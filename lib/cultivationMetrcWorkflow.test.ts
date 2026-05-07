import { describe, expect, it } from "vitest";
import {
  generateMetrcTagSequence,
  collectExistingPlantTagsFromCultivationBatches,
  findOverlappingTags,
  resolveMoveToVegPlantTags,
  sumImmatureAvailableExcluding,
  allImmatureDepletedAfterMove,
  buildMetrcVegMovePayload,
} from "./cultivationMetrcWorkflow";

describe("cultivationMetrcWorkflow", () => {
  it("generates sequential METRC tags preserving prefix and zero padding", () => {
    const first = "ABCDEF012345670000020401";
    const r = generateMetrcTagSequence(first, 5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tags).toEqual([
      "ABCDEF012345670000020401",
      "ABCDEF012345670000020402",
      "ABCDEF012345670000020403",
      "ABCDEF012345670000020404",
      "ABCDEF012345670000020405",
    ]);
  });

  it("rejects overflow when digit width exceeded", () => {
    const r = generateMetrcTagSequence("X999", 5);
    expect(r.ok).toBe(false);
  });

  it("collects tags from plantTagRecords across batches", () => {
    const existing = collectExistingPlantTagsFromCultivationBatches(
      [
        { id: "A", plantTagRecords: [{ tag: "T1" }] },
        { id: "B", plantTagRecords: [{ tag: "T2" }] },
      ],
      "A",
    );
    expect(existing.has("T2")).toBe(true);
    expect(existing.has("T1")).toBe(false);
  });

  it("finds overlaps between generated list and existing set", () => {
    const g = ["A1", "A2", "A3"];
    const ex = new Set(["A2"]);
    expect(findOverlappingTags(g, ex)).toEqual(["A2"]);
  });

  it("sums other immature availability excluding one id", () => {
    const sum = sumImmatureAvailableExcluding(
      [
        { id: "a", countAvailable: 10 },
        { id: "b", countAvailable: 5 },
      ],
      "a",
    );
    expect(sum).toBe(5);
  });

  it("detects when all immature batches reach zero after subtract", () => {
    const ok = allImmatureDepletedAfterMove([{ id: "a", countAvailable: 3 }], "a", 3);
    expect(ok).toBe(true);
    const notOk = allImmatureDepletedAfterMove(
      [
        { id: "a", countAvailable: 3 },
        { id: "b", countAvailable: 2 },
      ],
      "a",
      3,
    );
    expect(notOk).toBe(false);
  });

  it("resolveMoveToVegPlantTags prefers METRC inventory slice", () => {
    const r = resolveMoveToVegPlantTags({
      moveCount: 2,
      inventoryTags: ["A1", "A2", "A3"],
      firstTagManual: "",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe("metrc_inventory");
    expect(r.tags).toEqual(["A1", "A2"]);
  });

  it("resolveMoveToVegPlantTags falls back to numeric sequence", () => {
    const r = resolveMoveToVegPlantTags({
      moveCount: 2,
      inventoryTags: ["only_one"],
      firstTagManual: "T09",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe("local_sequence");
    expect(r.tags).toEqual(["T09", "T10"]);
  });

  it("builds METRC payload array shape", () => {
    const p = buildMetrcVegMovePayload({
      immatureBatchName: "IMM_B",
      countMovingToVeg: 4,
      startingTag: "TAG001",
      newLocationLabel: "Veg Room A",
      newSublocation: "",
      growthDateYmd: "2026-05-06",
    });
    expect(p).toHaveLength(1);
    expect(p[0].GrowthPhase).toBe("Vegetative");
    expect(p[0].NewSublocation).toBe(null);
    expect(p[0].PatientLicenseNumber).toBe(null);
  });
});
