/** Normalized rectangles (0–1) for a US personal check in landscape orientation (long edge horizontal). */

export type RegionId =
  | "drawer"
  | "date"
  | "payee"
  | "numericAmount"
  | "writtenAmount"
  | "memo"
  | "micr";

export const CHECK_REGIONS: Record<
  RegionId,
  { label: string; x: number; y: number; w: number; h: number; hint: string }
> = {
  drawer: {
    label: "Bank / payer header",
    x: 0.02,
    y: 0.02,
    w: 0.52,
    h: 0.12,
    hint: "Top-left logo or company name"
  },
  date: {
    label: "Date",
    x: 0.62,
    y: 0.02,
    w: 0.36,
    h: 0.11,
    hint: "Top-right date line"
  },
  payee: {
    label: "Payee",
    x: 0.04,
    y: 0.2,
    w: 0.72,
    h: 0.12,
    hint: "“Pay to the order of” line"
  },
  numericAmount: {
    label: "Amount (numbers)",
    x: 0.68,
    y: 0.16,
    w: 0.3,
    h: 0.1,
    hint: "Boxed amount on the right"
  },
  writtenAmount: {
    label: "Written amount",
    x: 0.04,
    y: 0.32,
    w: 0.88,
    h: 0.1,
    hint: "Legal line under payee"
  },
  memo: {
    label: "Memo",
    x: 0.04,
    y: 0.72,
    w: 0.38,
    h: 0.12,
    hint: "Lower-left memo"
  },
  micr: {
    label: "MICR line",
    x: 0.02,
    y: 0.86,
    w: 0.96,
    h: 0.12,
    hint: "Routing · account · check #"
  }
};

export function regionPixelRect(
  imgW: number,
  imgH: number,
  region: { x: number; y: number; w: number; h: number },
  pad = 0.01
): { x: number; y: number; w: number; h: number } {
  const px = Math.max(0, Math.floor((region.x - pad) * imgW));
  const py = Math.max(0, Math.floor((region.y - pad) * imgH));
  const pw = Math.min(imgW - px, Math.ceil((region.w + pad * 2) * imgW));
  const ph = Math.min(imgH - py, Math.ceil((region.h + pad * 2) * imgH));
  return { x: px, y: py, w: Math.max(8, pw), h: Math.max(8, ph) };
}
