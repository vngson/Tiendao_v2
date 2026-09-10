"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { SiteHeader } from "@/presentation/components/site-header";
import { ReaderControls } from "@/presentation/components/reader-controls";
import { ChapterContent } from "@/presentation/components/chapter-content";
import { ChapterNav } from "@/presentation/components/chapter-nav";
import { ChapterPickerDialog } from "@/presentation/components/chapter-picker-dialog";
import {
  fetchChapterList,
  fetchChapterPageHint,
  fetchNovelInfo,
} from "@/lib/api-client";
import { useReaderSettings } from "@/presentation/hooks/use-reader-settings";
import type { Chapter } from "@/domain/entities/novel";

interface NeighborState {
  status: "loading" | "ready" | "error";
  prev?: Chapter | null;
  next?: Chapter | null;
  error?: string;
}

interface NovelInfo {
  id: string;
  title: string;
  titleVi: string | null;
  sourceUrl: string;
  coverUrl: string | null;
}

function ReaderPageInner() {
  useReaderSettings();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathParams = useParams<{ novelId: string; chapterSlug: string }>();

  const chapterUrl = searchParams.get("url");
  // Prefer the novelId straight from the path so the breadcrumb + reading
  // history have a stable id even before `/api/novel/info` resolves.
  const novelIdFromPath = pathParams?.novelId ?? "";

  const [novelInfo, setNovelInfo] = useState<NovelInfo | null>(null);
  const [neighbors, setNeighbors] = useState<NeighborState>({ status: "loading" });
  // Translated chapter title, populated by `<ChapterContent>` once the
  // translation completes. Empty until then so the title slot collapses
  // (no "—" or placeholder leaks).
  const [chapterTitle, setChapterTitle] = useState<string>("");
  // Chapter-list popup. Reuses the same scroll-lock + Escape + backdrop
  // chrome as the settings dialog.
  const [pickerOpen, setPickerOpen] = useState(false);
  // 1-based page index that contains the current chapter. Resolved during
  // the prev/next scan (lines 81-154). Used by `ChapterPickerDialog` to
  // pre-load the right page instead of defaulting to page 1.
  const [currentChapterPage, setCurrentChapterPage] = useState<number>(1);

  const novel = useMemo(() => {
    return {
      id: novelInfo?.id ?? novelIdFromPath,
      title: novelInfo?.titleVi ?? novelInfo?.title ?? "",
      titleVi: novelInfo?.titleVi ?? undefined,
      sourceUrl: novelInfo?.sourceUrl ?? "",
      coverUrl: novelInfo?.coverUrl ?? null,
    };
  }, [novelInfo, novelIdFromPath]);

  // Fetch the cached novel info (fetchNovelInfo hits /api/novel/info which
  // reads from KV — near-instant on cache hit).
  useEffect(() => {
    if (!chapterUrl) return;
    let cancelled = false;
    // First try resolving the novel URL from the chapter URL by asking the
    // existing /api/novel endpoint with the chapter URL — it returns the
    // cached novel entry without re-fetching.
    fetchNovelInfo(chapterUrl)
      .then((info) => {
        if (cancelled) return;
        if (info) setNovelInfo(info);
      })
      .catch(() => {
        // Soft fail — breadcrumb will show "Quay lại truyện".
      });
    return () => {
      cancelled = true;
    };
  }, [chapterUrl]);

  // Resolve prev/next chapter from the chapter list. We scan up to
  // totalPages so chapters that live on any page get neighbours — capping
  // at SCAN_CAP=5 used to hide Prev/Next for deep-links past page 5 of
  // long novels. Each per-page fetch is server-side cached, so repeat
  // scans cost ~0 — the cap was unnecessary defensiveness, not a perf
  // concern. The hint (chapterIndex) lets us seed with the right page
  // first; we widen as later pages report a higher totalPages.
  const SCAN_CAP = Number.POSITIVE_INFINITY;

  useEffect(() => {
    // Reset the bubble-up title slot when navigating to a new chapter —
    // ChapterContent will repopulate it via onTitleLoaded.
    setChapterTitle("");
    console.log("[neighbors] effect run", {
      chapterUrl,
      novelSourceUrl: novel.sourceUrl,
    });
    if (!chapterUrl) {
      console.log("[neighbors] skip (no chapterUrl)");
      setNeighbors({ status: "error", error: "Thiếu URL chương" });
      return;
    }
    if (!novel.sourceUrl) {
      console.log("[neighbors] skip (no novel.sourceUrl)");
      setNeighbors({ status: "ready", prev: null, next: null });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // Fast path: ask the server's `chapterIndex` cache where the
        // chapter lives. Warm hit (e.g. fresh from a paste) jumps
        // straight to the right page with zero scanning (Spec §10).
        const hint = await fetchChapterPageHint(chapterUrl).catch(() => null);
        if (cancelled) return;
        console.log("[neighbors] hint", {
          chapterUrl,
          hint,
        });

        // Seed the scan with page 1; cap extends to SCAN_CAP or the
        // parser-reported `totalPages`, whichever is smaller. When the
        // hint hits, seed with the hint's page instead of page 1.
        let startPage = 1;
        if (hint?.page && hint.page > 0) startPage = hint.page;
        let page = await fetchChapterList({
          novelUrl: novel.sourceUrl,
          page: startPage,
        });
        if (cancelled) return;
        let totalPages = page.totalPages ?? 1;
        let idx = page.chapters.findIndex((c) => c.url === chapterUrl);
        let scanEnd = Math.min(SCAN_CAP, totalPages);
        let scannedPage = startPage;
        console.log("[neighbors] scan start", {
          startPage,
          totalPages,
          scanEnd,
          SCAN_CAP,
          firstPageReturned: page.currentPage,
          chaptersOnFirstPage: page.chapters.length,
          idx,
          // Surface the first chapter URL on the scanned page so the
          // user can compare against `chapterUrl` if `idx` is -1.
          firstChapterUrlOnPage: page.chapters[0]?.url ?? null,
          lastChapterUrlOnPage:
            page.chapters[page.chapters.length - 1]?.url ?? null,
        });
        // When the hint hit, search forward from there (chapterIndex
        // can drift after the novel's chapter list grows).
        while (idx === -1 && scannedPage < scanEnd) {
          scannedPage += 1;
          page = await fetchChapterList({
            novelUrl: novel.sourceUrl,
            page: scannedPage,
          });
          if (cancelled) return;
          // A later page may report a higher `totalPages`; widen the cap.
          if (page.totalPages && page.totalPages > totalPages) {
            totalPages = page.totalPages;
            scanEnd = Math.min(SCAN_CAP, totalPages);
          }
          idx = page.chapters.findIndex((c) => c.url === chapterUrl);
          console.log("[neighbors] scan step", {
            scannedPage,
            totalPages,
            scanEnd,
            idx,
            chaptersOnPage: page.chapters.length,
            firstChapterUrlOnPage: page.chapters[0]?.url ?? null,
            lastChapterUrlOnPage:
              page.chapters[page.chapters.length - 1]?.url ?? null,
          });
        }
        if (cancelled) return;
        if (idx === -1) {
          // Chapter not found within the cap — keep the soft "no neighbours"
          // state so Prev/Next disable but the page still renders.
          console.log("[neighbors] ✗ chapter not found in scanned range", {
            chapterUrl,
            scannedRange: [startPage, scanEnd],
            totalPages,
          });
          setNeighbors({ status: "ready", prev: null, next: null });
          setCurrentChapterPage(1);
          return;
        }
        setCurrentChapterPage(scannedPage);
        const prevChapter = idx > 0 ? (page.chapters[idx - 1] ?? null) : null;
        const nextChapter =
          idx < page.chapters.length - 1
            ? (page.chapters[idx + 1] ?? null)
            : null;
        console.log("[neighbors] ✓ resolved", {
          scannedPage,
          idx,
          prevChapterUrl: prevChapter?.url ?? null,
          nextChapterUrl: nextChapter?.url ?? null,
          pageSize: page.chapters.length,
          isLastChapterOnPage: idx === page.chapters.length - 1,
          isFirstChapterOnPage: idx === 0,
        });
        setNeighbors({
          status: "ready",
          prev: prevChapter,
          next: nextChapter,
        });
      } catch (err: unknown) {
        if (cancelled) return;
        console.log("[neighbors] ✗ error", {
          chapterUrl,
          error: err instanceof Error ? err.message : String(err),
        });
        setNeighbors({
          status: "error",
          error: err instanceof Error ? err.message : "Lỗi",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chapterUrl, novel.sourceUrl]);

  // Keyboard shortcuts: ← / → jump between chapters. Skip when the user
  // is typing in an input/textarea or when the settings dialog is open
  // (dialog already binds Escape + scroll-lock).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (document.querySelector('[role="dialog"]')) return;
      if (e.key === "ArrowLeft" && neighbors.prev) {
        e.preventDefault();
        navigate(neighbors.prev);
      } else if (e.key === "ArrowRight" && neighbors.next) {
        e.preventDefault();
        navigate(neighbors.next);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // `navigate` reads `novel.id`/`chapterUrl` at click time; eslint is happy
    // if we depend on the resolved state via `neighbors`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [neighbors.prev, neighbors.next, novel.id, chapterUrl]);

  function navigate(chapter: Chapter) {
    const qs = new URLSearchParams({ url: chapter.url });
    router.push(
      `/read/${encodeURIComponent(novel.id)}/chapter?${qs.toString()}`,
    );
  }

  // Stable callback refs — declared above any early return so the order
  // of hooks stays predictable.
  const handleTitleLoaded = useCallback((title: string) => {
    setChapterTitle(title);
  }, []);

  const handlePickerSelect = useCallback(
    (chapter: Chapter) => {
      navigate(chapter);
    },
    // navigate is recreated each render; the dialog calls it only on
    // click so we can omit it from the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  if (!chapterUrl) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-2xl px-6 py-10">
          <p>Thiếu tham số URL.</p>
        </main>
      </>
    );
  }

  const currentChapter: Chapter = {
    title: "",
    url: chapterUrl,
    chapterNumber: null,
    sourceId: null,
    position: 0,
  };

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <ReaderControls />

      {/* Breadcrumb bar — full-bleed gold strip (matches title-bg sections).
        *   Acts as the only "back to novel" affordance; prev/next hints were
        *   removed because they duplicate the buttons in the pagination row. */}
      <div className="flex items-center gap-4 px-[2rem] py-2 text-base">
        <Link
          href={`/novel?url=${encodeURIComponent(novel.sourceUrl || chapterUrl)}`}
          className="font-title min-w-0 truncate font-bold tiendao-link bg-transparent"
          title={novel.title || "Quay lại truyện"}
        >
          ← Quay lại truyện
        </Link>
      </div>

      {/* Page body. Header + pagination cap at 80rem to keep their layout
        *   predictable; the chapter body sits in its own block whose
        *   max-width is driven by `--reader-content-max-width` so the
        *   "Độ rộng cột đọc" setting in the dialog actually resizes it. */}
      <main className="flex w-full flex-1 flex-col py-8">
        <div className="mx-auto flex w-full max-w-[80rem] flex-col gap-6 px-4 md:px-10 lg:px-20">
          {/* Title block — DFVN Bridge Type, ~28px, bold. The translated
            *   chapter title bubbles up from <ChapterContent> via
            *   onTitleLoaded once the LLM finishes, so users see it under
            *   the novel title without an extra round-trip. */}
          <header className="flex flex-col items-center gap-1 text-center">
            <h1
              className="font-title text-2xl font-bold leading-tight"
              title={novel.title || "Đang đọc"}
            >
              {novel.title || "Đang đọc"}
            </h1>
            {chapterTitle && (
              <h2
                className="font-title text-base font-normal text-gray"
                title={chapterTitle}
              >
                {chapterTitle}
              </h2>
            )}
          </header>

          {/* Pagination row — prev / picker / next. The middle slot opens a
            *   chapter-list popup so users can jump anywhere in the novel
            *   without scrolling through dozens of pages. Shared via
            *   <ChapterNav> so the same component renders below the
            *   chapter body too. */}
          <ChapterNav
            prev={neighbors.prev ?? null}
            next={neighbors.next ?? null}
            novelSourceUrl={novel.sourceUrl}
            onOpenPicker={() => setPickerOpen(true)}
            onNavigate={navigate}
          />
        </div>

        <ChapterContent
          chapterUrl={chapterUrl}
          novel={novel}
          chapter={currentChapter}
          prevChapter={neighbors.prev ?? null}
          nextChapter={neighbors.next ?? null}
          initialScrollPosition={0}
          onNavigate={navigate}
          onOpenPicker={() => setPickerOpen(true)}
          onTitleLoaded={handleTitleLoaded}
        />
      </main>

      {pickerOpen && novel.sourceUrl && (
        <ChapterPickerDialog
          novelUrl={novel.sourceUrl}
          currentChapterUrl={chapterUrl}
          initialPage={currentChapterPage}
          onSelect={handlePickerSelect}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

export default function ReaderPage() {
  return (
    <Suspense
      fallback={
        <>
          <SiteHeader />
          <main className="mx-auto max-w-2xl px-6 py-10">
            <p className="text-gray">Đang tải…</p>
          </main>
        </>
      }
    >
      <ReaderPageInner />
    </Suspense>
  );
}
