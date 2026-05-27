import type { MetrcSpreadsheetFields } from "./metrcSpreadsheetFields.js";

export type FinishPackageIdempotentResult = "Already Finished" | "Package already finished";

export function isMetrcPackageAlreadyFinishedMessage(message: string | null | undefined): boolean {
  const normalized = String(message || "").trim().toLowerCase();
  return normalized.includes("already finished");
}

export function buildFinishPackageIdempotentSpreadsheetFields(input: {
  licenseNumber: string;
  packageId: string | null;
  packageLabel: string;
  requestBody: unknown;
  result: FinishPackageIdempotentResult;
}): MetrcSpreadsheetFields {
  const requestSent = (() => {
    try {
      return JSON.stringify(input.requestBody, null, 2);
    } catch {
      return String(input.requestBody ?? "");
    }
  })();

  return {
    resultCode: 200,
    licenseFacility: input.licenseNumber,
    idNumber: input.packageId ?? "",
    lastModifiedDate: new Date().toISOString().slice(0, 10),
    tagNumber: input.packageLabel,
    requestSent,
    minifiedJsonForSpreadsheet: JSON.stringify({
      Label: input.packageLabel,
      Result: input.result,
    }),
  };
}
