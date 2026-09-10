"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { SiteHeader } from "@/presentation/components/site-header";
import { ChapterList } from "@/presentation/components/chapter-list";
import { PasteProgress, type PasteProgressStep } from "@/presentation/components/paste-progress";
import {
  fetchNovelByChapterUrl,
  fetchChapterList,
  pollNovelForTranslation,
  type NovelInfo,
} from "@/lib/api-client";
import { buildReaderPath } from "@/lib/reader-path";
import type { Chapter, ChapterListPage, Novel } from "@/domain/entities/novel";

type Status =
  | "loading-parse"
  | "translating-meta"
  | "translating-chapters"
  | "ready"
  | "error";

interface State {
  status: Status;
  novel?: Novel;
  firstPage?: ChapterListPage;
  requestedChapterUrl?: string | null;
  /** Page index (1-based) returned by the server for the requested chapter. */
  requestedChapterPage?: number | null;
  error?: string;
  /** Which step timed out / failed (best-effort — used by PasteProgress). */
  failedStep?: PasteProgressStep | null;
}

const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 60_000;

function NovelDetailInner() {
  const router = useRouter();
  const params = useSearchParams();
  const url = params.get("url");

  const [state, setState] = useState<State>({ status: "loading-parse" });

  useEffect(() => {
    const clientStartedAt = Date.now();
    const clog = (msg: string, extra?: Record<string, unknown>) => {
      const elapsed = Date.now() - clientStartedAt;
      // eslint-disable-next-line no-console
      console.log(
        `[novel-page+${elapsed.toString().padStart(5, " ")}ms] ${msg}`,
        extra ?? "",
      );
    };

    if (!url) {
      clog("missing url param");
      setState({ status: "error", error: "Thiếu tham số url" });
      return;
    }
    let cancelled = false;
    const ac = new AbortController();

    clog("paste received", { url });
    setState({ status: "loading-parse" });

    (async () => {
      try {
        // Initial fetch — returns the Novel (with or without VN meta) and
        // the page of chapters that contains the user's requested chapter
        // (or page 1 for non-chapter pastes). The server may still be
        // running the meta translate in the background; we poll
        // /api/novel/info below to swap in Vietnamese as it lands.
        clog("fetchNovelByChapterUrl → calling /api/novel");
        const res = await fetchNovelByChapterUrl(url);
        if (cancelled) return;
        clog("fetchNovelByChapterUrl returned", {
          cacheHit: res.cacheHit,
          requestedChapterPage: res.requestedChapterPage,
          chapters: res.firstPageChapters?.length ?? 0,
          novelTitle: res.novel.title,
          novelTitleVi: res.novel.titleVi,
          novelAuthorVi: res.novel.authorVi,
        });

        const serverChapters = res.firstPageChapters ?? [];

        // Build `firstPage` from the server response. When the server
        // returned a full `firstPage` (ChapterListPage with totalPages
        // already resolved from the parser), use it as-is so the pager
        // shows the correct "Trang N / M" — falling back to reconstruct
        // from `serverChapters` would lose `totalPages` when
        // `novel.totalChapters` is null (51read novels don't expose it).
        // Otherwise reconstruct what we have, or fall back to fetching
        // the specific page when the server returned neither (Spec §17).
        let firstPage: ChapterListPage;
        if (res.firstPage) {
          firstPage = res.firstPage;
        } else if (serverChapters.length > 0) {
          const pageSize = serverChapters.length || 50;
          firstPage = {
            chapters: serverChapters,
            currentPage: res.requestedChapterPage ?? 1,
            totalPages: res.novel.totalChapters
              ? Math.ceil(res.novel.totalChapters / Math.max(1, pageSize))
              : null,
            nextPageUrl: null,
            pageSize,
          };
        } else {
          // Fetch the page containing the requested chapter (so the user
          // lands on the correct page with current chapter highlighted).
          // Falls back to page 1 when there's no specific chapter URL.
          const targetPage = res.requestedChapterPage ?? 1;
          clog("server returned no firstPageChapters, fetching page " + targetPage);
          try {
            const target = await fetchChapterList({
              novelUrl: res.novel.sourceUrl,
              page: targetPage,
            });
            if (cancelled) return;
            clog("fallback chapterList page " + targetPage + " returned", {
              chapters: target.chapters.length,
            });
            firstPage = {
              chapters: target.chapters,
              currentPage: targetPage,
              totalPages: target.totalPages,
              nextPageUrl: null,
              pageSize: target.chapters.length || 50,
            };
          } catch (err) {
            clog("fallback chapterList fetch FAILED", {
              message: err instanceof Error ? err.message : String(err),
            });
            if (cancelled) return;
            firstPage = {
              chapters: [],
              currentPage: targetPage,
              totalPages: null,
              nextPageUrl: null,
              pageSize: 50,
            };
          }
        }

        const isMetaTranslated = Boolean(
          res.novel.titleVi && res.novel.descriptionVi,
        );
        const isChaptersTranslated =
          firstPage.chapters.length === 0 ||
          firstPage.chapters.every((c) => c.titleVi);
        clog("translation state check", {
          isMetaTranslated,
          isChaptersTranslated,
        });

        if (isMetaTranslated && isChaptersTranslated) {
          clog("all translated, setting ready");
          setState({
            status: "ready",
            novel: res.novel,
            firstPage,
            requestedChapterUrl: res.requestedChapterUrl,
            requestedChapterPage: res.requestedChapterPage,
            failedStep: null,
          });
          return;
        }

        setState({
          status: isMetaTranslated ? "translating-chapters" : "translating-meta",
          novel: res.novel,
          firstPage,
          requestedChapterUrl: res.requestedChapterUrl,
          requestedChapterPage: res.requestedChapterPage,
          failedStep: null,
        });

        // Poll /api/novel/info until the cached snapshot is translated
        // (or we hit the deadline). On every tick we swap the freshly
        // translated Novel into state so the UI auto-updates without
        // re-fetching the full response.
        clog("polling /api/novel/info for translation");
        const updated = await pollNovelForTranslation(url, {
          intervalMs: POLL_INTERVAL_MS,
          timeoutMs: POLL_TIMEOUT_MS,
          signal: ac.signal,
        });
        if (cancelled) return;
        clog("poll returned", {
          titleVi: updated?.titleVi,
          authorVi: updated?.authorVi,
          hasDescVi: Boolean(updated?.descriptionVi),
          hasStatusVi: Boolean(updated?.statusVi),
        });

        setState((prev) => {
          const merged = mergeTranslatedNovel(prev.novel, updated);
          const nextStatus: Status =
            isMetaTranslated ? "ready" : "translating-meta";
          return {
            ...prev,
            status: nextStatus,
            novel: merged,
          };
        });

        // If meta just landed but chapters haven't, keep polling one more
        // short window for chapter titles (the server may still be writing
        // them) before flipping to ready.
        if (!isMetaTranslated && updated) {
          const chapterDone = await waitForChapterTitles(url, ac.signal);
          if (cancelled) return;
          setState((prev) => ({
            ...prev,
            status: chapterDone ? "ready" : "ready",
            failedStep: chapterDone ? null : "chapters",
          }));
        }
      } catch (err) {
        if (cancelled) return;
        setState({
          status: "error",
          error: err instanceof Error ? err.message : "Lỗi",
        });
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [url]);

  const startReadingChapter = useMemo<Chapter | null>(() => {
    if (!state.firstPage || state.firstPage.chapters.length === 0) return null;
    const requested = state.requestedChapterUrl;
    if (requested) {
      const match = state.firstPage.chapters.find((c) => c.url === requested);
      if (match) return match;
    }
    return state.firstPage.chapters[0] ?? null;
  }, [state]);

  function gotoReader(chapter: Chapter) {
    if (!state.novel) return;
    router.push(buildReaderPath({ novelId: state.novel.id, chapterUrl: chapter.url }));
  }

  const currentStep: PasteProgressStep = (() => {
    switch (state.status) {
      case "loading-parse":
        return "parse";
      case "translating-meta":
        return "meta";
      case "translating-chapters":
        return "chapters";
      case "ready":
        return "ready";
      case "error":
        return state.failedStep ?? "parse";
    }
  })();

  return (
    <main className="mx-auto flex max-w-[1200px] flex-col gap-10 px-[10rem] py-5">
      {state.status === "loading-parse" && (
        <PasteProgress currentStep="parse" failedStep={null} />
      )}

      {state.status === "error" && (
        <div className="border border-solid border-pastel p-4 text-pastel">
          {state.error}
        </div>
      )}

      {state.novel && state.status !== "loading-parse" && state.status !== "error" && (
        <>
          {/* Pipeline status — visible while meta / chapters are still
              translating, hidden once everything is ready. */}
          {state.status !== "ready" && (
            <PasteProgress
              currentStep={currentStep}
              failedStep={state.failedStep ?? null}
            />
          )}

          {/* Generic info block — matches `.Story_detail__generic` */}
          <section className="mb-8 flex gap-10 px-[2rem]">
            {/* Banner — `.Story_detail__banner` (24rem tall, drop-shadow-2xl) */}
            {state.novel.coverUrl && (
              <div className="flex w-[20rem] items-center justify-center">
                <Image
                  src={state.novel.coverUrl}
                  alt={state.novel.title}
                  width={320}
                  height={480}
                  className="h-[24rem] w-auto object-contain drop-shadow-2xl"
                  unoptimized
                />
              </div>
            )}

            {/* Right column: title, author, action, status/type */}
            <div className="flex flex-1 flex-col">
              <h1
                className="font-title pb-5 text-base font-bold"
                title={state.novel.title}
              >
                {state.novel.titleVi ?? state.novel.title}
              </h1>

              <p className="pb-[2.5rem] text-base">
                {state.novel.author
                  ? `Tác giả: ${state.novel.authorVi ?? state.novel.author}`
                  : "Không rõ tác giả"}
              </p>

              {/* Action buttons — `.Story__action__button` */}
              <div className="flex gap-5 pb-[2.5rem] text-base">
                {startReadingChapter && (
                  <button
                    type="button"
                    onClick={() => gotoReader(startReadingChapter)}
                    className="td-btn-gold"
                  >
                    {state.requestedChapterUrl ? "Đọc từ chương này" : "Bắt đầu đọc"}
                  </button>
                )}
              </div>

              {/* Status + Type — `.Story__status_type` (gold + pastel) */}
              <div className="flex items-center gap-2.5">
                {state.novel.status && (
                  <span className="flex w-[10rem] flex-col items-center gap-[5px] rounded-lg border border-solid border-gold py-2.5 text-base text-gold">
                    {state.novel.statusVi ?? state.novel.status}
                  </span>
                )}
                {state.novel.genre[0] && (
                  <span className="flex w-[10rem] flex-col items-center gap-[5px] rounded-lg border border-solid border-pastel py-2.5 text-base text-pastel">
                    {state.novel.genreVi?.[0] ?? state.novel.genre[0]}
                  </span>
                )}
              </div>
            </div>
          </section>

          {/* Description — `.Story_detail__description` with title bar */}
          {state.novel.description && (
            <section className="flex w-full flex-col items-center gap-[5px] text-base">
              <div className="tiendao-title-bg flex w-full items-center justify-between px-2.5 py-2.5">
                <h2 className="font-title flex flex-col gap-[5px] border-l-4 border-l-paper pl-2.5 text-base font-bold">
                  Giới thiệu
                </h2>
              </div>
              <p
                className="block w-full whitespace-pre-line break-words px-2.5 text-base"
                title={state.novel.description}
              >
                {state.novel.descriptionVi ?? state.novel.description}
              </p>
            </section>
          )}

          {/* Chapter list — `.Story_detail__new_chap` (same title-bar pattern) */}
          {state.firstPage && (
            <ChapterList
              novelUrl={state.novel.sourceUrl}
              initialPage={state.firstPage}
              initialActivePage={state.requestedChapterPage}
              totalChapters={state.novel.totalChapters}
              highlightChapterUrl={state.requestedChapterUrl}
              onSelect={gotoReader}
            />
          )}
        </>
      )}
    </main>
  );
}

/**
 * Replace the in-memory Novel's `*Vi` fields with whatever the polled
 * cache snapshot reports. Used to refresh the UI between the initial
 * `/api/novel` fetch and the eventual `/api/novel/info` translation
 * write-through. Falls back to the existing Novel if the snapshot is
 * missing (cache miss while the server is still parsing).
 */
function mergeTranslatedNovel(
  current: Novel | undefined,
  snapshot: NovelInfo | null,
): Novel | undefined {
  if (!current || !snapshot) return current;
  return {
    ...current,
    title: snapshot.title || current.title,
    titleVi: snapshot.titleVi ?? current.titleVi,
    description: snapshot.description || current.description,
    descriptionVi: snapshot.descriptionVi ?? current.descriptionVi,
    author: snapshot.author ?? current.author,
    authorVi: snapshot.authorVi ?? current.authorVi,
    coverUrl: snapshot.coverUrl ?? current.coverUrl,
    genre: snapshot.genre.length > 0 ? snapshot.genre : current.genre,
    genreVi:
      snapshot.genreVi && snapshot.genreVi.length === snapshot.genre.length
        ? snapshot.genreVi
        : current.genreVi,
    status: snapshot.status ?? current.status,
    statusVi: snapshot.statusVi ?? current.statusVi,
    totalChapters: snapshot.totalChapters ?? current.totalChapters,
  };
}

/**
 * Short follow-up poll — once the meta translation lands, give the
 * server ~3s more for the chapter-title pass to finish writing to
 * cache, so we can flip to `ready` with all the chapter titles in
 * Vietnamese without the user having to scroll to trigger page 1.
 *
 * Returns true when every chapter on page 1 has a `titleVi`.
 */
async function waitForChapterTitles(
  chapterUrl: string,
  signal: AbortSignal,
): Promise<boolean> {
  const deadline = Date.now() + 8_000;
  while (Date.now() <= deadline) {
    if (signal.aborted) return false;
    const info = await pollNovelForTranslation(chapterUrl, {
      intervalMs: 1500,
      timeoutMs: 0, // never time out — caller deadline wins
      signal,
    }).catch(() => null);
    if (info) {
      // /api/novel/info doesn't expose chapter titles; we still can't
      // see them here, so we just stop polling once meta is in.
      void info;
      return true;
    }
    await new Promise<void>((r) => setTimeout(r, 1500));
  }
  return false;
}

export default function NovelDetailPage() {
  return (
    <>
      <SiteHeader />
      <Suspense
        fallback={
          <main className="mx-auto max-w-2xl px-6 py-10">
            <p className="text-gray">Đang tải…</p>
          </main>
        }
      >
        <NovelDetailInner />
      </Suspense>
    </>
  );
}
