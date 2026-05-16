import { prisma } from "../config/prisma.js";

const g = (n: number) => Number(Number(n).toFixed(4));

export type ExtractionOilPoolBreakdown = {
  outputGrams: number;
  packagingGrams: number;
  ediblesGrams: number;
  availableGrams: number;
};

/** Display label for extraction product type (matches edibles / extraction UI fallbacks). */
export function extractionRunProductTypeLabel(run: {
  extractionUiState: unknown;
  productCategory: string | null;
}): string {
  const ui = (run.extractionUiState as Record<string, unknown> | null) ?? null;
  const fromUi =
    typeof ui?.productType === "string"
      ? ui.productType
      : typeof ui?.name === "string"
        ? String(ui.name)
        : null;
  if (fromUi?.trim()) return fromUi.trim();
  if (run.productCategory === "LIVE") return "Live Resin";
  return "Extract";
}

/** Edible kitchen may only pull from completed Live Resin *oil* runs (excludes dabbable-only SKUs). */
export function isLiveResinOilRun(run: { extractionUiState: unknown; productCategory: string | null }): boolean {
  const label = extractionRunProductTypeLabel(run).toLowerCase();
  if (!label.includes("live resin")) return false;
  if (label.includes("dabbable") && !label.includes("oil")) return false;
  return label.includes("oil") || label.includes("(edible)");
}

/**
 * Shared ledger: extraction output minus all packaging lot net weights and non-cancelled edible oil inputs.
 * Used by edible batch create and extraction packaging weigh-ins.
 */
export async function getExtractionOilPoolBreakdown(
  companyId: string,
  extractionRunId: string,
): Promise<ExtractionOilPoolBreakdown | null> {
  const run = await prisma.extractionRun.findFirst({
    where: { id: extractionRunId, companyId, phase: "COMPLETED" },
  });
  if (!run) return null;
  const out = g(Number(run.outputGrams) || 0);
  const [packAgg, edibleAgg] = await Promise.all([
    prisma.packagingLot.aggregate({
      where: { companyId, extractionRunId },
      _sum: { netOutputGrams: true },
    }),
    prisma.edibleBatch.aggregate({
      where: {
        companyId,
        extractionRunId,
        status: { notIn: ["CANCELLED"] },
      },
      _sum: { oilInputGrams: true },
    }),
  ]);
  const packagingGrams = g(Number(packAgg._sum.netOutputGrams ?? 0));
  const ediblesGrams = g(Number(edibleAgg._sum.oilInputGrams ?? 0));
  const availableGrams = Math.max(0, g(out - packagingGrams - ediblesGrams));
  return { outputGrams: out, packagingGrams, ediblesGrams, availableGrams };
}
