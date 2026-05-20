import { describe, expect, it } from "vitest";
import {
  getSourceAvailable,
  isActiveExtractionSourceBatch,
  isCompletedSourceBatch,
} from "./sourceBatchActive";

describe("sourceBatchActive", () => {
  it("treats Prisma-style zero-weight package as inactive", () => {
    const pkg = {
      id: "cmou3m4ju004bpk01j98w0ner",
      type: "Dry Trim",
      status: "Available for Extraction",
      grams: 0,
      amount: "",
    };
    expect(getSourceAvailable(pkg)).toBe(0);
    expect(isActiveExtractionSourceBatch(pkg)).toBe(false);
  });

  it("keeps legacy row with weight and no remainingAmount as active until completed", () => {
    const row = {
      id: "TRIM-abc-1234",
      type: "Dry Trim",
      weightLbs: 5,
      status: "Available for Extraction",
    };
    expect(getSourceAvailable(row)).toBe(5);
    expect(isActiveExtractionSourceBatch(row)).toBe(true);
  });

  it("marks used-in-extraction as completed", () => {
    expect(isCompletedSourceBatch({ status: "Used in Extraction" })).toBe(true);
  });

  it("does not treat transferred Complete rows with weight as completed", () => {
    const row = {
      id: "FF-GUAV.012026-1",
      type: "Fresh Frozen",
      status: "Complete",
      grams: 1200,
      weightLbs: 2.65,
      manualTransferToExtraction: true,
    };
    expect(isCompletedSourceBatch(row)).toBe(false);
    expect(isActiveExtractionSourceBatch(row)).toBe(true);
  });

  it("treats Complete with zero available as completed", () => {
    expect(
      isCompletedSourceBatch({
        status: "Complete",
        grams: 0,
        manualTransferToExtraction: true,
      }),
    ).toBe(true);
  });
});
