import { listMetrcPackageRequestLogs } from "../repositories/metrcPackageRepository.js";
import {
  extractFinishPackageRefFromPayloads,
  isSuccessfulEvaluationFinishLog,
} from "./metrcEvaluationFinishPackageRef.js";

/** Package labels successfully finished during evaluation (including idempotent already-finished). */
export async function listEvaluationFinishedPackageLabels(companyId: string): Promise<Set<string>> {
  const labels = new Set<string>();
  const logs = await listMetrcPackageRequestLogs(companyId, 200);

  for (const log of logs) {
    if (log.action !== "evaluation_finish") continue;
    try {
      const requestPayload = JSON.parse(log.requestPayloadJson || "{}") as unknown;
      const responsePayload = JSON.parse(log.responsePayloadJson || "{}") as unknown;
      if (!isSuccessfulEvaluationFinishLog({ httpStatus: log.httpStatus, responsePayload })) {
        continue;
      }
      const ref = extractFinishPackageRefFromPayloads({ requestPayload, responsePayload });
      if (ref?.packageLabel) labels.add(ref.packageLabel);
    } catch {
      // ignore malformed log payloads
    }
  }

  return labels;
}
