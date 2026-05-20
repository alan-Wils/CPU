import { describe, expect, it } from "vitest";
import { mergeCompanyValuePreserveMaskedSecrets, scrubCompanySecretsForHttp } from "./configHttpPayload.js";

describe("configHttpPayload METRC secrets", () => {
  it("scrub sets hasMetrcVendorApiKey from stored apiKey", () => {
    const out = scrubCompanySecretsForHttp({
      metrc: { apiKey: "VENDOR-REAL", userKey: "USER-REAL" },
    }) as { metrc: Record<string, unknown> };
    expect(out.metrc.hasMetrcVendorApiKey).toBe(true);
    expect(out.metrc.hasMetrcUserApiKey).toBe(true);
    expect(out.metrc.apiKey).toBe("");
    expect(out.metrc.userKey).toBe("");
  });

  it("merge preserves vendor key when client sends empty apiKey", () => {
    const merged = mergeCompanyValuePreserveMaskedSecrets(
      { metrc: { apiKey: "STORED-VENDOR", userKey: "U" } },
      { metrc: { apiKey: "", userKey: "U", hasMetrcVendorApiKey: true } },
    ) as { metrc: Record<string, unknown> };
    expect(merged.metrc.apiKey).toBe("STORED-VENDOR");
  });

  it("merge preserves vendor key when client sends masked placeholder text", () => {
    const merged = mergeCompanyValuePreserveMaskedSecrets(
      { metrc: { apiKey: "STORED-VENDOR" } },
      {
        metrc: {
          apiKey: "•••••••• configured — enter a new key only if you intend to replace the stored value.",
        },
      },
    ) as { metrc: Record<string, unknown> };
    expect(merged.metrc.apiKey).toBe("STORED-VENDOR");
  });

  it("merge accepts new vendor key when operator replaces it", () => {
    const merged = mergeCompanyValuePreserveMaskedSecrets(
      { metrc: { apiKey: "OLD" } },
      { metrc: { apiKey: "NEW-VENDOR" } },
    ) as { metrc: Record<string, unknown> };
    expect(merged.metrc.apiKey).toBe("NEW-VENDOR");
  });
});
