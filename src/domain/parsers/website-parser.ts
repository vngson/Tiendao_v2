/**
 * Website adapter contract. Each parser is a pure function from raw HTML
 * to domain entities — no I/O lives here. Hosting site is selected by the
 * {@link ParserFactory}.
 */
import type {
  Chapter,
  ChapterListPage,
  Novel,
  ParsedChapterContent,
} from "@/domain/entities/novel";

export interface WebsiteParser {
  /** Lowercase hostname this parser serves (e.g. "m.shuhaige.net"). */
  readonly hostname: string;

  /** Extract novel metadata from a novel-page HTML. */
  parseNovelPage(args: {
    html: string;
    novelUrl: string;
    origin: string;
  }): Novel;

  /**
   * Extract one page of the chapter list (paginated). Returns the page number
   * it represents and the next-list-page URL when available.
   */
  parseChapterListPage(args: {
    html: string;
    novelUrl: string;
    origin: string;
  }): ChapterListPage;

  /**
   * Extract chapter content + the URL of the next sub-page inside the same
   * chapter (multi-page chapter), if any.
   */
  parseChapterPage(args: {
    html: string;
    chapterUrl: string;
    origin: string;
  }): ParsedChapterContent;

  /**
   * Build the canonical chapter URL list-page URL for a given page number.
   * Page 1 typically maps to `/<novelId>/`, page N to `/<novelId>_N/`.
   */
  buildChapterListPageUrl(args: {
    novelUrl: string;
    page: number;
  }): string;
}

export class ParserFactory {
  private static readonly parsers = new Map<string, WebsiteParser>();

  static register(parser: WebsiteParser): void {
    ParserFactory.parsers.set(parser.hostname.toLowerCase(), parser);
  }

  static get(hostname: string): WebsiteParser | undefined {
    const lower = hostname.toLowerCase();
    return (
      ParserFactory.parsers.get(lower) ??
      [...ParserFactory.parsers.values()].find((p) => lower.endsWith(`.${p.hostname}`))
    );
  }

  static list(): readonly WebsiteParser[] {
    return [...ParserFactory.parsers.values()];
  }
}

export type {
  Chapter,
  ChapterListPage,
  Novel,
  ParsedChapterContent,
};
