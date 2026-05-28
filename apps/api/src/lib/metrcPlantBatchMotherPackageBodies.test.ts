import { describe, expect, it } from "vitest";
import {
  METRC_DEFAULT_MOTHER_PLANT_PACKAGE_NOTE,
  buildMetrcMotherPlantPackageBody,
} from "./metrcPlantBatchMotherPackageBodies.js";

describe("buildMetrcMotherPlantPackageBody", () => {
  it("omits Id, Sublocation, and PatientLicenseNumber from frommotherplant payload", () => {
    const body = buildMetrcMotherPlantPackageBody({
      sourcePlantLabel: "AAA00080000196B000000007",
      packageTag: "AAA00090000196B000000017",
      count: 3,
      actualDate: "2026-05-28",
      locationName: "SBX Default Location Type Location 1",
      itemName: "SBX Immature Plants SBX Strain 1 Item",
    });

    const row = body[0] as Record<string, unknown>;
    expect(row).not.toHaveProperty("Id");
    expect(row).not.toHaveProperty("Sublocation");
    expect(row).not.toHaveProperty("PatientLicenseNumber");
  });

  it("includes required METRC fields with plant label as PlantBatch", () => {
    const body = buildMetrcMotherPlantPackageBody({
      sourcePlantLabel: "AAA00080000196B000000007",
      packageTag: "AAA00090000196B000000017",
      count: 3,
      actualDate: "2026-05-28",
      locationName: "SBX Default Location Type Location 1",
      itemName: "SBX Immature Plants SBX Strain 1 Item",
    });

    expect(body).toEqual([
      {
        PlantBatch: "AAA00080000196B000000007",
        Count: 3,
        Tag: "AAA00090000196B000000017",
        Location: "SBX Default Location Type Location 1",
        Item: "SBX Immature Plants SBX Strain 1 Item",
        Note: METRC_DEFAULT_MOTHER_PLANT_PACKAGE_NOTE,
        IsTradeSample: false,
        IsDonation: false,
        ActualDate: "2026-05-28",
      },
    ]);
  });

  it("omits Location when not provided", () => {
    const body = buildMetrcMotherPlantPackageBody({
      sourcePlantLabel: "AAA00080000196B000000007",
      packageTag: "AAA00090000196B000000017",
      count: 1,
      actualDate: "2026-05-28",
      itemName: "SBX Immature Plants SBX Strain 1 Item",
    });

    const row = body[0] as Record<string, unknown>;
    expect(row).not.toHaveProperty("Location");
    expect(row.PlantBatch).toBe("AAA00080000196B000000007");
    expect(row.Item).toBe("SBX Immature Plants SBX Strain 1 Item");
  });

  it("uses custom note when provided", () => {
    const body = buildMetrcMotherPlantPackageBody({
      sourcePlantLabel: "AAA00080000196B000000007",
      packageTag: "AAA00090000196B000000017",
      count: 2,
      actualDate: "2026-05-28",
      itemName: "SBX Immature Plants SBX Strain 1 Item",
      note: "Custom mother package note.",
    });

    expect((body[0] as { Note: string }).Note).toBe("Custom mother package note.");
  });
});
