import { describe, expect, it } from "vitest";
import {
  addDaysYmd,
  anchorYmdForTemplateStage,
  cultivationTemplateDedupeKey,
  parseCultivationTemplateDedupeKey,
  resolveStageAnchorsYmd,
} from "@/lib/cultivationSectionScheduleTemplates";
import { TASK_MOVE_TO_FLOWER } from "@/lib/cultivationMetrcWorkflow";

describe("cultivationSectionScheduleTemplates", () => {
  it("parses dedupe keys", () => {
    const k = cultivationTemplateDedupeKey("tpl1", "BATCH-A");
    expect(parseCultivationTemplateDedupeKey(k)).toEqual({ templateId: "tpl1", batchId: "BATCH-A" });
    expect(parseCultivationTemplateDedupeKey("nope")).toBeNull();
  });

  it("resolves earliest veg and flower anchors from logs", () => {
    const bid = "batch-1";
    const logs = [
      { batch: bid, task: "Move to Veg / Assign Plant Tags", data: { stageMoveDate: "2026-02-10" } },
      { batch: bid, task: "Move to Veg / Assign Plant Tags", data: { stageMoveDate: "2026-02-05" } },
      { batch: bid, task: TASK_MOVE_TO_FLOWER, data: { stageMoveDate: "2026-03-01" } },
      { batch: bid, task: TASK_MOVE_TO_FLOWER, data: { stageMoveDate: "2026-02-28" } },
      { batch: "other", task: TASK_MOVE_TO_FLOWER, data: { stageMoveDate: "2026-01-01" } },
    ];
    const a = resolveStageAnchorsYmd(bid, "2026-01-01", logs);
    expect(a.clone).toBe("2026-01-01");
    expect(a.veg).toBe("2026-02-05");
    expect(a.flower).toBe("2026-02-28");
    expect(anchorYmdForTemplateStage("clone", a)).toBe("2026-01-01");
    expect(anchorYmdForTemplateStage("veg", a)).toBe("2026-02-05");
    expect(anchorYmdForTemplateStage("flower", a)).toBe("2026-02-28");
  });

  it("addDaysYmd rolls month in UTC zone", () => {
    expect(addDaysYmd("2026-01-30", 5, "UTC")).toBe("2026-02-04");
  });
});
