"use client";

import type { CSSProperties } from "react";
import { CHECK_REGIONS, type RegionId } from "@/lib/checkRegionGeometry";

type Props = {
  /** When true, show alignment frame and region guides over the video/preview layer */
  active: boolean;
};

const overlayRoot: CSSProperties = {
  position: "absolute",
  left: 0,
  top: 0,
  width: "100%",
  height: "100%",
  minHeight: 280,
  zIndex: 50,
  pointerEvents: "none",
  boxSizing: "border-box",
  transform: "translateZ(2px)",
  WebkitTransform: "translateZ(2px)",
  isolation: "isolate",
  overflow: "hidden",
  borderRadius: 10
};

/**
 * Guides above the camera — inline styles + SVG strokes (often composites above video better than DIV borders).
 * {@link CheckCameraGroundHints} below the preview is the reliable fallback on iOS.
 */
export function CheckCameraOverlay({ active }: Props) {
  if (!active) return null;

  const regionIds = Object.keys(CHECK_REGIONS) as RegionId[];

  return (
    <div style={overlayRoot}>
      {/* High-contrast scrim so guides read on any video background */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 0,
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.12) 22%, rgba(0,0,0,0.08) 78%, rgba(0,0,0,0.82) 100%)",
          pointerEvents: "none"
        }}
      />

      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          zIndex: 1,
          pointerEvents: "none",
          filter: "drop-shadow(0 0 3px rgba(0,0,0,0.9))"
        }}
      >
        <rect
          x="3"
          y="6"
          width="94"
          height="88"
          fill="none"
          stroke="#4ade80"
          strokeWidth="0.9"
          strokeDasharray="3 2"
          rx="1.2"
        />
        {regionIds.map((id) => {
          const r = CHECK_REGIONS[id];
          return (
            <rect
              key={`svg-${id}`}
              x={r.x * 100}
              y={r.y * 100}
              width={r.w * 100}
              height={r.h * 100}
              fill="rgba(16,185,129,0.14)"
              stroke="#6ee7b7"
              strokeWidth="0.55"
              rx="0.6"
            />
          );
        })}
      </svg>

      <div
        style={{
          position: "relative",
          zIndex: 2,
          display: "flex",
          flexDirection: "column",
          height: "100%",
          padding: 8,
          boxSizing: "border-box"
        }}
      >
        <p
          style={{
            margin: 0,
            padding: "10px 12px",
            borderRadius: 10,
            background: "rgba(0,0,0,0.88)",
            color: "#f8fafc",
            fontSize: 14,
            fontWeight: 600,
            textAlign: "center",
            textShadow: "0 2px 4px #000",
            lineHeight: 1.35,
            flexShrink: 0,
            border: "1px solid rgba(52,211,153,0.55)"
          }}
        >
          Line up the check in landscape · long edge horizontal · green frame = scan area
        </p>

        <div
          style={{
            position: "relative",
            flex: "1 1 auto",
            minHeight: 160,
            marginTop: 6,
            marginBottom: 6,
            width: "100%"
          }}
        >
          {regionIds.map((id) => {
            const r = CHECK_REGIONS[id];
            return (
              <div
                key={id}
                title={r.hint}
                style={{
                  position: "absolute",
                  left: `${r.x * 100}%`,
                  top: `${r.y * 100}%`,
                  width: `${r.w * 100}%`,
                  height: `${r.h * 100}%`,
                  border: "2px solid rgba(167,243,208,0.95)",
                  borderRadius: 6,
                  boxSizing: "border-box",
                  overflow: "hidden",
                  boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,0,0,0.45)"
                }}
              >
                <span
                  style={{
                    display: "block",
                    padding: "4px 8px",
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#ecfdf5",
                    background: "rgba(0,0,0,0.78)",
                    textShadow: "0 1px 2px #000",
                    lineHeight: 1.2,
                    maxWidth: "100%",
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                    overflow: "hidden"
                  }}
                >
                  {r.label}
                </span>
              </div>
            );
          })}
        </div>

        <p
          style={{
            margin: 0,
            padding: "8px 10px",
            borderRadius: 10,
            background: "rgba(0,0,0,0.88)",
            color: "#a7f3d0",
            fontSize: 12,
            fontWeight: 600,
            textAlign: "center",
            flexShrink: 0,
            border: "1px solid rgba(52,211,153,0.45)"
          }}
        >
          Tip: fill the frame — too much background slows OCR.
        </p>
      </div>
    </div>
  );
}

/** Same alignment info as a panel below the video — always visible when overlays are hidden by the OS compositor. */
export function CheckCameraGroundHints({ active }: Props) {
  if (!active) return null;

  const regionIds = Object.keys(CHECK_REGIONS) as RegionId[];

  return (
    <div
      role="region"
      aria-label="Check alignment reference"
      style={{
        marginTop: 12,
        padding: 14,
        borderRadius: 10,
        background: "linear-gradient(135deg, rgba(6,78,59,0.92), rgba(15,118,110,0.75))",
        border: "2px solid #34d399",
        color: "#ecfdf5",
        boxShadow: "0 8px 24px rgba(0,0,0,0.35)"
      }}
    >
      <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 6, letterSpacing: "0.02em" }}>Alignment reference</div>
      <p style={{ margin: "0 0 12px", fontSize: 13, lineHeight: 1.45, color: "#d1fae5" }}>
        If guides do not appear on the video, use this map. Hold the check in{" "}
        <strong style={{ color: "#fff" }}>landscape</strong> (long edge horizontal): date top-right, payee center-left,
        boxed amount right, MICR along the bottom.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {regionIds.map((id) => {
          const r = CHECK_REGIONS[id];
          return (
            <div
              key={id}
              title={r.hint}
              style={{
                flex: "1 1 140px",
                minWidth: 120,
                padding: "8px 10px",
                borderRadius: 8,
                border: "2px solid rgba(52,211,153,0.95)",
                background: "rgba(0,0,0,0.35)",
                fontSize: 12,
                fontWeight: 700
              }}
            >
              {r.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}
