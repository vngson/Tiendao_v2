import type { ChapterResponse } from "@/lib/api-client";

/**
 * Module-level chapter cache populated by the pre-warm path in
 * `<ChapterContent>` and read on the next mount of the same chapter.
 *
 * Why a singleton map and not React state:
 * - `<ChapterContent>` unmounts/remounts on each chapter change (key
 *   changes via `chapterUrl`). Local state would be wiped between mounts.
 * - A module-level `Map` survives the remount, so the second mount for
 *   chapter X+1 finds the resolved payload from the previous chapter's
 *   pre-warm and renders it without a network round-trip.
 *
 * Cap is intentionally small (32 entries) — the working set is the
 * current chapter + 1-2 neighbours. Older entries fall out via FIFO,
 * keeping memory bounded on long sessions.
 *
 * Only `status: "completed"` responses are stored. "processing" and
 * "failed" entries are not cached — the former because the result isn't
 * available yet, the latter because the failure path belongs to the
 * component that observed it (so it can show the retry button).
 */
const MAX_ENTRIES = 32;
const store = new Map<string, ChapterResponse>();

function evictIfFull() {
  while (store.size > MAX_ENTRIES) {
    const oldestKey = store.keys().next().value;
    if (oldestKey === undefined) break;
    store.delete(oldestKey);
  }
}

export function getCachedChapter(chapterUrl: string): ChapterResponse | null {
  const cached = store.get(chapterUrl);
  if (!cached || cached.status !== "completed") return null;
  // Touch — move to end of insertion order so the LRU-ish eviction keeps
  // recently-used entries alive longer.
  store.delete(chapterUrl);
  store.set(chapterUrl, cached);
  return cached;
}

export function setCachedChapter(
  chapterUrl: string,
  response: ChapterResponse,
): void {
  if (response.status !== "completed") return;
  store.set(chapterUrl, response);
  evictIfFull();
}

/** Test/debug helper — wipe the cache (not wired into the UI). */
export function clearChapterClientCache(): void {
  store.clear();
}
