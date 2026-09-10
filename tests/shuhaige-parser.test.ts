import { describe, expect, it } from "vitest";
import { ShuhaigeParser } from "@/domain/parsers/shuhaige-parser";
import { ParserFactory } from "@/domain/parsers";
import "@/domain/parsers";

const SAMPLE_NOVEL_HTML = `<!doctype html><html><head><meta name="description" content="一代魔尊楚枫，替人族镇守黑渊抵御异族数百年"></head><body><div class="detail"><img src="https://img.shuhaige.net/386531/312050.jpg" alt="cover"><p class="name"><strong>逆天魔尊：重生归来</strong></p><p class="author">作者：<a href="/author/草船借火箭/">草船借火箭</a></p><p><a href="/XuanHuan/" class="layui-btn layui-btn-xs layui-btn-radius">玄幻</a><span class="layui-btn layui-btn-xs layui-btn-radius layui-btn-normal">连载中</span><span class="layui-btn layui-btn-xs layui-bg-red">549 万字</span></p><p class="new">最新章节：<a href="/386531/152638867.html">第1344章 奸情！</a></p><p>最后更新：2026-09-07 04:55:07</p></div><div class="caption"><span>共 1344 章</span></div><ul class="read"><li chapter-id="132734178"><a href="/386531/132734178.html">第1章 乞丐和瑶池圣女！</a></li><li chapter-id="132734179"><a href="/386531/132734179.html">第2章 史诗巨作！</a></li><li chapter-id="132734181"><a href="/386531/132734181.html">第3章 诡异世界</a></li><li chapter-id="132734183"><a href="/386531/132734183.html">第4章 混沌星辰珠</a></li><li chapter-id="132743645"><a href="/386531/132743645.html">第5章 混沌诀</a></li><li chapter-id="132775380"><a href="/386531/132775380.html">第6章 楚家</a></li></ul><div class="pagelist"><span class="pagenum"><em>第1 - 50章</em><select><option value="/386531_1/" selected>第1 - 50章</option><option value="/386531_2/">第51 - 100章</option><option value="/386531_27/">第1301 - 1350章</option></select></span><a href="/386531_2/">下一页</a></div></body></html>`;

const SAMPLE_CHAPTER_HTML = `<!doctype html><html><body><h1 class="headline">第115章 再见莫倾颜！</h1><div class="content"><p>楚枫站在悬崖之上，俯瞰着远方的城池。</p><p>本章未完，请点击下一页继续阅读</p><p>“你来了。”莫倾颜轻声说道。</p><p>本站域名最快更新无防盗</p><p>两人相视而立，仿佛整个世界都安静了下来。</p></div><div class="pager"><a href="/386531/132855415.html">上一章</a><a href="/386531/">目录</a><a href="/386531/132855416_2.html">下一页</a></div></body></html>`;

describe("ShuhaigeParser", () => {
  const parser = new ShuhaigeParser();
  ParserFactory.register(parser);

  it("is registered for m.shuhaige.net", () => {
    expect(ParserFactory.get("m.shuhaige.net")).toBe(parser);
  });

  describe("parseNovelPage", () => {
    it("extracts novel metadata", () => {
      const novel = parser.parseNovelPage({
        html: SAMPLE_NOVEL_HTML,
        novelUrl: "https://m.shuhaige.net/386531/",
        origin: "https://m.shuhaige.net",
      });
      expect(novel.id).toBe("386531");
      expect(novel.title).toBe("逆天魔尊：重生归来");
      expect(novel.author).toBe("草船借火箭");
      expect(novel.coverUrl).toBe(
        "https://img.shuhaige.net/386531/312050.jpg",
      );
      expect(novel.genre).toContain("玄幻");
      expect(novel.status).toBe("连载中");
      expect(novel.totalChapters).toBe(1344);
      expect(novel.lastUpdatedAt).toContain("最后更新");
      expect(novel.description).toContain("楚枫");
    });
  });

  describe("parseChapterListPage", () => {
    it("extracts chapters + pagination metadata", () => {
      const page = parser.parseChapterListPage({
        html: SAMPLE_NOVEL_HTML,
        novelUrl: "https://m.shuhaige.net/386531/",
        origin: "https://m.shuhaige.net",
      });
      expect(page.chapters.length).toBe(6);
      expect(page.chapters[0]?.title).toBe("第1章 乞丐和瑶池圣女！");
      expect(page.chapters[0]?.url).toBe(
        "https://m.shuhaige.net/386531/132734178.html",
      );
      expect(page.chapters[0]?.sourceId).toBe("132734178");
      expect(page.chapters[0]?.chapterNumber).toBe(1);
      expect(page.currentPage).toBe(1);
      expect(page.totalPages).toBe(27);
      expect(page.nextPageUrl).toBe("https://m.shuhaige.net/386531_2/");
    });

    it("returns null next-page URL on last page", () => {
      const last = SAMPLE_NOVEL_HTML.replace(
        '<a href="/386531_2/">下一页</a>',
        "",
      );
      const page = parser.parseChapterListPage({
        html: last,
        novelUrl: "https://m.shuhaige.net/386531/",
        origin: "https://m.shuhaige.net",
      });
      expect(page.nextPageUrl).toBeNull();
    });
  });

  describe("parseChapterPage", () => {
    it("extracts title and cleaned paragraphs", () => {
      const result = parser.parseChapterPage({
        html: SAMPLE_CHAPTER_HTML,
        chapterUrl: "https://m.shuhaige.net/386531/132855416.html",
        origin: "https://m.shuhaige.net",
      });
      expect(result.title).toBe("第115章 再见莫倾颜！");
      // Noise lines are filtered.
      expect(result.paragraphs).not.toContainEqual(
        expect.stringContaining("本章未完"),
      );
      expect(result.paragraphs).not.toContainEqual(
        expect.stringContaining("本站域名"),
      );
      // Real prose is kept.
      expect(result.paragraphs).toContainEqual(
        expect.stringContaining("楚枫站在悬崖之上"),
      );
      expect(result.paragraphs).toContainEqual(
        expect.stringContaining("莫倾颜"),
      );
    });

    it("detects next sub-page URL from pager", () => {
      const result = parser.parseChapterPage({
        html: SAMPLE_CHAPTER_HTML,
        chapterUrl: "https://m.shuhaige.net/386531/132855416.html",
        origin: "https://m.shuhaige.net",
      });
      expect(result.nextSubPageUrl).toBe(
        "https://m.shuhaige.net/386531/132855416_2.html",
      );
    });

    it("returns null when there is no next sub-page", () => {
      const html = SAMPLE_CHAPTER_HTML.replace(
        '<a href="/386531/132855416_2.html">下一页</a>',
        "",
      );
      const result = parser.parseChapterPage({
        html,
        chapterUrl: "https://m.shuhaige.net/386531/132855416.html",
        origin: "https://m.shuhaige.net",
      });
      expect(result.nextSubPageUrl).toBeNull();
    });
  });

  describe("buildChapterListPageUrl", () => {
    it("returns novel URL for page 1", () => {
      const url = parser.buildChapterListPageUrl({
        novelUrl: "https://m.shuhaige.net/386531/",
        page: 1,
      });
      expect(url).toBe("https://m.shuhaige.net/386531/");
    });

    it("uses _N suffix for subsequent pages", () => {
      const url = parser.buildChapterListPageUrl({
        novelUrl: "https://m.shuhaige.net/386531/",
        page: 3,
      });
      expect(url).toBe("https://m.shuhaige.net/386531_3/");
    });
  });
});
