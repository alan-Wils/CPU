import { env } from "../config/env.js";
import {
  estimateNeonMetricCostUsd,
  estimateStorageMbFromRowsWritten,
  type NeonUsageMetric,
} from "../config/neonUsagePricing.js";
import { prisma } from "../config/prisma.js";
import { logInfo, logWarn } from "../lib/logger.js";

type NeonAggregationStatus =
  | "Active"
  | "No activity"
  | "Aggregated internally"
  | "Error"
  | "Missing config";

export type NeonAggregationResult = {
  status: NeonAggregationStatus;
  totalCost: number;
  currency: "USD";
  metrics: Record<NeonUsageMetric, number>;
  diagnostics: {
    enabled: boolean;
    projectId: string;
    apiReachable: boolean;
    message: string;
  };
};

function asMetric(v: string): NeonUsageMetric | null {
  const t = String(v || "").trim() as NeonUsageMetric;
  if (
    t === "db_read" ||
    t === "db_write" ||
    t === "rows_written" ||
    t === "rows_read" ||
    t === "storage_mb" ||
    t === "query"
  ) {
    return t;
  }
  return null;
}

async function runNeonDiagnostics(): Promise<NeonAggregationResult["diagnostics"]> {
  const apiKey = String(env.NEON_API_KEY || "").trim();
  const projectId = String(env.NEON_PROJECT_ID || "").trim();
  if (!apiKey || !projectId) {
    return {
      enabled: false,
      projectId,
      apiReachable: false,
      message: "Missing NEON_API_KEY or NEON_PROJECT_ID for optional diagnostics.",
    };
  }
  try {
    const res = await fetch(`https://console.neon.tech/api/v2/projects/${encodeURIComponent(projectId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return {
      enabled: true,
      projectId,
      apiReachable: res.ok,
      message: res.ok ? "Diagnostics reachable." : `Diagnostics request failed (${res.status}).`,
    };
  } catch (error) {
    return {
      enabled: true,
      projectId,
      apiReachable: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export class NeonUsageAggregationService {
  async aggregateMonth(monthStart: Date, nextMonthStart: Date): Promise<NeonAggregationResult> {
    logInfo("[NEON_USAGE] aggregation_start", {
      monthStart: monthStart.toISOString(),
      nextMonthStart: nextMonthStart.toISOString(),
    });
    const metrics: Record<NeonUsageMetric, number> = {
      db_read: 0,
      db_write: 0,
      rows_written: 0,
      rows_read: 0,
      storage_mb: 0,
      query: 0,
    };
    try {
      const rows = await prisma.usageEvent.groupBy({
        by: ["unitType"],
        where: {
          provider: "neon",
          createdAt: { gte: monthStart, lt: nextMonthStart },
        },
        _sum: { units: true },
      });
      for (const row of rows) {
        const metric = asMetric(row.unitType);
        if (!metric) continue;
        metrics[metric] += row._sum.units ?? 0;
      }
      if (metrics.storage_mb <= 0 && metrics.rows_written > 0) {
        metrics.storage_mb = estimateStorageMbFromRowsWritten(metrics.rows_written);
      }
      const totalUnits =
        metrics.db_read +
        metrics.db_write +
        metrics.rows_written +
        metrics.rows_read +
        metrics.storage_mb +
        metrics.query;
      const diagnostics = await runNeonDiagnostics();
      let status: NeonAggregationStatus = "Aggregated internally";
      if (totalUnits <= 0) status = "No activity";
      else if (!diagnostics.enabled) status = "Missing config";
      else if (diagnostics.enabled && diagnostics.apiReachable) status = "Active";

      const totalCost =
        estimateNeonMetricCostUsd("db_read", metrics.db_read) +
        estimateNeonMetricCostUsd("db_write", metrics.db_write) +
        estimateNeonMetricCostUsd("rows_read", metrics.rows_read) +
        estimateNeonMetricCostUsd("rows_written", metrics.rows_written) +
        estimateNeonMetricCostUsd("query", metrics.query) +
        estimateNeonMetricCostUsd("storage_mb", metrics.storage_mb);

      logInfo("[NEON_USAGE] aggregation_complete", {
        status,
        totalCost,
        metrics,
        diagnostics,
      });

      return {
        status,
        totalCost,
        currency: "USD",
        metrics,
        diagnostics,
      };
    } catch (error) {
      logWarn("[NEON_USAGE] aggregation_error", {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        status: "Error",
        totalCost: 0,
        currency: "USD",
        metrics,
        diagnostics: {
          enabled: false,
          projectId: String(env.NEON_PROJECT_ID || "").trim(),
          apiReachable: false,
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
}

