"use client";

/**
 * Per-browser reading history. Tracked in localStorage so it survives reloads
 * but never leaves the user's device. Capped to keep storage small.
 */

import type { Chapter } from "@/domain/entities/novel";

export interface ReadingHistoryEntry {
  novelId: string;
  novelTitle: string;
  novelUrl: string;
  coverUrl: string | null;
  lastChapter: {
    title: string;
    url: string;
    chapterNumber: number | null;
  };
  /** Pixel scroll position from the last reader view. */
  scrollPosition: number;
  /** ISO timestamp of the last time this novel was opened. */
  lastReadAt: string;
}

const STORAGE_KEY = "tiendao.reading-history.v1";
const MAX_ENTRIES = 20;

function read(): ReadingHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as ReadingHistoryEntry[];
  } catch {
    return [];
  }
}

function write(entries: ReadingHistoryEntry[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // ignore
  }
}

export function getReadingHistory(): ReadingHistoryEntry[] {
  return read().sort((a, b) => b.lastReadAt.localeCompare(a.lastReadAt));
}

export function recordChapterRead(args: {
  novel: { id: string; title: string; titleVi?: string; sourceUrl: string; coverUrl: string | null };
  chapter: Chapter;
  scrollPosition?: number;
}) {
  const next: ReadingHistoryEntry = {
    novelId: args.novel.id,
    // Prefer the Vietnamese title so the "Tủ truyện" card reads naturally.
    novelTitle: args.novel.titleVi ?? args.novel.title,
    novelUrl: args.novel.sourceUrl,
    coverUrl: args.novel.coverUrl,
    lastChapter: {
      // Chapter.title is the Vietnamese title returned by the translation job.
      title: args.chapter.title,
      url: args.chapter.url,
      chapterNumber: args.chapter.chapterNumber,
    },
    scrollPosition: args.scrollPosition ?? 0,
    lastReadAt: new Date().toISOString(),
  };
  const existing = read().filter((e) => e.novelId !== args.novel.id);
  const merged = [next, ...existing].slice(0, MAX_ENTRIES);
  write(merged);
}

export function updateScrollPosition(novelId: string, position: number) {
  const entries = read().map((e) =>
    e.novelId === novelId ? { ...e, scrollPosition: position } : e,
  );
  write(entries);
}

export function clearReadingHistory() {
  write([]);
}
