import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { CacheService } from "@/infrastructure/storage/cache";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import {
  InvalidNovelUrlError,
  resolveNovelUrl,
} from "@/domain/url/novel-url-resolver";
import { SsrfBlockedError } from "@/lib/ssrf-guard";
import type { Novel } from "@/domain/entities/novel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  novelUrl: z.string().min(1).max(2048),
});

/**
 * Returns the cached `Novel` snapshot (with Vietnamese fields when the
 * translation pass has already written them) for the given chapter URL.
 *
 * The reader page passes the chapter URL (the only thing in the URL bar),
 * and we resolve it back to the parent novel URL to look up the cache entry.
 * Returns `{ novel: null }` when nothing is cached yet — the reader renders
 * a generic "Đang đọc" title in that case.
 *
 * Now exposes the full Vietnamese snapshot (description / author / genre /
 * status + their `Vi` counterparts) so the reader breadcrumb and surrounding
 * UI never have to render raw Chinese when a translated version is cached.
 */
export async function GET(request: NextRequest) {
  const rl = await checkRateLimit(`novel-info:${getClientIp(request.headers)}`, {
    limit: 60,
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
      { error: "Missing or invalid 'novelUrl' query parameter" },
      { status: 400 },
    );
  }

  let canonicalNovelUrl: string;
  try {
    canonicalNovelUrl = resolveNovelUrl(parsed.data.novelUrl).novelUrl;
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
  const novel = (await cache.getNovel(canonicalNovelUrl)) as Novel | null;
  if (!novel) {
    return NextResponse.json({ novel: null }, { status: 200 });
  }

  return NextResponse.json(
    {
      novel: {
        id: novel.id,
        title: novel.title,
        titleVi: novel.titleVi ?? null,
        description: novel.description,
        descriptionVi: novel.descriptionVi ?? null,
        author: novel.author,
        authorVi: novel.authorVi ?? null,
        coverUrl: novel.coverUrl,
        genre: novel.genre,
        genreVi: novel.genreVi ?? null,
        status: novel.status,
        statusVi: novel.statusVi ?? null,
        totalChapters: novel.totalChapters,
        lastUpdatedAt: novel.lastUpdatedAt,
        sourceUrl: novel.sourceUrl,
      },
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    },
  );
}
