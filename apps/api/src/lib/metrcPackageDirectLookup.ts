import { MetrcClient, isMetrcClientFailure } from "./metrcClient.js";
import { parseMetrcDataRecords } from "./metrcConnectionHelpers.js";
import { parseMetrcPackagesPayload, type ParsedMetrcPackage } from "./metrcPackagesParse.js";

function licenseQuery(licenseNumber: string): string {
  const license = String(licenseNumber || "").trim();
  return license ? `?licenseNumber=${encodeURIComponent(license)}` : "";
}

export function buildMetrcPackageByLabelPathCandidates(
  packageLabel: string,
  licenseNumber: string,
): string[] {
  const encoded = encodeURIComponent(String(packageLabel || "").trim());
  const q = licenseQuery(licenseNumber);
  return [`/packages/v2/${encoded}${q}`, `/packages/v1/${encoded}${q}`];
}

export function readMetrcPackageIdFromRow(row: Record<string, unknown>): string | null {
  const id = row.Id ?? row.id;
  if (id === undefined || id === null) return null;
  const s = String(id).trim();
  return s || null;
}

export type MetrcPackageDirectLookupSuccess = {
  ok: true;
  endpoint: string;
  parsed: ParsedMetrcPackage;
  packageId: string | null;
  raw: Record<string, unknown>;
};

export type MetrcPackageDirectLookupFailure = {
  ok: false;
  endpointsTried: string[];
};

export type MetrcPackageDirectLookupResult =
  | MetrcPackageDirectLookupSuccess
  | MetrcPackageDirectLookupFailure;

/** GET /packages/v2/{label} — direct lookup by package tag (not active list). */
export async function fetchMetrcPackageByLabel(input: {
  client: MetrcClient;
  packageLabel: string;
  licenseNumber: string;
}): Promise<MetrcPackageDirectLookupResult> {
  const packageLabel = String(input.packageLabel || "").trim();
  const licenseNumber = String(input.licenseNumber || "").trim();
  if (!packageLabel) {
    return { ok: false, endpointsTried: [] };
  }

  const endpointsTried: string[] = [];
  for (const pathname of buildMetrcPackageByLabelPathCandidates(packageLabel, licenseNumber)) {
    endpointsTried.push(pathname.split("?")[0] || pathname);
    const result = await input.client.get<unknown>(pathname);
    if (isMetrcClientFailure(result)) continue;

    const parsedRows = parseMetrcPackagesPayload(result.data);
    const parsed =
      parsedRows.find((row) => row.packageLabel === packageLabel) ?? parsedRows[0];
    if (parsed) {
      return {
        ok: true,
        endpoint: pathname.split("?")[0] || pathname,
        parsed,
        packageId: readMetrcPackageIdFromRow(parsed.raw),
        raw: parsed.raw,
      };
    }

    if (result.data && typeof result.data === "object" && !Array.isArray(result.data)) {
      const singleParsed = parseMetrcPackagesPayload([result.data as Record<string, unknown>]);
      const row = singleParsed[0];
      if (row) {
        return {
          ok: true,
          endpoint: pathname.split("?")[0] || pathname,
          parsed: row,
          packageId: readMetrcPackageIdFromRow(row.raw),
          raw: row.raw,
        };
      }
    }

    const rows = parseMetrcDataRecords(result.data);
    if (rows[0]) {
      const fallbackParsed = parseMetrcPackagesPayload(rows)[0];
      if (fallbackParsed) {
        return {
          ok: true,
          endpoint: pathname.split("?")[0] || pathname,
          parsed: fallbackParsed,
          packageId: readMetrcPackageIdFromRow(fallbackParsed.raw),
          raw: fallbackParsed.raw,
        };
      }
    }
  }

  return { ok: false, endpointsTried };
}
