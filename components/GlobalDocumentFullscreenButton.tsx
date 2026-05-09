"use client";

import DocumentFullscreenButton from "@/components/DocumentFullscreenButton";

/**
 * One fullscreen toggle for the whole app (all routes). Fixed top-right; z-index stays below in-app modals (~10k+).
 */
export default function GlobalDocumentFullscreenButton() {
  return (
    <div
      className="global-fullscreen-btn-wrap"
      style={{
        position: "fixed",
        top: "max(10px, env(safe-area-inset-top, 0px))",
        right: "max(10px, env(safe-area-inset-right, 0px))",
        zIndex: 9000,
        pointerEvents: "none",
      }}
    >
      <DocumentFullscreenButton
        style={{
          pointerEvents: "auto",
          width: 44,
          height: 44,
          borderRadius: 12,
          border: "1px solid rgba(148, 163, 184, 0.28)",
          background: "rgba(2, 6, 23, 0.85)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          color: "#e2e8f0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          boxShadow: "0 8px 28px rgba(0,0,0,0.35)",
        }}
      />
    </div>
  );
}
