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
  it("sandbox operational plan order", () => {
    expect(buildMetrcClientAuthPlan({ vendorOnly: false, environment: "sandbox" })).toEqual([
      "sandbox_x_metrc_key",
      "sandbox_x_metrc_key_and_user_key_header",
      "sandbox_x_metrc_key_and_userkey_header",
      "sandbox_x_metrc_key_and_x_user_key",
      "sandbox_basic_license_user",
      "sandbox_basic_vendor_user",
      "sandbox_bearer_user",
    ]);
  });

  it("vendor-only plan for provisioning", () => {
    expect(buildMetrcClientAuthPlan({ vendorOnly: true, environment: "sandbox" })).toEqual([
      "vendor_only",
    ]);
  });

  it("builds x-user-key header for sandbox mode B", () => {
    const auth = buildMetrcRequestAuth(creds, "sandbox_x_metrc_key_and_x_user_key");
    expect(auth?.headers["x-metrc-key"]).toBe("VENDOR-KEY");
    expect(auth?.headers["x-user-key"]).toBe("USER-KEY-LONG");
    expect(auth?.headers["x-metrc-user-key"]).toBeUndefined();
  });

  it("builds basic vendor:user for sandbox mode C", () => {
    const auth = buildMetrcRequestAuth(creds, "sandbox_basic_vendor_user");
    expect(auth?.axiosBasic).toEqual({ username: "VENDOR-KEY", password: "USER-KEY-LONG" });
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
