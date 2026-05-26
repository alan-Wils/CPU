import { describe, expect, it } from "vitest";
import {
  findNexbatchStrainByExactName,
  reconcileMetrcStrainsWithNexbatch,
} from "./metrcNexbatchStrains.js";

describe("metrcNexbatchStrains", () => {
  it("links exact name matches without creating duplicates", () => {
    const cultivation = {
      strains: [
        {
          id: "strain-1",
          name: "Blue Dream",
          acronym: "BD",
          dominance: "",
          potency: "",
          averageYield: "",
        },
      ],
    };

    const out = reconcileMetrcStrainsWithNexbatch({
      cultivation,
      metrcStrains: [{ metrcStrainId: "42", name: "Blue Dream" }],
    });

    expect(out.nexbatchStrainsCreated).toBe(0);
    expect(out.links.get("42")).toBe("strain-1");
    const strains = out.cultivation.strains as Record<string, unknown>[];
    expect(strains[0]?.metrcStrainId).toBe("42");
  });

  it("creates METRC-linked strains when no exact name match", () => {
    const out = reconcileMetrcStrainsWithNexbatch({
      cultivation: { strains: [] },
      metrcStrains: [{ metrcStrainId: "99", name: "New METRC Strain" }],
    });

    expect(out.nexbatchStrainsCreated).toBe(1);
    expect(out.links.get("99")).toBe("strain-metrc-99");
    const strains = out.cultivation.strains as Record<string, unknown>[];
    expect(strains[0]?.name).toBe("New METRC Strain");
    expect(strains[0]?.metrcLinked).toBe(true);
  });

  it("findNexbatchStrainByExactName requires trimmed exact match", () => {
    const strains = [{ id: "a", name: "Sour Diesel", acronym: "SD", dominance: "", potency: "", averageYield: "" }];
    expect(findNexbatchStrainByExactName(strains, "Sour Diesel")).not.toBeNull();
    expect(findNexbatchStrainByExactName(strains, "sour diesel")).toBeNull();
  });
});
