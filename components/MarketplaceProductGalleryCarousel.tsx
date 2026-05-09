"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MarketplaceProductImageFrame from "@/components/MarketplaceProductImageFrame";

type SlideKind = "primary" | "extra";

export type GallerySlide = {
  kind: SlideKind;
  /** Stable React key for the slide. Primary uses a synthetic id; extras use their DB id. */
  key: string;
  imageUrl: string;
};

type Props = {
  apiBaseUrl: string;
  primaryImageUrl: string | null;
  /** Optional extras already ordered by `position` ascending. */
  extraImages?: { id: string; imageUrl: string }[] | null;
  /**
   * Used as the buyer-side fallback only when no primary image and no extras exist
   * (matches the existing single-image frame behavior).
   */
  companyInventoryLogoUrl?: string | null;
  /** AUTO | CONTAIN | COVER for the primary slide; extras render with `cover`. */
  imageDisplayMode?: string | null;
  /** Background placeholder color/gradient used when nothing is uploaded. */
  placeholderBackground: string;
  /** Override aspect ratio (defaults to "16 / 10" matching the existing detail modal). */
  aspectRatio?: string;
  /** Maxheight constraint matching the detail modal. */
  maxHeight?: string;
};

/** Build the unified slide list (primary first if present; extras after). */
export function buildSlides(
  primaryImageUrl: string | null,
  extras: { id: string; imageUrl: string }[] | null | undefined,
): GallerySlide[] {
  const slides: GallerySlide[] = [];
  const p = (primaryImageUrl || "").trim();
  if (p) slides.push({ kind: "primary", key: "__primary", imageUrl: p });
  for (const e of extras || []) {
    const url = (e.imageUrl || "").trim();
    if (!url) continue;
    slides.push({ kind: "extra", key: e.id, imageUrl: url });
  }
  return slides;
}

/**
 * Swipeable gallery for the buyer product detail modal.
 *
 * - When there's only the primary image (or only the company logo fallback), this collapses to the same
 *   single-image render as before to avoid showing dead arrows / dots.
 * - When there are 2+ slides (primary + extras) we render a horizontal carousel with:
 *     * native horizontal scroll-snap (touch swipe + trackpad)
 *     * left/right arrow buttons (desktop)
 *     * keyboard arrow support
 *     * a slide-index pill (e.g. "2 / 5") and dots
 */
export default function MarketplaceProductGalleryCarousel({
  apiBaseUrl,
  primaryImageUrl,
  extraImages,
  companyInventoryLogoUrl,
  imageDisplayMode,
  placeholderBackground,
  aspectRatio = "16 / 10",
  maxHeight = "min(46vh, 340px)",
}: Props) {
  const slides = buildSlides(primaryImageUrl, extraImages || []);
  const hasMultiple = slides.length > 1;
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(0);

  const scrollTo = useCallback((i: number) => {
    const track = trackRef.current;
    if (!track) return;
    const clamped = Math.max(0, Math.min(i, slides.length - 1));
    const slide = track.children.item(clamped) as HTMLElement | null;
    if (!slide) return;
    track.scrollTo({ left: slide.offsetLeft, behavior: "smooth" });
  }, [slides.length]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const w = track.clientWidth || 1;
        const i = Math.round(track.scrollLeft / w);
        setIndex((prev) => (prev === i ? prev : i));
      });
    };
    track.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      track.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [slides.length]);

  /** Single-slide path — same render path as the existing single-image frame. */
  if (!hasMultiple) {
    return (
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio,
          maxHeight,
          borderRadius: "22px 22px 0 0",
          overflow: "hidden",
          background: "#020617",
        }}
      >
        <MarketplaceProductImageFrame
          apiBaseUrl={apiBaseUrl}
          imageUrl={primaryImageUrl}
          companyInventoryLogoUrl={companyInventoryLogoUrl ?? null}
          imageDisplayMode={imageDisplayMode}
          objectFitOverride="cover"
          relaxCoverForLogoFallback={!(primaryImageUrl || "").trim()}
          fillParent
          height={320}
          placeholderBackground={placeholderBackground}
          borderRadius={0}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        aspectRatio,
        maxHeight,
        borderRadius: "22px 22px 0 0",
        overflow: "hidden",
        background: "#020617",
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          scrollTo(index + 1);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          scrollTo(index - 1);
        }
      }}
      tabIndex={0}
      role="group"
      aria-label={`Product photos (${slides.length})`}
    >
      <div
        ref={trackRef}
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          overflowX: "auto",
          overflowY: "hidden",
          scrollSnapType: "x mandatory",
          scrollbarWidth: "none",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {slides.map((s, i) => (
          <div
            key={s.key}
            style={{
              flex: "0 0 100%",
              width: "100%",
              height: "100%",
              scrollSnapAlign: "start",
              position: "relative",
              background: "#020617",
            }}
            aria-label={`Photo ${i + 1} of ${slides.length}`}
          >
            <MarketplaceProductImageFrame
              apiBaseUrl={apiBaseUrl}
              imageUrl={s.imageUrl}
              companyInventoryLogoUrl={null}
              imageDisplayMode={s.kind === "primary" ? imageDisplayMode : "COVER"}
              objectFitOverride="cover"
              fillParent
              height={320}
              placeholderBackground={placeholderBackground}
              borderRadius={0}
            />
          </div>
        ))}
      </div>

      <button
        type="button"
        aria-label="Previous photo"
        onClick={(e) => {
          e.stopPropagation();
          scrollTo(index - 1);
        }}
        disabled={index <= 0}
        style={navBtnStyle("left", index <= 0)}
      >
        ‹
      </button>
      <button
        type="button"
        aria-label="Next photo"
        onClick={(e) => {
          e.stopPropagation();
          scrollTo(index + 1);
        }}
        disabled={index >= slides.length - 1}
        style={navBtnStyle("right", index >= slides.length - 1)}
      >
        ›
      </button>

      <div
        aria-hidden
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          padding: "4px 10px",
          borderRadius: 999,
          background: "rgba(2, 6, 23, 0.7)",
          border: "1px solid rgba(148, 163, 184, 0.35)",
          color: "#e2e8f0",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.06em",
        }}
      >
        {index + 1} / {slides.length}
      </div>

      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 8,
          display: "flex",
          justifyContent: "center",
          gap: 6,
          pointerEvents: "none",
        }}
      >
        {slides.map((s, i) => (
          <button
            key={s.key}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              scrollTo(i);
            }}
            aria-label={`Go to photo ${i + 1}`}
            aria-current={i === index ? "true" : undefined}
            style={{
              pointerEvents: "auto",
              width: i === index ? 18 : 8,
              height: 8,
              borderRadius: 999,
              border: "none",
              cursor: "pointer",
              background:
                i === index
                  ? "linear-gradient(135deg, #22d3ee, #06b6d4)"
                  : "rgba(148, 163, 184, 0.55)",
              transition: "width 200ms ease, background 200ms ease",
              padding: 0,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function navBtnStyle(side: "left" | "right", disabled: boolean) {
  return {
    position: "absolute" as const,
    top: "50%",
    [side]: 8,
    transform: "translateY(-50%)",
    width: 36,
    height: 36,
    borderRadius: 999,
    border: "1px solid rgba(148, 163, 184, 0.35)",
    background: "rgba(2, 6, 23, 0.65)",
    color: "#f1f5f9",
    fontSize: 22,
    lineHeight: 1,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.35 : 0.95,
    display: "flex" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backdropFilter: "blur(6px)",
    boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
  };
}
