"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Site header — TienDao style.
 *
 * Layout follows `src/components/Header/Header.css` from TienDaoWeb/Front_End:
 * - Soft gray background (`--background-color-1`), 70px tall
 * - Logo (real PNG from /assets/Logo.png) on the left, scaled to header height
 * - Nav items in DFVN Bridge Type, hover/active → gold
 * - Dark mode toggle (☾/☀) on the right
 */
export function SiteHeader() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = window.localStorage.getItem("tiendao.reader.settings");
    let initial: "light" | "dark" = "light";
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as { theme?: "light" | "dark" };
        if (parsed.theme === "dark") initial = "dark";
      } catch {
        // ignore
      }
    } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      initial = "dark";
    }
    setTheme(initial);
    document.documentElement.classList.toggle("dark", initial === "dark");
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      const raw = window.localStorage.getItem("tiendao.reader.settings");
      const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      window.localStorage.setItem(
        "tiendao.reader.settings",
        JSON.stringify({ ...parsed, theme: next }),
      );
    } catch {
      // ignore
    }
  }

  return (
    <header
      className="bg-bg-soft border-b border-black/20 dark:border-white/10"
      style={{ height: 70 }}
    >
      <div
        className="mx-auto flex w-full max-w-[80rem] items-center justify-between gap-8 px-6 md:px-12 lg:px-20"
        style={{ height: 70 }}
      >
        {/* Logo + wordmark. Both children are 56px tall; `flex items-center`
            on the wrapper centers them on the header's 70px midline so the
            wordmark visually lines up with the logo regardless of font ascent. */}
        <Link href="/" className="flex items-center gap-3">
          <Image
            src="/assets/Logo_small.webp"
            alt="Tiên đạo"
            width={60}
            height={60}
            className="block h-14 w-14 shrink-0 object-contain"
            priority
          />
          <span
            className="flex shrink-0 items-center font-bold whitespace-nowrap"
            style={{
              fontFamily: "var(--font-utm), var(--font-display), serif",
              fontSize: "2.6rem",
              letterSpacing: "0.02em",
              height: 56,
              lineHeight: "56px",
              // Nudge the optical center down so the wordmark visually aligns
              // with the logo's geometric center (UTM ThuPhap has a low cap).
              paddingTop: "3.35rem",
              paddingLeft: "1rem",
            }}
          >
            Tiên đạo
          </span>
        </Link>

        {/* Nav — DFVN Bridge Type, bold, generous spacing.
            "Tủ truyện" points at the home page where the continue-reading
            list lives; we don't introduce a separate `/tu-truyen` route
            until there's a reason to split reading history from discovery. */}
        <nav
          className="flex items-center justify-center gap-10 whitespace-nowrap"
          style={{ fontFamily: "var(--font-title)", fontSize: "1.6rem", fontWeight: 700 }}
        >
          <Link href="/" className="tiendao-link">
            Trang chủ
          </Link>
          <Link href="/" className="tiendao-link">
            Tủ truyện
          </Link>
        </nav>

        {/* Theme toggle — matches header scale, gold border on hover.
            Uses the same gold border treatment as other CTAs for consistency. */}
        <button
          type="button"
          onClick={toggleTheme}
          className="tiendao-link inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap border border-solid border-black/60 px-5 text-base font-bold transition hover:border-gold hover:text-gold dark:border-white/40 dark:text-white dark:hover:border-gold dark:hover:text-gold"
          style={{
            fontFamily: "var(--font-title), serif",
            height: 44,
            minWidth: 110,
            borderRadius: "5px",
          }}
          aria-label="Chuyển chế độ sáng/tối"
          title={theme === "dark" ? "Chuyển sang sáng" : "Chuyển sang tối"}
        >
          {mounted ? (theme === "dark" ? "☀ Sáng" : "☾ Tối") : "☾ Tối"}
        </button>
      </div>
    </header>
  );
}
