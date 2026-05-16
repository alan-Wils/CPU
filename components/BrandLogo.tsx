import type { CSSProperties } from "react";
import Link from "next/link";

type BrandLogoProps = {
  /** When false, render only the image (e.g. login has no home session). */
  linkToHome?: boolean;
  /** Visual height in px; width scales with aspect ratio. */
  height?: number;
  /** Cap logo width (px); defaults from height for wide wordmarks. Ignored when `fitWithinParent` is true. */
  maxWidth?: number;
  /**
   * When true, logo uses `width: 100%`, `height: auto`, and `maxHeight` from `height`
   * so it scales down inside narrow parents (e.g. login form) while staying large on wide screens.
   */
  fitWithinParent?: boolean;
  /** Purple/teal pulse glow (see `globals.css`). Set false to disable. */
  loginGlow?: boolean;
};

export default function BrandLogo({
  linkToHome = true,
  height = 44,
  maxWidth: maxWidthProp,
  fitWithinParent = false,
  loginGlow = true,
}: BrandLogoProps) {
  const maxWidth = maxWidthProp ?? Math.min(520, Math.round(height * 5.5));
  const img = fitWithinParent ? (
    <img
      src="/logo.png"
      alt="NexBatch"
      style={{
        width: "100%",
        height: "auto",
        maxHeight: `min(${height}px, 72vh)`,
        objectFit: "contain",
        display: "block",
      }}
    />
  ) : (
    <img
      src="/logo.png"
      alt="NexBatch"
      height={height}
      style={{
        height,
        width: "auto",
        maxWidth,
        objectFit: "contain",
        display: "block",
      }}
    />
  );

  const outerStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    lineHeight: 0,
    ...(fitWithinParent
      ? { width: "100%", maxWidth: "100%", flexShrink: 1, minWidth: 0 }
      : { flexShrink: 0 }),
  };

  if (!linkToHome) {
    return (
      <span
        style={outerStyle}
        className={loginGlow ? "login-brand-logo-glow-link" : undefined}
      >
        {img}
      </span>
    );
  }

  return (
    <Link
      href="/"
      style={outerStyle}
      className={loginGlow ? "login-brand-logo-glow-link" : undefined}
    >
      {img}
    </Link>
  );
}
