export const METRC_EVALUATION_DEFAULT_PACKAGE_LABEL = "AAA00090000196B000000001";
export const METRC_EVALUATION_DEFAULT_PACKAGE_ID = "46601";
export const METRC_EVALUATION_DEFAULT_PACKAGE_LICENSE = "SF-SBX-CO-7-13402";
/** Fallback UOM when evaluation package 46601 is not yet synced. */
export const METRC_EVALUATION_DEFAULT_PACKAGE_UNIT = "Kilograms";

/** Valid for METRC CO sandbox package adjustments (not plant/harvest "Entry Error"). */
export const METRC_EVALUATION_DEFAULT_ADJUSTMENT_REASON = "Inventory Adjustment";

export function resolveMetrcPackageAdjustmentReason(adjustmentReason?: string | null): string {
  const requested = String(adjustmentReason || "").trim();
  if (!requested || requested === "Entry Error") {
    return METRC_EVALUATION_DEFAULT_ADJUSTMENT_REASON;
  }
  return requested;
}
