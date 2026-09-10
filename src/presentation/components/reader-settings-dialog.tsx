"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  useReaderSettings,
  FONT_SIZE_LIMITS,
  type ContentWidth,
  type FontFamily,
  type Theme,
} from "@/presentation/hooks/use-reader-settings";

interface ReaderSettingsDialogProps {
  onClose: () => void;
}

const THEME_OPTIONS: ReadonlyArray<readonly [Theme, string]> = [
  ["light", "Sáng"],
  ["dark", "Tối"],
];

const FONT_FAMILY_OPTIONS: ReadonlyArray<readonly [FontFamily, string]> = [
  ["serif", "Serif"],
  ["sans", "Sans"],
];

const CONTENT_WIDTH_OPTIONS: ReadonlyArray<readonly [ContentWidth, string]> = [
  [600, "Hẹp"],
  [800, "Vừa"],
  [1000, "Rộng"],
  [1200, "Rất rộng"],
];

/**
 * Reader settings popup — single source of truth for theme, font size,
 * font family, line height, and content width.
 *
 * Rendered through `createPortal(document.body)` so it escapes any
 * stacking-context or `overflow: hidden` ancestor. Backdrop click and
 * Escape both close; while open, `<html>` is scroll-locked.
 */
export function ReaderSettingsDialog({ onClose }: ReaderSettingsDialogProps) {
  const {
    settings,
    setTheme,
    setFontSize,
    setFontFamily,
    setLineHeight,
    setContentWidth,
    reset,
  } = useReaderSettings();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);

    // Lock the underlying scroll **without** hiding the scrollbar — just
    // disabling overflow would reflow content ~15px sideways as the bar
    // disappears. Bumping <html>'s right padding by the scrollbar width
    // keeps the page stationary while the modal is open.
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

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <div className="td-dialog-backdrop" onClick={onClose} aria-hidden />
      <div
        className="td-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reader-settings-title"
      >
        <div className="td-dialog-panel p-[3rem]">
          <header className="flex items-center justify-between border-b border-black/10 pb-4 dark:border-white/10">
            <h2
              id="reader-settings-title"
              className="font-display text-[2.4rem] font-bold"
            >
              Cài đặt chương truyện
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

          <div className="flex flex-col gap-7 py-6 text-[1.6rem]">
            <Row label="Giao diện">
              <Segmented
                value={settings.theme}
                options={THEME_OPTIONS}
                onChange={setTheme}
              />
            </Row>
            <Row label="Font chữ">
              <Segmented
                value={settings.fontFamily}
                options={FONT_FAMILY_OPTIONS}
                onChange={setFontFamily}
              />
            </Row>
            <Row label="Cỡ chữ">
              <FontSizeInput
                value={settings.fontSize}
                onChange={setFontSize}
              />
            </Row>
            <Row label={`Giãn dòng: ${settings.lineHeight.toFixed(2)}`}>
              <input
                type="range"
                min={1.5}
                max={2.2}
                step={0.05}
                value={settings.lineHeight}
                onChange={(e) => setLineHeight(Number(e.target.value))}
                aria-label="Giãn dòng"
                className="w-full accent-[color:var(--gold)]"
              />
            </Row>
            <Row label="Độ rộng cột đọc">
              <Segmented
                value={settings.contentWidth}
                options={CONTENT_WIDTH_OPTIONS}
                onChange={setContentWidth}
              />
            </Row>
          </div>

          <footer className="flex justify-end gap-3 border-t border-black/10 pt-4 dark:border-white/10">
            <button
              type="button"
              onClick={reset}
              className="td-btn text-[1.4rem]"
            >
              Đặt lại mặc định
            </button>
            <button
              type="button"
              onClick={onClose}
              className="td-btn-gold text-[1.4rem]"
            >
              Xong
            </button>
          </footer>
        </div>
      </div>
    </>,
    document.body,
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6">
      <span className="shrink-0 font-bold" style={{ minWidth: "12rem" }}>
        {label}
      </span>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {children}
      </div>
    </div>
  );
}

interface SegmentedProps<T extends string | number> {
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  onChange: (value: T) => void;
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: SegmentedProps<T>) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup">
      {options.map(([optValue, label]) => {
        const active = optValue === value;
        return (
          <button
            key={String(optValue)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(optValue)}
            className={`td-segment ${active ? "td-segment-active" : ""}`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

interface FontSizeInputProps {
  value: number;
  onChange: (value: number) => void;
}

/**
 * Numeric font-size stepper (12–32px). Wraps the value so −/+ buttons work
 * at the boundaries and clamps any typed input through the hook's setter.
 */
function FontSizeInput({ value, onChange }: FontSizeInputProps) {
  const { min, max } = FONT_SIZE_LIMITS;

  function commit(raw: string) {
    const next = Number.parseInt(raw, 10);
    if (Number.isFinite(next)) onChange(next);
  }

  return (
    <div className="inline-flex items-center gap-2" role="group" aria-label="Cỡ chữ">
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        disabled={value <= min}
        aria-label="Giảm cỡ chữ"
        className="td-segment disabled:cursor-not-allowed disabled:opacity-40"
      >
        −
      </button>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => commit(e.target.value)}
        className="td-input w-[10rem] text-center"
        aria-label="Cỡ chữ (pixel)"
      />
      <span className="text-gray text-[1.4rem]">px</span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={value >= max}
        aria-label="Tăng cỡ chữ"
        className="td-segment disabled:cursor-not-allowed disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}
