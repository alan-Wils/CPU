import { describe, expect, it } from "vitest";
import {
  buildEvaluationWorkbook,
  evaluationSpreadsheetFilename,
} from "./metrcEvaluationExport";
import { createEmptyEvaluationState } from "./metrcEvaluation";

describe("metrcEvaluationExport", () => {
  it("builds workbook with summary, history, and metadata sheets", () => {
    const state = createEmptyEvaluationState("company_test");
    const workbook = buildEvaluationWorkbook(state, {
      environment: "sandbox",
      activeFacilityLicense: "SF-SBX-CO-7-13402",
    });
    expect(workbook.SheetNames).toEqual(["Summary", "History", "Export Metadata"]);
  });

  it("uses dated filename", () => {
    expect(evaluationSpreadsheetFilename(new Date("2026-05-26T12:00:00.000Z"))).toBe(
      "NexBatch_METRC_Evaluation_2026-05-26.xlsx",
    );
  });
});
