import { describe, expect, it } from "vitest";
import {
  DEFAULT_CULTIVATION_STORAGE_LOCATIONS,
  normalizeCultivationStorageLocationsConfig,
  storageTypeForMaterialType,
} from "./cultivationStorageConfig";

describe("cultivationStorageConfig", () => {
  it("applies defaults when lists are empty", () => {
    const out = normalizeCultivationStorageLocationsConfig({ freezers: [], dryRooms: [] });
    expect(out.freezers).toEqual(DEFAULT_CULTIVATION_STORAGE_LOCATIONS.freezers);
    expect(out.dryRooms).toEqual(DEFAULT_CULTIVATION_STORAGE_LOCATIONS.dryRooms);
  });

  it("maps material type to storage type", () => {
    expect(storageTypeForMaterialType("FRESH_FROZEN")).toBe("FREEZER");
    expect(storageTypeForMaterialType("TRIM")).toBe("DRY_ROOM");
  });
});
