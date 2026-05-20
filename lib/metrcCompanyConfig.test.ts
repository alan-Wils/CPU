import { describe, expect, it } from "vitest";
import {
  defaultMetrcCompanyConfig,
  isMaskedMetrcSecretPlaceholder,
  prepareMetrcSecretsForSave,
} from "./metrcCompanyConfig";

describe("prepareMetrcSecretsForSave", () => {
  it("clears apiKey when vendor field was not touched", () => {
    const out = prepareMetrcSecretsForSave(
      {
        ...defaultMetrcCompanyConfig,
        apiKey: "browser-autofill",
        hasMetrcVendorApiKey: true,
      },
      { vendorKey: false, userKey: false },
    );
    expect(out.apiKey).toBe("");
    expect(out.hasMetrcVendorApiKey).toBeUndefined();
  });

  it("keeps apiKey when vendor field was touched", () => {
    const out = prepareMetrcSecretsForSave(
      { ...defaultMetrcCompanyConfig, apiKey: "REAL-VENDOR" },
      { vendorKey: true },
    );
    expect(out.apiKey).toBe("REAL-VENDOR");
  });

  it("treats masked placeholder as empty", () => {
    expect(
      isMaskedMetrcSecretPlaceholder(
        "•••••••• configured — enter a new key only if you intend to replace the stored value.",
      ),
    ).toBe(true);
  });
});
