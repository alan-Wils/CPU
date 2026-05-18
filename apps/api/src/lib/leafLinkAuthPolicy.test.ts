import { describe, expect, it, beforeEach } from "vitest";
import {
  _resetLeafLinkAuthPolicyForTests,
  classifyLeafLinkAuthHttpError,
  isLeafLinkAuthComboInCooldown,
  markLeafLinkAuthComboFailed,
  markLeafLinkAuthComboSucceeded,
  orderedLeafLinkAuthCandidates,
} from "./leafLinkAuthPolicy.js";

describe("leafLinkAuthPolicy", () => {
  beforeEach(() => {
    _resetLeafLinkAuthPolicyForTests();
  });

  it("does not classify generic 403 as invalid credentials", () => {
    const c = classifyLeafLinkAuthHttpError(403, { detail: "Forbidden" }, "https://api/v2/products/");
    expect(c.code).not.toBe("LEAFLINK_INVALID_CREDENTIALS");
    expect(["LEAFLINK_AUTH_MODE_DENIED", "LEAFLINK_FORBIDDEN_ENDPOINT"]).toContain(c.code);
  });

  it("classifies company scope 403", () => {
    const c = classifyLeafLinkAuthHttpError(
      403,
      { detail: "Company not allowed" },
      "https://api/v2/companies/co-1/products/",
    );
    expect(c.code).toBe("LEAFLINK_COMPANY_SCOPE_DENIED");
  });

  it("classifies expired token 401", () => {
    const c = classifyLeafLinkAuthHttpError(401, { detail: "Token expired" }, "https://api/v2/orders-received/");
    expect(c.code).toBe("LEAFLINK_INVALID_TOKEN");
  });

  it("caches preferred auth and suppresses cooled-down modes", () => {
    const tenant = "https://app.leaflink.com/api|co1";
    const endpoint = "https://app.leaflink.com/api/v2/products/?page=1";
    const all = ["App key1", "Token key1", "Bearer key1"];

    markLeafLinkAuthComboFailed(tenant, endpoint, "App", "LEAFLINK_AUTH_MODE_DENIED");
    expect(isLeafLinkAuthComboInCooldown(tenant, endpoint, "App")).toBe(true);

    const orderedWhileCool = orderedLeafLinkAuthCandidates(all, tenant, endpoint);
    expect(orderedWhileCool[0]).not.toBe("App key1");

    markLeafLinkAuthComboSucceeded(tenant, endpoint, "Token key1", "Token");
    const orderedAfterSuccess = orderedLeafLinkAuthCandidates(all, tenant, endpoint);
    expect(orderedAfterSuccess[0]).toBe("Token key1");
  });
});
