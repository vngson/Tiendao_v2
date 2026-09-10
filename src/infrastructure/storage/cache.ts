/**
 * Cache + job-state storage backed by Vercel KV.
 *
 * Degrades gracefully to an in-memory map when KV is not configured
 * (local dev, fresh Vercel projects before KV is provisioned). The
 * in-memory fallback is per-instance — do not rely on it across cold
 * starts in production.
 */
import { kv } from "@vercel/kv";
import { createHash } from "node:crypto";
import { getEnv, isKvConfigured } from "@/lib/env";

const NS = {
  // Bump `:v1` → `:v2` to invalidate every cached entry from the previous
  // paste-flow deployment. Old keys remain in KV but are unreachable by code;
  // they expire automatically after CACHE_TTL_SECONDS (30 days default).
  // Use this whenever the cached Novel/ChapterList shape changes in a way
  // that older entries would render incorrectly.
  chapter: "chapter:v2",
  novel: "novel:v3",
  chapterList: "chapter-list:v3",
  job: "job:v2",
  // Maps a user-pasted chapter URL to the page that contains it. One entry
  // per novel — written once when a deep-link is first resolved, then
  // reused on every subsequent paste of the same chapter.
  chapterIndex: "chapter-index:v1",
  // Per-novel CN→VI glossary of proper nouns (character names, sect names,
  // technique names, etc). Grows incrementally as new chapters are
  // translated; reused on every subsequent chapter to keep parallel-chunk
  // translations consistent.
  glossary: "glossary:v1",
} as const;

export interface CacheBackend {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
}

class MemoryBackend implements CacheBackend {
  private readonly store = new Map<string, { value: unknown; expiresAt: number | null }>();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
    this.store.set(key, { value, expiresAt });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }
}

class KvBackend implements CacheBackend {
  async get<T>(key: string): Promise<T | null> {
    return (await kv.get<T>(key)) ?? null;
  }
  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds && ttlSeconds > 0) {
      await kv.set(key, value, { ex: ttlSeconds });
    } else {
      await kv.set(key, value);
    }
  }
  async del(key: string): Promise<void> {
    await kv.del(key);
  }
}

function getBackend(): CacheBackend {
  // Re-evaluate on every call so a stale KvBackend (from before env was fixed)
  // does not stick around. The decision is cheap.
  return isKvConfigured() ? new KvBackend() : new MemoryBackend();
}

export function hashCacheKey(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}

function normalizeUrl(url: string): string {
  // Strip default ports + trailing slash so equivalent URLs hit the same cache slot.
  try {
    const u = new URL(url);
    if ((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443")) {
      u.port = "";
    }
    if (u.pathname !== "/" && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.replace(/\/+$/, "");
    }
    return u.href;
  } catch {
    return url;
  }
}

export interface ChapterCacheKeyArgs {
  chapterUrl: string;
  providerId: string;
  model: string;
}

export function chapterCacheKey(args: ChapterCacheKeyArgs): string {
  const norm = normalizeUrl(args.chapterUrl);
  return `${NS.chapter}:${args.providerId}:${args.model}:${hashCacheKey(norm)}`;
}

export function novelCacheKey(novelUrl: string): string {
  return `${NS.novel}:${hashCacheKey(normalizeUrl(novelUrl))}`;
}

export function chapterListCacheKey(args: {
  novelUrl: string;
  page: number;
}): string {
  return `${NS.chapterList}:${hashCacheKey(normalizeUrl(args.novelUrl))}:${args.page}`;
}

export function jobKey(jobId: string): string {
  return `${NS.job}:${jobId}`;
}

export function chapterIndexCacheKey(novelUrl: string): string {
  return `${NS.chapterIndex}:${hashCacheKey(normalizeUrl(novelUrl))}`;
}

export function glossaryCacheKey(novelUrl: string): string {
  return `${NS.glossary}:${hashCacheKey(normalizeUrl(novelUrl))}`;
}

/**
 * One chapter URL → one page number, per novel. Populated lazily by
 * `NovelService.findChapterPage` after a deep-link scan, then reused on
 * every subsequent paste of the same chapter. Bumping `:v1` invalidates
 * the entire map (re-scans happen automatically).
 */
export interface ChapterIndex {
  /** chapterUrl → page index (1-based) */
  pagesByChapter: Readonly<Record<string, number>>;
}

export interface JobState<T = unknown> {
  status: "processing" | "completed" | "failed";
  result?: T;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export class CacheService {
  constructor(private readonly backendOverride?: CacheBackend) {}

  private get be(): CacheBackend {
    return this.backendOverride ?? getBackend();
  }

  async getChapterTranslation(args: ChapterCacheKeyArgs): Promise<unknown | null> {
    return this.be.get(chapterCacheKey(args));
  }

  async setChapterTranslation(
    args: ChapterCacheKeyArgs,
    value: unknown,
    ttlSeconds?: number,
  ): Promise<void> {
    const ttl = ttlSeconds ?? getEnv().CACHE_TTL_SECONDS;
    return this.be.set(chapterCacheKey(args), value, ttl);
  }

  async getNovel(novelUrl: string): Promise<unknown | null> {
    return this.be.get(novelCacheKey(novelUrl));
  }

  async setNovel(novelUrl: string, value: unknown): Promise<void> {
    return this.be.set(novelCacheKey(novelUrl), value, getEnv().CACHE_TTL_SECONDS);
  }

  async getChapterList(args: { novelUrl: string; page: number }) {
    return this.be.get(chapterListCacheKey(args));
  }

  async setChapterList(args: { novelUrl: string; page: number }, value: unknown) {
    return this.be.set(chapterListCacheKey(args), value, getEnv().CACHE_TTL_SECONDS);
  }

  async getJob<T = unknown>(jobId: string): Promise<JobState<T> | null> {
    return this.be.get<JobState<T>>(jobKey(jobId));
  }

  async setJob<T = unknown>(
    jobId: string,
    state: JobState<T>,
    ttlSeconds = 30 * 60,
  ): Promise<void> {
    return this.be.set(jobKey(jobId), state, ttlSeconds);
  }

  async deleteJob(jobId: string): Promise<void> {
    return this.be.del(jobKey(jobId));
  }

  async getChapterIndex(novelUrl: string): Promise<ChapterIndex | null> {
    return this.be.get<ChapterIndex>(chapterIndexCacheKey(novelUrl));
  }

  async setChapterIndex(novelUrl: string, value: ChapterIndex): Promise<void> {
    return this.be.set(
      chapterIndexCacheKey(novelUrl),
      value,
      getEnv().CACHE_TTL_SECONDS,
    );
  }

  /**
   * Per-novel CN→VI glossary. Returned shape is the same record that was
   * written via `setGlossary`. The cache layer treats it as opaque.
   */
  async getGlossary(novelUrl: string): Promise<Record<string, string> | null> {
    return this.be.get<Record<string, string>>(glossaryCacheKey(novelUrl));
  }

  async setGlossary(
    novelUrl: string,
    value: Record<string, string>,
  ): Promise<void> {
    return this.be.set(
      glossaryCacheKey(novelUrl),
      value,
      getEnv().CACHE_TTL_SECONDS,
    );
  }
}

export const cacheService = new CacheService();
