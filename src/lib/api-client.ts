import type { Chapter, ChapterListPage, Novel, TranslatedChapter } from "@/domain/entities/novel";

export interface NovelDetailResponse {
  novel: Novel;
  /** Full ChapterListPage for the page containing the requested chapter.
   *  Includes totalPages, currentPage, pageSize — used by the ChapterList
   *  pager so "Trang N / M" renders correctly even when novel.totalChapters
   *  is null. */
  firstPage: ChapterListPage | null;
  /** Flat array of chapters for backward compat — equals firstPage.chapters. */
  firstPageChapters: Chapter[] | null;
  requestedChapterUrl: string | null;
  /**
   * Page index (1-based) that contains the requested chapter — i.e. the
   * page rendered on first paint. `null` when the user pasted a novel
   * landing page (no specific chapter requested) or when the server
   * couldn't determine the page after a 3-page scan cap.
   */
  requestedChapterPage: number | null;
  cacheHit: boolean;
}

export interface ChapterResponse {
  status: "completed" | "processing" | "failed";
  jobId?: string;
  pollUrl?: string;
  result?: TranslatedChapter;
  sourceUrl?: string;
  title?: string;
  paragraphs?: string[];
  novel?: { id: string; title: string };
  prevChapterUrl?: string | null;
  nextChapterUrl?: string | null;
  error?: string;
}

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, { cache: "no-store", ...init });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function fetchNovelByChapterUrl(url: string): Promise<NovelDetailResponse> {
  const qs = new URLSearchParams({ url });
  return fetchJson<NovelDetailResponse>(`/api/novel?${qs.toString()}`);
}

export async function fetchChapterList(args: {
  novelUrl: string;
  page: number;
}): Promise<ChapterListPage> {
  const qs = new URLSearchParams({
    novelUrl: args.novelUrl,
    page: String(args.page),
  });
  return fetchJson<ChapterListPage>(`/api/chapter/list?${qs.toString()}`);
}

/**
 * O(1) lookup of the page that contains the given chapter URL via the
 * server-side `chapterIndex` cache (written by deep-link pastes). Returns
 * `null` on cache miss — the reader page falls back to its sequential
 * scan in that case.
 */
export interface ChapterPageHint {
  page: number | null;
  novelUrl: string | null;
}

export async function fetchChapterPageHint(
  chapterUrl: string,
): Promise<ChapterPageHint> {
  const qs = new URLSearchParams({ url: chapterUrl });
  return fetchJson<ChapterPageHint>(
    `/api/novel/page-for-chapter?${qs.toString()}`,
  );
}

export async function requestChapter(
  url: string,
  signal?: AbortSignal,
): Promise<ChapterResponse> {
  const qs = new URLSearchParams({ url });
  return fetchJson<ChapterResponse>(`/api/chapter?${qs.toString()}`, signal ? { signal } : undefined);
}

export async function pollChapterStatus(jobId: string): Promise<ChapterResponse> {
  const qs = new URLSearchParams({ jobId });
  return fetchJson<ChapterResponse>(`/api/chapter/status?${qs.toString()}`);
}

/**
 * Absolute URL for the SSE chapter-status stream. `EventSource` (unlike
 * `fetch`) requires an absolute URL — passing a relative path throws on
 * every browser. The browser fills in `window.location.origin` so this
 * works on localhost, LAN hosts, and Vercel without config.
 */
export function chapterStatusStreamUrl(jobId: string): string {
  const qs = new URLSearchParams({ jobId });
  return `${window.location.origin}/api/chapter/stream?${qs.toString()}`;
}

export interface NovelInfo {
  id: string;
  title: string;
  titleVi: string | null;
  description: string;
  descriptionVi: string | null;
  author: string | null;
  authorVi: string | null;
  coverUrl: string | null;
  genre: readonly string[];
  genreVi: readonly string[] | null;
  status: string | null;
  statusVi: string | null;
  totalChapters: number | null;
  lastUpdatedAt: string | null;
  sourceUrl: string;
}

/**
 * Fetch the cached novel descriptor that powers the reader breadcrumb.
 *
 * The reader page passes the *chapter* URL (the only thing in the URL bar),
 * and the server-side `CacheService.getNovel` resolves it back to the parent
 * novel. Returns `null` when the novel hasn't been cached yet — caller
 * handles the soft-fail by rendering a generic "Đang đọc" title.
 */
export async function fetchNovelInfo(chapterUrl: string): Promise<NovelInfo | null> {
  const qs = new URLSearchParams({ novelUrl: chapterUrl });
  try {
    const res = await fetch(`/api/novel/info?${qs.toString()}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { novel: NovelInfo | null };
    return body.novel;
  } catch {
    return null;
  }
}

/**
 * True when the cached novel snapshot has Vietnamese fields filled in
 * for every field that has a Chinese counterpart. Fields with empty
 * Chinese source (no author, no status) are skipped — they don't need a
 * translation.
 */
export function novelInfoIsTranslated(info: NovelInfo): boolean {
  if (!info.titleVi) return false;
  if (!info.descriptionVi) return false;
  if (info.author && !info.authorVi) return false;
  if (info.status && !info.statusVi) return false;
  if (info.genre.length > 0) {
    if (!info.genreVi || info.genreVi.length !== info.genre.length) return false;
  }
  return true;
}

export interface PollNovelOptions {
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Poll `/api/novel/info` until the cached snapshot is translated (or the
 * caller aborts / the deadline hits). Used by the paste-flow page to
 * show the Vietnamese title/description/author swap in once the
 * background translation pass writes them to cache — without forcing the
 * initial `/api/novel` request to block until both passes finish.
 *
 * Returns the most recent snapshot on every tick (including on timeout)
 * so the caller can render whatever is cached so far.
 */
export async function pollNovelForTranslation(
  chapterUrl: string,
  opts: PollNovelOptions = {},
): Promise<NovelInfo | null> {
  const intervalMs = opts.intervalMs ?? 2500;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const deadline = Date.now() + timeoutMs;

  let last: NovelInfo | null = null;
  while (Date.now() <= deadline) {
    if (opts.signal?.aborted) {
      throw new DOMException("Polling aborted", "AbortError");
    }
    last = await fetchNovelInfo(chapterUrl);
    if (last && novelInfoIsTranslated(last)) return last;

    // Cap the wait so a cancelled/timeout caller doesn't sleep forever.
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, Math.min(intervalMs, remaining));
      // External abort cuts the wait short.
      opts.signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
  return last;
}
