import { METRC_EVALUATION_DEFAULT_PACKAGE_LABEL } from "./metrcPackageEvaluationDefaults.js";
import {
  findMetrcPackageByLabel,
  listMetrcPackagesForCompany,
} from "../repositories/metrcPackageRepository.js";

export type MetrcPackageTagSource = "incremented_from_latest_package" | "incremented_from_default_seed";

export type GeneratedSandboxPackageTag = {
  generatedPackageTag: string;
  packageTagSource: MetrcPackageTagSource;
  previousPackageLabel: string | null;
};

const MAX_TAG_COLLISION_ATTEMPTS = 500;

/** Increment trailing numeric suffix while preserving zero-padding and prefix. */
export function incrementMetrcTag(label: string): string {
  const trimmed = String(label || "").trim();
  const match = trimmed.match(/^(.+?)(\d+)$/);
  if (!match) {
    return `${trimmed}000000001`;
  }
  const [, prefix, digits] = match;
  const next = (BigInt(digits) + 1n).toString();
  const padded = next.padStart(digits.length, "0");
  return `${prefix}${padded}`;
}

function matchesSandboxLicense(
  rowLicense: string,
  licenseNumber: string | null | undefined,
): boolean {
  const license = String(licenseNumber || "").trim();
  if (!license) return true;
  return rowLicense.trim().toLowerCase() === license.toLowerCase();
}

export function pickLatestSandboxPackageLabel(
  rows: Array<{ packageLabel: string; lastSyncedAt: Date; licenseNumber: string }>,
  licenseNumber?: string | null,
): string | null {
  const filtered = rows.filter(
    (row) =>
      String(row.packageLabel || "").trim().length > 0 && matchesSandboxLicense(row.licenseNumber, licenseNumber),
  );
  if (!filtered.length) return null;

  const sorted = [...filtered].sort((a, b) => {
    const syncDiff = b.lastSyncedAt.getTime() - a.lastSyncedAt.getTime();
    if (syncDiff !== 0) return syncDiff;
    return b.packageLabel.localeCompare(a.packageLabel);
  });
  return sorted[0]?.packageLabel.trim() ?? null;
}

export async function generateNextUnusedSandboxPackageTag(input: {
  companyId: string;
  licenseNumber?: string | null;
}): Promise<GeneratedSandboxPackageTag> {
  const rows = await listMetrcPackagesForCompany(input.companyId);
  const latestLabel = pickLatestSandboxPackageLabel(rows, input.licenseNumber);

  const previousPackageLabel = latestLabel;
  const packageTagSource: MetrcPackageTagSource = latestLabel
    ? "incremented_from_latest_package"
    : "incremented_from_default_seed";

  const seedLabel = latestLabel ?? METRC_EVALUATION_DEFAULT_PACKAGE_LABEL;
  let candidate = incrementMetrcTag(seedLabel);

  for (let attempt = 0; attempt < MAX_TAG_COLLISION_ATTEMPTS; attempt += 1) {
    const existing = await findMetrcPackageByLabel(input.companyId, candidate);
    if (!existing) {
      return {
        generatedPackageTag: candidate,
        packageTagSource,
        previousPackageLabel,
      };
    }
    candidate = incrementMetrcTag(candidate);
  }

  throw new Error(
    `Unable to allocate an unused sandbox package tag after ${MAX_TAG_COLLISION_ATTEMPTS} attempts.`,
  );
}
