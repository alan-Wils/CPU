import { describe, expect, it } from "vitest";
import {
  cultivationCalendarStageGroup,
  formatCultivationBatchCalendarOptionLabel,
  groupCultivationBatchesForCalendarPicker,
} from "./cultivationCalendarBatchPick";

describe("cultivationCalendarStageGroup", () => {
  it("maps clone synonyms", () => {
    expect(cultivationCalendarStageGroup("clone")).toBe("clone");
    expect(cultivationCalendarStageGroup("Clones")).toBe("clone");
  });
  it("maps veg", () => {
    expect(cultivationCalendarStageGroup("Veg")).toBe("veg");
  });
  it("maps other stages to flower bucket", () => {
    expect(cultivationCalendarStageGroup("Flower")).toBe("flower");
    expect(cultivationCalendarStageGroup("Partially Harvested")).toBe("flower");
  });
});

describe("formatCultivationBatchCalendarOptionLabel", () => {
  it("includes the full batch id for long refs", () => {
    const id = "ALLI.042726";
    expect(
      formatCultivationBatchCalendarOptionLabel({
        id,
        stage: "clone",
        strain: "Guava",
        plants: 100,
      }),
    ).toBe(`Guava · 100 plants · ${id}`);
  });
});

describe("groupCultivationBatchesForCalendarPicker", () => {
  it("returns clone, veg, flower in order with only non-empty groups", () => {
    const rows = [
      { id: "f1", stage: "Flower", strain: "Alpha" },
      { id: "c1", stage: "clone", strain: "Beta" },
      { id: "v1", stage: "Veg", strain: "Gamma" },
    ];
    const g = groupCultivationBatchesForCalendarPicker(rows);
    expect(g.map((x) => x.group)).toEqual(["clone", "veg", "flower"]);
    expect(g[0].batches.map((b) => b.id)).toEqual(["c1"]);
    expect(g[1].batches.map((b) => b.id)).toEqual(["v1"]);
    expect(g[2].batches.map((b) => b.id)).toEqual(["f1"]);
  });

  it("skips empty id rows", () => {
    const g = groupCultivationBatchesForCalendarPicker([{ id: "", stage: "Veg", strain: "X" }]);
    expect(g).toEqual([]);
  });
});
