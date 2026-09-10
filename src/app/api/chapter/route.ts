import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { NovelService } from "@/domain/services/novel-service";
import { createTranslationProvider } from "@/infrastructure/ai/create-translation-provider";
import { TranslationService } from "@/domain/services/translation-service";
import { CacheService } from "@/infrastructure/storage/cache";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { resolveNovelUrl } from "@/domain/url/novel-url-resolver";
import { SsrfBlockedError } from "@/lib/ssrf-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // Pro limit; Hobby truncates at 10s.

const QuerySchema = z.object({
  url: z.string().min(1).max(2048),
});

function buildService(): NovelService {
  const provider = createTranslationProvider();
  // Bump chunk budget to 9 000 chars so a typical chapter (~50-80 paragraphs
  // of CN, ~3 000-5 000 chars) translates in ONE provider call instead of
  // being split into 2-3 parallel calls — each chunk costs ~15 s of round-
  // trip, so halving the chunk count cuts wall-clock by ~30-40 %. Tested on
  // Groq qwen3-32b / M3 (Anthropic Messages) — both handle 9 000-char
  // payloads without truncation or timeout at 60 s `maxDuration`.
  const translation = new TranslationService(provider, { maxCharsPerChunk: 9_000 });
  return new NovelService(new CacheService(), translation);
}

export async function GET(request: NextRequest) {
  const rl = await checkRateLimit(`chapter:${getClientIp(request.headers)}`, {
    limit: 20,
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

  try {
    resolveNovelUrl(parsed.data.url);
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid URL" },
      { status: 400 },
    );
  }

  const service = buildService();

  // Try cache first; if hit, return synchronously.
  const provider = createTranslationProvider();
  const cache = new CacheService();
  const cached = (await cache.getChapterTranslation({
    chapterUrl: parsed.data.url,
    providerId: provider.id,
    model: provider.model,
  })) as unknown;
  if (cached) {
    return NextResponse.json({ status: "completed", ...(cached as object) });
  }

  // Cache miss: choose sync vs async based on whether we expect to fit in
  // the remaining function budget. We always start a job and return 202 —
  // the client polls. This works on Hobby (10s) and Pro alike.
  const jobId = await service.startTranslationJob(parsed.data.url);
  return NextResponse.json(
    {
      status: "processing",
      jobId,
      pollUrl: `/api/chapter/status?jobId=${jobId}`,
    },
    { status: 202 },
  );
}
