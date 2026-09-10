/**
 * Parser for m.51read.org (51read mobile).
 *
 * Observed structure (from real HTML, 2026-09-08):
 *   Novel page (/xiaoshuo/{id}):
 *     - <nav class="wr-topbar"><a href="/fenlei/shds">分类</a></nav>   (header nav — IGNORE)
 *     - <div class="wr-breadcrumb"><a href="/fenlei/{slug}">玄幻异能</a></div>
 *       (breadcrumb — USE for genre, scoped to avoid the header nav link)
 *     - <h1>title</h1>
 *     - <p>作者：<a>name</a></p>
 *     - <span>连载</span> | <span>完结</span>
 *     - <p>最后更新：YYYY-MM-DD HH:MM</p>
 *     - <h2>简介</h2><p>...</p>
 *     - <img alt="...封面图">         (cover)
 *
 *   Full TOC (/zhangjiemulu/{id} or /zhangjiemulu/{id}/{N}):
 *     - <div id="content_1" class="wr-catalog-grid">
 *         <a class="wr-catalog-item" href="/xiaoshuo/{id}/zhangjie/{chapterId}">第N章 title</a>
 *       </div>
 *     - 50 entries per page
 *     - <select id="indexselect">
 *         <option value="/zhangjiemulu/{id}" selected="selected">1</option>
 *         ...
 *         <option value="/zhangjiemulu/{id}/27">27</option>
 *       </select>
 *     - <a href="/zhangjiemulu/{id}/2" class="index-container-btn">下一页</a>
 *
 *   Chapter page (/xiaoshuo/{id}/zhangjie/{chapterId}):
 *     - <div class="wr-breadcrumb"><h1>第N章 title</h1></div>
 *     - <div id="content" class="wr-content">
 *         <div id="booktxtSource" class="wr-source-content">
 *           <p>paragraph 1</p>
 *           <p>paragraph 2</p>
 *           ...
 *         </div>
 *       </div>
 *     - <nav class="wr-page-nav wr-page-nav-bottom">
 *         <a rel="prev" href="...">上一章</a>
 *         <a href="/zhangjiemulu/{id}">目录</a>
 *         <a rel="next" href="...">下一章</a>
 *       </nav>
 *     - no sub-page nav observed (single-page chapters)
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

// Generic noise patterns that match the boilerplate every Chinese web-novel
// site appends around its real content. 51read-specific self-promo (its own
// hostname) is included so the same filter survives a future host swap.
const NOISE_LINE_PATTERNS: readonly RegExp[] = [
  /请收藏|记住|书签|推荐票|月票/i,
  /本章未完，请点击下一页继续阅读|点击下一页/i,
  /天才一秒记住|手机用户请浏览|手机看小说/i,
  /本站域名|最快更新|无弹窗|无防盗/i,
  /温馨提示|书友群|关注公众号|qq群/i,
  /m\.51read\.org|51read\.org/i,
  /^\s*\d+\s*$/, // standalone numbers (pagination junk)
];

function isLikelyNoise(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  return NOISE_LINE_PATTERNS.some((re) => re.test(trimmed));
}

/** Parse "第N章" / "第X章" out of a chapter title. Chinese numerals up to ~99. */
function parseChapterNumber(title: string): number | null {
  const m = /第\s*([0-9一-九十百千零〇两]+)\s*章/.exec(title);
  if (!m || !m[1]) return null;
  const token = m[1];
  if (/^\d+$/.test(token)) return Number.parseInt(token, 10);
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
  const any = /\d+/.exec(title);
  return any ? Number.parseInt(any[0], 10) : null;
}

/**
 * Find the first <a> whose text matches any predicate and return its
 * absolute href. Mirrors `pickNavHref` from the shuhaige parser but kept
 * private here until a 3rd parser joins (YAGNI vs DRY).
 */
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

export class M51readParser implements WebsiteParser {
  readonly hostname = "m.51read.org";

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

    // Title is the first <h1> on the novel page.
    const title = $("h1").first().text().trim() || "Untitled";

    // Author paragraph starts with "作者：".
    const author = (() => {
      const authorPara = $("p")
        .toArray()
        .find((el) => $(el).text().trim().startsWith("作者"));
      if (!authorPara) return null;
      const text = $(authorPara).text().trim();
      return text.replace(/^作者[:：]\s*/, "").trim() || null;
    })();

    // Genre: the category link lives inside the breadcrumb (.wr-breadcrumb).
    // The topbar nav also has a generic `<a href="/fenlei/shds">分类</a>`
    // — scoping to the breadcrumb (or falling back to detail-meta area)
    // avoids picking up that nav link. We still allow the unscoped fallback
    // for older pages that may not have a breadcrumb wrapper, but we exclude
    // the literal "分类" text which is the header nav, not a real genre.
    const genre: string[] = (() => {
      const scope = $(".wr-breadcrumb, .breadcrumb, .wr-detail-meta").first();
      const $root = scope.length ? scope : $("body");
      return $root
        .find('a[href^="/fenlei/"]')
        .toArray()
        .map((el) => $(el).text().trim())
        .filter((t) => t.length > 0 && t !== "分类");
    })();

    // Status: explicit "连载" / "完结" tokens appear inside the meta block.
    // Look for a span containing either token; fall back to a page-wide scan.
    const status = (() => {
      const span = $("span")
        .toArray()
        .map((el) => $(el).text().trim())
        .find((t) => t === "连载" || t === "完结" || t === "连载中" || t === "已完结");
      if (span) return span;
      const any = $("body").text();
      if (/完结|已完成/.test(any)) return "完结";
      if (/连载/.test(any)) return "连载";
      return null;
    })();

    // Description lives under a heading that literally says "简介".
    const description = (() => {
      const heading = $("h2")
        .toArray()
        .find((el) => $(el).text().trim().includes("简介"));
      if (!heading) return "";
      const $next = $(heading).nextAll("p").first();
      return $next.text().trim();
    })();

    // Last updated: a paragraph containing "最后更新".
    const lastUpdatedAt =
      $("p")
        .toArray()
        .map((el) => $(el).text().trim())
        .find((t) => t.startsWith("最后更新")) ?? null;

    // Cover image: prefer an <img> whose alt mentions 封面, otherwise the
    // first <img> on the page (51read returns a placeholder nocover.jpg for
    // novels without artwork, which is still a valid absolute URL).
    const coverImg =
      $('img[alt*="封面"]').first().attr("src") ??
      $("img").first().attr("src") ??
      null;
    const coverUrl = coverImg ? resolveUrl(coverImg, origin) : null;

    // Total chapter count: 51read does not surface "共 N 章" on the novel
    // page — only on the TOC. Leave null; the client can fall back to the
    // latest chapter link shown on the page.
    const totalChapters = null;

    // novelId from path: /xiaoshuo/{id}
    const m = /\/xiaoshuo\/(\d+)/.exec(new URL(novelUrl).pathname);
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
    novelUrl,
    origin,
  }: {
    html: string;
    novelUrl: string;
    origin: string;
  }): ChapterListPage {
    const $ = cheerio.load(html);

    // Scope chapter links to this novel by id so we never grab a
    // "推荐阅读" cross-link from another novel on the page.
    const novelIdMatch = /\/(?:xiaoshuo|zhangjiemulu)\/(\d+)/.exec(
      new URL(novelUrl).pathname,
    );
    const novelId = novelIdMatch?.[1] ?? "";

    const chapterHrefRe = novelId
      ? new RegExp(`^/xiaoshuo/${novelId}/zhangjie/(\\d+)/?$`)
      : /^\/xiaoshuo\/\d+\/zhangjie\/\d+\/?$/;

    // The full TOC page wraps chapter links in `.wr-catalog-grid` /
    // `.wr-catalog-item`. The novel DETAIL page (e.g. /xiaoshuo/{id}) does
    // not — it only exposes the latest 9 chapters plus a "开始阅读" CTA
    // pointing at chapter 1. Parsing that as a "page 1" would pollute the
    // cache with the wrong 10 entries (chapters 1344→1336 + the CTA),
    // which then corrupts every subsequent deep-link scan. Detect the
    // TOC container and bail out with an empty list when it's absent.
    const catalogScope = $(".wr-catalog-grid, .wr-catalog-list").first();
    if (!catalogScope.length) {
      return {
        chapters: [],
        currentPage: 1,
        totalPages: null,
        nextPageUrl: null,
        pageSize: 0,
      };
    }

    const candidateAnchors = catalogScope
      .find("a.wr-catalog-item, a")
      .toArray();

    const rawChapters: Chapter[] = candidateAnchors.flatMap((el, idx) => {
      const href = $(el).attr("href");
      if (!href || !chapterHrefRe.test(href)) return [];
      const title = $(el).text().trim();
      if (!title) return [];
      const chapterNumber = parseChapterNumber(title);
      // Defense-in-depth: any chapter link whose title doesn't match
      // "第N章 ..." is a CTA / nav button (e.g. "开始阅读", "章节目录").
      // Skip it so it never reaches the chapter list.
      if (chapterNumber === null) return [];
      const sourceIdMatch = /\/zhangjie\/(\d+)/.exec(href);
      const sourceId = sourceIdMatch?.[1] ?? null;
      const url = resolveUrl(href, origin);
      return [
        {
          title,
          url,
          sourceId,
          chapterNumber,
          position: idx + 1,
        },
      ];
    });

    // Dedupe by URL — same defense-in-depth as shuhaige: keep the first.
    const seen = new Set<string>();
    const chapters = rawChapters.filter((c) => {
      if (seen.has(c.url)) return false;
      seen.add(c.url);
      return true;
    });

    // Page number: prefer the URL path; cross-check against the
    // <select id="indexselect"> selected <option>.
    const listPath = new URL(novelUrl).pathname;
    const listPageMatch = /\/zhangjiemulu\/\d+(?:\/(\d+))?/.exec(listPath);
    const urlPage =
      listPageMatch && listPageMatch[1]
        ? Number.parseInt(listPageMatch[1], 10)
        : 1;

    const selectPage = (() => {
      // <option value="/zhangjiemulu/{id}" selected="selected">1</option>
      // or <option value="/zhangjiemulu/{id}/{N}" selected>...</option>
      const opt = $("#indexselect option[selected], #pageselect option[selected]")
        .first()
        .attr("value");
      if (!opt) return null;
      const m = /\/zhangjiemulu\/\d+(?:\/(\d+))?/.exec(opt);
      if (!m) return null;
      return m[1] ? Number.parseInt(m[1], 10) : 1;
    })();

    const currentPage = selectPage ?? urlPage;

    // totalPages: from the LAST <option> in the page selector. Each option
    // looks like /zhangjiemulu/{id}/{N} (last entry is the highest N).
    const totalPages = (() => {
      const options = $("#indexselect option, #pageselect option").toArray();
      if (options.length === 0) return null;
      let max = 0;
      for (const opt of options) {
        const value = $(opt).attr("value") ?? "";
        const m = /\/zhangjiemulu\/\d+(?:\/(\d+))?/.exec(value);
        if (!m) continue;
        const n = m[1] ? Number.parseInt(m[1], 10) : 1;
        if (Number.isFinite(n) && n > max) max = n;
      }
      return max > 0 ? max : null;
    })();

    // nextPageUrl: the "下一页" link. Scope to this novel so we never pick
    // up a stray "下一页" from a different list on the page.
    const nextPageUrl = (() => {
      if (!novelId) return null;
      const anchors = $("a").toArray();
      for (const el of anchors) {
        const text = $(el).text().trim();
        if (text !== "下一页") continue;
        const href = $(el).attr("href");
        if (!href || href.startsWith("javascript:")) continue;
        if (!href.startsWith(`/zhangjiemulu/${novelId}/`)) continue;
        return resolveUrl(href, origin);
      }
      return null;
    })();

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
  }: {
    html: string;
    chapterUrl: string;
    origin: string;
  }): ParsedChapterContent {
    const $ = cheerio.load(html);

    const title = $("h1").first().text().trim() || "Chương";

    // Content is a div holding many <p> children. 51read does not expose a
    // stable class on the wrapper, so we pick structurally: the div with the
    // most direct <p> children.
    const paragraphs: string[] = (() => {
      let bestIndex = -1;
      let bestCount = 0;
      $("div").each((i, el) => {
        const count = $(el).children("p").length;
        if (count > bestCount) {
          bestCount = count;
          bestIndex = i;
        }
      });
      if (bestIndex < 0) return [];
      const divs = $("div").toArray();
      const best = divs[bestIndex];
      if (!best) return [];
      return $(best)
        .children("p")
        .toArray()
        .map((el) => $(el).text().trim())
        .filter((t) => !isLikelyNoise(t) && t.length > 0);
    })();

    // Single-page chapters confirmed — no sub-page nav observed.
    const nextSubPageUrl: string | null = null;

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
    const m = /\/xiaoshuo\/(\d+)/.exec(u.pathname);
    if (!m || !m[1]) return novelUrl;
    const novelId = m[1];
    u.pathname =
      page <= 1
        ? `/zhangjiemulu/${novelId}`
        : `/zhangjiemulu/${novelId}/${page}`;
    return u.href;
  }
}
