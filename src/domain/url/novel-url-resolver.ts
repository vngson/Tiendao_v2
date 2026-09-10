/**
 * Resolves a chapter URL to the corresponding novel URL.
 *
 * Pattern (shuhaige.net):
 *   https://m.shuhaige.net/386531/132855416.html   → novel
 *   https://m.shuhaige.net/386531/                 → novel list (page 1)
 *   https://m.shuhaige.net/386531_2/               → novel list (page 2)
 *
 * Implemented as a per-hostname strategy so adding a new site is a new
 * {@link NovelUrlStrategy}, not a string-surgery hack.
 */

export interface ResolvedNovelUrl {
  readonly origin: string;
  readonly novelId: string;
  readonly novelUrl: string;
  /** Whether the input was a chapter URL or already a novel URL. */
  readonly kind: "chapter" | "novel-page";
  /** Original (normalized) URL the user supplied. */
  readonly originalUrl: string;
}

export class InvalidNovelUrlError extends Error {
  constructor(url: string, reason: string) {
    super(`Invalid novel URL "${url}": ${reason}`);
    this.name = "InvalidNovelUrlError";
  }
}

export interface NovelUrlStrategy {
  /** Which hostname this strategy handles (lower-case, no port). */
  readonly hostname: string;
  /**
   * Parse a chapter or novel-page URL into a resolved novel descriptor.
   * Implementations MUST throw {@link InvalidNovelUrlError} on bad input.
   */
  resolve(url: URL): ResolvedNovelUrl;
}

/**
 * Strategy for shuhaige-style sites where the path is `/<novelId>/...` or
 * `/<novelId>_<pageIndex>/` for paginated chapter lists.
 */
class ShuhaigeStrategy implements NovelUrlStrategy {
  readonly hostname = "m.shuhaige.net";

  resolve(url: URL): ResolvedNovelUrl {
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length === 0) {
      throw new InvalidNovelUrlError(url.href, "no novel id in path");
    }

    // First segment is either "386531" or "386531_2" (paginated list page)
    const head = segments[0]!;
    const match = /^(\d+)(?:_(\d+))?$/.exec(head);
    if (!match) {
      throw new InvalidNovelUrlError(
        url.href,
        `expected numeric novel id, got "${head}"`,
      );
    }
    const novelId = match[1]!;
    const kind: ResolvedNovelUrl["kind"] =
      segments.length >= 2 ? "chapter" : "novel-page";

    return {
      origin: `${url.protocol}//${url.host}`,
      novelId,
      novelUrl: `${url.protocol}//${url.host}/${novelId}/`,
      kind,
      originalUrl: url.href,
    };
  }
}

/**
 * Strategy for 51read-style sites:
 *   /xiaoshuo/{id}/zhangjie/{chapterId}  → chapter
 *   /xiaoshuo/{id}                        → novel page
 *   /zhangjiemulu/{id}                    → novel page (full TOC, page 1)
 *   /zhangjiemulu/{id}/{page}             → novel page (full TOC, page N)
 */
class M51readStrategy implements NovelUrlStrategy {
  readonly hostname = "m.51read.org";

  resolve(url: URL): ResolvedNovelUrl {
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length < 2) {
      throw new InvalidNovelUrlError(
        url.href,
        "expected /xiaoshuo/{id}/ or /zhangjiemulu/{id}/",
      );
    }

    let novelId: string;
    if (segments[0] === "zhangjiemulu" && segments[1]) {
      novelId = segments[1];
    } else if (segments[0] === "xiaoshuo" && segments[1]) {
      novelId = segments[1];
    } else {
      throw new InvalidNovelUrlError(
        url.href,
        `expected /xiaoshuo/{id}/ or /zhangjiemulu/{id}/, got ${url.pathname}`,
      );
    }

    const kind: ResolvedNovelUrl["kind"] =
      segments.length >= 4 && segments[2] === "zhangjie"
        ? "chapter"
        : "novel-page";

    return {
      origin: `${url.protocol}//${url.host}`,
      novelId,
      novelUrl: `${url.protocol}//${url.host}/xiaoshuo/${novelId}`,
      kind,
      originalUrl: url.href,
    };
  }
}

const STRATEGIES: readonly NovelUrlStrategy[] = [
  new ShuhaigeStrategy(),
  new M51readStrategy(),
];
const STRATEGY_BY_HOSTNAME = new Map(
  STRATEGIES.map((s) => [s.hostname, s] as const),
);

/**
 * Resolves a user-provided URL (chapter or novel page) to its canonical novel.
 * Uses native URL parsing — never string manipulation.
 */
export function resolveNovelUrl(input: string): ResolvedNovelUrl {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new InvalidNovelUrlError(input, "not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new InvalidNovelUrlError(input, `unsupported protocol ${url.protocol}`);
  }
  const strategy =
    STRATEGY_BY_HOSTNAME.get(url.hostname.toLowerCase()) ??
    STRATEGIES.find((s) => url.hostname.toLowerCase().endsWith(`.${s.hostname}`));
  if (!strategy) {
    throw new InvalidNovelUrlError(
      input,
      `no parser registered for hostname "${url.hostname}"`,
    );
  }
  return strategy.resolve(url);
}

export function isSupportedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return (
    STRATEGY_BY_HOSTNAME.has(lower) ||
    STRATEGIES.some((s) => lower.endsWith(`.${s.hostname}`))
  );
}
