"use client";

import { CHECK_REGIONS, type RegionId } from "@/lib/checkRegionGeometry";

type Props = {
  /** When true, show alignment frame and region guides over the video/preview layer */
  active: boolean;
};

/**
 * Guides above the camera — uses inline styles only so visibility does not depend on Tailwind content paths.
 */
export function CheckCameraOverlay({ active }: Props) {
  if (!active) return null;

  const regionIds = Object.keys(CHECK_REGIONS) as RegionId[];

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        zIndex: 5,
        pointerEvents: "none",
        display: "flex",
        flexDirection: "column",
        padding: 8,
        boxSizing: "border-box"
      }}
    >
      <p
        style={{
          margin: 0,
          padding: "8px 10px",
          borderRadius: 8,
          background: "rgba(0,0,0,0.65)",
          color: "#f8fafc",
          fontSize: 13,
          textAlign: "center",
          textShadow: "0 1px 2px #000",
          lineHeight: 1.35
        }}
      >
        Line up the check inside the green frame · Keep amounts in the boxes · Hold steady
      </p>

      <div style={{ position: "relative", flex: 1, minHeight: 120, marginTop: 6, marginBottom: 6 }}>
        {/* Outer check frame */}
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
                background: "rgba(16, 185, 129, 0.12)",
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
                  background: "rgba(0,0,0,0.55)",
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
          background: "rgba(0,0,0,0.65)",
          color: "#a7f3d0",
          fontSize: 12,
          textAlign: "center"
        }}
      >
        Each green box is scanned separately for faster, more accurate OCR.
      </p>
    </div>
  );
}
