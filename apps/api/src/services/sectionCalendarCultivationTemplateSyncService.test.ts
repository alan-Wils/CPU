import { describe, expect, it } from "vitest";
import {
  buildCultivationTemplateOnlyFingerprint,
  buildCultivationTemplateSyncFingerprint,
} from "./sectionCalendarCultivationTemplateSyncService.js";

describe("buildCultivationTemplateSyncFingerprint", () => {
  it("is stable for the same template set and changes when templates change", () => {
    const base = {
      templates: [
        { id: "a", stage: "clone", daysFromStageStart: 0, title: "Start" },
        { id: "b", stage: "veg", daysFromStageStart: 3, title: "Move to Veg" },
      ],
      batchCount: 12,
      storeUpdatedAt: "2026-05-01T00:00:00.000Z",
    };
    const fp1 = buildCultivationTemplateOnlyFingerprint(base.templates);
    const fp2 = buildCultivationTemplateOnlyFingerprint(base.templates);
    expect(fp1).toBe(fp2);

    const fp3 = buildCultivationTemplateOnlyFingerprint([
      ...base.templates,
      { id: "c", stage: "flower", daysFromStageStart: 1, title: "Flip" },
    ]);
    expect(fp3).not.toBe(fp1);

    const hashed = buildCultivationTemplateSyncFingerprint(base);
    expect(hashed).not.toBe(fp1);
  });
});
