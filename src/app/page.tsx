import { SiteHeader } from "@/presentation/components/site-header";
import { UrlInputForm } from "@/presentation/components/url-input-form";
import { ContinueReadingList } from "@/presentation/components/continue-reading-list";

/**
 * Home page — TienDao HomePage style.
 *
 * Layout mirrors the `Homepage` block from HomePage.css:
 * - Single-column centered content, max-width 1200px
 * - Hero block (logo + tagline)
 * - Open-by-URL card
 * - Reading history
 */
export default function HomePage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />

      <main className="mx-auto flex max-w-[1200px] flex-col items-stretch gap-12 px-6 py-12 md:px-12 md:py-16 lg:px-20">
        {/* Hero — display serif, generous vertical rhythm */}
        <section className="flex flex-col items-center gap-4 pt-6 pb-2 text-center">
          <h1
            className="font-bold leading-[1.1] tracking-wide"
            style={{
              fontFamily: "var(--font-utm), var(--font-display), serif",
              fontSize: "5.6rem",
              color: "var(--black)",
            }}
          >
            Tiên đạo
          </h1>
          <p
            className="text-base"
            style={{
              fontFamily: "var(--font-title), serif",
              color: "var(--gray)",
              letterSpacing: "0.04em",
            }}
          >
            Đọc truyện Trung Quốc, tự động dịch sang tiếng Việt.
          </p>
        </section>

        {/* Open-by-URL — translucent card on top of the page background.
            Switched from `bg-paper` (solid white) so the landscape image
            shows through and the design stays cohesive. */}
        <section
          className="mx-auto flex w-full max-w-[56rem] flex-col gap-6 rounded-card border border-black/10 px-8 py-8 shadow-card backdrop-blur-sm md:px-12 md:py-10"
          style={{ backgroundColor: "rgba(255, 255, 255, 0.82)" }}
        >
          <h2
            className="font-bold"
            style={{
              fontFamily: "var(--font-title), serif",
              fontSize: "2rem",
              color: "var(--black)",
              letterSpacing: "0.02em",
            }}
          >
            Mở truyện từ URL
          </h2>
          <UrlInputForm />
        </section>

        {/* Reading history */}
        <ContinueReadingList />
      </main>
    </div>
  );
}
