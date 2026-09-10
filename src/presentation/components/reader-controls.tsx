"use client";

import { useState } from "react";
import { ReaderSettingsDialog } from "@/presentation/components/reader-settings-dialog";

/**
 * Floating "Settings" trigger for the reader page.
 *
 * Renders a fixed bottom-right FAB that opens the unified
 * {@link ReaderSettingsDialog}. Keeps the name `ReaderControls` so the
 * reader page import stays unchanged.
 */
export function ReaderControls() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Mở cài đặt"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="td-btn-gold fixed bottom-6 right-6 z-40"
        style={{
          borderRadius: "999px",
          padding: "1rem 2rem",
          boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
          fontSize: "1.6rem",
        }}
      >
        <span aria-hidden="true">⚙</span>
        Cài đặt
      </button>
      {open && <ReaderSettingsDialog onClose={() => setOpen(false)} />}
    </>
  );
}
