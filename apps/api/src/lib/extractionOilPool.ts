import { prisma } from "../config/prisma.js";
import { computeOilPoolAvailableGrams, sumActiveReservedGrams } from "./edibleOilReservations.js";

const g = (n: number) => Number(Number(n).toFixed(4));

export type ExtractionOilPoolBreakdown = {
  outputGrams: number;
  packagingGrams: number;
  ediblesGrams: number;
  reservedGrams: number;
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
 * Shared ledger: extraction output minus packaging, edible batch oil, and active kitchen reservations.
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
  const [packAgg, edibleAgg, reservedGrams] = await Promise.all([
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
    sumActiveReservedGrams(companyId, extractionRunId),
  ]);
  const packagingGrams = g(Number(packAgg._sum.netOutputGrams ?? 0));
  const ediblesGrams = g(Number(edibleAgg._sum.oilInputGrams ?? 0));
  const availableGrams = computeOilPoolAvailableGrams(out, packagingGrams, ediblesGrams, reservedGrams);
  return { outputGrams: out, packagingGrams, ediblesGrams, reservedGrams, availableGrams };
}

/** Human label from extraction UI (e.g. BLUE.051526). */
export function extractionRunMarketBatchCode(run: { extractionUiState: unknown }): string | null {
  const ui = (run.extractionUiState as Record<string, unknown> | null) ?? null;
  const code = typeof ui?.marketBatchCode === "string" ? ui.marketBatchCode.trim() : "";
  return code || null;
}

/** Attach shared oil-pool fields so packaging SPA reflects edible kitchen allocation. */
export async function enrichLegacyPackagingRowsWithOilPool(
  companyId: string,
  rows: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  const runIds = [
    ...new Set(
      rows
        .map((r) =>
          String(r.extractionRunId || r.extractionBatchId || r.sourceBatchId || "").trim(),
        )
        .filter(Boolean),
    ),
  ];
  const pools = new Map<string, ExtractionOilPoolBreakdown>();
  await Promise.all(
    runIds.map(async (runId) => {
      const pool = await getExtractionOilPoolBreakdown(companyId, runId);
      if (pool) pools.set(runId, pool);
    }),
  );
  return rows.map((row) => {
    const runId = String(
      row.extractionRunId || row.extractionBatchId || row.sourceBatchId || "",
    ).trim();
    const pool = pools.get(runId);
    const ov = row.packagingPoolOverrides as Record<string, unknown> | undefined;
    if (ov?.enabled) {
      const packageable = g(Number(ov.packageableGrams ?? row.packageableGrams ?? row.finalOilGrams ?? 0));
      const packaged = g(Number(ov.packagedGrams ?? row.packagedGrams ?? 0));
      const edibles = g(Number(ov.ediblesAllocatedGrams ?? 0));
      const reserved = g(Number(ov.ediblesReservedGrams ?? 0));
      const available = Math.max(packageable - packaged - edibles - reserved, 0);
      return {
        ...row,
        packageableGrams: packageable,
        finalOilGrams: packageable,
        packagedGrams: packaged,
        ediblesAllocatedGrams: edibles,
        ediblesReservedGrams: reserved,
        oilPoolOutputGrams: packageable,
        oilPoolPackagingGrams: packaged,
        oilPoolAvailableGrams: available,
        packagingPoolOverrides: ov,
      };
    }
    if (!pool) return row;
    return {
      ...row,
      oilPoolOutputGrams: pool.outputGrams,
      oilPoolPackagingGrams: pool.packagingGrams,
      ediblesAllocatedGrams: pool.ediblesGrams,
      ediblesReservedGrams: pool.reservedGrams,
      oilPoolAvailableGrams: pool.availableGrams,
    };
  });
}
