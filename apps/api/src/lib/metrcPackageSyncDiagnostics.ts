import type { ParsedMetrcPackage } from "./metrcPackagesParse.js";

function readDateField(row: Record<string, unknown>, keys: string[]): Date | null {
  for (const key of keys) {
    const raw = row[key];
    if (raw === undefined || raw === null || raw === "") continue;
    if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
    const parsed = new Date(String(raw).trim());
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

export function readPackageLastModified(raw: Record<string, unknown>): Date | null {
  return readDateField(raw, [
    "LastModified",
    "lastModified",
    "LastModifiedDate",
    "lastModifiedDate",
    "UpdatedDate",
    "updatedDate",
  ]);
}

export function sortParsedPackagesNewestFirst(rows: ParsedMetrcPackage[]): ParsedMetrcPackage[] {
  return [...rows].sort((a, b) => {
    const aTime = readPackageLastModified(a.raw)?.getTime() ?? 0;
    const bTime = readPackageLastModified(b.raw)?.getTime() ?? 0;
    if (bTime !== aTime) return bTime - aTime;
    return b.packageLabel.localeCompare(a.packageLabel);
  });
}

export type MetrcPackageSyncDiagnostics = {
  rawMetrcPackageCount: number;
  filteredPackageCount: number;
  newestPackageLabel: string | null;
  newestPackageModifiedAt: string | null;
  returnedLabels: string[];
  pagesFetched: number;
};

export function buildMetrcPackageSyncDiagnostics(input: {
  rawMetrcPackageCount: number;
  parsed: ParsedMetrcPackage[];
  pagesFetched: number;
}): MetrcPackageSyncDiagnostics {
  const sorted = sortParsedPackagesNewestFirst(input.parsed);
  const newest = sorted[0];
  const newestModified = newest ? readPackageLastModified(newest.raw) : null;

  return {
    rawMetrcPackageCount: input.rawMetrcPackageCount,
    filteredPackageCount: input.parsed.length,
    newestPackageLabel: newest?.packageLabel ?? null,
    newestPackageModifiedAt: newestModified ? newestModified.toISOString() : null,
    returnedLabels: sorted.map((row) => row.packageLabel),
    pagesFetched: input.pagesFetched,
  };
}
