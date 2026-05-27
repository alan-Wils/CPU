import { listMetrcPackageRequestLogs } from "../repositories/metrcPackageRepository.js";
import { METRC_EVALUATION_DEFAULT_PACKAGE_LICENSE } from "./metrcPackageEvaluationDefaults.js";

export type EvaluationFinishPackageRef = {
  packageLabel: string;
  packageId: string | null;
  licenseNumber: string;
  finishedAt: Date;
};

function readTrimmedString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function readPackageId(value: unknown): string | null {
  const s = readTrimmedString(value);
  return s || null;
}

function extractLabelFromMetrcBody(body: unknown): string | null {
  if (!Array.isArray(body) || !body[0] || typeof body[0] !== "object") return null;
  const row = body[0] as { Label?: unknown; label?: unknown };
  const label = readTrimmedString(row.Label ?? row.label);
  return label || null;
}

/** Extract package label/id/license from a finish request or response payload. */
export function extractFinishPackageRefFromPayloads(input: {
  requestPayload?: unknown;
  responsePayload?: unknown;
  licenseFallback?: string | null;
}): Omit<EvaluationFinishPackageRef, "finishedAt"> | null {
  const licenseFallback =
    readTrimmedString(input.licenseFallback) || METRC_EVALUATION_DEFAULT_PACKAGE_LICENSE;

  const tryRoot = (root: unknown): Omit<EvaluationFinishPackageRef, "finishedAt"> | null => {
    if (!root || typeof root !== "object") return null;
    const record = root as Record<string, unknown>;

    const evaluationPackage = record.evaluationPackage;
    if (evaluationPackage && typeof evaluationPackage === "object") {
      const pkg = evaluationPackage as Record<string, unknown>;
      const packageLabel = readTrimmedString(pkg.packageLabel);
      if (packageLabel) {
        return {
          packageLabel,
          packageId: readPackageId(pkg.packageId),
          licenseNumber:
            readTrimmedString(pkg.licenseNumber) || licenseFallback,
        };
      }
    }

    const topLabel = readTrimmedString(record.packageLabel);
    if (topLabel) {
      return {
        packageLabel: topLabel,
        packageId: readPackageId(record.packageId),
        licenseNumber: readTrimmedString(record.licenseNumber) || licenseFallback,
      };
    }

    const spreadsheetFields = record.spreadsheetFields;
    if (spreadsheetFields && typeof spreadsheetFields === "object") {
      const tagNumber = readTrimmedString(
        (spreadsheetFields as { tagNumber?: unknown }).tagNumber,
      );
      if (tagNumber) {
        return {
          packageLabel: tagNumber,
          packageId: readPackageId(
            (spreadsheetFields as { packageId?: unknown }).packageId ?? record.packageId,
          ),
          licenseNumber:
            readTrimmedString(
              (spreadsheetFields as { licenseNumber?: unknown }).licenseNumber,
            ) || licenseFallback,
        };
      }
    }

    const resolved = record.packageResolvedBeforeMutation;
    if (resolved && typeof resolved === "object") {
      const packageLabel = readTrimmedString(
        (resolved as { packageLabel?: unknown }).packageLabel,
      );
      if (packageLabel) {
        return {
          packageLabel,
          packageId: readPackageId((resolved as { packageId?: unknown }).packageId),
          licenseNumber: licenseFallback,
        };
      }
    }

    const pkg = record.package;
    if (pkg && typeof pkg === "object" && !Array.isArray(pkg)) {
      const packageLabel = readTrimmedString(
        (pkg as { packageLabel?: unknown }).packageLabel,
      );
      if (packageLabel) {
        return {
          packageLabel,
          packageId: readPackageId((pkg as { packageId?: unknown }).packageId),
          licenseNumber:
            readTrimmedString((pkg as { licenseNumber?: unknown }).licenseNumber) ||
            licenseFallback,
        };
      }
    }

    const bodyLabel = extractLabelFromMetrcBody(record.body);
    if (bodyLabel) {
      return {
        packageLabel: bodyLabel,
        packageId: null,
        licenseNumber: licenseFallback,
      };
    }

    return null;
  };

  const fromResponse = tryRoot(input.responsePayload);
  if (fromResponse) return fromResponse;

  return tryRoot(input.requestPayload);
}

export function isSuccessfulEvaluationFinishLog(input: {
  httpStatus: number | null;
  responsePayload: unknown;
}): boolean {
  if (input.responsePayload && typeof input.responsePayload === "object") {
    const response = input.responsePayload as Record<string, unknown>;
    if (response.alreadyFinished === true) return true;
    if (response.idempotent === true) return true;
    if (response.ok === true) return true;
  }
  return input.httpStatus == null || input.httpStatus < 400;
}

/** Latest successful evaluation_finish log (newest first). */
export async function getLatestEvaluationFinishPackageRef(
  companyId: string,
): Promise<EvaluationFinishPackageRef | null> {
  const logs = await listMetrcPackageRequestLogs(companyId, 200);

  for (const log of logs) {
    if (log.action !== "evaluation_finish") continue;
    try {
      const requestPayload = JSON.parse(log.requestPayloadJson || "{}") as unknown;
      const responsePayload = JSON.parse(log.responsePayloadJson || "{}") as unknown;
      if (!isSuccessfulEvaluationFinishLog({ httpStatus: log.httpStatus, responsePayload })) {
        continue;
      }

      const extracted = extractFinishPackageRefFromPayloads({
        requestPayload,
        responsePayload,
      });
      if (!extracted?.packageLabel) continue;

      return {
        ...extracted,
        finishedAt: log.createdAt,
      };
    } catch {
      // ignore malformed log payloads
    }
  }

  return null;
}
