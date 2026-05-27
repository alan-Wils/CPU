import { METRC_EVALUATION_DEFAULT_PACKAGE_LICENSE } from "./metrcPackageEvaluationDefaults.js";

export const LATEST_FINISH_RESULT_REASON = "latest_finish_result";

export type LatestFinishedEvaluationPackage = {
  packageLabel: string;
  licenseNumber: string;
  selectedReason: typeof LATEST_FINISH_RESULT_REASON;
};

function readTrimmed(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function collectRecordRoots(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const roots: Record<string, unknown>[] = [record];
  if (record.responsePayload && typeof record.responsePayload === "object") {
    roots.push(record.responsePayload as Record<string, unknown>);
  }
  return roots;
}

function extractLabelFromMetrcBody(body: unknown): string {
  if (!Array.isArray(body) || !body[0] || typeof body[0] !== "object") return "";
  const row = body[0] as { Label?: unknown; label?: unknown };
  return readTrimmed(row.Label ?? row.label);
}

function extractPackageLabel(
  responsePayload: unknown,
  requestPayload: unknown,
): string {
  const responseRoots = collectRecordRoots(responsePayload);
  const requestRoots = collectRecordRoots(requestPayload);

  for (const root of responseRoots) {
    const label = readTrimmed(root.packageLabel);
    if (label) return label;
  }

  for (const root of responseRoots) {
    const label = readTrimmed(root.selectedPackageLabel);
    if (label) return label;
  }

  for (const root of responseRoots) {
    const spreadsheetFields = root.spreadsheetFields;
    if (spreadsheetFields && typeof spreadsheetFields === "object") {
      const label = readTrimmed((spreadsheetFields as { tagNumber?: unknown }).tagNumber);
      if (label) return label;
    }
  }

  for (const root of requestRoots) {
    const label = extractLabelFromMetrcBody(root.body);
    if (label) return label;
  }

  for (const root of requestRoots) {
    const pkg = root.package;
    if (pkg && typeof pkg === "object" && !Array.isArray(pkg)) {
      const label = readTrimmed((pkg as { packageLabel?: unknown }).packageLabel);
      if (label) return label;
    }
  }

  return "";
}

function extractLicenseNumber(
  responsePayload: unknown,
  requestPayload: unknown,
): string {
  const responseRoots = collectRecordRoots(responsePayload);
  const requestRoots = collectRecordRoots(requestPayload);

  for (const root of responseRoots) {
    const license = readTrimmed(root.licenseNumber);
    if (license) return license;
  }

  for (const root of requestRoots) {
    const license = readTrimmed(root.licenseNumber);
    if (license) return license;
  }

  for (const root of requestRoots) {
    const pkg = root.package;
    if (pkg && typeof pkg === "object" && !Array.isArray(pkg)) {
      const license = readTrimmed((pkg as { licenseNumber?: unknown }).licenseNumber);
      if (license) return license;
    }
  }

  return METRC_EVALUATION_DEFAULT_PACKAGE_LICENSE;
}

/** METRC mutation request from a finish API response (not the evaluation UI wrapper). */
export function resolveFinishChecklistMetrcRequestPayload(
  responsePayload: unknown,
  evaluationRequestPayload?: unknown,
): unknown {
  if (responsePayload && typeof responsePayload === "object") {
    const nested = (responsePayload as Record<string, unknown>).requestPayload;
    if (nested) return nested;
  }
  return evaluationRequestPayload;
}

/**
 * Latest successful package_finish checklist result.
 * Does not query packages, sync, or generic evaluation resolvers.
 */
export function resolveLatestFinishedEvaluationPackage(input: {
  responsePayload?: unknown;
  requestPayload?: unknown;
}): LatestFinishedEvaluationPackage | null {
  const metrcRequest = resolveFinishChecklistMetrcRequestPayload(
    input.responsePayload,
    input.requestPayload,
  );

  const packageLabel = extractPackageLabel(input.responsePayload, metrcRequest);
  if (!packageLabel) return null;

  return {
    packageLabel,
    licenseNumber: extractLicenseNumber(input.responsePayload, metrcRequest),
    selectedReason: LATEST_FINISH_RESULT_REASON,
  };
}
