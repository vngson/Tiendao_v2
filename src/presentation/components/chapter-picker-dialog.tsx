"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { fetchChapterList } from "@/lib/api-client";
import type { Chapter, ChapterListPage } from "@/domain/entities/novel";

interface ChapterPickerDialogProps {
  novelUrl: string;
  currentChapterUrl: string;
  /**
   * 1-based page index that contains `currentChapterUrl`. When provided
   * (>1), the dialog pre-loads pages 1..initialPage so the current chapter
   * is visible without the user clicking "Tải trang" repeatedly. Falls back
   * to page 1 when omitted or when 1.
   */
  initialPage?: number;
  onSelect: (chapter: Chapter) => void;
  onClose: () => void;
}

/**
 * Chapter list popup — TienDao style.
 *
 * Reuses the same dialog chrome as `ReaderSettingsDialog` (backdrop click,
 * Escape to close, `<html>` scroll-lock that compensates for the scrollbar
 * width so the page doesn't reflow). Pages are loaded on demand — page 1
 * is fetched on open, additional pages require a "Tải thêm" click so the
 * dialog stays snappy on huge novels and avoids burning LLM tokens on
 * title translations the user might not browse.
 *
 * Selection calls `onSelect` then `onClose`. Highlighted row matches
 * `currentChapterUrl` (gold border + "Đang đọc" pill, same as
 * `ChapterList`).
 */
export function ChapterPickerDialog({
  novelUrl,
  currentChapterUrl,
  initialPage,
  onSelect,
  onClose,
}: ChapterPickerDialogProps) {
  const [pages, setPages] = useState<ChapterListPage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingPage, setLoadingPage] = useState(false);

  // Escape closes; backdrop click closes. Mirror the settings dialog's
  // scroll-lock so the underlying reader doesn't shift sideways when the
  // dialog opens.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const html = document.documentElement;
    const body = document.body;
    const prevOverflow = html.style.overflow;
    const prevPaddingRight = html.style.paddingRight;
    const scrollbarWidth = window.innerWidth - html.clientWidth;
    if (scrollbarWidth > 0) {
      const computed = window.getComputedStyle(body);
      const currentPad = parseFloat(computed.paddingRight) || 0;
      html.style.paddingRight = `${currentPad + scrollbarWidth}px`;
    }
    html.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      html.style.overflow = prevOverflow;
      html.style.paddingRight = prevPaddingRight;
    };
  }, [onClose]);

  // Sequential scan: fetch pages 1..targetPage so the dialog lands on the
  // page containing the current chapter (when `initialPage` > 1). Per-page
  // fetch hits the server-side `chapterListCacheKey` cache → repeat scans
  // cost ~0 after the first paste. Falls back to page 1 when no hint.
  useEffect(() => {
    let cancelled = false;
    const targetPage = initialPage && initialPage > 1 ? initialPage : 1;
    (async () => {
      try {
        const collected: ChapterListPage[] = [];
        for (let p = 1; p <= targetPage; p += 1) {
          if (cancelled) return;
          const page = await fetchChapterList({ novelUrl, page: p });
          if (cancelled) return;
          collected.push(page);
          // Stop early once we've reached the last known page.
          if (!page.totalPages || p >= page.totalPages) break;
        }
        if (cancelled) return;
        setPages(collected);
      } catch (err: unknown) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Lỗi tải danh sách chương");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [novelUrl, initialPage]);

  const totalPages = pages?.at(-1)?.totalPages ?? 1;
  const loadedPages = pages?.length ?? 0;
  const canLoadMore = loadedPages < totalPages;

  const loadNextPage = useCallback(async () => {
    if (!canLoadMore || loadingPage) return;
    setLoadingPage(true);
    setError(null);
    try {
      const next = await fetchChapterList({ novelUrl, page: loadedPages + 1 });
      setPages((prev) => (prev ? [...prev, next] : [next]));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Lỗi tải trang");
    } finally {
      setLoadingPage(false);
    }
  }, [canLoadMore, loadingPage, loadedPages, novelUrl]);

  const flatChapters = useMemo(() => {
    if (!pages) return [];
    // Dedup again here so two pages that happen to overlap don't collide.
    const seen = new Set<string>();
    const out: Array<Chapter & { __page: number; __idx: number }> = [];
    pages.forEach((p) => {
      p.chapters.forEach((c, i) => {
        if (seen.has(c.url)) return;
        seen.add(c.url);
        out.push({ ...c, __page: p.currentPage, __idx: i });
      });
    });
    return out;
  }, [pages]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <div className="td-dialog-backdrop" onClick={onClose} aria-hidden />
      <div
        className="td-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="chapter-picker-title"
      >
        <div className="td-dialog-panel flex max-h-[80vh] flex-col p-[3rem]">
          <header className="flex items-center justify-between border-b border-black/10 pb-4 dark:border-white/10">
            <h2
              id="chapter-picker-title"
              className="font-display text-[2.4rem] font-bold"
            >
              Danh sách chương
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="td-btn px-4 py-2 text-[1.4rem]"
              aria-label="Đóng"
            >
              ✕
            </button>
          </header>

          <div className="flex-1 overflow-y-auto py-4">
            {!pages && !error && (
              <p className="py-6 text-center text-gray">Đang tải…</p>
            )}
            {error && (
              <p className="py-6 text-center text-pastel">{error}</p>
            )}
            {pages && flatChapters.length === 0 && (
              <p className="py-6 text-center text-gray">Chưa có chương nào.</p>
            )}
            <ul className="flex flex-col gap-2 text-[1.6rem]">
              {flatChapters.map((c) => {
                const isCurrent = c.url === currentChapterUrl;
                return (
                  <li
                    key={`${c.__page}-${c.__idx}-${c.url}`}
                    className="Relative--comic flex items-center justify-between rounded-pill border border-solid border-transparent px-4 py-2 transition hover:border-gold/60"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(c);
                        onClose();
                      }}
                      className={`flex w-full items-center justify-between gap-3 text-left transition ${
                        isCurrent ? "text-gold" : "hover:text-gold"
                      }`}
                      title={c.titleVi ?? c.title}
                    >
                      <span className="block w-[80%] truncate font-bold">
                        {c.titleVi ?? c.title}
                      </span>
                      {isCurrent && (
                        <span className="rounded-pill border border-solid border-gold px-2 py-0.5 text-xs text-gold">
                          Đang đọc
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            {canLoadMore && (
              <div className="mt-4 flex justify-center">
                <button
                  type="button"
                  onClick={() => void loadNextPage()}
                  disabled={loadingPage}
                  className="td-btn-gold text-[1.4rem] disabled:opacity-40"
                >
                  {loadingPage
                    ? "Đang tải…"
                    : `Tải trang ${loadedPages + 1}/${totalPages}`}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
