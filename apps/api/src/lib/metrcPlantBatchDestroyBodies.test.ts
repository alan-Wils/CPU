import { describe, expect, it } from "vitest";
import { buildMetrcPlantBatchDestroyBody } from "./metrcPlantBatchDestroyBodies.js";

describe("buildMetrcPlantBatchDestroyBody", () => {
  it("builds METRC plant batch destroy payload with required waste fields", () => {
    const body = buildMetrcPlantBatchDestroyBody({
      plantBatchName: "AAA00080000196B000009999",
      count: 1,
      actualDate: "2026-05-28",
      wasteReasonName: "Contamination",
      reasonNote: "NexBatch sandbox evaluation destroy test",
    });

    expect(body).toEqual([
      {
        PlantBatch: "AAA00080000196B000009999",
        Count: 1,
        WasteReasonName: "Contamination",
        ReasonNote: "NexBatch sandbox evaluation destroy test",
        ActualDate: "2026-05-28",
      },
    ]);
    expect(body[0]).not.toHaveProperty("Name");
    expect(body[0]).not.toHaveProperty("Note");
  });

  it("includes optional waste method, weight, and unit when provided", () => {
    const body = buildMetrcPlantBatchDestroyBody({
      plantBatchName: "AAA00080000196B000009999",
      count: 2,
      actualDate: "2026-05-28",
      wasteReasonName: "Contamination",
      reasonNote: "Evaluation destroy with weight.",
      wasteMethodName: "Compost",
      wasteWeight: 12.5,
      wasteUnitOfMeasureName: "Grams",
    });

    expect(body[0]).toMatchObject({
      WasteMethodName: "Compost",
      WasteWeight: 12.5,
      WasteUnitOfMeasureName: "Grams",
    });
  });
});
