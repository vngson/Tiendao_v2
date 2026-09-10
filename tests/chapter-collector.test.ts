import { describe, expect, it, vi } from "vitest";
import {
  ChapterCollector,
  EmptyChapterError,
  InfinitePaginationError,
} from "@/domain/services/chapter-collector";
import type { WebsiteParser } from "@/domain/parsers/website-parser";

function makeFetchMock(pages: { url: string; html: string }[]) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: string) => {
    calls.push(url);
    const page = pages.find((p) => p.url === url);
    if (!page) throw new Error(`unexpected fetch ${url}`);
    return { url, finalUrl: url, body: page.html, status: 200, contentType: "text/html" };
  });
  return { fetch: fetchMock, calls };
}

const PARSER: WebsiteParser = {
  hostname: "test",
  parseChapterPage({ html }) {
    // Test fixture: each page has 2 paragraphs and optionally points to next.
    const isLast = !html.includes("__NEXT__");
    return {
      title: "Chapter",
      paragraphs: ["para-1-of-page", "para-2-of-page"],
      nextSubPageUrl: isLast ? null : "next",
    };
  },
  parseNovelPage: () => {
    throw new Error("not used");
  },
  parseChapterListPage: () => {
    throw new Error("not used");
  },
  buildChapterListPageUrl: ({ novelUrl }) => novelUrl,
};

describe("ChapterCollector", () => {
  it("returns single-page chapter untouched", async () => {
    const { fetch, calls } = makeFetchMock([
      { url: "https://x.com/c/1.html", html: "no marker" },
    ]);
    const collector = new ChapterCollector(PARSER, { fetch });
    const result = await collector.collect("https://x.com/c/1.html");
    expect(result.paragraphs).toEqual(["para-1-of-page", "para-2-of-page"]);
    expect(calls).toEqual(["https://x.com/c/1.html"]);
  });

  it("follows the nextSubPageUrl chain and concatenates paragraphs", async () => {
    const { fetch, calls } = makeFetchMock([
      { url: "https://x.com/c/1.html", html: "__NEXT__" },
      { url: "https://x.com/c/2.html", html: "__NEXT__" },
      { url: "https://x.com/c/3.html", html: "final" },
    ]);
    const parser: WebsiteParser = {
      ...PARSER,
      parseChapterPage({ html }) {
        const isLast = html === "final";
        return {
          title: "Chapter",
          paragraphs: [`p-${html.slice(0, 4)}`],
          nextSubPageUrl: isLast ? null : "https://x.com/c/next",
        };
      },
      parseChapterPageImpl: undefined as never,
    } as WebsiteParser;
    // Simpler: re-implement parser to advance URLs by sequence.
    const seqParser: WebsiteParser = {
      ...PARSER,
      parseChapterPage() {
        const idx = calls.length; // 1 = first, 2 = second, 3 = third
        if (idx === 1) {
          return {
            title: "Chapter",
            paragraphs: ["p1"],
            nextSubPageUrl: "https://x.com/c/2.html",
          };
        }
        if (idx === 2) {
          return {
            title: "Chapter",
            paragraphs: ["p2"],
            nextSubPageUrl: "https://x.com/c/3.html",
          };
        }
        return { title: "Chapter", paragraphs: ["p3"], nextSubPageUrl: null };
      },
    };
    const collector = new ChapterCollector(seqParser, { fetch });
    const result = await collector.collect("https://x.com/c/1.html");
    expect(result.paragraphs).toEqual(["p1", "p2", "p3"]);
    expect(calls).toEqual([
      "https://x.com/c/1.html",
      "https://x.com/c/2.html",
      "https://x.com/c/3.html",
    ]);
  });

  it("throws on pagination loop", async () => {
    const { fetch } = makeFetchMock([{ url: "https://x.com/c/1.html", html: "x" }]);
    const loopingParser: WebsiteParser = {
      ...PARSER,
      parseChapterPage() {
        return {
          title: "loop",
          paragraphs: ["p"],
          nextSubPageUrl: "https://x.com/c/1.html",
        };
      },
    };
    const collector = new ChapterCollector(loopingParser, { fetch });
    await expect(collector.collect("https://x.com/c/1.html")).rejects.toBeInstanceOf(
      InfinitePaginationError,
    );
  });

  it("throws on empty chapter", async () => {
    const { fetch } = makeFetchMock([{ url: "https://x.com/c/1.html", html: "x" }]);
    const emptyParser: WebsiteParser = {
      ...PARSER,
      parseChapterPage() {
        return { title: "x", paragraphs: [], nextSubPageUrl: null };
      },
    };
    const collector = new ChapterCollector(emptyParser, { fetch });
    await expect(collector.collect("https://x.com/c/1.html")).rejects.toBeInstanceOf(
      EmptyChapterError,
    );
  });

  it("honors maxSubPages cap", async () => {
    // Build 12 chained pages.
    const pages = Array.from({ length: 12 }, (_, i) => ({
      url: `https://x.com/c/${i + 1}.html`,
      html: "__NEXT__",
    }));
    const { fetch, calls } = makeFetchMock(pages);
    let i = 0;
    const seqParser: WebsiteParser = {
      ...PARSER,
      parseChapterPage() {
        i++;
        return {
          title: "t",
          paragraphs: [`p${i}`],
          nextSubPageUrl: i >= 12 ? null : `https://x.com/c/${i + 1}.html`,
        };
      },
    };
    const collector = new ChapterCollector(seqParser, { fetch });
    const result = await collector.collect("https://x.com/c/1.html", {
      maxSubPages: 5,
    });
    expect(result.paragraphs).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    expect(calls.length).toBe(5);
  });
});
