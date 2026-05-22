import type { LoadedMetrcConfig } from "./metrcConfigLoader.js";
import { readUserApiKey, readVendorApiKey } from "./metrcConfigLoader.js";
import { logWarn } from "./logger.js";

/** Character counts only — never exposes key material. */
export function metrcStoredKeyLengths(metrc: Record<string, unknown>): {
  userKeyLength: number;
  vendorKeyLength: number;
} {
  return {
    userKeyLength: readUserApiKey(metrc).length,
    vendorKeyLength: readVendorApiKey(metrc).length,
  };
}

export function buildMetrcCredentialHint(input: {
  userKeyLength: number;
  vendorKeyLength: number;
  licenseNumber: string;
}): string {
  const license = String(input.licenseNumber || "").trim();
  if (!input.userKeyLength) {
    return "No user API key is stored. In Admin → Company Config, click Replace user key, paste the full METRC user API key, then click Save configuration.";
  }
  if (input.userKeyLength < 36) {
    return `Stored user API key is only ${input.userKeyLength} characters (METRC keys are usually 48+). Re-copy the full key from METRC and save again.`;
  }
  if (!input.vendorKeyLength) {
    return "Vendor (integrator) API key is missing. Save it in Company Config before using the Colorado sandbox.";
  }
  if (!license) {
    return "Facility license number is missing. Run sandbox setup or enter the license in Company Config.";
  }
  return `Server has vendor key (${input.vendorKeyLength} chars) and user key (${input.userKeyLength} chars) for license ${license}. If you still get 401, generate a new user API key in METRC and replace the stored key.`;
}

/** Shown when header auth modes all return 401 but vendor/user slots look correct. */
export function buildMetrcOperationalAccessDeniedHint(licenseNumber: string): string {
  const license = String(licenseNumber || "").trim() || "this license";
  return (
    `Keys are mapped correctly, but METRC denied operational access for ${license}. ` +
    "Confirm the sandbox user key is paired to this Connect deployment and that the sandbox facility has operational access."
  );
}

export function buildMetrcCredentialHintFromLoaded(loaded: LoadedMetrcConfig): string {
  return buildMetrcCredentialHint({
    userKeyLength: loaded.userApiKey.length,
    vendorKeyLength: loaded.vendorApiKey.length,
    licenseNumber: loaded.licenseNumber,
  });
}

export function logMetrcCredentialDiagnostics(parts: {
  companyId: string;
  purpose: string;
  userKeyLength: number;
  vendorKeyLength: number;
  licensePresent: boolean;
  attemptedAuthModes?: string[];
}): void {
  logWarn("[METRC] credential_diagnostics", {
    companyId: parts.companyId,
    purpose: parts.purpose,
    userKeyLength: parts.userKeyLength,
    vendorKeyLength: parts.vendorKeyLength,
    licensePresent: parts.licensePresent,
    attemptedAuthModes: parts.attemptedAuthModes ?? [],
  });
}
