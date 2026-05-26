import { parseMetrcDataRecords } from "./metrcConnectionHelpers.js";

/** Integrator setup placeholder (e.g. SBX-CO) — not the operational facility license. */
export function isMetrcSandboxPlaceholderLicense(license: string): boolean {
  const t = String(license || "").trim();
  if (!t) return false;
  return /^SBX-[A-Z]{2}$/i.test(t);
}

/** Prefer a real SF-SBX-* facility license over a sandbox placeholder. */
export function mergeMetrcOperationalLicense(current: string, discovered: string): string {
  const cur = String(current || "").trim();
  const disc = String(discovered || "").trim();
  if (!disc) return cur;
  if (!cur) return disc;
  if (isMetrcSandboxPlaceholderLicense(disc) && !isMetrcSandboxPlaceholderLicense(cur)) {
    return cur;
  }
  if (isMetrcSandboxPlaceholderLicense(cur) && !isMetrcSandboxPlaceholderLicense(disc)) {
    return disc;
  }
  if (disc.startsWith("SF-") && cur !== disc && isMetrcSandboxPlaceholderLicense(cur)) {
    return disc;
  }
  return cur;
}

export function normalizeMetrcFacilityDisplayName(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  return s.replace(/\s+Location\s+\d+\s*$/i, "").trim() || s;
}

export function pickMetrcFacilityNameFromLocations(rows: unknown): string | null {
  for (const row of parseMetrcDataRecords(rows)) {
    const name = String(row.Name ?? row.name ?? row.DisplayName ?? row.displayName ?? "").trim();
    if (name) return normalizeMetrcFacilityDisplayName(name);
  }
  return null;
}

export function isMetrcProvisioningComplete(
  metrc: Record<string, unknown>,
  hasUserKey: boolean,
): boolean {
  if (Boolean(metrc.metrcOperationalAccessGranted)) return true;
  return Boolean(metrc.sandboxReady) && hasUserKey;
}

export type MetrcOperationalSuccessPatch = {
  operationalLicense?: string;
  facilityName?: string | null;
};

/** Persist sandbox connected / operational access after an authenticated METRC HTTP 200. */
export function applyMetrcOperationalSuccess(
  metrc: Record<string, unknown>,
  patch: MetrcOperationalSuccessPatch = {},
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...metrc,
    sandboxReady: true,
    sandboxProvisioning: false,
    metrcOperationalAccessGranted: true,
    metrcSandboxOperationalStatus: "connected",
    metrcLastConnectionStatus: "connected",
  };

  if (patch.operationalLicense) {
    const merged = mergeMetrcOperationalLicense(
      String(next.licenseNumber ?? next.facilityLicenseNumber ?? ""),
      patch.operationalLicense,
    );
    if (merged) {
      next.licenseNumber = merged;
      next.facilityLicenseNumber = merged;
    }
  }

  const existingName = String(next.facilityName ?? "").trim();
  const incomingName = String(patch.facilityName ?? "").trim();
  if (incomingName && !existingName) {
    next.facilityName = incomingName;
  }

  return next;
}
