import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { NovelService } from "@/domain/services/novel-service";
import { createTranslationProvider } from "@/infrastructure/ai/create-translation-provider";
import { TranslationService } from "@/domain/services/translation-service";
import { CacheService } from "@/infrastructure/storage/cache";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { resolveNovelUrl } from "@/domain/url/novel-url-resolver";
import { SsrfBlockedError } from "@/lib/ssrf-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  novelUrl: z.string().min(1).max(2048),
  page: z.coerce.number().int().min(1).max(200).default(1),
});

function buildService(): NovelService {
  return new NovelService(
    new CacheService(),
    // See api/chapter/route.ts for the 9 000-char chunk rationale — fewer
    // parallel calls → faster chapter-list translation on cold novels.
    new TranslationService(createTranslationProvider(), { maxCharsPerChunk: 9_000 }),
  );
}

export async function GET(request: NextRequest) {
  const rl = await checkRateLimit(`chlist:${getClientIp(request.headers)}`, {
    limit: 60,
    windowSeconds: 60,
  });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const parsed = QuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
  }

  try {
    resolveNovelUrl(parsed.data.novelUrl);
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid URL" },
      { status: 400 },
    );
  }

  try {
    const page = await buildService().getChapterListPage({
      novelUrl: parsed.data.novelUrl,
      page: parsed.data.page,
    });
    return NextResponse.json(page, {
      headers: { "Cache-Control": "public, s-maxage=300" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}
