import { MetrcClient } from "./metrcClient.js";
import type { LoadedMetrcConfig } from "./metrcConfigLoader.js";

export const METRC_KEYS_SWAPPED_HINT =
  "Vendor and user API keys appear to be swapped in Company Config. Put the METRC Connect integrator key in Vendor API key and the facility user key (from METRC email) in User API key, then Save configuration and test again.";

/**
 * After all auth modes return 401, probe with vendor/user reversed.
 * Returns true when swapped credentials succeed (keys were stored in wrong fields).
 */
export async function probeMetrcKeysPossiblySwapped(input: {
  loaded: LoadedMetrcConfig;
  companyId: string;
  pathnameAndQuery: string;
}): Promise<boolean> {
  const { loaded, companyId, pathnameAndQuery } = input;
  if (loaded.environment !== "sandbox") return false;
  const vendor = loaded.vendorApiKey.trim();
  const user = loaded.userApiKey.trim();
  if (!vendor || !user || vendor.length < 36 || user.length < 36) return false;

  const swappedClient = MetrcClient.fromLoadedConfig(
    {
      vendorApiKey: user,
      userApiKey: vendor,
      username: loaded.username,
      licenseNumber: loaded.licenseNumber,
      stateCode: loaded.stateCode,
      environment: loaded.environment,
      apiBaseUrlOverride: loaded.apiBaseUrlOverride,
    },
    companyId,
  );

  const probe = await swappedClient.probeAuthMode(
    pathnameAndQuery,
    "sandbox_basic_vendor_user",
  );
  return probe.status >= 200 && probe.status < 300;
}
