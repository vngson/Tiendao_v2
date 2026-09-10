"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * URL input form — TienDao style.
 *
 * - `.td-input` / `.td-input-error` for the field (matches TienDao's
 *   `.normal-input` / `.error-input` from src/index.css).
 * - `.td-btn-gold` submit button (gold border, gold-on-hover fill).
 */
export function UrlInputForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = url.trim();
    if (!trimmed) {
      setError("Vui lòng nhập URL chương hoặc trang truyện.");
      return;
    }
    if (!/^https?:\/\//i.test(trimmed)) {
      setError("URL phải bắt đầu bằng http:// hoặc https://");
      return;
    }

    setLoading(true);
    try {
      // Pass through encodeURIComponent for safety in the query string.
      router.push(`/novel?url=${encodeURIComponent(trimmed)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đã xảy ra lỗi");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {/* Visible label — required for accessibility (WCAG 3.3.2) */}
      <label
        htmlFor="url"
        className="block text-base font-bold"
        style={{
          fontFamily: "var(--font-title), serif",
          color: "var(--black)",
          letterSpacing: "0.01em",
        }}
      >
        Dán URL chương hoặc trang truyện
      </label>

      {/* Helper text — explains expected format */}
      <p
        className="-mt-2 text-xs"
        style={{ color: "var(--gray)", fontFamily: "var(--font-body)" }}
      >
        Ví dụ:&nbsp;
        <code
          className="rounded px-1 py-0.5 text-xs"
          style={{ backgroundColor: "var(--title-bg-color)" }}
        >
          https://m.shuhaige.net/386531/132855416.html
        </code>
      </p>

      {/* Input — full-width, generous padding (44px+ touch target). */}
      <input
        id="url"
        type="url"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        placeholder="https://m.shuhaige.net/..."
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? "url-error" : undefined}
        className={`w-full outline-none transition focus:border-gold ${
          error ? "td-input-error" : ""
        }`}
        style={{
          border: `1px solid ${error ? "var(--pastel)" : "var(--black)"}`,
          borderRadius: "5px",
          background: "var(--paper)",
          fontFamily: "var(--font-body)",
          fontSize: "1.6rem",
          padding: "1.2rem 1.6rem",
        }}
      />

      {/* Error — close to field, color + text (not color alone) */}
      {error && (
        <p
          id="url-error"
          role="alert"
          className="flex items-center gap-2 text-sm"
          style={{ color: "var(--pastel)" }}
        >
          <span aria-hidden="true">⚠</span>
          {error}
        </p>
      )}

      {/* Submit — right-aligned, 44px+ tall touch target */}
      <div className="flex justify-end pt-2">
        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 border border-solid border-gold px-6 py-3 text-base font-bold transition hover:bg-gold hover:text-paper disabled:opacity-50"
          style={{
            color: "var(--gold)",
            borderRadius: "5px",
            minHeight: 44,
            minWidth: 160,
          }}
        >
          {loading ? (
            <>
              <span
                aria-hidden="true"
                className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
              />
              Đang xử lý…
            </>
          ) : (
            "Mở truyện →"
          )}
        </button>
      </div>
    </form>
  );
}
