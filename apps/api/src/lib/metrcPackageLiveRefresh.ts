import { MetrcClient, isMetrcClientFailure } from "./metrcClient.js";
import { parseMetrcDataRecords } from "./metrcConnectionHelpers.js";
import {
  resolvePackageQuantity,
  resolvePackageUnitOfMeasure,
  type ResolvedMetrcEvaluationPackage,
} from "./metrcPackageResolve.js";
import { isPackageFinished } from "./metrcPackageStatus.js";

function licenseQuery(licenseNumber: string): string {
  const license = String(licenseNumber || "").trim();
  return license ? `?licenseNumber=${encodeURIComponent(license)}` : "";
}

function pathCandidates(label: string, licenseNumber: string): string[] {
  const encoded = encodeURIComponent(label);
  const q = licenseQuery(licenseNumber);
  return [`/packages/v2/${encoded}${q}`, `/packages/v1/${encoded}${q}`];
}

function mergeLiveRow(
  pkg: ResolvedMetrcEvaluationPackage,
  row: Record<string, unknown>,
): ResolvedMetrcEvaluationPackage {
  const raw = { ...pkg.raw, ...row };
  return {
    ...pkg,
    quantity: resolvePackageQuantity({ persistedQuantity: pkg.quantity, raw }),
    unitOfMeasure: resolvePackageUnitOfMeasure({
      persistedUnitOfMeasure: pkg.unitOfMeasure,
      raw,
    }),
    raw,
    isFinished: isPackageFinished({ raw }),
  };
}

/** Pull latest quantity/finished state from METRC for a package label. */
export async function refreshEvaluationPackageFromMetrc(input: {
  client: MetrcClient;
  licenseNumber: string;
  pkg: ResolvedMetrcEvaluationPackage;
}): Promise<ResolvedMetrcEvaluationPackage> {
  const label = String(input.pkg.packageLabel || "").trim();
  if (!label) return input.pkg;

  for (const pathname of pathCandidates(label, input.licenseNumber)) {
    const result = await input.client.get<unknown>(pathname);
    if (isMetrcClientFailure(result)) continue;

    const rows = parseMetrcDataRecords(result.data);
    if (rows[0]) return mergeLiveRow(input.pkg, rows[0]);

    if (result.data && typeof result.data === "object" && !Array.isArray(result.data)) {
      return mergeLiveRow(input.pkg, result.data as Record<string, unknown>);
    }
  }

  return input.pkg;
}
