import { METRC_EVALUATION_DEFAULT_PACKAGE_LICENSE } from "./metrcPackageEvaluationDefaults.js";

export type FinishChecklistPackageRef = {
  packageLabel: string;
  packageId: string | null;
  licenseNumber: string;
};

function readTrimmed(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function readPackageId(value: unknown): string | null {
  const s = readTrimmed(value);
  return s || null;
}

function extractLabelFromMetrcBody(body: unknown): string {
  if (!Array.isArray(body) || !body[0] || typeof body[0] !== "object") return "";
  const row = body[0] as { Label?: unknown; label?: unknown };
  return readTrimmed(row.Label ?? row.label);
}

function extractLicenseFromRecord(
  record: Record<string, unknown>,
  fallback: string,
): string {
  const direct = readTrimmed(record.licenseNumber);
  if (direct) return direct;

  const spreadsheetFields = record.spreadsheetFields;
  if (spreadsheetFields && typeof spreadsheetFields === "object") {
    const fromSheet = readTrimmed(
      (spreadsheetFields as { licenseNumber?: unknown }).licenseNumber,
    );
    if (fromSheet) return fromSheet;
  }

  const pkg = record.package;
  if (pkg && typeof pkg === "object" && !Array.isArray(pkg)) {
    const fromPkg = readTrimmed((pkg as { licenseNumber?: unknown }).licenseNumber);
    if (fromPkg) return fromPkg;
  }

  return fallback;
}

/** Extract label/license from a finish checklist response or request payload object. */
export function extractFinishChecklistPackageRef(root: unknown): FinishChecklistPackageRef | null {
  if (!root || typeof root !== "object") return null;
  const record = root as Record<string, unknown>;
  const licenseFallback = METRC_EVALUATION_DEFAULT_PACKAGE_LICENSE;

  const labelCandidates = [
    readTrimmed(record.packageLabel),
    readTrimmed(record.selectedPackageLabel),
    record.spreadsheetFields && typeof record.spreadsheetFields === "object"
      ? readTrimmed((record.spreadsheetFields as { tagNumber?: unknown }).tagNumber)
      : "",
    extractLabelFromMetrcBody(record.body),
    record.package && typeof record.package === "object" && !Array.isArray(record.package)
      ? readTrimmed((record.package as { packageLabel?: unknown }).packageLabel)
      : "",
    record.evaluationPackage && typeof record.evaluationPackage === "object"
      ? readTrimmed((record.evaluationPackage as { packageLabel?: unknown }).packageLabel)
      : "",
    record.packageResolvedBeforeMutation &&
    typeof record.packageResolvedBeforeMutation === "object"
      ? readTrimmed(
          (record.packageResolvedBeforeMutation as { packageLabel?: unknown }).packageLabel,
        )
      : "",
  ];

  const packageLabel = labelCandidates.find((label) => label.length > 0) ?? "";
  if (!packageLabel) return null;

  const packageId =
    readPackageId(record.packageId) ??
    (record.spreadsheetFields && typeof record.spreadsheetFields === "object"
      ? readPackageId((record.spreadsheetFields as { packageId?: unknown }).packageId)
      : null) ??
    (record.package && typeof record.package === "object" && !Array.isArray(record.package)
      ? readPackageId((record.package as { packageId?: unknown }).packageId)
      : null) ??
    (record.evaluationPackage && typeof record.evaluationPackage === "object"
      ? readPackageId((record.evaluationPackage as { packageId?: unknown }).packageId)
      : null);

  return {
    packageLabel,
    packageId,
    licenseNumber: extractLicenseFromRecord(record, licenseFallback),
  };
}

/**
 * Resolve package identity from finish checklist payloads (API response + stored request).
 * Walks nested responsePayload and requestPayload objects from the evaluation UI.
 */
export function extractFinishChecklistPackageRefFromPayloads(input: {
  responsePayload?: unknown;
  requestPayload?: unknown;
}): FinishChecklistPackageRef | null {
  const roots: unknown[] = [];

  if (input.responsePayload && typeof input.responsePayload === "object") {
    const response = input.responsePayload as Record<string, unknown>;
    roots.push(response);
    if (response.responsePayload) roots.push(response.responsePayload);
    if (response.requestPayload) roots.push(response.requestPayload);
  }

  if (input.requestPayload && typeof input.requestPayload === "object") {
    const request = input.requestPayload as Record<string, unknown>;
    roots.push(request);
    if (request.body) roots.push({ ...request, body: request.body });
    if (request.package) roots.push(request);
  }

  for (const root of roots) {
    const ref = extractFinishChecklistPackageRef(root);
    if (ref) return ref;
  }

  return null;
}
