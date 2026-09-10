/**
 * Collects all sub-pages of a chapter into a single Chinese text blob.
 *
 * Strategy: walk the parser's `nextSubPageUrl` chain. Hard caps protect
 * against infinite loops on broken markup.
 */
import { fetchWebsite } from "@/infrastructure/http/website-fetcher";
import type {
  ParsedChapterContent,
} from "@/domain/entities/novel";
import type { WebsiteParser } from "@/domain/parsers/website-parser";

export interface CollectedChapter {
  readonly title: string;
  readonly paragraphs: readonly string[];
  /** Final URL we ended on (may equal the start URL when single-page). */
  readonly finalUrl: string;
}

export interface ChapterCollectorOptions {
  /** Max sub-pages to follow before giving up. Default 10. */
  maxSubPages?: number;
  /** Per-request timeout. Default 60s — see website-fetcher defaults. */
  timeoutMs?: number;
}

export class ChapterCollector {
  constructor(
    private readonly parser: WebsiteParser,
    private readonly deps: { fetch: typeof fetchWebsite } = { fetch: fetchWebsite },
  ) {}

  async collect(
    chapterUrl: string,
    opts: ChapterCollectorOptions = {},
  ): Promise<CollectedChapter> {
    const max = opts.maxSubPages ?? 10;
    const timeoutMs = opts.timeoutMs ?? 60_000;

    let currentUrl: string | null = chapterUrl;
    const allParagraphs: string[] = [];
    let title = "";

    const seen = new Set<string>();
    let pageCount = 0;

    while (currentUrl && pageCount < max) {
      if (seen.has(currentUrl)) {
        throw new InfinitePaginationError(currentUrl);
      }
      seen.add(currentUrl);

      const { body, finalUrl } = await this.deps.fetch(currentUrl, { timeoutMs });
      const origin = new URL(finalUrl).origin;
      const parsed: ParsedChapterContent = this.parser.parseChapterPage({
        html: body,
        chapterUrl: finalUrl,
        origin,
      });

      if (!title) title = parsed.title;
      for (const p of parsed.paragraphs) allParagraphs.push(p);

      currentUrl = parsed.nextSubPageUrl;
      pageCount++;
    }

    if (currentUrl && pageCount >= max) {
      // Gracefully cap instead of throwing — the bulk of the chapter is
      // almost always in the first few sub-pages.
      console.warn(
        `[chapter-collector] hit sub-page cap (${max}) at ${currentUrl}`,
      );
    }

    if (allParagraphs.length === 0) {
      throw new EmptyChapterError(chapterUrl);
    }

    return {
      title,
      paragraphs: allParagraphs,
      finalUrl: chapterUrl,
    };
  }
}

export class EmptyChapterError extends Error {
  constructor(url: string) {
    super(`No content extracted from chapter ${url}`);
    this.name = "EmptyChapterError";
  }
}

export class InfinitePaginationError extends Error {
  constructor(url: string) {
    super(`Pagination loop detected at ${url}`);
    this.name = "InfinitePaginationError";
  }
}
