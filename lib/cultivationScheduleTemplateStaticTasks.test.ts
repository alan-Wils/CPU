import { describe, expect, it } from "vitest";
import {
  listStaticCultivationTasksForSchedulePicker,
  scheduleTemplateTitleSelectValue,
  SCHEDULE_TEMPLATE_TASK_CUSTOM,
} from "@/lib/cultivationScheduleTemplateStaticTasks";

describe("cultivationScheduleTemplateStaticTasks", () => {
  it("lists built-in clone tasks when METRC on", () => {
    const list = listStaticCultivationTasksForSchedulePicker("clone", true, []);
    expect(list.length).toBeGreaterThan(3);
    expect(list).toContain("Maintenance");
  });

  it("includes custom tasks for the chosen stage", () => {
    const list = listStaticCultivationTasksForSchedulePicker("veg", true, [
      { id: "1", label: "Veg-only check", rewardsEligible: true, tierPointsMultiplier: 1, stages: ["veg"] },
      { id: "2", label: "Wrong stage", rewardsEligible: true, tierPointsMultiplier: 1, stages: ["clone"] },
    ]);
    expect(list).toContain("Veg-only check");
    expect(list).not.toContain("Wrong stage");
  });

  it("maps unknown title to custom sentinel", () => {
    const opts = ["A", "B"];
    expect(scheduleTemplateTitleSelectValue("A", opts)).toBe("A");
    expect(scheduleTemplateTitleSelectValue("Z", opts)).toBe(SCHEDULE_TEMPLATE_TASK_CUSTOM);
  });
});
