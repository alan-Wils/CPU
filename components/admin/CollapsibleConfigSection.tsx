"use client";

import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";

type Props = {
  /** Outer card (`styles.card`). */
  sectionStyle: CSSProperties;
  /** e.g. "1" … "5" */
  sectionNumber: string;
  title: string;
  /** One-line summary shown when collapsed. */
  summaryCollapsed?: ReactNode;
  /** When true, section starts expanded (e.g. long forms users often need first visit). */
  defaultOpen?: boolean;
  children: ReactNode;
};

/**
 * Compact collapsible section for Admin company config — collapsed by default.
 */
export function CollapsibleConfigSection({
  sectionStyle,
  sectionNumber,
  title,
  summaryCollapsed,
  defaultOpen = false,
  children,
}: Props) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <section style={sectionStyle}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          textAlign: "left",
          background: "#0f172a",
          border: "1px solid #334155",
          borderRadius: 10,
          padding: "12px 14px",
          marginBottom: open ? 14 : summaryCollapsed ? 8 : 0,
          cursor: "pointer",
          color: "#e2e8f0",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          fontFamily: "inherit",
        }}
        aria-expanded={open}
      >
        <span style={{ fontSize: 18, fontWeight: 700 }}>
          <span aria-hidden>{open ? "▼ " : "▶ "}</span>
          {sectionNumber}. {title}
        </span>
      </button>
      {!open && summaryCollapsed ? (
        <div
          style={{
            color: "#94a3b8",
            fontSize: 13,
            marginBottom: 12,
            paddingLeft: 4,
            lineHeight: 1.45,
          }}
        >
          {summaryCollapsed}
        </div>
      ) : null}
      {open ? children : null}
    </section>
  );
}
