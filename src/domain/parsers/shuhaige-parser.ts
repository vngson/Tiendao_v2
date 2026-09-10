/**
 * Parser for m.shuhaige.net (book-haige novel site).
 *
 * Observed structure (from sample HTML):
 *   Novel page (.detail):
 *     - <img src="https://img.shuhaige.net/<novelId>/<imageId>.jpg">
 *     - <p class="name"><strong>title</strong></p>
 *     - <p class="author">作者：<a href="/author/<name>/">name</a>...</p>
 *     - genre link + status pill + word count
 *     - <p class="new">最新章节：<a ...>title</a></p>
 *     - 最后更新：YYYY-MM-DD HH:MM:SS
 *
 *   Chapter list (<ul class="read">):
 *     - <li chapter-id="<id>"><a href="/<novelId>/<chapterId>.html">title</a></li>
 *     - 50 entries per page
 *     - pagination via <select> with options /<novelId>_<n>/
 *
 *   Chapter page:
 *     - <h1 class="headline">title</h1>
 *     - <div class="content"><p>...</p>...</div>
 *     - <div class="pager"><a>上一页</a> <a>下一页</a> <a>下一页</a> ...</div>
 *
 * Nav text semantics (preferred over positional indices):
 *   上一章 = previous chapter
 *   下一章 = next chapter
 *   下一页 = next sub-page (same chapter)
 *   上一章 (on chapter page) = previous sub-page (NOT previous chapter)
 */
import * as cheerio from "cheerio";
import { resolveUrl } from "@/infrastructure/http/website-fetcher";
import type {
  Chapter,
  ChapterListPage,
  Novel,
  ParsedChapterContent,
} from "@/domain/entities/novel";
import type { WebsiteParser } from "@/domain/parsers/website-parser";

const NOISE_LINE_PATTERNS: readonly RegExp[] = [
  /请收藏|记住|书签|推荐票|月票/i,
  /本章未完，请点击下一页继续阅读|点击下一页/i,
  /天才一秒记住|手机用户请浏览|手机看小说/i,
  /本站域名|最快更新|无弹窗|无防盗/i,
  /温馨提示|书友群|关注公众号|qq群/i,
  // Self-promo lines that just drop the source site's domain + a tagline.
  // They appear as the first/last paragraph on every chapter page and add
  // nothing to the translated output. Match on the host (any subdomain)
  // so the same filter survives host swaps.
  /m\.shuhaige\.net|shuhaige\.net/i,
  /^\s*\d+\s*$/, // standalone numbers (pagination junk)
];

function isLikelyNoise(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  return NOISE_LINE_PATTERNS.some((re) => re.test(trimmed));
}

function parseChapterNumber(title: string): number | null {
  const m = /第\s*([0-9一-九十百千零〇两]+)\s*章/.exec(title);
  if (!m || !m[1]) return null;
  const token = m[1];
  if (/^\d+$/.test(token)) return Number.parseInt(token, 10);
  // Minimal Chinese-numeral conversion for tokens up to ~100 (covers >99% of cases).
  const digits: Record<string, number> = {
    零: 0, 〇: 0,
    一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
    六: 6, 七: 7, 八: 8, 九: 9,
  };
  if (token === "十") return 10;
  const tenMatch = /^([一二三四五六七八九两])?十([一二三四五六七八九])?$/.exec(token);
  if (tenMatch) {
    const tens = tenMatch[1] ? digits[tenMatch[1]] ?? 1 : 1;
    const ones = tenMatch[2] ? digits[tenMatch[2]] ?? 0 : 0;
    return tens * 10 + ones;
  }
  // Fallback: parse any run of digits anywhere in the title.
  const any = /\d+/.exec(title);
  return any ? Number.parseInt(any[0], 10) : null;
}

function pickNavHref(
  $: cheerio.CheerioAPI,
  origin: string,
  predicates: readonly ((text: string) => boolean)[],
): string | null {
  const anchors = $("a").toArray();
  for (const el of anchors) {
    const text = $(el).text().trim();
    if (!predicates.some((p) => p(text))) continue;
    const href = $(el).attr("href");
    if (!href || href.startsWith("javascript:")) continue;
    return resolveUrl(href, origin);
  }
  return null;
}

export class ShuhaigeParser implements WebsiteParser {
  readonly hostname = "m.shuhaige.net";

  parseNovelPage({
    html,
    novelUrl,
    origin,
  }: {
    html: string;
    novelUrl: string;
    origin: string;
  }): Novel {
    const $ = cheerio.load(html);
    const title = $(".detail .name strong").first().text().trim() || "Untitled";
    const authorHref = $(".detail .author a").first().attr("href");
    const author =
      $(".detail .author a").first().text().trim().replace(/^作者[:：]\s*/, "") || null;

    const cover = $(".detail img").first().attr("src");
    const coverUrl = cover ? resolveUrl(cover, origin) : null;

    const genre = $(".detail a.layui-btn")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((t) => t.length > 0);

    const status = $(".detail span.layui-btn-normal").first().text().trim() || null;

    // Description is the <meta name="description"> tag.
    const description =
      $('meta[name="description"]').attr("content")?.trim() ?? "";

    // Total chapter count: text like "共 1344 章" appears in .caption.
    const caption = $(".caption").text();
    const totalMatch = /共\s*(\d+)\s*章/.exec(caption);
    const totalChapters = totalMatch && totalMatch[1] ? Number.parseInt(totalMatch[1], 10) : null;

    const lastUpdatedAt = $(".detail p")
      .toArray()
      .map((el) => $(el).text().trim())
      .find((t) => t.startsWith("最后更新")) ?? null;

    // novelId from path: https://m.shuhaige.net/<id>/
    const m = /\/(\d+)\/?$/.exec(new URL(novelUrl).pathname);
    const id = m && m[1] ? m[1] : "";

    return {
      id,
      sourceUrl: novelUrl,
      origin,
      title,
      author,
      coverUrl,
      genre,
      status,
      description,
      totalChapters,
      lastUpdatedAt,
    };
  }

  parseChapterListPage({
    html,
    origin,
  }: {
    html: string;
    novelUrl: string;
    origin: string;
  }): ChapterListPage {
    const $ = cheerio.load(html);
    const rawChapters: Chapter[] = $("ul.read > li").toArray().flatMap((el, idx) => {
      const $li = $(el);
      const $a = $li.find("a").first();
      const href = $a.attr("href");
      if (!href) return [];
      const title = $a.text().trim();
      const url = resolveUrl(href, origin);
      const sourceId = $li.attr("chapter-id") ?? null;
      return [{ title, url, sourceId, chapterNumber: parseChapterNumber(title), position: idx + 1 }];
    });

    // shuhaige occasionally repeats the same chapter link on a single page
    // (e.g. last chapter + "next page" sentinel). Downstream consumers key
    // by `url` and React requires unique sibling keys — keep the first
    // occurrence so `currentPage`/positions remain stable.
    const seen = new Set<string>();
    const chapters = rawChapters.filter((c) => {
      if (seen.has(c.url)) return false;
      seen.add(c.url);
      return true;
    });

    // Detect current page from <select> option marked selected.
    const currentPage = (() => {
      const selected = $(".pagelist select option[selected]").first();
      if (selected.length === 0) return 1;
      const v = selected.attr("value") ?? "";
      const m = /_(\d+)\/?$/.exec(v);
      return m && m[1] ? Number.parseInt(m[1], 10) : 1;
    })();

    // Total pages = last option's page index.
    const totalPages = (() => {
      const last = $(".pagelist select option").last();
      const v = last.attr("value") ?? "";
      const m = /_(\d+)\/?$/.exec(v);
      return m && m[1] ? Number.parseInt(m[1], 10) : null;
    })();

    // Next page link: prefer <a href> with text 下一页 inside .pagelist.
    const nextPageUrl = pickNavHref($, origin, [(t) => t === "下一页"]) ?? null;

    return {
      chapters,
      currentPage,
      totalPages,
      nextPageUrl,
      pageSize: chapters.length,
    };
  }

  parseChapterPage({
    html,
    chapterUrl,
    origin,
  }: {
    html: string;
    chapterUrl: string;
    origin: string;
  }): ParsedChapterContent {
    const $ = cheerio.load(html);
    const title = $("h1.headline").first().text().trim() || "Chương";

    const paragraphs: string[] = $("div.content p")
      .toArray()
      .map((el) => $(el).text().trim())
      .filter((t) => !isLikelyNoise(t) && t.length > 0);

    // Multi-page chapter: look for "下一页" inside the page content, but
    // be careful — the same selector may exist in the bottom pager and in
    // inline "click next page" prompts. We prefer the pager link when
    // present, falling back to any in-content match.
    const pagerNext = $(".pager a")
      .toArray()
      .map((el) => ({ href: $(el).attr("href"), text: $(el).text().trim() }))
      .find((l) => l.href && l.text === "下一页");

    let nextSubPageUrl: string | null = null;
    if (pagerNext && pagerNext.href) {
      const resolved = resolveUrl(pagerNext.href, origin);
      // Guard: must be same chapterId (different sub-page), not next chapter.
      const currentPath = new URL(chapterUrl).pathname;
      const nextPath = new URL(resolved).pathname;
      if (nextPath !== currentPath && nextPath.startsWith(currentPath.replace(/\.html$/, ""))) {
        nextSubPageUrl = resolved;
      }
    }

    return { title, paragraphs, nextSubPageUrl };
  }

  buildChapterListPageUrl({
    novelUrl,
    page,
  }: {
    novelUrl: string;
    page: number;
  }): string {
    const u = new URL(novelUrl);
    if (page <= 1) {
      u.pathname = `${u.pathname.replace(/\/?$/, "")}/`;
      return u.href;
    }
    // /386531/  →  /386531_2/
    const idMatch = /\/(\d+)\/?$/.exec(u.pathname);
    if (!idMatch || !idMatch[1]) return novelUrl;
    u.pathname = `/${idMatch[1]}_${page}/`;
    return u.href;
  }
}
