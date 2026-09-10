import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { CacheService } from "@/infrastructure/storage/cache";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import {
  InvalidNovelUrlError,
  resolveNovelUrl,
} from "@/domain/url/novel-url-resolver";
import { SsrfBlockedError } from "@/lib/ssrf-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  url: z.string().min(1).max(2048),
});

/**
 * O(1) lookup of the page that contains the given chapter URL.
 *
 * Reads the cached `chapterIndex` map (written by `/api/novel`'s deep-link
 * scan) and returns `{ page, novelUrl }` without crawling. The reader
 * page uses this on first paint to land directly on the page containing
 * the user's requested chapter, with no scan overhead.
 *
 * Returns `{ page: null, novelUrl: null }` on cache miss — the reader
 * falls back to its sequential scan (up to SCAN_CAP) in that case.
 */
export async function GET(request: NextRequest) {
  const rl = await checkRateLimit(`page-for-chapter:${getClientIp(request.headers)}`, {
    limit: 120,
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

  let canonicalNovelUrl: string;
  try {
    canonicalNovelUrl = resolveNovelUrl(parsed.data.url).novelUrl;
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof InvalidNovelUrlError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid URL" },
      { status: 400 },
    );
  }

  const cache = new CacheService();
  const index = await cache.getChapterIndex(canonicalNovelUrl);
  const page = index?.pagesByChapter[parsed.data.url] ?? null;

  return NextResponse.json(
    { page, novelUrl: canonicalNovelUrl },
    {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
      },
    },
  );
}
