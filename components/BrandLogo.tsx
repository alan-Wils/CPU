import Link from "next/link";

type BrandLogoProps = {
  /** When false, render only the image (e.g. login has no home session). */
  linkToHome?: boolean;
  /** Visual height in px; width scales with aspect ratio. */
  height?: number;
};

export default function BrandLogo({
  linkToHome = true,
  height = 44,
}: BrandLogoProps) {
  const img = (
    <img
      src="/logo.png"
      alt="CPU"
      height={height}
      style={{
        height,
        width: "auto",
        maxWidth: 220,
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
