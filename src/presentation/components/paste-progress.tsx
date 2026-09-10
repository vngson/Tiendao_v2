"use client";

export type PasteProgressStep = "parse" | "meta" | "chapters" | "ready";

interface PasteProgressProps {
  /** Which step the pipeline is currently working on. */
  currentStep: PasteProgressStep;
  /** Optional error message for a step that failed. Renders it as a warning. */
  failedStep?: PasteProgressStep | null;
}

/**
 * Three-step pipeline visualization for the paste-flow page.
 *
 *   1. parse      — fetch + parse the source page (HTML → Novel + ChapterList).
 *   2. meta       — translate title / description / author / genre / status.
 *   3. chapters   — translate the first 50 chapter titles.
 *
 * The currently-running step gets a spinner + the indeterminate
 * `.td-shimmer-bar` so the reader knows work is happening even when no
 * percentage is known. Steps after the current one dim out.
 */
export function PasteProgress({ currentStep, failedStep }: PasteProgressProps) {
  const steps: Array<{ key: PasteProgressStep; label: string }> = [
    { key: "parse", label: "Lấy thông tin truyện" },
    { key: "meta", label: "Dịch tên truyện, tác giả, giới thiệu" },
    { key: "chapters", label: "Dịch tên 50 chương đầu" },
  ];

  return (
    <section
      aria-live="polite"
      aria-label="Tiến trình tải truyện"
      className="tiendao-title-bg flex w-full flex-col gap-2 px-4 py-3"
      style={{ borderRadius: "0.75rem" }}
    >
      {steps.map((s, i) => {
        const state = stepState(s.key, currentStep, failedStep);
        return (
          <div key={s.key} className="flex flex-col gap-1">
            <div
              className="flex items-center gap-2 text-sm"
              style={{
                fontFamily: "var(--font-body)",
                color:
                  state === "dim"
                    ? "var(--gray)"
                    : state === "failed"
                      ? "var(--pastel)"
                      : "var(--black)",
              }}
            >
              <span aria-hidden="true" className="inline-flex w-5 justify-center">
                {state === "done" && <DoneIcon />}
                {state === "active" && <SpinnerIcon />}
                {state === "pending" && <PendingIcon />}
                {state === "failed" && <FailedIcon />}
                {state === "dim" && <PendingIcon />}
              </span>
              <span className={state === "active" ? "font-bold" : ""}>
                {s.label}
                {state === "failed" && " — thử lại sau"}
              </span>
              {state === "active" && (
                <span className="text-xs" style={{ color: "var(--gray)" }}>
                  đang xử lý…
                </span>
              )}
              {state === "done" && (
                <span className="text-xs" style={{ color: "var(--gray)" }}>
                  xong
                </span>
              )}
            </div>
            {state === "active" && i < steps.length - 1 && <div className="td-shimmer-bar" />}
          </div>
        );
      })}
      {currentStep === "ready" && (
        <p
          className="text-xs"
          style={{ color: "var(--gold)", fontFamily: "var(--font-body)" }}
        >
          ✓ Sẵn sàng đọc.
        </p>
      )}
    </section>
  );
}

/**
 * Compare step index against current step to decide the visual state.
 * Steps before `currentStep` are done; `currentStep` is active (unless
 * `failedStep` matches it, in which case it's failed); later steps dim.
 */
function stepState(
  step: PasteProgressStep,
  currentStep: PasteProgressStep,
  failedStep?: PasteProgressStep | null,
): "done" | "active" | "pending" | "failed" | "dim" {
  if (currentStep === "ready") return "done";
  const order: PasteProgressStep[] = ["parse", "meta", "chapters"];
  const stepIdx = order.indexOf(step);
  const curIdx = order.indexOf(currentStep);
  if (stepIdx === curIdx) {
    return failedStep === step ? "failed" : "active";
  }
  if (stepIdx < curIdx) return "done";
  return "dim";
}

function DoneIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M2 7l3.5 3.5L12 3.5"
        fill="none"
        stroke="var(--gold)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PendingIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <circle
        cx="7"
        cy="7"
        r="5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function FailedIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M3 3l8 8M11 3l-8 8"
        fill="none"
        stroke="var(--pastel)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
      style={{ color: "var(--gold)" }}
    />
  );
}
