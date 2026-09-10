import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { NovelService } from "@/domain/services/novel-service";
import { createTranslationProvider } from "@/infrastructure/ai/create-translation-provider";
import { TranslationService } from "@/domain/services/translation-service";
import { CacheService } from "@/infrastructure/storage/cache";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { InvalidNovelUrlError, resolveNovelUrl } from "@/domain/url/novel-url-resolver";
import { SsrfBlockedError } from "@/lib/ssrf-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Allow up to 120s on Pro so the meta + chapter-title translation can
// finish on cold cache. Hobby truncates at 10s — caller will see 504 and
// can retry; the partial raw-CN entry is NOT cached anymore (see
// NovelService.getNovelByChapterUrl), so the next request re-translates.
// The client polls /api/novel/info to fill VN lazily if needed.
export const maxDuration = 120;

const QuerySchema = z.object({
  url: z.string().min(1).max(2048),
});

// Two-phase translation: meta first (5 fields + thinkingBudget can run ~6-12s
// on Gemini), then chapter titles (usually 3-8s for 50 titles). Each phase
// has its own budget so a slow meta call doesn't starve the chapter pass.
// The chapter pass is the bigger consumer — up to 3 TOC pages × 50 titles
// each, so we give it the lion's share of the 120s route budget.
const META_TIMEOUT_MS = 45_000;
const CHAPTER_LIST_TIMEOUT_MS = 90_000;

function buildService(): NovelService {
  const env = getEnv();
  const provider = createTranslationProvider();
  // Bump chunk budget to 9 000 chars so chapter-list translation (typically
  // ~50 titles at once) collapses into fewer parallel calls. See
  // api/chapter/route.ts for the rationale.
  const translation = new TranslationService(provider, { maxCharsPerChunk: 9_000 });
  const cache = new CacheService();
  return new NovelService(cache, translation);
}

export async function GET(request: NextRequest) {
  const rl = await checkRateLimit(`novel:${getClientIp(request.headers)}`, {
    limit: 30,
    windowSeconds: 60,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests", resetSeconds: rl.resetSeconds },
      { status: 429, headers: { "Retry-After": String(rl.resetSeconds) } },
    );
  }

  const parsed = QuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Missing or invalid 'url' query parameter" },
      { status: 400 },
    );
  }

  const startedAt = Date.now();
  const log = (msg: string, extra?: Record<string, unknown>) => {
    const elapsed = Date.now() - startedAt;
    // eslint-disable-next-line no-console
    console.log(
      `[novel+${elapsed.toString().padStart(5, " ")}ms] ${msg}`,
      extra ? JSON.stringify(extra) : "",
    );
  };

  log("GET /api/novel", { url: parsed.data.url });

  try {
    resolveNovelUrl(parsed.data.url);
  } catch (err) {
    if (err instanceof InvalidNovelUrlError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof SsrfBlockedError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  // Per-phase AbortControllers — meta gets the longer budget, chapter-title
  // translation runs after meta so the user sees the novel title swap in
  // before the chapter list finishes translating.
  const controllerMeta = new AbortController();
  const controllerChapters = new AbortController();
  const metaTimer = setTimeout(
    () => controllerMeta.abort(),
    META_TIMEOUT_MS,
  );
  const chapterTimer = setTimeout(
    () => controllerChapters.abort(),
    CHAPTER_LIST_TIMEOUT_MS,
  );

  try {
    const service = buildService();
    log("buildService ok, calling getNovelByChapterUrl");
    const result = await service.getNovelByChapterUrl({
      chapterUrl: parsed.data.url,
      signalMeta: controllerMeta.signal,
      signalChapters: controllerChapters.signal,
      onStep: log,
    });
    log("getNovelByChapterUrl done", {
      cacheHit: result.cacheHit,
      page: result.requestedChapterPage,
      chapters: result.firstPageChapters?.length ?? 0,
      novelVi:
        Boolean(result.novel.titleVi) && result.novel.titleVi !== result.novel.title,
    });
    return NextResponse.json(
      {
        novel: result.novel,
        firstPage: result.firstPage,
        firstPageChapters: result.firstPageChapters,
        requestedChapterUrl: result.requestedChapterUrl,
        requestedChapterPage: result.requestedChapterPage,
        cacheHit: result.cacheHit,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      },
    );
  } catch (err) {
    log("ERROR", { message: err instanceof Error ? err.message : String(err) });
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    clearTimeout(metaTimer);
    clearTimeout(chapterTimer);
    log("GET /api/novel end");
  }
}
