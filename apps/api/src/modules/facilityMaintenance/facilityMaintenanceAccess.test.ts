import { describe, expect, it } from "vitest";
import { userMayAccessFacilitiesMaintenance } from "./facilityMaintenanceAccess.js";

describe("userMayAccessFacilitiesMaintenance", () => {
  it("allows elevated company roles regardless of permissions", () => {
    expect(userMayAccessFacilitiesMaintenance("OWNER", [])).toBe(true);
    expect(userMayAccessFacilitiesMaintenance("ADMIN", undefined)).toBe(true);
    expect(userMayAccessFacilitiesMaintenance("OPERATIONS_MANAGER", [])).toBe(true);
  });

  it("requires JWT permission for facility specialist", () => {
    expect(userMayAccessFacilitiesMaintenance("FACILITY_MAINTENANCE_SPECIALIST", [])).toBe(false);
    expect(
      userMayAccessFacilitiesMaintenance("FACILITY_MAINTENANCE_SPECIALIST", [
        "page.facilities-maintenance",
        "page.data-hub",
      ]),
    ).toBe(true);
  });
});
