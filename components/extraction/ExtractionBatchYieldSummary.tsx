"use client";

import {
  computeExtractionYieldMetrics,
  formatYieldGramsDisplay,
  formatYieldPercentDisplay,
  getLegacyFinishBatchYieldPercent,
  hasExtractionDetailedYields,
} from "@/lib/extractionYieldHelpers";

type Props = {
  batch: any;
  terpAddBackPercent: number;
  compact?: boolean;
};

export function ExtractionBatchYieldSummary({
  batch,
  terpAddBackPercent,
  compact = true,
}: Props) {
  if (hasExtractionDetailedYields(batch)) {
    const metrics = computeExtractionYieldMetrics(batch, terpAddBackPercent);
    if (!metrics) {
      return <span>Yield: —</span>;
    }

    const lineStyle = compact
      ? { fontSize: 12, marginTop: 4, color: "#cbd5e1", lineHeight: 1.45 }
      : { fontSize: 13, marginTop: 6, color: "#cbd5e1", lineHeight: 1.5 };

    return (
      <div style={lineStyle}>
        <span>
          Oil: {formatYieldPercentDisplay(metrics.oilYieldPercent)} · Terp:{" "}
          {formatYieldPercentDisplay(metrics.terpYieldPercent)} · Total:{" "}
          {formatYieldPercentDisplay(metrics.totalBatchYieldPercent)} · Terped:{" "}
          {formatYieldGramsDisplay(metrics.terpedOilGrams)} (
          {formatYieldPercentDisplay(metrics.terpedOilYieldPercent)}) · Leftover:{" "}
          {formatYieldGramsDisplay(metrics.leftoverTerpsGrams)} (
          {formatYieldPercentDisplay(metrics.leftoverTerpsPercent)})
        </span>
        {metrics.terpAddBackCapped ? (
          <div style={{ color: "#fbbf24", fontWeight: 600, marginTop: 4 }}>
            Terp add-back capped at collected amount (
            {formatYieldGramsDisplay(metrics.actualTerpsAddedBackGrams)} added of{" "}
            {formatYieldGramsDisplay(metrics.terpsToAddBackGrams)} calculated).
          </div>
        ) : null}
      </div>
    );
  }

  const legacy = getLegacyFinishBatchYieldPercent(batch);
  return <span>Yield: {legacy || "—"}</span>;
}
