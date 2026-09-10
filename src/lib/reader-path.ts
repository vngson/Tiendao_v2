/**
 * Helpers to build the path-based reader URL: `/read/<novelId>/chapter`.
 *
 * The chapter is identified by its source URL in the `?url=` query — that's
 * the stable identifier the API uses to fetch + cache content. We use a
 * literal `chapter` segment instead of a per-chapter slug so the path is
 * always valid (one canonical shape), easy to type manually, and still
 * shorter than the legacy `/read?url=...&novelId=...&novelTitle=...` form.
 */

function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Build the reader path. `novelId` should be a stable identifier for the
 * novel (currently the path segment derived from the source URL by the
 * URL resolver). `chapterUrl` is the full chapter URL the API expects.
 */
export function buildReaderPath(args: {
  novelId: string;
  chapterUrl: string;
}): string {
  return `/read/${encodeURIComponent(args.novelId)}/chapter?url=${encodeURIComponent(args.chapterUrl)}`;
}

/**
 * Extract the stable novel-id path segment from a novel source URL.
 * Mirrors the heuristic used by the URL resolver so `novelId` in the path
 * matches what the API expects.
 */
export function novelIdFromUrl(sourceUrl: string): string {
  try {
    const u = new URL(sourceUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    return parts[0] ?? "";
  } catch {
    return "";
  }
}

/**
 * Compute a human-readable chapter slug for the legacy 2-segment route
 * (kept exported so old bookmarks still work, but no longer used to build
 * new URLs).
 */
export function chapterSlugFromUrl(chapterUrl: string): string {
  const lastSegment = (() => {
    try {
      const u = new URL(chapterUrl);
      const parts = u.pathname.split("/").filter(Boolean);
      return parts.at(-1) ?? "";
    } catch {
      return "";
    }
  })();
  return slugify(lastSegment.replace(/\.(html|htm)$/i, "")) || "chapter";
}
