/**
 * Domain entities. Pure data types, no I/O.
 */

export interface Novel {
  /** Unique identifier within the source website. */
  readonly id: string;
  /** Source-specific stable URL for the novel landing page. */
  readonly sourceUrl: string;
  /** Origin (scheme + host) for resolving relative URLs. */
  readonly origin: string;
  /** Original Chinese title from the source page. */
  readonly title: string;
  /** Vietnamese translation of the title (filled in by translation pipeline). */
  readonly titleVi?: string;
  readonly author: string | null;
  /** Vietnamese translation of the author name (filled in by translation pipeline). */
  readonly authorVi?: string;
  readonly coverUrl: string | null;
  readonly genre: readonly string[];
  /** Vietnamese renderings of the genre tags, same length as `genre`. */
  readonly genreVi?: readonly string[];
  readonly status: string | null;
  /** Vietnamese translation of the publication status. */
  readonly statusVi?: string;
  /** Original Chinese description from the source page. */
  readonly description: string;
  /** Vietnamese translation of the description (filled in by translation pipeline). */
  readonly descriptionVi?: string;
  /** Total chapter count reported by the source. May be approximate. */
  readonly totalChapters: number | null;
  readonly lastUpdatedAt: string | null;
}

export interface Chapter {
  readonly title: string;
  readonly url: string;
  /** Best-effort chapter number parsed from title; null when unparseable. */
  readonly chapterNumber: number | null;
  /**
   * 1-based position within the chapter list page (DOM order, before dedupe).
   * Stable across runs for the same source page; not unique across pages.
   */
  readonly position: number;
  /** Identifier used by the source website for this chapter (when available). */
  readonly sourceId: string | null;
  /** Vietnamese translation of the chapter title (filled in lazily). */
  readonly titleVi?: string;
}

export interface ChapterListPage {
  readonly chapters: readonly Chapter[];
  readonly currentPage: number;
  readonly totalPages: number | null;
  /** URL of the next page of the chapter list, if any. */
  readonly nextPageUrl: string | null;
  /**
   * Number of chapters on this page (defaults to `chapters.length` when
   * the parser doesn't expose a constant). Used by the UI to compute
   * "Trang N / totalPages" without a hardcoded page-size assumption.
   */
  readonly pageSize?: number;
}

export interface ParsedChapterContent {
  readonly title: string;
  /** Raw Chinese paragraphs. */
  readonly paragraphs: readonly string[];
  /** Resolved absolute URL of the next sub-page inside the same chapter, if any. */
  readonly nextSubPageUrl: string | null;
}

export interface TranslatedChapter {
  readonly sourceUrl: string;
  readonly novel: { id: string; title: string };
  readonly title: string;
  /** Translated Vietnamese paragraphs, one per source paragraph (best-effort). */
  readonly paragraphs: readonly string[];
  readonly prevChapterUrl: string | null;
  readonly nextChapterUrl: string | null;
}
