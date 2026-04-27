"use client";

import type { CSSProperties } from "react";
import { CHECK_REGIONS, type RegionId } from "@/lib/checkRegionGeometry";

type Props = {
  /** When true, show alignment frame and region guides over the video/preview layer */
  active: boolean;
};

const overlayShell: CSSProperties = {
  position: "absolute",
  left: 0,
  top: 0,
  width: "100%",
  height: "100%",
  minHeight: 280,
  zIndex: 50,
  pointerEvents: "none",
  boxSizing: "border-box",
  // Promote above <video> compositor on many WebKit builds (iOS Safari, some Chrome).
  transform: "translateZ(1px)",
  WebkitTransform: "translateZ(1px)",
  isolation: "isolate"
};

/**
 * Guides above the camera — inline styles only. On some mobile browsers the live
 * {@link CheckCameraGroundHints} below the preview remains visible when overlays fail to stack.
 */
export function CheckCameraOverlay({ active }: Props) {
  if (!active) return null;

  const regionIds = Object.keys(CHECK_REGIONS) as RegionId[];

  return (
    <div
      style={{
        ...overlayShell,
        display: "flex",
        flexDirection: "column",
        padding: 8
      }}
    >
      <p
        style={{
          margin: 0,
          padding: "8px 10px",
          borderRadius: 8,
          background: "rgba(0,0,0,0.75)",
          color: "#f8fafc",
          fontSize: 13,
          textAlign: "center",
          textShadow: "0 1px 2px #000",
          lineHeight: 1.35,
          flexShrink: 0
        }}
      >
        Line up the check inside the green frame · Keep amounts in the boxes · Hold steady
      </p>

      <div
        style={{
          position: "relative",
          flex: "1 1 auto",
          minHeight: 200,
          marginTop: 6,
          marginBottom: 6,
          width: "100%"
        }}
      >
        <div
          style={{
            position: "absolute",
            left: "3%",
            top: "6%",
            width: "94%",
            height: "88%",
            border: "3px dashed rgba(52, 211, 153, 0.95)",
            borderRadius: 10,
            boxSizing: "border-box",
            boxShadow: "0 0 0 1px rgba(0,0,0,0.4) inset"
          }}
        />

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
                border: "2px solid rgba(110, 231, 183, 0.95)",
                borderRadius: 4,
                background: "rgba(16, 185, 129, 0.18)",
                boxSizing: "border-box",
                overflow: "hidden"
              }}
            >
              <span
                style={{
                  display: "block",
                  padding: "2px 6px",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#ecfdf5",
                  background: "rgba(0,0,0,0.65)",
                  textShadow: "0 1px 1px #000",
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
          padding: "6px 10px",
          borderRadius: 8,
          background: "rgba(0,0,0,0.75)",
          color: "#a7f3d0",
          fontSize: 12,
          textAlign: "center",
          flexShrink: 0
        }}
      >
        Each green box is scanned separately for faster, more accurate OCR.
      </p>
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
        background: "rgba(6, 78, 59, 0.55)",
        border: "2px solid rgba(52, 211, 153, 0.85)",
        color: "#ecfdf5"
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>Alignment reference</div>
      <p style={{ margin: "0 0 12px", fontSize: 13, lineHeight: 1.45, color: "#d1fae5" }}>
        If you do not see green guides on the camera, use this map: hold the check in{" "}
        <strong style={{ color: "#fff" }}>landscape</strong> (long edge horizontal), date top-right, MICR line along the
        bottom edge.
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
                border: "1px solid rgba(52, 211, 153, 0.9)",
                background: "rgba(15, 118, 110, 0.35)",
                fontSize: 12,
                fontWeight: 600
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
