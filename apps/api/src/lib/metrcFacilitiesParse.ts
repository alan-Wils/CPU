import { parseMetrcDataRecords } from "./metrcConnectionHelpers.js";
import { readMetrcDisplayLabel } from "./metrcDisplayLabel.js";
import { normalizeMetrcFacilityDisplayName } from "./metrcOperationalStatus.js";

export type ParsedMetrcFacility = {
  licenseNumber: string;
  facilityName: string;
  /** @deprecated Prefer {@link facilityTypeName}; kept for API/DB column compat. */
  facilityType: string;
  facilityTypeName: string;
  stateCode: string;
  active: boolean;
  capabilities: Record<string, unknown>;
  raw: Record<string, unknown>;
};

function readLicenseNumber(row: Record<string, unknown>): string {
  const licenseObj = row.License ?? row.license;
  if (licenseObj && typeof licenseObj === "object" && !Array.isArray(licenseObj)) {
    const lic = licenseObj as Record<string, unknown>;
    const nested = String(lic.Number ?? lic.number ?? "").trim();
    if (nested) return nested;
  }
  return String(
    row.LicenseNumber
      ?? row.licenseNumber
      ?? row.FacilityLicenseNumber
      ?? row.facilityLicenseNumber
      ?? "",
  ).trim();
}

function readFacilityName(row: Record<string, unknown>): string {
  const raw = String(
    row.Name ?? row.name ?? row.FacilityName ?? row.facilityName ?? row.DisplayName ?? "",
  ).trim();
  return normalizeMetrcFacilityDisplayName(raw);
}

function readFacilityTypeName(row: Record<string, unknown>): string {
  const direct = readMetrcDisplayLabel(
    row.FacilityTypeName
      ?? row.facilityTypeName
      ?? row.LicenseType
      ?? row.licenseType,
  );
  if (direct) return direct;
  return readMetrcDisplayLabel(row.FacilityType ?? row.facilityType);
}

function readStateCode(row: Record<string, unknown>, fallbackState: string): string {
  const fromRow = String(
    row.State ?? row.state ?? row.StateCode ?? row.stateCode ?? "",
  )
    .trim()
    .toUpperCase();
  if (/^[A-Z]{2}$/.test(fromRow)) return fromRow;
  const fb = String(fallbackState || "")
    .trim()
    .toUpperCase();
  return /^[A-Z]{2}$/.test(fb) ? fb : "";
}

function readActive(row: Record<string, unknown>): boolean {
  const raw = row.IsActive ?? row.isActive ?? row.Active ?? row.active;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") {
    const s = raw.trim().toLowerCase();
    if (s === "false" || s === "0" || s === "no") return false;
    if (s === "true" || s === "1" || s === "yes") return true;
  }
  if (typeof raw === "number") return raw !== 0;
  return true;
}

export function extractMetrcFacilityCapabilities(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const caps: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (/^Can[A-Z]/.test(key) && typeof value === "boolean") {
      caps[key] = value;
    }
  }
  const permissions = row.Permissions ?? row.permissions;
  if (permissions !== undefined) caps.permissions = permissions;
  const capabilities = row.Capabilities ?? row.capabilities;
  if (capabilities !== undefined) caps.capabilities = capabilities;
  return caps;
}

export function parseMetrcFacilitiesPayload(
  body: unknown,
  fallbackStateCode: string,
): ParsedMetrcFacility[] {
  const out: ParsedMetrcFacility[] = [];
  for (const row of parseMetrcDataRecords(body)) {
    const licenseNumber = readLicenseNumber(row);
    if (!licenseNumber) continue;
    const facilityTypeName = readFacilityTypeName(row);
    out.push({
      licenseNumber,
      facilityName: readFacilityName(row),
      facilityType: facilityTypeName,
      facilityTypeName,
      stateCode: readStateCode(row, fallbackStateCode),
      active: readActive(row),
      capabilities: extractMetrcFacilityCapabilities(row),
      raw: row,
    });
  }
  return out;
}

export function pickMetrcFacilityNameFromFacilities(
  facilities: ParsedMetrcFacility[],
  configLicense: string,
): string | null {
  if (!facilities.length) return null;
  const cfg = String(configLicense || "").trim();
  const picked =
    (cfg ? facilities.find((f) => f.licenseNumber === cfg) : null) ?? facilities[0];
  return picked?.facilityName?.trim() || null;
}

export function pickPrimaryMetrcOperationalLicense(facilities: ParsedMetrcFacility[]): string | null {
  const sf = facilities.find((f) => f.licenseNumber.startsWith("SF-"));
  return (sf ?? facilities[0])?.licenseNumber ?? null;
}
