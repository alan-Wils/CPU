import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

/** Tab favicon canvas (browsers scale this slot). */
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/** Scale factor for the source mark — trims perceived padding so the logo reads larger in the tab. */
const MARK_ZOOM = 1.75;

export const runtime = "nodejs";

export default async function Icon() {
  const bytes = await readFile(join(process.cwd(), "public", "brand-tab-mark.png"));
  const src = `data:image/png;base64,${bytes.toString("base64")}`;
  const side = Math.round(size.width * MARK_ZOOM);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#ffffff",
          overflow: "hidden",
        }}
      >
        <img src={src} width={side} height={side} alt="" />
      </div>
    ),
    { ...size },
  );
}
