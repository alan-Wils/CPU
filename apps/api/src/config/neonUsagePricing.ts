/**
 * Internal Neon usage estimation constants (tenant attribution).
 * Keep these configurable and conservative; vendor invoices still remain source of truth for accounting.
 */
export const NEON_USAGE_PRICING = {
  /** USD per 1M queries (reads+writes). */
  perMillionQueriesUsd: 0.1,
  /** USD per GB-month estimated storage. */
  perGbStorageMonthUsd: 0.35,
  /** Additional compute proxy per 1M write-ish units. */
  perMillionComputeUnitsUsd: 0.2,
  /** Heuristic bytes written per row when estimating storage growth. */
  estimatedBytesPerRow: 1200,
} as const;

export type NeonUsageMetric =
  | "db_read"
  | "db_write"
  | "rows_written"
  | "rows_read"
  | "storage_mb"
  | "query";

export function estimateNeonMetricCostUsd(metric: NeonUsageMetric, units: number): number {
  const u = Math.max(0, Number.isFinite(units) ? units : 0);
  if (metric === "storage_mb") {
    const gb = u / 1024;
    return gb * NEON_USAGE_PRICING.perGbStorageMonthUsd;
  }
  if (metric === "db_write" || metric === "rows_written") {
    return (u / 1_000_000) * NEON_USAGE_PRICING.perMillionComputeUnitsUsd;
  }
  // query, db_read, rows_read default to query-rate proxy.
  return (u / 1_000_000) * NEON_USAGE_PRICING.perMillionQueriesUsd;
}

export function estimateStorageMbFromRowsWritten(rowsWritten: number): number {
  const bytes = Math.max(0, rowsWritten) * NEON_USAGE_PRICING.estimatedBytesPerRow;
  return bytes / (1024 * 1024);
}

