"use client";

import { useEffect, useRef, useState } from "react";
import {
  chapterStatusStreamUrl,
  pollChapterStatus,
  requestChapter,
} from "@/lib/api-client";
import {
  getCachedChapter,
  setCachedChapter,
} from "@/lib/chapter-client-cache";
import { prewarmChapter, getPrewarmInFlight } from "@/lib/chapter-prewarm";
import {
  recordChapterRead,
  updateScrollPosition,
} from "@/presentation/utils/reading-history";
import type { ChapterResponse } from "@/lib/api-client";
import type { Chapter } from "@/domain/entities/novel";
import { ChapterNav } from "@/presentation/components/chapter-nav";

interface ChapterReaderProps {
  chapterUrl: string;
  novel: { id: string; title: string; sourceUrl: string; coverUrl: string | null };
  chapter: Chapter;
  prevChapter: Chapter | null;
  nextChapter: Chapter | null;
  initialScrollPosition: number;
  onNavigate: (chapter: Chapter) => void;
  /**
   * Opens the chapter-picker dialog (lives in the parent page). Bottom
   * nav delegates here so the picker state stays owned by the reader
   * page, not duplicated in the chapter body.
   */
  onOpenPicker?: () => void;
  /**
   * Fires when the translated chapter title becomes available so the
   * parent can show it under the novel title. Empty string when the
   * translation failed / no title was returned.
   */
  onTitleLoaded?: (title: string) => void;
}

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 5 * 60_000;

// Cap shown-time at 90s before we surface a "retry" prompt. The hard 5-minute
// backend poll still runs in the background; this is just a UX hint so the user
// isn't staring at an unbounded spinner.
const USER_TIMEOUT_MS = 90_000;

// How long we expect an average chapter translation to take. Used to
// render a coarse ETA hint under the "Đang dịch chương…" line so first-time
// users don't assume the app is frozen while waiting. The SSE stream does
// not emit chunk counts yet (it's a coarse "processing" → "completed"
// signal), so we use a fixed assumption calibrated against M3/Groq
// round-trips observed in dev. The hint updates every second.
const EXPECTED_TRANSLATION_SECONDS = 25;

/**
 * Chapter content — TienDao ChapDetail style.
 *
 * Layout mirrors `.Chap_detail` from ChapDetail.css:
 * - Page padding `px-[12rem]` is handled by the parent /read page.
 * - Content font-size `2.4rem` with `whitespace: pre-wrap` (via `.reader-content`).
 * - Pagination controls at the top and bottom match `.Chap__action_top` /
 *   `.Chap__action_bottom` (gold border buttons, 15rem wide).
 */
export function ChapterContent({
  chapterUrl,
  novel,
  chapter,
  prevChapter,
  nextChapter,
  initialScrollPosition,
  onNavigate,
  onOpenPicker,
  onTitleLoaded,
}: ChapterReaderProps) {
  const [state, setState] = useState<ChapterResponse>({ status: "processing" });
  // Bump on "Thử lại" click so the polling effect re-runs.
  const [retryNonce, setRetryNonce] = useState(0);
  // True once we've been "processing" for > USER_TIMEOUT_MS without resolving
  // — used to surface the retry button while the background poller keeps going.
  const [showSlowHint, setShowSlowHint] = useState(false);
  // Seconds since the current translation started. Reset to 0 on each new
  // chapterUrl / retry. Used to render the ETA hint under "Đang dịch chương…".
  const [elapsedSec, setElapsedSec] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reset + fetch on chapterUrl change or retry.
  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let slowHintTimer: ReturnType<typeof setTimeout> | null = null;
    let cleanup: (() => void) | null = null;
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    setState({ status: "processing" });
    setShowSlowHint(false);
    setElapsedSec(0);

    // Fast path: if a previous chapter's pre-warm already resolved this
    // URL, render it immediately instead of cycling through
    // "Đang dịch…" → SSE/polling. The cache survives remounts because it
    // lives at module scope (see chapter-client-cache.ts), which is the
    // key property — local React state would be wiped on the chapter
    // change that triggers this effect.
    const cached = getCachedChapter(chapterUrl);
    if (cached && cached.status === "completed" && cached.paragraphs) {
      setState({
        status: "completed",
        title: cached.title ?? "",
        paragraphs: [...cached.paragraphs],
        sourceUrl: cached.sourceUrl ?? chapterUrl,
        novel: cached.novel ?? { id: "", title: "" },
        prevChapterUrl: cached.prevChapterUrl ?? null,
        nextChapterUrl: cached.nextChapterUrl ?? null,
      });
      onTitleLoaded?.(cached.title ?? "");
      return;
    }

    // Mid-flight path: the previous chapter's pre-warm started a job
    // for this URL and is still resolving it. Wait for that job instead
    // of starting a duplicate — duplicate jobs burn provider quota and
    // double the wait. The pre-warm helper writes the result to the
    // client cache when it completes, so on resolution we re-read the
    // cache rather than reusing the promise payload (the cache survives
    // if the user navigated again while we were waiting).
    const inFlight = getPrewarmInFlight(chapterUrl);
    if (inFlight) {
      inFlight
        .then(() => {
          if (cancelled) return;
          const cachedAfterPrewarm = getCachedChapter(chapterUrl);
          if (
            cachedAfterPrewarm &&
            cachedAfterPrewarm.status === "completed" &&
            cachedAfterPrewarm.paragraphs
          ) {
            setState({
              status: "completed",
              title: cachedAfterPrewarm.title ?? "",
              paragraphs: [...cachedAfterPrewarm.paragraphs],
              sourceUrl: cachedAfterPrewarm.sourceUrl ?? chapterUrl,
              novel: cachedAfterPrewarm.novel ?? { id: "", title: "" },
              prevChapterUrl: cachedAfterPrewarm.prevChapterUrl ?? null,
              nextChapterUrl: cachedAfterPrewarm.nextChapterUrl ?? null,
            });
            onTitleLoaded?.(cachedAfterPrewarm.title ?? "");
            return;
          }
          // Pre-warm failed or returned no data — fall through to the
          // regular requestChapter flow below.
          run();
        })
        .catch(() => {
          if (cancelled) return;
          run();
        });
      return;
    }

    // Surface a "đợi lâu quá, muốn thử lại?" hint after USER_TIMEOUT_MS so
    // the user isn't stuck on the shimmer forever. Polling keeps running.
    slowHintTimer = setTimeout(() => {
      if (!cancelled) setShowSlowHint(true);
    }, USER_TIMEOUT_MS);

    // Tick once per second so the ETA hint under "Đang dịch chương…" reflects
    // the actual elapsed time. Cheap (one setState per second, no re-render
    // of children since `<ChapterContent>` is the only consumer).
    const startedAt = Date.now();
    const tickTimer = setInterval(() => {
      if (cancelled) return;
      setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    }, 1_000);

    async function run() {
      try {
        const res = await requestChapter(chapterUrl);
        if (cancelled) return;

        if (res.status === "completed" && res.paragraphs) {
          const completed: ChapterResponse = {
            status: "completed",
            title: res.title ?? "",
            paragraphs: [...res.paragraphs],
            sourceUrl: res.sourceUrl ?? chapterUrl,
            novel: res.novel ?? { id: "", title: "" },
            prevChapterUrl: res.prevChapterUrl ?? null,
            nextChapterUrl: res.nextChapterUrl ?? null,
          };
          setState(completed);
          setCachedChapter(chapterUrl, completed);
          onTitleLoaded?.(completed.title ?? "");
          return;
        }
        if (res.status === "failed") {
          setState({ status: "failed", error: res.error ?? "Lỗi không xác định" });
          return;
        }

        // processing → subscribe to SSE stream (preferred: server pushes
        // completion the moment the job resolves). Fall back to the
        // legacy setTimeout poll if EventSource isn't available (older
        // browsers) or the stream errors out.
        const jobId = res.jobId;
        if (!jobId) {
          setState({ status: "failed", error: "No jobId returned" });
          return;
        }

        const applyCompleted = (result: NonNullable<ChapterResponse["result"]>) => {
          const completed: ChapterResponse = {
            status: "completed",
            result,
            sourceUrl: result.sourceUrl,
            title: result.title,
            paragraphs: [...result.paragraphs],
            novel: result.novel,
            prevChapterUrl: result.prevChapterUrl,
            nextChapterUrl: result.nextChapterUrl,
          };
          setState(completed);
          // Cache the streamed / polled completion so the next visit to
          // this URL hits the fast path at the top of this effect.
          setCachedChapter(chapterUrl, completed);
          onTitleLoaded?.(result.title ?? "");
        };

        const applyFailed = (error: string) => {
          setState({ status: "failed", error });
        };

        // Legacy polling fallback — reused by both the "EventSource
        // unsupported" path and the "stream errored" recovery path.
        const legacyPoll = () => {
          if (cancelled) return;
          if (Date.now() > deadline) {
            applyFailed("Quá thời gian chờ");
            return;
          }
          pollChapterStatus(jobId)
            .then((status) => {
              if (cancelled) return;
              if (status.status === "completed" && status.result) {
                applyCompleted(status.result);
                return;
              }
              if (status.status === "failed") {
                applyFailed(status.error ?? "Dịch thất bại");
                return;
              }
              setTimeout(legacyPoll, POLL_INTERVAL_MS);
            })
            .catch((err: unknown) => {
              if (cancelled) return;
              applyFailed(err instanceof Error ? err.message : "Lỗi polling");
            });
        };

        if (typeof EventSource === "undefined") {
          void legacyPoll();
          return;
        }

        const es = new EventSource(chapterStatusStreamUrl(jobId));
        let fellBackToPolling = false;
        const fallBack = () => {
          if (fellBackToPolling || cancelled) return;
          fellBackToPolling = true;
          es.close();
          void legacyPoll();
        };

        es.addEventListener("status", (e) => {
          if (cancelled) return;
          let payload: {
            status: string;
            result?: ChapterResponse["result"];
            error?: string;
          } | null = null;
          try {
            payload = JSON.parse((e as MessageEvent).data);
          } catch {
            return;
          }
          if (!payload) return;
          if (payload.status === "completed" && payload.result) {
            applyCompleted(payload.result);
            es.close();
            return;
          }
          if (payload.status === "failed") {
            applyFailed(payload.error ?? "Dịch thất bại");
            es.close();
            return;
          }
          if (payload.status === "expired" || payload.status === "timeout") {
            // Stream gave up — switch to one-shot poll.
            fallBack();
          }
        });

        // EventSource doesn't expose `onclose` distinctly from `onerror`,
        // so we treat any error as "recover via polling" once. The
        // browser auto-reconnects after a network blip, but for our use
        // case (chapter change closes it anyway) polling is simpler.
        es.onerror = () => {
          if (cancelled) return;
          // If the stream has been definitively closed (not just a
          // transient blip), EventSource.readyState === CLOSED.
          if (es.readyState === EventSource.CLOSED) {
            fallBack();
          }
        };

        // Cleanup: close the stream on chapter change / unmount. Without
        // this the browser keeps the connection open until the server
        // closes it, which is wasteful and can fire `onmessage` into a
        // stale component.
        cleanup = () => {
          es.close();
        };
        return;
      } catch (err) {
        if (cancelled) return;
        setState({
          status: "failed",
          error: err instanceof Error ? err.message : "Lỗi",
        });
      }
    }

    void run();

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (slowHintTimer) clearTimeout(slowHintTimer);
      clearInterval(tickTimer);
      if (cleanup) cleanup();
    };
  }, [chapterUrl, retryNonce, onTitleLoaded]);

  // Restore + persist scroll position; record reading history when loaded.
  useEffect(() => {
    if (state.status !== "completed") return;
    recordChapterRead({ novel, chapter, scrollPosition: 0 });

    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = initialScrollPosition;
      }
    });

    const onScroll = () => {
      if (!scrollRef.current) return;
      updateScrollPosition(novel.id, scrollRef.current.scrollTop);
    };
    const el = scrollRef.current;
    el?.addEventListener("scroll", onScroll, { passive: true });
    return () => el?.removeEventListener("scroll", onScroll);
  }, [state.status, novel, chapter, initialScrollPosition]);

  // Pre-warm the next chapter after the current one finishes + the user
  // has had a moment to start reading. The pre-warm helper subscribes
  // to the server-side job via SSE/polling and writes the result to the
  // client cache when it completes — so when the user clicks "Chương
  // tiếp" the next mount hits the fast path at the top of this
  // component's effect (or waits on the in-flight pre-warm if the job
  // hasn't resolved yet). Guarded by:
  //   - 3 s idle delay (so we don't fire while the user is still deciding)
  //   - `document.visibilityState` (don't burn provider quota in a hidden
  //     tab; the user may not even click next)
  //   - cleanup only unsubscribes from visibility — we DO NOT cancel the
  //     pre-warm promise, because the next chapter's mount may already be
  //     waiting for it.
  useEffect(() => {
    console.log("[prewarm] effect run", {
      status: state.status,
      hasNextChapter: !!nextChapter,
      nextChapterUrl: nextChapter?.url ?? null,
    });
    if (state.status !== "completed" || !nextChapter) {
      console.log("[prewarm] skip (status not completed or no nextChapter)");
      return;
    }
    if (typeof window === "undefined") return;

    const fire = () => {
      const visibility = document.visibilityState;
      console.log("[prewarm] fire attempt", {
        nextChapterUrl: nextChapter.url,
        visibility,
      });
      if (visibility !== "visible") {
        console.log("[prewarm] skip (tab hidden)");
        return;
      }
      console.log("[prewarm] → prewarmChapter started", {
        url: nextChapter.url,
      });
      // prewarmChapter owns the SSE/polling lifecycle and the cache
      // write on completion. The returned promise resolves when the
      // client cache for this URL has been populated (or the job fails
      // / times out) — but we don't `await` it here. The next mount
      // will await it via `getPrewarmInFlight` if the user clicks
      // "Chương tiếp" before the job finishes.
      prewarmChapter(nextChapter.url)
        .then((res) => {
          console.log("[prewarm] ← prewarmChapter settled", {
            url: nextChapter.url,
            status: res?.status ?? "null",
          });
        })
        .catch((err: unknown) => {
          console.log("[prewarm] ✗ prewarmChapter failed", {
            url: nextChapter.url,
            error: err instanceof Error ? err.message : String(err),
          });
        });
    };

    const idleTimer = setTimeout(fire, 3_000);

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        console.log("[prewarm] visibilitychange → visible, firing");
        fire();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearTimeout(idleTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      console.log("[prewarm] cleanup (chapter change / unmount)");
      // NOTE: pre-warm is NOT aborted here. The promise keeps running
      // in the module-level registry, and the next chapter's mount
      // joins it via `getPrewarmInFlight`. Aborting here would force a
      // duplicate job when the user navigates to next before the
      // current pre-warm resolves.
    };
  }, [state.status, nextChapter]);

  return (
    <div ref={scrollRef} className="h-full w-full overflow-y-auto">
      {state.status === "processing" && (
        <div className="reader-content mx-auto mt-12 flex flex-col gap-6 text-center">
          <p className="text-base text-gray">
            Đang dịch chương…
            {/* Coarse ETA — calibrated against the M3/Groq round-trip
             * latency observed in dev (≈20-30s for an average chapter).
             * Hides after the expected window since the "Lâu hơn dự
             * kiến" hint takes over. */}
            {!showSlowHint && elapsedSec <= EXPECTED_TRANSLATION_SECONDS && (
              <span className="ml-2 text-gray">
                ~{Math.max(1, EXPECTED_TRANSLATION_SECONDS - elapsedSec)}s nữa
              </span>
            )}
            {showSlowHint && (
              <span className="ml-2 text-pastel">
                Lâu hơn dự kiến — bạn có thể thử lại trong khi chờ.
              </span>
            )}
          </p>
          <div className="td-shimmer-bar" aria-hidden />
          {/* Skeleton paragraphs — 4 lines of varied widths so the page
            *   doesn't look empty while the translation streams in. */}
          <div className="flex flex-col gap-3">
            <div className="td-skeleton" style={{ width: "92%" }} />
            <div className="td-skeleton" style={{ width: "78%" }} />
            <div className="td-skeleton" style={{ width: "88%" }} />
            <div className="td-skeleton" style={{ width: "60%" }} />
          </div>
          {showSlowHint && (
            <button
              type="button"
              onClick={() => setRetryNonce((n) => n + 1)}
              className="td-btn-gold mx-auto w-[18rem] text-[1.4rem]"
            >
              Thử lại
            </button>
          )}
        </div>
      )}

      {state.status === "failed" && (
        <div className="mx-auto mt-12 flex max-w-[60rem] flex-col items-center gap-4 border border-solid border-pastel p-6 text-center text-pastel">
          <p className="font-title text-lg font-bold">Không tải được chương</p>
          <p className="text-base text-black">{state.error}</p>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="td-btn-gold w-[18rem] text-[1.4rem]"
          >
            Thử lại
          </button>
        </div>
      )}

      {state.status === "completed" && state.paragraphs && (
        <>
          {/* Body — `.Chap__content` from ChapDetail.css.
            *   All sizing (font-size, line-height, max-width, padding-x) is
            *   driven by CSS vars defined on `<html>` from the settings dialog,
            *   so do NOT add Tailwind utilities here — they would win the
            *   cascade and freeze the controls. */}
          <div className="reader-content my-8">
            {state.paragraphs
              // Drop pure-punctuation paragraphs ("……", "----", "***"
              // etc.) — Chinese/VN web-novel sources use these as chapter
              // break markers, not as content. Whitespace-only strings
              // also collapse to no useful text.
              .filter((p) => p.trim().length > 0 && !/^[\s\.\-—…*·,，。]+$/.test(p.trim()))
              .map((p, i) => (
                <p key={i}>{p}</p>
              ))}
          </div>

          {/* Bottom action bar — mirrors the top nav so users land on the same
            *   controls after scrolling the chapter. Capped at 80rem so it
            *   doesn't stretch across the whole viewport. Only renders
            *   AFTER the chapter body has loaded so the prev/next controls
            *   don't compete with the "Đang dịch chương…" skeleton above. */}
          <div className="mx-auto mt-12 flex w-full max-w-[80rem] flex-wrap items-center justify-center gap-3 px-4 text-base md:px-10 lg:px-20">
            <ChapterNav
              prev={prevChapter}
              next={nextChapter}
              novelSourceUrl={novel.sourceUrl}
              onOpenPicker={onOpenPicker ?? (() => {})}
              onNavigate={onNavigate}
            />
          </div>
        </>
      )}
    </div>
  );
}
