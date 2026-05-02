import Link from "next/link";

type BrandLogoProps = {
  /** When false, render only the image (e.g. login has no home session). */
  linkToHome?: boolean;
  /** Visual height in px; width scales with aspect ratio. */
  height?: number;
  /** Cap logo width (px); defaults from height for wide wordmarks. */
  maxWidth?: number;
};

export default function BrandLogo({
  linkToHome = true,
  height = 44,
  maxWidth: maxWidthProp,
}: BrandLogoProps) {
  const maxWidth = maxWidthProp ?? Math.min(520, Math.round(height * 5.5));
  const img = (
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

  if (!linkToHome) {
    return <span style={{ display: "inline-flex", alignItems: "center" }}>{img}</span>;
  }

  return (
    <Link
      href="/"
      style={{
        display: "inline-flex",
        alignItems: "center",
        flexShrink: 0,
        lineHeight: 0,
      }}
    >
      {img}
    </Link>
  );
}
