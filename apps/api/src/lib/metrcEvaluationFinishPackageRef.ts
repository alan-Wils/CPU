import { listMetrcPackageRequestLogs } from "../repositories/metrcPackageRepository.js";
import { extractFinishChecklistPackageRefFromPayloads } from "./metrcFinishChecklistPackageRef.js";
export type EvaluationFinishPackageRef = {
  packageLabel: string;
  packageId: string | null;
  licenseNumber: string;
  finishedAt: Date;
};

/** Extract package label/id/license from a finish request or response payload. */
export function extractFinishPackageRefFromPayloads(input: {
  requestPayload?: unknown;
  responsePayload?: unknown;
  licenseFallback?: string | null;
}): Omit<EvaluationFinishPackageRef, "finishedAt"> | null {
  const ref = extractFinishChecklistPackageRefFromPayloads({
    requestPayload: input.requestPayload,
    responsePayload: input.responsePayload,
  });
  if (!ref) return null;
  return ref;
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
