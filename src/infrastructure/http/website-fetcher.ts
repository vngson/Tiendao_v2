/**
 * HTTP fetcher with SSRF protection, timeouts, retries, and a normal-looking
 * User-Agent. Uses native fetch (Node 18+ via Next.js runtime).
 */
import {
  SsrfBlockedError,
  assertHostnameResolvesPublic,
  validatePublicUrl,
} from "@/lib/ssrf-guard";

export interface FetchOptions {
  /** Total request timeout in ms. Default 60s — shuhaige.net can take
   *  20–40s to respond under load; 12s was way too aggressive. */
  timeoutMs?: number;
  /** Number of retry attempts on transient errors. Default 4 (so up to
   *  5 total tries × 60s = 5min worst case). */
  retries?: number;
  /** Override User-Agent (rarely needed). */
  userAgent?: string;
  /** Optional request headers (kept minimal). */
  headers?: Record<string, string>;
  /** External AbortSignal — fires `controller.abort()` as well, so the
   *  caller's deadline is honored even when the per-attempt timeout
   *  has not yet fired. Without this, retry loops can outlive the
   *  caller's budget by minutes. */
  signal?: AbortSignal;
}

export interface FetchResult {
  url: string;
  status: number;
  /** Final URL after redirects. */
  finalUrl: string;
  body: string;
  contentType: string | null;
}

export class FetchFailedError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "FetchFailedError";
  }
}

const DEFAULT_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchWebsite(
  rawUrl: string,
  opts: FetchOptions = {},
): Promise<FetchResult> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const retries = opts.retries ?? 4;
  const userAgent = opts.userAgent ?? DEFAULT_UA;

  const url = validatePublicUrl(rawUrl);

  // Defense in depth: also verify DNS resolves to a public IP before fetch.
  await assertHostnameResolvesPublic(url.hostname);

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (opts.signal) {
      if (opts.signal.aborted) {
        controller.abort();
      } else {
        opts.signal.addEventListener("abort", () => controller.abort(), {
          once: true,
        });
      }
    }
    try {
      const res = await fetch(url.href, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent": userAgent,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7,vi;q=0.5",
          "Cache-Control": "no-cache",
          ...opts.headers,
        },
      });

      if (res.status === 403 || res.status === 429 || res.status >= 500) {
        console.warn(
          `[fetchWebsite] upstream error ${res.status} ${res.statusText} ` +
            `(attempt ${attempt + 1}/${retries + 1}) ${url.href}`,
        );
        if (attempt < retries) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new FetchFailedError(
          `HTTP ${res.status} ${res.statusText}`,
          res.status,
        );
      }

      if (!res.ok) {
        console.warn(
          `[fetchWebsite] non-ok status ${res.status} ${res.statusText} ${url.href}`,
        );
        throw new FetchFailedError(
          `HTTP ${res.status} ${res.statusText}`,
          res.status,
        );
      }

      const body = await res.text();
      return {
        url: rawUrl,
        status: res.status,
        finalUrl: res.url || url.href,
        body,
        contentType: res.headers.get("content-type"),
      };
    } catch (err) {
      lastError = err;
      if (err instanceof SsrfBlockedError) throw err;
      console.warn(
        `[fetchWebsite] attempt ${attempt + 1}/${retries + 1} threw ${
          err instanceof Error ? err.name : "?"
        }: ${err instanceof Error ? err.message : String(err)} ${url.href}`,
      );
      if (err instanceof FetchFailedError && attempt === retries) throw err;
      if (attempt < retries) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  console.error(
    `[fetchWebsite] giving up after ${retries + 1} attempts: ${url.href}`,
    lastError instanceof Error ? lastError.message : lastError,
  );
  throw new FetchFailedError(
    `Fetch failed after ${retries + 1} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

/**
 * Resolves a possibly-relative href against a base URL using the platform
 * URL constructor (never string manipulation).
 */
export function resolveUrl(href: string, base: string): string {
  return new URL(href, base).href;
}
