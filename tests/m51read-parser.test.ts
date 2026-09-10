import { describe, expect, it } from "vitest";
import { M51readParser } from "@/domain/parsers/m51read-parser";
import { ParserFactory } from "@/domain/parsers";
import "@/domain/parsers";

const SAMPLE_NOVEL_HTML = `<!doctype html><html lang="zh-Hans"><body>
<header class="wr-topbar">
  <nav class="wr-nav" id="site-nav">
    <a href="/">首页</a>
    <a class="" href="/fenlei/shds">分类</a>
    <a href="/paihang/week">排行榜</a>
    <a href="/history">最近阅读</a>
  </nav>
</header>
<main class="page-shell">
  <article class="wr-detail">
    <div class="wr-breadcrumb">
      <a href="/">首页</a>
      <span>/</span>
      <a href="/fenlei/xhyn">玄幻异能</a>
      <span>/</span>
      <h1>逆天魔尊：重生归来，镇压万界</h1>
    </div>
    <div class="wr-detail-meta">
      <p>作者：<a href="/zuozhe/草船借火箭" title="草船借火箭的小说合集">草船借火箭</a></p>
      <span class="wr-status">连载</span>
      <p>最后更新：2026-09-07 12:49</p>
    </div>
    <div class="wr-detail-latest">
      <p>最新章节：<a href="/xiaoshuo/447223/zhangjie/32712028" title="第1344章 奸情！">第1344章 奸情！</a></p>
      <a href="/xiaoshuo/447223/zhangjie/18494857">开始阅读</a>
      <a href="/zhangjiemulu/447223">章节目录</a>
    </div>
    <h2>简介</h2>
    <p>一代魔尊楚枫，替人族镇守黑渊抵御异族数百年，却惨遭人族几位大帝偷袭致死！</p>
    <img src="/static/default/img/nocover.jpg" alt="逆天魔尊：重生归来，镇压万界小说封面图" />
  </article>
</main>
</body></html>`;

const SAMPLE_TOC_HTML = `<!doctype html><html lang="zh-Hans"><body>
<header class="wr-topbar">
  <nav class="wr-nav" id="site-nav">
    <a href="/">首页</a>
    <a class="" href="/fenlei/shds">分类</a>
    <a href="/paihang/week">排行榜</a>
  </nav>
</header>
<main class="page-shell">
  <div class="wr-breadcrumb">
    <a href="/">首页</a>
    <span>/</span>
    <a href="/fenlei/xhyn">玄幻异能</a>
    <span>/</span>
    <a href="/xiaoshuo/447223">逆天魔尊：重生归来，镇压万界</a>
  </div>
  <div class="wr-catalog">
    <h1>逆天魔尊：重生归来，镇压万界全文最新章节目录</h1>
    <div class="wr-catalog-pager">
      <span>没有了</span>
      <select id="indexselect">
        <option value="/zhangjiemulu/447223" selected="selected">1</option>
        <option value="/zhangjiemulu/447223/2">2</option>
        <option value="/zhangjiemulu/447223/3">3</option>
        <option value="/zhangjiemulu/447223/26">26</option>
        <option value="/zhangjiemulu/447223/27">27</option>
      </select>
      <a href="/zhangjiemulu/447223/2" class="index-container-btn">下一页</a>
    </div>
    <div id="content_1" class="wr-catalog-grid">
      <a class="wr-catalog-item" href="/xiaoshuo/447223/zhangjie/18494857">第1章 乞丐和瑶池圣女！</a>
      <a class="wr-catalog-item" href="/xiaoshuo/447223/zhangjie/18494858">第2章 史诗巨作！</a>
      <a class="wr-catalog-item" href="/xiaoshuo/447223/zhangjie/18494859">第3章 诡异世界</a>
      <a class="wr-catalog-item" href="/xiaoshuo/447223/zhangjie/18494860">第4章 混沌星辰珠</a>
    </div>
  </div>
</main>
</body></html>`;

const SAMPLE_TOC_PAGE3_HTML = `<!doctype html><html lang="zh-Hans"><body>
<header class="wr-topbar">
  <nav class="wr-nav" id="site-nav">
    <a href="/" class="">首页</a>
    <a class="" href="/fenlei/shds">分类</a>
  </nav>
</header>
<main class="page-shell">
  <div class="wr-catalog">
    <div class="wr-catalog-pager">
      <a href="/zhangjiemulu/447223/2" class="index-container-btn">上一页</a>
      <select id="indexselect">
        <option value="/zhangjiemulu/447223">1</option>
        <option value="/zhangjiemulu/447223/2">2</option>
        <option value="/zhangjiemulu/447223/3" selected="selected">3</option>
        <option value="/zhangjiemulu/447223/27">27</option>
      </select>
      <a href="/zhangjiemulu/447223/4" class="index-container-btn">下一页</a>
    </div>
    <div id="content_1" class="wr-catalog-grid">
      <a class="wr-catalog-item" href="/xiaoshuo/447223/zhangjie/18500001">第101章 新的旅程！</a>
      <a class="wr-catalog-item" href="/xiaoshuo/447223/zhangjie/18500002">第102章 鸿蒙始祖剑！</a>
      <a class="wr-catalog-item" href="/xiaoshuo/447223/zhangjie/18500003">第103章 混沌星辰珠！</a>
    </div>
  </div>
</main>
</body></html>`;

const SAMPLE_TOC_LAST_PAGE_HTML = `<!doctype html><html lang="zh-Hans"><body>
<main class="page-shell">
  <div class="wr-catalog">
    <div class="wr-catalog-pager">
      <a href="/zhangjiemulu/447223/26" class="index-container-btn">上一页</a>
      <select id="indexselect">
        <option value="/zhangjiemulu/447223">1</option>
        <option value="/zhangjiemulu/447223/27" selected="selected">27</option>
      </select>
      <span>没有了</span>
    </div>
    <div id="content_1" class="wr-catalog-grid">
      <a class="wr-catalog-item" href="/xiaoshuo/447223/zhangjie/32712028">第1344章 奸情！</a>
    </div>
  </div>
</main>
</body></html>`;

const SAMPLE_CHAPTER_HTML = `<!doctype html><html lang="zh-Hans"><body>
<header class="wr-topbar">
  <nav class="wr-nav">
    <a href="/" class="">首页</a>
    <a class="" href="/fenlei/shds">分类</a>
  </nav>
</header>
<main class="page-shell">
  <article class="wr-reader">
    <div class="wr-reader-main">
      <div class="wr-reader-frame">
        <section class="wr-paper">
          <div class="wr-breadcrumb">
            <a href="/">首页</a>
            <span>/</span>
            <a href="/fenlei/xhyn">玄幻异能</a>
            <span>/</span>
            <a href="/xiaoshuo/447223" title="逆天魔尊：重生归来，镇压万界最新章节">逆天魔尊：重生归来，镇压万界</a>
            <span>/</span>
            <h1>第173章 圣家！</h1>
          </div>
          <div id="content" class="wr-content">
            <div id="booktxtSource" class="wr-source-content">
              <p>楚枫听到纪玄说已经查到圣璃儿的消息，猛的一喜，急声询问道：</p>
              <p>"她现在在哪？"</p>
              <p>本章未完，请点击下一页继续阅读</p>
              <p>纪玄连忙禀告道："她在北方大陆！"</p>
              <p>本站域名最快更新无防盗</p>
              <p>两人相视而立，仿佛整个世界都安静了下来。</p>
              <p>请收藏本站：www.51read.org，方便下次阅读</p>
            </div>
          </div>
          <nav class="wr-page-nav wr-page-nav-bottom" aria-label="章节导航">
            <a rel="prev" href="/xiaoshuo/447223/zhangjie/18495060">上一章</a>
            <a href="/zhangjiemulu/447223">目录</a>
            <a rel="next" href="/xiaoshuo/447223/zhangjie/18495064">下一章</a>
          </nav>
        </section>
      </div>
    </div>
  </article>
</main>
</body></html>`;

describe("M51readParser", () => {
  const parser = new M51readParser();
  ParserFactory.register(parser);

  it("is registered for m.51read.org", () => {
    expect(ParserFactory.get("m.51read.org")).toBe(parser);
  });

  describe("parseNovelPage", () => {
    it("extracts novel metadata", () => {
      const novel = parser.parseNovelPage({
        html: SAMPLE_NOVEL_HTML,
        novelUrl: "https://m.51read.org/xiaoshuo/447223",
        origin: "https://m.51read.org",
      });
      expect(novel.id).toBe("447223");
      expect(novel.title).toBe("逆天魔尊：重生归来，镇压万界");
      expect(novel.author).toBe("草船借火箭");
      expect(novel.coverUrl).toBe(
        "https://m.51read.org/static/default/img/nocover.jpg",
      );
      expect(novel.genre).toEqual(["玄幻异能"]);
      // The header nav has a generic "分类" link pointing to /fenlei/shds —
      // confirm we did NOT pick it up as a genre.
      expect(novel.genre).not.toContain("分类");
      expect(novel.status).toBe("连载");
      expect(novel.description).toContain("楚枫");
      expect(novel.lastUpdatedAt).toContain("最后更新");
      expect(novel.totalChapters).toBeNull();
    });

    it("tolerates a novel with no description block", () => {
      const html = SAMPLE_NOVEL_HTML.replace(
        /<h2>简介<\/h2>\s*<p>[\s\S]*?<\/p>/,
        "",
      );
      const novel = parser.parseNovelPage({
        html,
        novelUrl: "https://m.51read.org/xiaoshuo/447223",
        origin: "https://m.51read.org",
      });
      expect(novel.description).toBe("");
    });
  });

  describe("parseChapterListPage", () => {
    it("returns an empty page when called on a detail page (no .wr-catalog-grid)", () => {
      // The novel detail page has the latest 9 chapters + a "开始阅读" CTA,
      // but no TOC grid. Parsing it as page 1 would pollute the cache with
      // the wrong 10 entries. Parser must bail out with empty chapters.
      const detailPage = parser.parseChapterListPage({
        html: SAMPLE_NOVEL_HTML,
        novelUrl: "https://m.51read.org/xiaoshuo/447223",
        origin: "https://m.51read.org",
      });
      expect(detailPage.chapters).toEqual([]);
      expect(detailPage.currentPage).toBe(1);
      expect(detailPage.totalPages).toBeNull();
    });

    it("skips CTA/nav links whose title does not match '第N章'", () => {
      // Defensive: even if a future source variation embeds a "开始阅读"
      // link inside .wr-catalog-grid, the chapterNumber=null filter strips
      // it.
      const polluted = SAMPLE_TOC_HTML.replace(
        '<a class="wr-catalog-item" href="/xiaoshuo/447223/zhangjie/18494857">第1章 乞丐和瑶池圣女！</a>',
        '<a class="wr-catalog-item" href="/xiaoshuo/447223/zhangjie/18494857">开始阅读</a>',
      );
      const page = parser.parseChapterListPage({
        html: polluted,
        novelUrl: "https://m.51read.org/zhangjiemulu/447223",
        origin: "https://m.51read.org",
      });
      expect(page.chapters.length).toBe(3); // CTA filtered out, 3 real chapters remain
      expect(page.chapters.find((c) => c.title === "开始阅读")).toBeUndefined();
    });

    it("extracts chapters + pagination metadata from a TOC page (page 1)", () => {
      const page = parser.parseChapterListPage({
        html: SAMPLE_TOC_HTML,
        novelUrl: "https://m.51read.org/zhangjiemulu/447223",
        origin: "https://m.51read.org",
      });
      expect(page.chapters.length).toBe(4);
      expect(page.chapters[0]?.title).toBe("第1章 乞丐和瑶池圣女！");
      expect(page.chapters[0]?.url).toBe(
        "https://m.51read.org/xiaoshuo/447223/zhangjie/18494857",
      );
      expect(page.chapters[0]?.sourceId).toBe("18494857");
      expect(page.chapters[0]?.chapterNumber).toBe(1);
      expect(page.currentPage).toBe(1);
      // totalPages derived from <select> last option value (27).
      expect(page.totalPages).toBe(27);
      expect(page.nextPageUrl).toBe(
        "https://m.51read.org/zhangjiemulu/447223/2",
      );
    });

    it("reads currentPage from selected <option> when URL omits /{N}", () => {
      const page = parser.parseChapterListPage({
        html: SAMPLE_TOC_PAGE3_HTML,
        novelUrl: "https://m.51read.org/zhangjiemulu/447223",
        origin: "https://m.51read.org",
      });
      // selected <option value="/zhangjiemulu/447223/3"> → 3
      expect(page.currentPage).toBe(3);
      expect(page.totalPages).toBe(27);
    });

    it("extracts page number from a TOC URL with /{N} suffix", () => {
      const page = parser.parseChapterListPage({
        html: SAMPLE_TOC_PAGE3_HTML,
        novelUrl: "https://m.51read.org/zhangjiemulu/447223/3",
        origin: "https://m.51read.org",
      });
      expect(page.currentPage).toBe(3);
    });

    it("returns null nextPageUrl on the last page", () => {
      const page = parser.parseChapterListPage({
        html: SAMPLE_TOC_LAST_PAGE_HTML,
        novelUrl: "https://m.51read.org/zhangjiemulu/447223/27",
        origin: "https://m.51read.org",
      });
      expect(page.nextPageUrl).toBeNull();
      expect(page.totalPages).toBe(27);
    });

    it("deduplicates chapter URLs (keeps first occurrence)", () => {
      const dup =
        SAMPLE_TOC_HTML +
        `<a class="wr-catalog-item" href="/xiaoshuo/447223/zhangjie/18494857">第1章 dup</a>`;
      const page = parser.parseChapterListPage({
        html: dup,
        novelUrl: "https://m.51read.org/zhangjiemulu/447223",
        origin: "https://m.51read.org",
      });
      expect(page.chapters.length).toBe(4);
      expect(page.chapters[0]?.title).toBe("第1章 乞丐和瑶池圣女！");
    });
  });

  describe("parseChapterPage", () => {
    it("extracts title and cleaned paragraphs", () => {
      const result = parser.parseChapterPage({
        html: SAMPLE_CHAPTER_HTML,
        chapterUrl: "https://m.51read.org/xiaoshuo/447223/zhangjie/18495062",
        origin: "https://m.51read.org",
      });
      expect(result.title).toBe("第173章 圣家！");
      // Noise lines are filtered.
      expect(result.paragraphs).not.toContain("本章未完，请点击下一页继续阅读");
      expect(result.paragraphs).not.toContain("本站域名最快更新无防盗");
      expect(result.paragraphs).not.toContain("请收藏本站：www.51read.org，方便下次阅读");
      // Prose is preserved.
      expect(result.paragraphs.some((p) => p.startsWith("楚枫听到"))).toBe(true);
      expect(result.paragraphs.some((p) => p.includes("北方大陆"))).toBe(true);
      // No sub-page nav observed for 51read.
      expect(result.nextSubPageUrl).toBeNull();
    });
  });

  describe("buildChapterListPageUrl", () => {
    it("builds the page-1 TOC URL", () => {
      const url = parser.buildChapterListPageUrl({
        novelUrl: "https://m.51read.org/xiaoshuo/447223",
        page: 1,
      });
      expect(url).toBe("https://m.51read.org/zhangjiemulu/447223");
    });

    it("builds the page-N TOC URL", () => {
      const url = parser.buildChapterListPageUrl({
        novelUrl: "https://m.51read.org/xiaoshuo/447223",
        page: 5,
      });
      expect(url).toBe("https://m.51read.org/zhangjiemulu/447223/5");
    });

    it("falls back to the novelUrl when no novel id is in the path", () => {
      const url = parser.buildChapterListPageUrl({
        novelUrl: "https://m.51read.org/",
        page: 1,
      });
      expect(url).toBe("https://m.51read.org/");
    });
  });
});
