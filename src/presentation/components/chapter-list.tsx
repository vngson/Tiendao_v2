"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchChapterList } from "@/lib/api-client";
import type { Chapter, ChapterListPage } from "@/domain/entities/novel";

interface ChapterListProps {
  novelUrl: string;
  initialPage: ChapterListPage;
  totalChapters: number | null;
  highlightChapterUrl?: string | null;
  /**
   * Page index (1-based) that the parent wants the user to land on.
   * Defaults to `initialPage.currentPage`. When the parent passes a
   * different value (e.g. the page containing the user's pasted chapter),
   * the picker is pinned there on first paint.
   */
  initialActivePage?: number | null;
  onSelect: (chapter: Chapter) => void;
}

/**
 * Chapter list — TienDao style.
 *
 * Mirrors `.Relative--comic` from StoryDetail.css: a vertical list of rows with
 * chapter type / title / chapter name. The current chapter is highlighted with
 * the gold border + title-bg fill (matches `.Story__status_btn` active state).
 *
 * Pagination: the page picker (dropdown) lets the user jump to any page; the
 * Prev/Next buttons move one page at a time. Each fetched page is translated
 * on the server and cached independently, so revisiting a page is instant.
 * The IntersectionObserver still loads the next page on scroll for users who
 * prefer to keep reading without using the controls.
 */
export function ChapterList({
  novelUrl,
  initialPage,
  totalChapters,
  highlightChapterUrl,
  initialActivePage,
  onSelect,
}: ChapterListProps) {
  const [pages, setPages] = useState<ChapterListPage[]>([initialPage]);
  const [activePage, setActivePage] = useState(
    initialActivePage && initialActivePage > 0
      ? initialActivePage
      : initialPage.currentPage,
  );
  const [loadingPage, setLoadingPage] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const listTopRef = useRef<HTMLDivElement>(null);
  // Monotonic request id — when stale responses resolve, drop them so
  // they don't overwrite UI state from a newer click (Spec §16).
  const reqIdRef = useRef(0);

  // Derive totalPages from totalChapters / pageSize when known, so the
  // pager shows the right "Trang N / M" even if the parser's <select>
  // markup was missing the last option. Page size is the initial page's
  // chapter count (server enforces ~50).
  const pageSize =
    initialPage.pageSize ?? initialPage.chapters.length ?? 50;
  const totalPages = useMemo(() => {
    if (totalChapters && totalChapters > 0 && pageSize > 0) {
      return Math.ceil(totalChapters / pageSize);
    }
    return initialPage.totalPages ?? pages.at(-1)?.totalPages ?? 1;
  }, [totalChapters, pageSize, initialPage.totalPages, pages]);
  const allChapters = pages.flatMap((p) => p.chapters);

  const loadPage = useCallback(
    async (page: number) => {
      if (page < 1) return;
      if (pages.some((p) => p.currentPage === page)) {
        setActivePage(page);
        return;
      }
      const reqId = ++reqIdRef.current;
      setLoadingPage(page);
      setError(null);
      try {
        const next = await fetchChapterList({ novelUrl, page });
        if (reqId !== reqIdRef.current) return; // stale, drop
        setPages((prev) =>
          [...prev, next].sort((a, b) => a.currentPage - b.currentPage),
        );
        setActivePage(page);
      } catch (err) {
        if (reqId !== reqIdRef.current) return;
        setError(err instanceof Error ? err.message : "Lỗi tải danh sách chương");
      } finally {
        if (reqId === reqIdRef.current) setLoadingPage(null);
      }
    },
    [novelUrl, pages],
  );

  const gotoPage = useCallback(
    (page: number) => {
      const clamped = Math.max(1, Math.min(totalPages, Math.floor(page)));
      if (clamped === activePage) return;
      void loadPage(clamped).then(() => {
        if (clamped === activePage) return;
        listTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },
    [activePage, loadPage, totalPages],
  );

  // IntersectionObserver-based lazy loading: load next page when sentinel scrolls into view.
  useEffect(() => {
    if (!loadMoreRef.current) return;
    if (activePage >= totalPages) return;
    const node = loadMoreRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          const next = activePage + 1;
          if (!pages.some((p) => p.currentPage === next)) {
            setActivePage(next);
            void loadPage(next);
          }
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [activePage, totalPages, loadPage, pages]);

  const pageOptions = useMemo(() => {
    const total = totalPages;
    return Array.from({ length: total }, (_, i) => i + 1);
  }, [totalPages]);

  return (
    <section
      ref={listTopRef}
      className="flex w-full flex-col gap-3"
    >
      {/* Section title bar (matches `.title_wrapper` from StoryDetail.css) */}
      <div className="tiendao-title-bg flex w-full flex-wrap items-center justify-between gap-3 px-2.5 py-2.5">
        <h2 className="font-title flex flex-col gap-[5px] border-l-4 border-l-paper pl-2.5 text-base font-bold">
          Danh sách chương
          <span className="text-xs font-normal text-gray">
            {allChapters.length}
            {totalChapters ? ` / ${totalChapters}` : ""} chương
          </span>
        </h2>

        {/* Pagination controls — pick a specific page or step prev/next. */}
        <div
          className="flex items-center gap-2 text-sm"
          aria-label="Điều hướng trang"
        >
          <button
            type="button"
            onClick={() => gotoPage(activePage - 1)}
            disabled={activePage <= 1}
            className="td-btn-gold disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              padding: "0.4rem 1rem",
              fontSize: "1.4rem",
              minHeight: "auto",
            }}
            aria-label="Trang trước"
          >
            ‹ Trước
          </button>
          <label className="flex items-center gap-1.5">
            <span className="sr-only">Trang</span>
            <select
              value={activePage}
              onChange={(e) => gotoPage(Number(e.target.value))}
              className="td-input"
              style={{ padding: "0.4rem 0.6rem", fontSize: "1.4rem" }}
              aria-label="Chọn trang"
            >
              {pageOptions.map((p) => (
                <option key={p} value={p}>
                  Trang {p}
                </option>
              ))}
            </select>
            <span style={{ color: "var(--gray)", fontSize: "1.3rem" }}>
              / {totalPages}
            </span>
          </label>
          <button
            type="button"
            onClick={() => gotoPage(activePage + 1)}
            disabled={activePage >= totalPages}
            className="td-btn-gold disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              padding: "0.4rem 1rem",
              fontSize: "1.4rem",
              minHeight: "auto",
            }}
            aria-label="Trang sau"
          >
            Sau ›
          </button>
        </div>
      </div>

      <ul className="grid w-full grid-cols-2 gap-x-3 gap-y-2 px-2.5 text-base lg:grid-cols-3">
        {allChapters.map((c) => {
          // React key: composite of owning page + position (DOM order)
          // + URL. Stable across page-jumps, unique even if a duplicate
          // URL slips past the parser dedupe.
          const owningPage = pages.find((p) => p.chapters.includes(c));
          const liKey = `${owningPage?.currentPage ?? 0}-${c.position}-${c.url}`;
          const isCurrent = c.url === highlightChapterUrl;
          return (
            <li
              key={liKey}
              className={`Relative--comic min-w-0 ${isCurrent ? "rounded-md ring-1 ring-gold" : ""}`}
            >
              <button
                type="button"
                onClick={() => onSelect(c)}
                className={`font-title flex w-full min-w-0 items-center gap-2 py-2 text-left transition ${
                  isCurrent ? "text-gold" : "hover:text-gold"
                }`}
                title={c.titleVi ?? c.title}
              >
                <span
                  className={`block min-w-0 flex-1 truncate font-bold ${
                    isCurrent ? "font-bold" : ""
                  }`}
                >
                  {c.titleVi ?? c.title}
                </span>
                {isCurrent && (
                  <span className="shrink-0 rounded-pill border border-solid border-gold px-1.5 py-0.5 text-[0.65rem] text-gold">
                    Đang đọc
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <div ref={loadMoreRef} style={{ height: "1px" }} />
      <ChapterListStatus
        loadingPage={loadingPage}
        pages={pages}
        error={error}
        activePage={activePage}
        totalPages={totalPages}
      />
    </section>
  );
}

function ChapterListStatus({
  loadingPage,
  pages,
  error,
  activePage,
  totalPages,
}: {
  loadingPage: number | null;
  pages: readonly ChapterListPage[];
  error: string | null;
  activePage: number;
  totalPages: number;
}) {
  if (error) return <p className="mt-4 text-sm text-pastel">{error}</p>;
  if (loadingPage) {
    return (
      <p className="mt-4 text-sm text-gray">Đang tải trang {loadingPage}…</p>
    );
  }
  // Granular: count missing titles on the currently-visible page so the
  // user sees real progress ("Đang dịch tên chương: 12/50") instead of a
  // generic spinner (Spec §15).
  const currentPageData = pages.find((p) => p.currentPage === activePage);
  if (currentPageData) {
    const total = currentPageData.chapters.length;
    const missing = currentPageData.chapters.filter(
      (c) => !c.titleVi || c.titleVi === c.title || c.titleVi.length === 0,
    ).length;
    if (total > 0 && missing > 0 && missing < total) {
      return (
        <p className="mt-4 text-sm text-gray">
          Đang dịch tên chương: {total - missing}/{total}…
        </p>
      );
    }
  }
  if (activePage >= totalPages && pages.length > 0) {
    return <p className="mt-4 text-sm text-gray">Hết danh sách chương.</p>;
  }
  return null;
}
