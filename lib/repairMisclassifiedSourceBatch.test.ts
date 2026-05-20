import { describe, expect, it } from "vitest";
import {
  isMisclassifiedTerminalSourceBatch,
  repairMisclassifiedSourceBatchRow,
} from "./repairMisclassifiedSourceBatch";

describe("repairMisclassifiedSourceBatch", () => {
  it("repairs transferred Complete rows that still have weight", () => {
    const row = {
      id: "FF-SODI.012026-2058",
      type: "Fresh Frozen",
      status: "Complete",
      grams: 800,
      cultivationTransferId: "clxyz123",
    };
    expect(isMisclassifiedTerminalSourceBatch(row)).toBe(true);
    expect(repairMisclassifiedSourceBatchRow(row)).toMatchObject({
      id: "FF-SODI.012026-2058",
      status: "Available for Extraction",
    });
  });

  it("does not repair Used in Extraction", () => {
    const row = {
      id: "FF-X.012026-1",
      status: "Used in Extraction",
      grams: 500,
      manualTransferToExtraction: true,
    };
    expect(repairMisclassifiedSourceBatchRow(row)).toBeNull();
  });
});
