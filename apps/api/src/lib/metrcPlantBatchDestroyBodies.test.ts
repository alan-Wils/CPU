import { describe, expect, it } from "vitest";
import { buildMetrcPlantBatchDestroyBody } from "./metrcPlantBatchDestroyBodies.js";

describe("buildMetrcPlantBatchDestroyBody", () => {
  it("builds METRC plant batch destroy payload", () => {
    const body = buildMetrcPlantBatchDestroyBody({
      plantBatchName: "AAA00080000196B000009999",
      count: 5,
      actualDate: "2026-05-28",
    });

    expect(body).toEqual([
      {
        PlantBatch: "AAA00080000196B000009999",
        Count: 5,
        ActualDate: "2026-05-28",
      },
    ]);
    expect(body[0]).not.toHaveProperty("Name");
  });

  it("includes optional note when provided", () => {
    const body = buildMetrcPlantBatchDestroyBody({
      plantBatchName: "AAA00080000196B000009999",
      count: 1,
      actualDate: "2026-05-28",
      note: "Sandbox evaluation destroy.",
    });

    expect((body[0] as { Note: string }).Note).toBe("Sandbox evaluation destroy.");
    expect(body[0]).not.toHaveProperty("Name");
  });
});
