import { describe, expect, it } from "vitest";
import {
  mergeCultivationTasksForStage,
  mergeWorkflowTaskList,
  resolveConfigurableTaskRewards,
} from "./customTasksConfig";

describe("customTasksConfig", () => {
  it("merges unique labels into cultivation lists by stage", () => {
    const customs = [
      {
        id: "a",
        label: "Extra Clone Job",
        rewardsEligible: true,
        tierPointsMultiplier: 1,
        stages: ["clone" as const],
      },
      {
        id: "b",
        label: "Flower Only",
        rewardsEligible: true,
        tierPointsMultiplier: 1,
        stages: ["flower" as const],
      },
    ];
    expect(mergeCultivationTasksForStage(["A"], customs, "clone")).toEqual(["A", "Extra Clone Job"]);
    expect(mergeCultivationTasksForStage(["A"], customs, "veg")).toEqual(["A"]);
    expect(mergeCultivationTasksForStage(["A"], customs, "flower")).toEqual(["A", "Flower Only"]);
  });

  it("resolveConfigurableTaskRewards defaults built-ins to eligible ×1", () => {
    const defs = { cultivation: [], extraction: [], packaging: [] };
    expect(resolveConfigurableTaskRewards("Cultivation", "Harvest", defs)).toEqual({
      eligible: true,
      tierMultiplier: 1,
    });
  });

  it("resolveConfigurableTaskRewards respects custom defs", () => {
    const defs = {
      cultivation: [],
      extraction: [
        {
          id: "x",
          label: "QC Pass",
          rewardsEligible: false,
          tierPointsMultiplier: 2,
        },
      ],
      packaging: [],
    };
    expect(resolveConfigurableTaskRewards("Extraction", "QC Pass", defs)).toEqual({
      eligible: false,
      tierMultiplier: 2,
    });
  });

  it("mergeWorkflowTaskList dedupes against defaults", () => {
    expect(mergeWorkflowTaskList(["Label"], [{ id: "1", label: "Label", rewardsEligible: true, tierPointsMultiplier: 1 }])).toEqual(["Label"]);
    expect(mergeWorkflowTaskList(["Label"], [{ id: "1", label: "Stamp", rewardsEligible: true, tierPointsMultiplier: 1 }])).toEqual([
      "Label",
      "Stamp",
    ]);
  });
});
