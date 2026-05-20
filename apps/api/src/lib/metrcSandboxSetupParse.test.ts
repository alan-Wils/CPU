import { describe, expect, it } from "vitest";
import {
  isMetrcSandboxAsyncProvisioningResponse,
  isMetrcSandboxPartialProvisioning,
  parseMetrcSandboxSetupResponse,
  redactMetrcSandboxPayload,
} from "./metrcSandboxSetupParse.js";

describe("parseMetrcSandboxSetupResponse", () => {
  it("reads userApiKey from credentials.userApiKey", () => {
    const parsed = parseMetrcSandboxSetupResponse({
      credentials: { userApiKey: "USER-123" },
      facilityLicenseNumber: "LIC-A",
      facilityName: "Test Facility",
      username: "op1",
    });
    expect(parsed.userApiKey).toBe("USER-123");
    expect(parsed.parserPaths.userApiKey).toBe("credentials.userApiKey");
    expect(parsed.facilityLicenseNumber).toBe("LIC-A");
  });

  it("reads Password as user key (common METRC sandbox shape)", () => {
    const parsed = parseMetrcSandboxSetupResponse({
      Username: "sandbox-user",
      Password: "SECRET-USER-KEY",
      FacilityLicenseNumber: "1-X",
      FacilityName: "Sandbox Grow",
    });
    expect(parsed.userApiKey).toBe("SECRET-USER-KEY");
    expect(parsed.username).toBe("sandbox-user");
    expect(parsed.facilityLicenseNumber).toBe("1-X");
  });

  it("reads nested Data.apiKey when distinct from vendor", () => {
    const parsed = parseMetrcSandboxSetupResponse(
      { Data: { apiKey: "USER-FROM-DATA", licenseNumber: "L-9" } },
      { vendorApiKey: "VENDOR-ONLY" },
    );
    expect(parsed.userApiKey).toBe("USER-FROM-DATA");
    expect(parsed.facilityLicenseNumber).toBe("L-9");
  });

  it("skips root apiKey when it matches vendor integrator key", () => {
    const parsed = parseMetrcSandboxSetupResponse(
      { apiKey: "SAME-VENDOR", licenseNumber: "L-1" },
      { vendorApiKey: "SAME-VENDOR" },
    );
    expect(parsed.userApiKey).toBe("");
    expect(parsed.facilityLicenseNumber).toBe("L-1");
  });

  it("detects HTTP 202 as async provisioning", () => {
    expect(isMetrcSandboxAsyncProvisioningResponse(202, "")).toBe(true);
  });

  it("detects user creation message as async provisioning", () => {
    expect(isMetrcSandboxAsyncProvisioningResponse(200, "User creation is in process")).toBe(true);
  });

  it("detects partial facility without user key as provisioning", () => {
    const parsed = parseMetrcSandboxSetupResponse({
      FacilityLicenseNumber: "L-1",
      FacilityName: "Test",
    });
    expect(
      isMetrcSandboxPartialProvisioning(parsed, 200, { FacilityLicenseNumber: "L-1" }),
    ).toBe(true);
  });

  it("redacts secrets in log payload", () => {
    const redacted = redactMetrcSandboxPayload({
      userApiKey: "abc123secret",
      facilityName: "Visible Name",
    }) as Record<string, unknown>;
    expect(String(redacted.userApiKey)).toContain("[redacted:");
    expect(redacted.facilityName).toBe("Visible Name");
  });
});
