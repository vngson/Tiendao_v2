"use client";

import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";
export type FontFamily = "serif" | "sans";
export type ContentWidth = 600 | 800 | 1000 | 1200;

// Numeric font size in pixels. Range is constrained in the dialog
// (12–32) so the body never collapses below legibility or balloons
// into unreadable blockiness.
export interface ReaderSettings {
  theme: Theme;
  fontSize: number;
  fontFamily: FontFamily;
  lineHeight: number;
  contentWidth: ContentWidth;
}

const STORAGE_KEY = "tiendao.reader.settings";

const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 32;
const FONT_SIZE_DEFAULT = 19;

const DEFAULT_SETTINGS: ReaderSettings = {
  theme: "light",
  fontSize: FONT_SIZE_DEFAULT,
  fontFamily: "serif",
  lineHeight: 1.85,
  contentWidth: 800,
};

function clampFontSize(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return FONT_SIZE_DEFAULT;
  }
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(value)));
}

function isContentWidth(value: unknown): value is ContentWidth {
  return value === 600 || value === 800 || value === 1000 || value === 1200;
}

function loadSettings(): ReaderSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<ReaderSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      fontSize: clampFontSize(parsed.fontSize),
      // Validate contentWidth is one of the allowed values; otherwise default.
      contentWidth: isContentWidth(parsed.contentWidth)
        ? parsed.contentWidth
        : DEFAULT_SETTINGS.contentWidth,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export const FONT_SIZE_LIMITS = {
  min: FONT_SIZE_MIN,
  max: FONT_SIZE_MAX,
  step: 1,
} as const;

/**
 * Persisted reader preferences.
 *
 * Writes CSS variables on `document.documentElement` so every `.reader-content`
 * container re-renders live when the user adjusts a slider/picker in the
 * settings dialog. `theme` flips `html.dark` so the rest of the app
 * (site header, novel page, etc.) follows.
 */
export function useReaderSettings() {
  // Lazy initializer reads from storage synchronously so callers (e.g. the
  // settings dialog) see persisted values on the very first render — no
  // flash of defaults before the mount-effect overrides them.
  const [settings, setSettings] = useState<ReaderSettings>(() =>
    loadSettings(),
  );

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.classList.toggle("dark", settings.theme === "dark");
    root.style.setProperty("--reader-font-size", `${settings.fontSize}px`);
    root.style.setProperty("--reader-line-height", String(settings.lineHeight));
    root.style.setProperty(
      "--reader-font-family",
      settings.fontFamily === "serif"
        ? 'var(--font-body)'
        : 'var(--font-sans)',
    );
    root.style.setProperty(
      "--reader-content-max-width",
      `${settings.contentWidth}px`,
    );
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // ignore quota errors
    }
  }, [settings]);

  const setTheme = useCallback(
    (theme: Theme) => setSettings((s) => ({ ...s, theme })),
    [],
  );
  const setFontSize = useCallback(
    (fontSize: number) =>
      setSettings((s) => ({ ...s, fontSize: clampFontSize(fontSize) })),
    [],
  );
  const setFontFamily = useCallback(
    (fontFamily: FontFamily) => setSettings((s) => ({ ...s, fontFamily })),
    [],
  );
  const setLineHeight = useCallback(
    (lineHeight: number) => setSettings((s) => ({ ...s, lineHeight })),
    [],
  );
  const setContentWidth = useCallback(
    (contentWidth: ContentWidth) =>
      setSettings((s) => ({ ...s, contentWidth })),
    [],
  );
  const reset = useCallback(() => setSettings(DEFAULT_SETTINGS), []);

  return {
    settings,
    setTheme,
    setFontSize,
    setFontFamily,
    setLineHeight,
    setContentWidth,
    reset,
  };
}
