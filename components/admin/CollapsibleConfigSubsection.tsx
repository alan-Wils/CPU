"use client";

import type { ReactNode } from "react";
import { useState } from "react";

type Props = {
  /** Row label in the subsection header (always visible). */
  title: ReactNode;
  /** Optional one-line hint shown only while collapsed (under the header button). */
  summaryCollapsed?: ReactNode;
  /** When true, subsection starts expanded. */
  defaultOpen?: boolean;
  /** Match `configSubCardLast` — no bottom margin on the shell. */
  last?: boolean;
  /** Inner body padding (default matches former configSubCard padding feel). */
  bodyPadding?: string;
  children: ReactNode;
};

/**
 * Nested collapsible panel inside a main {@link CollapsibleConfigSection} — collapsed by default
 * so long admin pages stay scannable when a tab is opened.
 */
export function CollapsibleConfigSubsection({
  title,
  summaryCollapsed,
  defaultOpen = false,
  last,
  bodyPadding = "14px 18px 16px",
  children,
}: Props) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <div
      style={{
        border: "1px solid #334155",
        borderRadius: 14,
        marginBottom: last ? 0 : 18,
        background: "#020617",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          width: "100%",
          textAlign: "left",
          background: "#0f172a",
          border: "none",
          borderBottom: open || (summaryCollapsed && !open) ? "1px solid #1e293b" : "none",
          padding: "12px 16px",
          cursor: "pointer",
          color: "#e2e8f0",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          fontFamily: "inherit",
        }}
      >
        <span style={{ fontWeight: 800, fontSize: 15, lineHeight: 1.35 }}>
          <span style={{ color: "#64748b", marginRight: 8 }} aria-hidden>
            {open ? "▼" : "▶"}
          </span>
          {title}
        </span>
      </button>
      {!open && summaryCollapsed ? (
        <div
          style={{
            color: "#94a3b8",
            fontSize: 12,
            padding: "0 16px 12px",
            lineHeight: 1.45,
          }}
        >
          {summaryCollapsed}
        </div>
      ) : null}
      {open ? <div style={{ padding: bodyPadding }}>{children}</div> : null}
    </div>
  );
}
