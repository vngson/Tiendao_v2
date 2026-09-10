"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import {
  getReadingHistory,
  type ReadingHistoryEntry,
} from "@/presentation/utils/reading-history";
import { buildReaderPath, novelIdFromUrl } from "@/lib/reader-path";

/**
 * Continue-reading list — TienDao style.
 *
 * Matches `.Homepage__reading` from HomePage.css: card row with cover + title +
 * chapter name. Cards use `.td-card` (drop-shadow + 1rem radius).
 *
 * Layout: cover on the left, title block in the middle, action button on the
 * right. The card background is slightly translucent so the page background
 * shows through, keeping the design cohesive on top of the landscape image.
 */
export function ContinueReadingList() {
  const [entries, setEntries] = useState<ReadingHistoryEntry[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setEntries(getReadingHistory().slice(0, 5));
  }, []);

  if (!mounted || entries.length === 0) return null;

  return (
    <section className="flex w-full flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <h2
          className="font-bold"
          style={{
            fontFamily: "var(--font-title), serif",
            fontSize: "2.4rem",
            color: "var(--black)",
            letterSpacing: "0.02em",
          }}
        >
          Tủ truyện
        </h2>
        <span
          className="font-bold"
          style={{
            color: "var(--gray)",
            fontFamily: "var(--font-body)",
            fontSize: "1.4rem",
          }}
        >
          {entries.length} truyện
        </span>
      </div>

      <ul className="flex flex-col gap-5">
        {entries.map((e) => (
          <li
            key={e.novelId}
            className="flex items-center gap-6 rounded-card border border-black/10 px-6 py-5 backdrop-blur-sm transition hover:border-gold hover:shadow-lg md:gap-7 md:px-7"
            style={{
              // Translucent white so the page background image shows through.
              backgroundColor: "rgba(255, 255, 255, 0.82)",
            }}
          >
            {/* Cover — explicit width/height prevents CLS, object-cover fills box */}
            <div
              className="relative shrink-0 overflow-hidden rounded-md"
              style={{
                width: 80,
                height: 112,
                backgroundColor: "var(--title-bg-color)",
              }}
            >
              {e.coverUrl ? (
                <Image
                  src={e.coverUrl}
                  alt={`Bìa ${e.novelTitle}`}
                  fill
                  sizes="80px"
                  className="object-cover"
                  unoptimized
                />
              ) : (
                <div
                  className="flex h-full w-full items-center justify-center text-xs"
                  style={{
                    color: "var(--gray)",
                    fontFamily: "var(--font-body)",
                  }}
                  aria-hidden="true"
                >
                  No cover
                </div>
              )}
            </div>

            {/* Title block — flex-1 so the action button stays right */}
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <h3
                className="truncate font-bold"
                style={{
                  fontFamily: "var(--font-title), serif",
                  fontSize: "1.8rem",
                  color: "var(--black)",
                  letterSpacing: "0.01em",
                }}
                title={e.novelTitle}
              >
                {e.novelTitle}
              </h3>
              <p
                className="truncate"
                style={{
                  color: "var(--gray)",
                  fontFamily: "var(--font-body)",
                  fontSize: "1.4rem",
                }}
                title={e.lastChapter.title}
              >
                {e.lastChapter.title}
              </p>
            </div>

            {/* Action — gold-bordered button matching the home-page CTA. */}
            <Link
              href={buildReaderPath({
                // Older history entries may have been written before the path
                // rewrite; fall back to deriving the novel id from the chapter
                // URL so the link still works.
                novelId: e.novelId || novelIdFromUrl(e.lastChapter.url),
                chapterUrl: e.lastChapter.url,
              })}
              className="td-btn-gold inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap"
              style={{
                borderRadius: "5px",
                height: 44,
                minWidth: 130,
                fontFamily: "var(--font-title), serif",
                fontSize: "1.6rem",
              }}
            >
              Đọc tiếp
              <span aria-hidden="true">→</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
