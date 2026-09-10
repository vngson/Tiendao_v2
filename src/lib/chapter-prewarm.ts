import {
  chapterStatusStreamUrl,
  pollChapterStatus,
  requestChapter,
  type ChapterResponse,
} from "@/lib/api-client";
import { setCachedChapter } from "@/lib/chapter-client-cache";

/**
 * Module-level registry of in-flight pre-warm promises, keyed by chapter
 * URL. When the user navigates to a chapter that has an active pre-warm
 * (because the previous chapter's `<ChapterContent>` started one), the
 * new mount awaits it instead of issuing its own `requestChapter` call.
 *
 * Why module-level (not React state): the pre-warm runs on the
 * `<ChapterContent>` for chapter A. When the user clicks "Chương tiếp"
 * the A instance unmounts and a new B instance mounts. Without a shared
 * store, the in-flight job for B is orphaned (server still runs it but
 * no client subscribes), and B's mount starts a fresh job — duplicating
 * work and burning quota.
 */
const inFlight = new Map<string, Promise<ChapterResponse | null>>();

/**
 * Kick off a pre-warm for `chapterUrl`. Returns the same promise on
 * repeat calls for the same URL (idempotent), so multiple `<ChapterContent>`
 * mounts racing each other share a single network round-trip.
 *
 * Behaviour:
 *   1. `requestChapter(url)` — sync cache hit returns immediately.
 *   2. Otherwise subscribe to `/api/chapter/stream?jobId=...` (SSE) and
 *      fall back to polling if EventSource isn't available.
 *   3. On `completed`, write the response to the client-side cache so
 *      the next visit to this URL hits the fast path in
 *      `<ChapterContent>`.
 *
 * Resolves with the cached `ChapterResponse` on success, or `null` on
 * failure / timeout. Never throws — pre-warm must never surface errors
 * to the user.
 */
export function prewarmChapter(chapterUrl: string): Promise<ChapterResponse | null> {
  const existing = inFlight.get(chapterUrl);
  if (existing) return existing;

  const promise = (async (): Promise<ChapterResponse | null> => {
    let res: ChapterResponse;
    try {
      res = await requestChapter(chapterUrl);
    } catch {
      return null;
    }

    if (res.status === "completed") {
      setCachedChapter(chapterUrl, res);
      return res;
    }
    if (res.status !== "processing" || !res.jobId) {
      return null;
    }

    // Async path — wait for the server-side job via SSE, with a polling
    // fallback for browsers that don't support EventSource or that
    // experience a transient stream error.
    const completed = await waitForJob(res.jobId);
    if (completed) {
      setCachedChapter(chapterUrl, completed);
    }
    return completed;
  })().finally(() => {
    // Free the registry slot either way so the next visit (after this
    // window) can issue a fresh request.
    inFlight.delete(chapterUrl);
  });

  inFlight.set(chapterUrl, promise);
  return promise;
}

/**
 * Test/debug helper — wipe the in-flight registry (not wired into UI).
 * Useful for unit tests asserting cache-write behaviour without leaving
 * promises dangling between cases.
 */
export function clearPrewarmRegistry(): void {
  inFlight.clear();
}

/**
 * Check whether a pre-warm is currently running for `chapterUrl`. Used
 * by `<ChapterContent>` on mount — if the previous chapter's pre-warm
 * is still resolving this URL, the new mount waits for it instead of
 * issuing a duplicate `requestChapter`.
 *
 * Returns the in-flight promise if one exists, `null` otherwise.
 */
export function getPrewarmInFlight(
  chapterUrl: string,
): Promise<ChapterResponse | null> | null {
  return inFlight.get(chapterUrl) ?? null;
}

function waitForJob(jobId: string): Promise<ChapterResponse | null> {
  return new Promise((resolve) => {
    let resolved = false;
    const settle = (value: ChapterResponse | null) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(value);
    };

    // 5 min hard cap mirrors POLL_TIMEOUT_MS in chapter-content. After
    // this the server job is presumed dead; the pre-warm gives up and
    // the on-demand path will retry the translation.
    const deadline = setTimeout(() => settle(null), 5 * 60_000);

    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    const stopPolling = () => {
      if (pollTimer !== null) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
    };

    const cleanup = () => {
      clearTimeout(deadline);
      stopPolling();
      if (typeof EventSource !== "undefined" && es) es.close();
    };

    let es: EventSource | null = null;
    if (typeof EventSource !== "undefined") {
      es = new EventSource(chapterStatusStreamUrl(jobId));
      es.addEventListener("status", (e) => {
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
          settle({
            status: "completed",
            result: payload.result,
            sourceUrl: payload.result.sourceUrl,
            title: payload.result.title,
            paragraphs: [...payload.result.paragraphs],
            novel: payload.result.novel,
            prevChapterUrl: payload.result.prevChapterUrl,
            nextChapterUrl: payload.result.nextChapterUrl,
          });
        } else if (payload.status === "failed") {
          settle(null);
        }
      });
      es.onerror = () => {
        if (es && es.readyState === EventSource.CLOSED) {
          // Stream closed without a terminal event — fall back to
          // polling so the pre-warm still completes when the job
          // resolves.
          es.close();
          es = null;
          startPolling();
        }
      };
    } else {
      startPolling();
    }

    function startPolling() {
      const tick = () => {
        pollChapterStatus(jobId)
          .then((status) => {
            if (resolved) return;
            if (status.status === "completed" && status.result) {
              settle({
                status: "completed",
                result: status.result,
                sourceUrl: status.result.sourceUrl,
                title: status.result.title,
                paragraphs: [...status.result.paragraphs],
                novel: status.result.novel,
                prevChapterUrl: status.result.prevChapterUrl,
                nextChapterUrl: status.result.nextChapterUrl,
              });
              return;
            }
            if (status.status === "failed") {
              settle(null);
              return;
            }
            pollTimer = setTimeout(tick, 2_000);
          })
          .catch(() => {
            // Transient poll failure — try again next tick rather than
            // giving up on the pre-warm.
            if (!resolved) pollTimer = setTimeout(tick, 2_000);
          });
      };
      tick();
    }
  });
}
