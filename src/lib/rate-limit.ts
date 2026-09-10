/**
 * Simple IP-based rate limiter backed by Vercel KV.
 * Sliding window of fixed size. Falls back to no-op when KV is not configured
 * (acceptable in local dev).
 */
import { kv } from "@vercel/kv";
import { isKvConfigured } from "@/lib/env";

export interface RateLimitConfig {
  /** Max requests allowed within `windowSeconds`. */
  limit: number;
  /** Sliding window length. */
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
}

export async function checkRateLimit(
  key: string,
  cfg: RateLimitConfig,
): Promise<RateLimitResult> {
  if (!isKvConfigured()) {
    return { allowed: true, remaining: cfg.limit, resetSeconds: 0 };
  }
  const fullKey = `rl:${key}`;
  const windowMs = cfg.windowSeconds * 1000;
  const now = Date.now();
  const windowStart = now - windowMs;

  // Drop expired entries.
  await kv.zremrangebyscore(fullKey, 0, windowStart);
  const count = (await kv.zcard(fullKey)) ?? 0;

  if (count >= cfg.limit) {
    const oldest = await kv.zrange(fullKey, 0, 0, { withScores: true });
    const oldestScore =
      Array.isArray(oldest) && oldest.length > 0
        ? Number((oldest[0] as { score: number }).score)
        : now;
    const resetSeconds = Math.max(
      1,
      Math.ceil((oldestScore + windowMs - now) / 1000),
    );
    return { allowed: false, remaining: 0, resetSeconds };
  }

  await kv.zadd(fullKey, { score: now, member: `${now}:${Math.random()}` });
  await kv.expire(fullKey, cfg.windowSeconds);

  return {
    allowed: true,
    remaining: cfg.limit - count - 1,
    resetSeconds: cfg.windowSeconds,
  };
}

export function getClientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "unknown";
}
