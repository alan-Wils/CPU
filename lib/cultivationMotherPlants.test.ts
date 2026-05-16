import { describe, expect, it } from "vitest";
import {
  applyPromotionToSourceBatch,
  buildMotherPlantsForPromotion,
  countActiveMothers,
  filterActiveMothers,
  normalizeMotherPlants,
  validateUniqueMotherTags,
} from "./cultivationMotherPlants";

describe("cultivationMotherPlants", () => {
  it("normalizes mother plant rows", () => {
    const rows = normalizeMotherPlants([
      {
        id: "m1",
        strain: "Gelato",
        acronym: "GEL",
        tag: "TAG001",
        status: "active",
        sourceBatchId: "b1",
        sourceStage: "Clones",
        promotedAt: "2026-05-16",
        createdAt: "2026-05-16T12:00:00.000Z",
        updatedAt: "2026-05-16T12:00:00.000Z",
      },
      { id: "", strain: "x" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.strain).toBe("Gelato");
  });

  it("filters active mothers", () => {
    const plants = normalizeMotherPlants([
      {
        id: "a",
        strain: "A",
        status: "active",
        sourceBatchId: "b",
        sourceStage: "Veg",
        promotedAt: "2026-01-01",
        createdAt: "t",
        updatedAt: "t",
      },
      {
        id: "r",
        strain: "R",
        status: "retired",
        sourceBatchId: "b",
        sourceStage: "Veg",
        promotedAt: "2026-01-01",
        createdAt: "t",
        updatedAt: "t",
      },
    ]);
    expect(countActiveMothers(plants)).toBe(1);
    expect(filterActiveMothers(plants)).toHaveLength(1);
  });

  it("rejects duplicate tags", () => {
    const existing = normalizeMotherPlants([
      {
        id: "m1",
        strain: "S",
        tag: "ABC123",
        status: "active",
        sourceBatchId: "b",
        sourceStage: "Clones",
        promotedAt: "2026-01-01",
        createdAt: "t",
        updatedAt: "t",
      },
    ]);
    const v = validateUniqueMotherTags(existing, ["ABC123"]);
    expect(v.ok).toBe(false);
  });

  it("builds moms from clone count with sequential tags", () => {
    const batch = { id: "clone-1", strain: "OG", acronym: "OG", plants: 10 };
    const built = buildMotherPlantsForPromotion({
      sourceBatch: batch,
      sourceStage: "Clones",
      plantCount: 2,
      startingTag: "ABCDEF012345670000020401",
      promotedAt: "2026-05-16",
      nowIso: "2026-05-16T12:00:00.000Z",
      newId: () => "id-1",
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.mothers).toHaveLength(2);
    expect(built.mothers[0]?.tag).toBe("ABCDEF012345670000020401");
    expect(built.mothers[1]?.tag).toBe("ABCDEF012345670000020402");
  });

  it("builds one mom per selected veg tag", () => {
    const batch = {
      id: "veg-1",
      strain: "Zkittlez",
      plants: 3,
      plantTagRecords: [{ tag: "T1" }, { tag: "T2" }, { tag: "T3" }],
    };
    const built = buildMotherPlantsForPromotion({
      sourceBatch: batch,
      sourceStage: "Veg",
      selectedTags: ["T1", "T3"],
      promotedAt: "2026-05-16",
      nowIso: "2026-05-16T12:00:00.000Z",
      newId: (() => {
        let n = 0;
        return () => `id-${++n}`;
      })(),
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.mothers.map((m) => m.tag)).toEqual(["T1", "T3"]);
    applyPromotionToSourceBatch(batch, 2, ["T1", "T3"]);
    expect(batch.plants).toBe(1);
    expect((batch.plantTagRecords as { tag: string }[]).map((r) => r.tag)).toEqual(["T2"]);
  });
});
