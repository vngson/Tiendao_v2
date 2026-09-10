"use client";

import type { Chapter } from "@/domain/entities/novel";

/**
 * Pagination row — prev / chapter-picker / next.
 *
 * Shared between the reader page (above the chapter body) and the
 * bottom-of-chapter render (mirrors the top nav so users land on the
 * same controls after scrolling). Renders unconditionally whenever a
 * `sourceUrl` is known — does NOT wait for the chapter translation to
 * finish, so users can jump to neighbours even while the current
 * chapter is still loading (otherwise prev/next stay hidden during a
 * 20–60 s translate).
 */
interface ChapterNavProps {
  /** Resolved prev/next neighbours. Either may be null at chapter
   *  boundaries or while the surrounding scan is still running. */
  prev: Chapter | null;
  next: Chapter | null;
  /** Novel source URL — gates the picker button (can't open the
   *  chapter-list popup without a canonical novel URL). */
  novelSourceUrl: string;
  /** Opens the chapter picker dialog. */
  onOpenPicker: () => void;
  /** Navigates to the given neighbour chapter. */
  onNavigate: (chapter: Chapter) => void;
}

export function ChapterNav({
  prev,
  next,
  novelSourceUrl,
  onOpenPicker,
  onNavigate,
}: ChapterNavProps) {
  return (
    <nav
      aria-label="Chương trước / sau"
      className="flex flex-wrap items-center justify-center gap-3 text-base"
    >
      <button
        type="button"
        disabled={!prev}
        onClick={() => prev && onNavigate(prev)}
        className="td-btn-gold w-[18rem] justify-center disabled:opacity-40 disabled:hover:bg-paper disabled:hover:text-gold dark:disabled:hover:bg-transparent"
      >
        ← Chương trước
      </button>
      <button
        type="button"
        onClick={onOpenPicker}
        disabled={!novelSourceUrl}
        className="td-btn-gold min-w-[24rem] max-w-full justify-center disabled:opacity-40 disabled:hover:bg-paper disabled:hover:text-gold dark:disabled:hover:bg-transparent"
        aria-haspopup="dialog"
      >
        ☰ Danh sách chương
      </button>
      <button
        type="button"
        disabled={!next}
        onClick={() => next && onNavigate(next)}
        className="td-btn-gold w-[18rem] justify-center disabled:opacity-40 disabled:hover:bg-paper disabled:hover:text-gold dark:disabled:hover:bg-transparent"
      >
        Chương tiếp →
      </button>
    </nav>
  );
}
