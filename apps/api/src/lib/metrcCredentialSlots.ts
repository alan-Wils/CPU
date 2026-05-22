import { readUserApiKey, readVendorApiKey } from "./metrcConfigLoader.js";

/**
 * DB stores vendor in `apiKey` and user in `userKey`.
 * When operators paste keys into the wrong UI fields, slots are reversed but lengths still look valid.
 */
export function remediateSwappedMetrcSlots(metrc: Record<string, unknown>): Record<string, unknown> {
  const vendorSlot = readVendorApiKey(metrc);
  const userSlot = readUserApiKey(metrc);
  return {
    ...metrc,
    apiKey: userSlot,
    userKey: vendorSlot,
    metrcCredentialSlotsRemediatedAt: new Date().toISOString(),
  };
}
