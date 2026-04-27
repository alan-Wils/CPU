"use client";

import { CHECK_REGIONS } from "@/lib/checkRegionGeometry";

type Props = {
  /** When true, show alignment frame and region guides over the video/preview layer */
  active: boolean;
};

/**
 * Semi-transparent overlay: check-shaped frame + labeled regions.
 * `pointer-events-none` so taps reach the video/canvas underneath.
 */
export function CheckCameraOverlay({ active }: Props) {
  if (!active) return null;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between p-2 text-white"
      style={{ textShadow: "0 1px 2px #000" }}
    >
      <p className="rounded bg-black/45 px-2 py-1 text-center text-xs sm:text-sm">
        Line up the check inside the corners · Keep amounts in the boxes · Hold steady
      </p>
      <div className="relative mx-auto aspect-[2.2/1] w-full max-w-2xl flex-1">
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          <rect
            x="2"
            y="4"
            width="96"
            height="92"
            rx="2"
            fill="none"
            stroke="rgba(52,211,153,0.85)"
            strokeWidth="0.9"
            strokeDasharray="3 2"
          />
          {(Object.keys(CHECK_REGIONS) as (keyof typeof CHECK_REGIONS)[]).map((id) => {
            const r = CHECK_REGIONS[id];
            const x = r.x * 100;
            const y = r.y * 100;
            const w = r.w * 100;
            const h = r.h * 100;
            return (
              <g key={id}>
                <rect
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  fill="rgba(52,211,153,0.06)"
                  stroke="rgba(110,231,183,0.75)"
                  strokeWidth="0.35"
                />
                <text x={x + 0.6} y={y + 3.2} fill="rgba(255,255,255,0.92)" fontSize="2.6">
                  {r.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="rounded bg-black/45 px-2 py-1 text-center text-[11px] text-emerald-100 sm:text-xs">
        We scan each labeled area separately for speed and accuracy.
      </p>
    </div>
  );
}
