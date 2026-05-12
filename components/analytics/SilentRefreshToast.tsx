"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const HIDE_MS = 2800;

/**
 * Corner notice when a silent background refetch completes (analytics / live-ops).
 * Portals to `document.body` so parent `overflow` / stacking contexts cannot hide it.
 */
export function SilentRefreshToast(props: { pulse: number }) {
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!props.pulse) return;
    setVisible(true);
    const t = window.setTimeout(() => setVisible(false), HIDE_MS);
    return () => window.clearTimeout(t);
  }, [props.pulse]);

  if (!mounted || !visible) return null;
  if (typeof document === "undefined" || !document.body) return null;

  return createPortal(
    <div
      key={props.pulse}
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        right: 28,
        bottom: 32,
        zIndex: 2147483000,
        minWidth: 132,
        boxSizing: "border-box",
        padding: "12px 20px",
        borderRadius: 14,
        border: "1px solid rgba(56, 189, 248, 0.65)",
        background: "linear-gradient(145deg, rgba(8, 47, 73, 0.98), rgba(15, 23, 42, 0.98))",
        color: "#f0f9ff",
        fontWeight: 800,
        fontSize: 14,
        letterSpacing: 0.03,
        lineHeight: 1.35,
        textAlign: "center",
        boxShadow:
          "0 0 0 1px rgba(56,189,248,0.2) inset, 0 22px 50px rgba(0,0,0,0.55), 0 0 40px rgba(56,189,248,0.25)",
        animation: "cpu-task-live-toast-in 0.34s ease-out",
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 800, color: "#7dd3fc", letterSpacing: 0.12, marginBottom: 4 }}>
        ANALYTICS
      </div>
      Refreshed
    </div>,
    document.body,
  );
}
