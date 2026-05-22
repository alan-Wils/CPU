import { describe, expect, it } from "vitest";
import {
  buildMetrcClientAuthPlan,
  buildMetrcRequestAuth,
  maskHeadersForLog,
  shouldTryNextMetrcAuthMode,
} from "./metrcAuthStrategy.js";

const creds = {
  environment: "sandbox" as const,
  vendorApiKey: "VENDOR-KEY",
  userApiKey: "USER-KEY-LONG",
  licenseNumber: "SBX-CO",
};

describe("metrcAuthStrategy", () => {
  it("sandbox operational plan uses Basic integrator:user only", () => {
    expect(buildMetrcClientAuthPlan({ vendorOnly: false, environment: "sandbox" })).toEqual([
      "sandbox_basic_vendor_user",
    ]);
  });

  it("production operational plan uses Basic integrator:user", () => {
    expect(buildMetrcClientAuthPlan({ vendorOnly: false, environment: "production" })).toEqual([
      "sandbox_basic_vendor_user",
    ]);
  });

  it("vendor-only plan for provisioning", () => {
    expect(buildMetrcClientAuthPlan({ vendorOnly: true, environment: "sandbox" })).toEqual([
      "vendor_only",
    ]);
  });

  it("builds Basic integrator:user without x-metrc-key for operational mode", () => {
    const auth = buildMetrcRequestAuth(creds, "sandbox_basic_vendor_user");
    expect(auth?.axiosBasic).toEqual({ username: "VENDOR-KEY", password: "USER-KEY-LONG" });
    expect(auth?.headers["x-metrc-key"]).toBeUndefined();
    expect(auth?.headers["x-metrc-user-key"]).toBeUndefined();
    expect(auth?.headers["x-user-key"]).toBeUndefined();
  });

  it("masks secrets in header logs", () => {
    const masked = maskHeadersForLog({
      "x-metrc-key": "abcdefghij",
      Accept: "application/json",
    });
    expect(masked["x-metrc-key"]).toContain("abcd");
    expect(masked["x-metrc-key"]).not.toBe("abcdefghij");
    expect(masked.Accept).toBe("application/json");
  });

  it("only retries auth on 401", () => {
    expect(shouldTryNextMetrcAuthMode(401)).toBe(true);
    expect(shouldTryNextMetrcAuthMode(403)).toBe(false);
    expect(shouldTryNextMetrcAuthMode(404)).toBe(false);
  });
});
