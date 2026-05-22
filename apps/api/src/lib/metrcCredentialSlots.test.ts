import { describe, expect, it } from "vitest";
import { readUserApiKey, readVendorApiKey } from "./metrcConfigLoader.js";
import { remediateSwappedMetrcSlots } from "./metrcCredentialSlots.js";

describe("remediateSwappedMetrcSlots", () => {
  it("exchanges apiKey and userKey slot values", () => {
    const metrc = {
      apiKey: "USER-KEY-IN-VENDOR-SLOT",
      userKey: "VENDOR-KEY-IN-USER-SLOT",
    };
    const fixed = remediateSwappedMetrcSlots(metrc);
    expect(readVendorApiKey(fixed)).toBe("VENDOR-KEY-IN-USER-SLOT");
    expect(readUserApiKey(fixed)).toBe("USER-KEY-IN-VENDOR-SLOT");
  });
});
