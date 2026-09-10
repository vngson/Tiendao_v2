/**
 * High-level orchestrator: takes a user URL and produces a translated chapter
 * or novel info. Composes fetcher → parser → collector → translator → cache.
 */

/**
 * Defense-in-depth: the LLM may return the input unchanged (or wrapped in a
 * shape that fails the provider's type checks, which then falls back to the
 * raw CN). Caching that as `titleVi` etc. would silently corrupt every
 * subsequent read for 30 days. Reject any translated field that still looks
 * Chinese — CJK characters are vanishingly rare in real Vietnamese prose.
 *
 * We check the union of `titleVi + descriptionVi` so a single Chinese
 * fragment anywhere in the combined output fails the gate.
 */
const CJK_RE = /[一-鿿㐀-䶿豈-﫿]/;
function looksChinese(value: string | undefined | null): boolean {
  return typeof value === "string" && CJK_RE.test(value);
}
import { ParserFactory } from "@/domain/parsers";
import { fetchWebsite } from "@/infrastructure/http/website-fetcher";
import { ChapterCollector } from "@/domain/services/chapter-collector";
import { TranslationService } from "@/domain/services/translation-service";
import { CacheService } from "@/infrastructure/storage/cache";
import { resolveNovelUrl } from "@/domain/url/novel-url-resolver";
import type {
  Chapter,
  ChapterListPage,
  Novel,
  TranslatedChapter,
} from "@/domain/entities/novel";

/** True when the requested chapter URL appears in this list page. */
function containsChapter(page: ChapterListPage, chapterUrl: string): boolean {
  return page.chapters.some((c) => c.url === chapterUrl);
}

export class NovelService {
  constructor(
    private readonly cache: CacheService,
    private readonly translation: TranslationService,
  ) {}

  /**
   * Single-flight per novel URL. Two concurrent pastes for the same URL
   * share the same in-flight translation promise — only one LLM call.
   * Keyed on `resolved.novelUrl` (the canonical novel landing URL).
   */
  private readonly inflightMeta = new Map<string, Promise<Novel>>();
  private readonly inflightChapterList = new Map<string, Promise<ChapterListPage>>();

  /**
   * Look up a novel by any URL on its domain (landing page or chapter).
   *
   * Returns the parsed Novel + the page of chapters that contains the
   * user's requested chapter (or page 1 for novels that don't pin a
   * specific chapter). Vietnamese fields are filled when the translation
   * pass succeeded:
   *   - Meta (title/description/author/genre/status) — runs upfront via
   *     `signalMeta`.
   *   - Chapter titles — only the page that contains the requested
   *     chapter is translated, via `signalChapters`. Other pages stay
   *     in raw CN until the user clicks a page in the picker.
   */
  async getNovelByChapterUrl(args: {
    chapterUrl: string;
    signalMeta?: AbortSignal;
    signalChapters?: AbortSignal;
    onStep?: (msg: string, extra?: Record<string, unknown>) => void;
  }) {
    const log = args.onStep ?? (() => undefined);
    const resolved = resolveNovelUrl(args.chapterUrl);
    const parser =
      ParserFactory.get(resolved.origin.replace(/^https?:\/\//, ""));
    if (!parser) {
      throw new Error(`No parser for origin ${resolved.origin}`);
    }

    log("resolved", {
      novelUrl: resolved.novelUrl,
      kind: resolved.kind,
      parser: parser.hostname,
    });

    const cached = (await this.cache.getNovel(resolved.novelUrl)) as
      | Novel
      | null;
    const requestedChapterUrl =
      resolved.kind === "chapter" ? resolved.originalUrl : null;
    if (cached) {
      log("novel cache HIT", {
        title: cached.title,
        titleVi: cached.titleVi,
        hasAuthorVi: Boolean(cached.authorVi),
        hasDescVi: Boolean(cached.descriptionVi),
        hasGenreVi: Boolean(cached.genreVi?.length),
        hasStatusVi: Boolean(cached.statusVi),
      });
      // Cache hit. If Vietnamese meta hasn't been filled yet (background
      // pass failed / interrupted / older entry), await a fresh translate
      // so the first reader sees Vietnamese titles instead of CN.
      const needsMeta =
        !cached.titleVi ||
        !cached.descriptionVi ||
        (cached.author && !cached.authorVi) ||
        (cached.genre.length > 0 &&
          (!cached.genreVi || cached.genreVi.length !== cached.genre.length)) ||
        (cached.status && !cached.statusVi);
      if (needsMeta) {
        log("novel cache HIT but meta incomplete → re-translate");
        const updated = await this.singleFlightMeta(
          resolved.novelUrl,
          () => this.fillNovelVi(cached, resolved.novelUrl, args.signalMeta, log),
        );
        // We still need the chapter → page resolution so the user lands
        // on the right page even when meta is being re-translated.
        const translatedListPage = await this.resolveChapterPageToTranslate({
          novelUrl: resolved.novelUrl,
          requestedChapterUrl,
          firstPage: {
            chapters: [],
            currentPage: 1,
            totalPages: null,
            pageSize: 0,
            nextPageUrl: null,
          },
          signal: args.signalChapters,
          onStep: log,
        });
        return {
          novel: updated,
          firstPage: translatedListPage,
          firstPageChapters: translatedListPage?.chapters ?? null,
          requestedChapterUrl,
          requestedChapterPage: translatedListPage?.currentPage ?? null,
          cacheHit: true as const,
        };
      }
      // Even on cache hit, a deep-link paste needs the chapter → page
      // resolution. We re-use the cached novel data, but look up (or
      // scan) the page that contains the requested chapter.
      const translatedListPage = await this.resolveChapterPageToTranslate({
        novelUrl: resolved.novelUrl,
        requestedChapterUrl,
        firstPage: { chapters: [], currentPage: 1, totalPages: null, pageSize: 0, nextPageUrl: null },
        signal: args.signalChapters,
        onStep: log,
      });
      log("novel cache HIT, meta complete", {
        chapters: translatedListPage?.chapters.length ?? 0,
        requestedChapterPage: translatedListPage?.currentPage ?? null,
      });
      return {
        novel: cached,
        firstPage: translatedListPage,
        firstPageChapters: translatedListPage?.chapters ?? null,
        requestedChapterUrl,
        requestedChapterPage: translatedListPage?.currentPage ?? null,
        cacheHit: true as const,
      };
    }

    log("novel cache MISS → fetch + parse");
    const { body } = await fetchWebsite(resolved.novelUrl);
    log("fetchWebsite ok", { bytes: body.length });
    const novel = parser.parseNovelPage({
      html: body,
      novelUrl: resolved.novelUrl,
      origin: resolved.origin,
    });
    log("parseNovelPage ok", {
      title: novel.title,
      author: novel.author,
      genre: novel.genre,
      status: novel.status,
    });
    const listPage = parser.parseChapterListPage({
      html: body,
      novelUrl: resolved.novelUrl,
      origin: resolved.origin,
    });
    log("parseChapterListPage ok", {
      chapters: listPage.chapters.length,
      currentPage: listPage.currentPage,
      totalPages: listPage.totalPages,
      pageSize: listPage.pageSize,
    });

    // Intentionally NOT caching the raw-CN novel here. If translation fails
    // or times out, the caller still gets the parsed `novel` back so the
    // UI can render, but the next request will re-fetch + re-translate
    // instead of getting stuck on a CN entry forever.
    if (listPage.chapters.length > 0) {
      await this.cache.setChapterList(
        { novelUrl: resolved.novelUrl, page: listPage.currentPage },
        listPage,
      );
      log("cached raw-CN chapterList page " + listPage.currentPage);
    } else {
      log("skip chapterList cache (empty — likely detail page)");
    }

    // Translate the novel meta first so the reader sees the Vietnamese
    // title/description/author swap in before the chapter list finishes.
    log("translating novel meta...");
    const translatedNovel = await this.singleFlightMeta(
      resolved.novelUrl,
      () => this.fillNovelVi(novel, resolved.novelUrl, args.signalMeta, log),
    );

    // Find the page that contains the requested chapter (if any) and
    // translate ONLY that page's titles. Other pages stay raw-CN until
    // the user navigates to them via the picker.
    if (requestedChapterUrl) {
      log("scan: requested chapter URL present", { requestedChapterUrl });
    } else {
      log("scan: no chapter URL, skipping chapter-page resolve");
    }
    const translatedListPage = await this.resolveChapterPageToTranslate({
      novelUrl: resolved.novelUrl,
      requestedChapterUrl,
      firstPage: listPage,
      signal: args.signalChapters,
      onStep: log,
    });

    return {
      novel: translatedNovel,
      firstPage: translatedListPage,
      firstPageChapters: translatedListPage?.chapters ?? null,
      requestedChapterUrl,
      requestedChapterPage: translatedListPage?.currentPage ?? null,
      cacheHit: false as const,
    };
  }

  /**
   * Pick the chapter-list page to translate for the current request.
   *
   * - Non-chapter URLs (landing-page pastes) → null; the UI renders
   *   the picker and translates on demand.
   * - chapter URL hits the `chapterIndex` cache → O(1) lookup.
   * - Cold scan: load page 1, check, then page 2, 3 (capped at 3 to
   *   stay within the route's `maxDuration`). On miss, fall back to
   *   page 1 (the user can navigate via the picker).
   *
   * Returns the page to render on first paint, or null when no specific
   * page was requested. Each per-page fetch hits the per-page chapter-
   * list cache, so repeat scans cost zero upstream after the first.
   */
  private async resolveChapterPageToTranslate(args: {
    novelUrl: string;
    requestedChapterUrl: string | null;
    firstPage: ChapterListPage;
    signal?: AbortSignal;
    onStep?: (msg: string, extra?: Record<string, unknown>) => void;
  }): Promise<ChapterListPage | null> {
    const log = args.onStep ?? (() => undefined);
    if (!args.requestedChapterUrl) return null;

    // O(1) hit: previously-scanned chapter URL.
    const index = await this.cache.getChapterIndex(args.novelUrl);
    const indexedPage = index?.pagesByChapter[args.requestedChapterUrl];
    if (indexedPage) {
      log(`chapterIndex HIT → page ${indexedPage}`);
      return this.singleFlightChapterList(
        `${args.novelUrl}:${indexedPage}`,
        () =>
          this.getChapterListPage(
            { novelUrl: args.novelUrl, page: indexedPage },
            args.signal,
          ),
      );
    }
    log("chapterIndex MISS, scanning...");

    // If the upstream parser bailed out on the firstPage (e.g. the source's
    // detail page doesn't expose a chapter list and the parser correctly
    // returned empty), we still need real page 1 data — fetch it from the
    // canonical TOC URL via the parser's `buildChapterListPageUrl`.
    const page1 = args.firstPage.chapters.length > 0
      ? await this.tryTranslatePage({
          novelUrl: args.novelUrl,
          page: args.firstPage,
          signal: args.signal,
          onStep: log,
        })
      : await this.singleFlightChapterList(
          `${args.novelUrl}:1`,
          () =>
            this.getChapterListPage(
              { novelUrl: args.novelUrl, page: 1 },
              args.signal,
            ),
        );
    log(`page ${page1.currentPage} ready`, {
      chapters: page1.chapters.length,
      totalPages: page1.totalPages,
    });
    if (containsChapter(page1, args.requestedChapterUrl)) {
      log(`requested chapter FOUND on page ${page1.currentPage}`);
      await this.recordChapterIndex(args.novelUrl, {
        [args.requestedChapterUrl]: page1.currentPage,
      });
      return page1;
    }

    // Sequential scan, capped at 9 extra pages (covers deep-link pastes
    // for novels up to ~500 chapters). Stop early at totalPages. The
    // route's maxDuration budget is shared with novel meta translation;
    // abort breaks the loop if the deadline approaches.
    const totalPages = page1.totalPages ?? 2;
    const scanCap = Math.min(totalPages, 10); // pages 2..10 = 9 fetches
    log(`scanning pages 2..${scanCap} (totalPages=${totalPages})`);
    for (let page = 2; page <= scanCap; page += 1) {
      if (args.signal?.aborted) {
        log(`scan aborted at page ${page}`);
        break;
      }
      const pageStart = Date.now();
      log(`scan page ${page} start`);
      try {
        const next = await this.singleFlightChapterList(
          `${args.novelUrl}:${page}`,
          () =>
            this.getChapterListPage(
              { novelUrl: args.novelUrl, page },
              args.signal,
            ),
        );
        log(`scan page ${page} loaded`, {
          chapters: next.chapters.length,
          tookMs: Date.now() - pageStart,
        });
        if (containsChapter(next, args.requestedChapterUrl)) {
          log(`requested chapter FOUND on page ${next.currentPage}`);
          await this.recordChapterIndex(args.novelUrl, {
            [args.requestedChapterUrl]: next.currentPage,
          });
          return next;
        }
      } catch (err) {
        // Don't let one bad page kill the whole paste. Log + continue so
        // the user still gets page 1 back, even if we couldn't confirm
        // the requested chapter's page.
        log(`scan page ${page} FAILED`, {
          tookMs: Date.now() - pageStart,
          message: err instanceof Error ? err.message : String(err),
        });
        break;
      }
    }

    log("scan exhausted, fallback to page 1");
    return page1;
  }

  private async tryTranslatePage(args: {
    novelUrl: string;
    page: ChapterListPage;
    signal?: AbortSignal;
    onStep?: (msg: string, extra?: Record<string, unknown>) => void;
  }): Promise<ChapterListPage> {
    const log = args.onStep ?? (() => undefined);
    if (args.page.chapters.length === 0) {
      log(`tryTranslatePage: page ${args.page.currentPage} empty, skipping`);
      return args.page;
    }
    log(`tryTranslatePage: translating page ${args.page.currentPage} titles`);
    return this.singleFlightChapterList(
      `${args.novelUrl}:${args.page.currentPage}`,
      () =>
        this.fillChapterListVi(
          args.page,
          { novelUrl: args.novelUrl, page: args.page.currentPage },
          args.signal,
        ),
    );
  }

  /**
   * Best-effort write of a single chapter → page mapping. Failures are
   * swallowed because the next request will just re-scan.
   */
  private async recordChapterIndex(
    novelUrl: string,
    additions: Record<string, number>,
  ): Promise<void> {
    try {
      const existing = (await this.cache.getChapterIndex(novelUrl)) ?? {
        pagesByChapter: {},
      };
      await this.cache.setChapterIndex(novelUrl, {
        pagesByChapter: { ...existing.pagesByChapter, ...additions },
      });
    } catch {
      // Cache write failed — next request will rescan. No-op.
    }
  }

  /**
   * Coalesce concurrent `fillNovelVi` calls for the same novel URL into a
   * single promise. The first caller registers; subsequent callers await
   * the same promise and get the same cached `Novel` back.
   */
  private singleFlightMeta(
    novelUrl: string,
    run: () => Promise<Novel>,
  ): Promise<Novel> {
    const existing = this.inflightMeta.get(novelUrl);
    if (existing) return existing;
    const p = run().finally(() => this.inflightMeta.delete(novelUrl));
    this.inflightMeta.set(novelUrl, p);
    return p;
  }

  private singleFlightChapterList(
    key: string,
    run: () => Promise<ChapterListPage>,
  ): Promise<ChapterListPage> {
    const existing = this.inflightChapterList.get(key);
    if (existing) {
      // eslint-disable-next-line no-console
      console.log(`[novel+chapterList] singleFlight DEDUPE key=${key}`);
      return existing;
    }
    // eslint-disable-next-line no-console
    console.log(`[novel+chapterList] singleFlight START key=${key}`);
    const p = run().finally(() => this.inflightChapterList.delete(key));
    this.inflightChapterList.set(key, p);
    return p;
  }

  /**
   * Translate novel meta (title + description + author + genre + status),
   * then patch the cached Novel. Best-effort: on failure the cached Novel
   * stays untouched (raw CN fallback).
   *
   * Translation-quality gate: if the LLM returns text that still contains
   * CJK characters (provider fallback, model ignored the prompt, malformed
   * JSON recovered into a partial shape, etc.), we refuse to cache it. A
   * poisoned `*Vi` field would survive 30 days in KV and silently corrupt
   * every subsequent paste. Better to fall through to the raw-CN novel and
   * let the next request retry translation.
   */
  private async fillNovelVi(
    novel: Novel,
    novelUrl: string,
    signal?: AbortSignal,
    onStep?: (msg: string, extra?: Record<string, unknown>) => void,
  ): Promise<Novel> {
    const log = onStep ?? (() => undefined);
    try {
      log("translateNovelMeta → calling LLM");
      const meta = await this.translation.translateNovelMeta({
        title: novel.title,
        description: novel.description,
        author: novel.author ?? undefined,
        genre: novel.genre,
        status: novel.status ?? undefined,
        signal,
      });
      log("translateNovelMeta returned", {
        titleVi: meta.titleVi,
        authorVi: meta.authorVi,
        genreVi: meta.genreVi,
        statusVi: meta.statusVi,
        descViPreview: meta.descriptionVi?.slice(0, 40),
      });
      // Reject if any user-visible field still looks Chinese. Genre/status
      // are short CN tokens ("连载", "玄幻异能") that the model often leaves
      // alone; we treat that as a translation failure too.
      const polluted =
        looksChinese(meta.titleVi) ||
        looksChinese(meta.descriptionVi) ||
        looksChinese(meta.authorVi) ||
        (meta.genreVi ?? []).some(looksChinese) ||
        looksChinese(meta.statusVi);
      if (polluted) {
        log("translateNovelMeta REJECTED (output looks Chinese), returning raw-CN novel");
        return novel;
      }
      const updated: Novel = {
        ...novel,
        titleVi: meta.titleVi,
        descriptionVi: meta.descriptionVi,
        authorVi: meta.authorVi ?? novel.author ?? undefined,
        genreVi:
          meta.genreVi && meta.genreVi.length === novel.genre.length
            ? meta.genreVi
            : novel.genre,
        statusVi: meta.statusVi ?? novel.status ?? undefined,
      };
      await this.cache.setNovel(novelUrl, updated);
      log("novel:v3 cached", { titleVi: updated.titleVi });
      return updated;
    } catch (err) {
      log("translateNovelMeta THREW", {
        message: err instanceof Error ? err.message : String(err),
      });
      // Swallow — caller still gets the raw-CN `novel` back.
      return novel;
    }
  }

  /**
   * Translate chapter titles in a list page, then patch the cached page.
   *
   * Per-chapter cache check: chapters that already have a `titleVi` distinct
   * from `title` are skipped (already translated). Only the missing subset
   * is sent to the LLM. The response is merged back into the page array
   * using the original index order.
   */
  private async fillChapterListVi(
    listPage: ChapterListPage,
    cacheArgs: { novelUrl: string; page: number },
    signal?: AbortSignal,
  ): Promise<ChapterListPage> {
    // Identify which chapters need translation (no usable VN title yet).
    const needsTranslation = listPage.chapters.map(
      (c) => !c.titleVi || c.titleVi === c.title || c.titleVi.length === 0,
    );
    const missingTitles = listPage.chapters
      .filter((_, i) => needsTranslation[i])
      .map((c) => c.title);

    if (missingTitles.length === 0) return listPage;

    let translatedMissing: string[];
    try {
      translatedMissing = await this.translation.translateChapterTitles({
        titles: missingTitles,
        signal,
      });
    } catch {
      // AI failed — return the page as-is (caller keeps whatever cached
      // entries were already there).
      return listPage;
    }

    let mi = 0;
    const updated: ChapterListPage = {
      ...listPage,
      chapters: listPage.chapters.map((c, i) => {
        if (!needsTranslation[i]) return c;
        const vi = translatedMissing[mi++];
        return vi && vi !== c.title ? { ...c, titleVi: vi } : c;
      }),
    };
    await this.cache.setChapterList(cacheArgs, updated);
    return updated;
  }

  async getChapterListPage(
    args: { novelUrl: string; page: number },
    signal?: AbortSignal,
  ) {
    const url = new URL(args.novelUrl);
    const parser = ParserFactory.get(url.hostname);
    if (!parser) throw new Error(`No parser for ${url.hostname}`);

    const cached = (await this.cache.getChapterList(args)) as
      | ChapterListPage
      | null;
    if (cached) {
      // eslint-disable-next-line no-console
      console.log(
        `[novel+chapterList:${args.page}] cache HIT (${cached.chapters.length} chapters)`,
      );
      const needsVi = cached.chapters.some((c) => !c.titleVi);
      if (needsVi) {
        const key = `${args.novelUrl}:${args.page}`;
        return this.singleFlightChapterList(key, () =>
          this.fillChapterListVi(cached, args, signal),
        );
      }
      return cached;
    }

    const listUrl = parser.buildChapterListPageUrl({
      novelUrl: args.novelUrl,
      page: args.page,
    });
    // Scan-loop fetches: keep the per-page fetch budget tight so a stuck
    // upstream can't extend the request past the route's `maxDuration`.
    // The detail-page fetch (line 134) keeps the wider budget because
    // shuhaige.net legitimately takes 20-40s under load.
    // eslint-disable-next-line no-console
    console.log(
      `[novel+chapterList:${args.page}] cache MISS → fetching ${listUrl}`,
    );
    const fetchStart = Date.now();
    const { body } = await fetchWebsite(listUrl, {
      signal,
      timeoutMs: 15_000,
      retries: 1,
    });
    // eslint-disable-next-line no-console
    console.log(
      `[novel+chapterList:${args.page}] fetched ${body.length}B in ${Date.now() - fetchStart}ms`,
    );
    const page = parser.parseChapterListPage({
      html: body,
      novelUrl: args.novelUrl,
      origin: `${url.protocol}//${url.host}`,
    });
    await this.cache.setChapterList(args, page);
    if (page.chapters.length > 0) {
      const key = `${args.novelUrl}:${args.page}`;
      return this.singleFlightChapterList(key, () =>
        this.fillChapterListVi(page, args, signal),
      );
    }
    return page;
  }

  async getTranslatedChapter(chapterUrl: string): Promise<TranslatedChapter> {
    const url = new URL(chapterUrl);
    const parser = ParserFactory.get(url.hostname);
    if (!parser) throw new Error(`No parser for ${url.hostname}`);

    const cacheArgs = {
      chapterUrl,
      providerId: this.translation.providerId,
      model: this.translation.model,
    };

    const cached = (await this.cache.getChapterTranslation(cacheArgs)) as
      | TranslatedChapter
      | null;
    if (cached) return cached;

    const collector = new ChapterCollector(parser);
    const collected = await collector.collect(chapterUrl);

    // Per-novel glossary is cached so repeat chapters skip the extraction
    // round-trip. We resolve it from the chapter URL via the same strategy
    // the paste flow uses (so chapter 117 gets the same canonical novel URL
    // as chapter 1).
    //
    // Cache failures are non-fatal — we fall back to an empty glossary so
    // translation still works.
    const novelUrl = resolveNovelUrl(chapterUrl).novelUrl;
    const existingGlossary = await this.cache
      .getGlossary(novelUrl)
      .catch(() => null)
      .then((g) => g ?? {});

    // Translate first, then run glossary extraction in the background. The
    // glossary call is non-blocking on the user-visible translation — its
    // result only matters for the NEXT chapter. If it fails or times out,
    // we silently keep the previous glossary.
    const translated = await this.translation.translate({
      paragraphs: collected.paragraphs,
      title: collected.title,
      glossary: existingGlossary,
    });

    // Fire-and-forget glossary update. Wrapped in a self-contained
    // promise so any error (timeout, abort, network blip, malformed
    // response) is contained — the user has already seen their translation.
    void this.refreshGlossaryInBackground({
      novelUrl,
      paragraphs: collected.paragraphs,
      existing: existingGlossary,
    });

    const result: TranslatedChapter = {
      sourceUrl: chapterUrl,
      novel: {
        id: url.pathname.split("/")[1] ?? "",
        title: "", // filled by caller if known
      },
      title: translated.title,
      paragraphs: translated.paragraphs,
      prevChapterUrl: null,
      nextChapterUrl: null,
    };

    await this.cache.setChapterTranslation(cacheArgs, result);
    return result;
  }

  async startTranslationJob(chapterUrl: string): Promise<string> {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    await this.cache.setJob(jobId, {
      status: "processing",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Fire-and-forget. Failures are written back to the job state.
    void this.runJob(jobId, chapterUrl).catch(async (err) => {
      await this.cache.setJob(jobId, {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    return jobId;
  }

  private async runJob(jobId: string, chapterUrl: string): Promise<void> {
    const result = await this.getTranslatedChapter(chapterUrl);
    await this.cache.setJob(jobId, {
      status: "completed",
      result,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  /**
   * Best-effort, non-blocking glossary refresh. Runs AFTER the chapter is
   * already translated and returned to the user, so any failure here
   * (timeout, abort, network blip, malformed JSON from the model) is
   * invisible. The next chapter simply uses the previously cached
   * glossary — no degradation beyond skipping one cycle.
   *
   * Hard 10s timeout: glossary is a small call (~1–2s on the M3 proxy),
   * 10s is generous but keeps zombie tasks from accumulating.
   */
  private refreshGlossaryInBackground(args: {
    novelUrl: string;
    paragraphs: readonly string[];
    existing: Readonly<Record<string, string>>;
  }): void {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 10_000);
    this.translation
      .extractAndMergeGlossary({
        paragraphs: args.paragraphs,
        existing: args.existing,
        signal: ac.signal,
      })
      .then(async (merged) => {
        await this.cache.setGlossary(args.novelUrl, merged).catch(() => undefined);
      })
      .catch(() => undefined)
      .finally(() => clearTimeout(timer));
  }
}
