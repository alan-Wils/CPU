import { listMetrcPackageRequestLogs } from "../repositories/metrcPackageRepository.js";

function extractPackageLabelFromLogPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;

  const pkg = root.package;
  if (pkg && typeof pkg === "object" && !Array.isArray(pkg)) {
    const label = (pkg as { packageLabel?: unknown }).packageLabel;
    if (label != null) {
      const s = String(label).trim();
      if (s) return s;
    }
  }

  const body = root.body;
  if (Array.isArray(body) && body[0] && typeof body[0] === "object") {
    const label =
      (body[0] as { Label?: unknown; label?: unknown }).Label ??
      (body[0] as { label?: unknown }).label;
    if (label != null) {
      const s = String(label).trim();
      if (s) return s;
    }
  }

  return null;
}

function isSuccessfulFinishLog(input: {
  httpStatus: number | null;
  responsePayload: unknown;
}): boolean {
  if (input.httpStatus != null && input.httpStatus >= 400) return false;
  if (!input.responsePayload || typeof input.responsePayload !== "object") {
    return input.httpStatus == null || input.httpStatus < 400;
  }
  const response = input.responsePayload as Record<string, unknown>;
  if (response.alreadyFinished === true) return true;
  if (response.ok === true) return true;
  if (response.idempotent === true) return true;
  return input.httpStatus == null || input.httpStatus < 400;
}

/** Package labels successfully finished during evaluation (including idempotent already-finished). */
export async function listEvaluationFinishedPackageLabels(companyId: string): Promise<Set<string>> {
  const labels = new Set<string>();
  const logs = await listMetrcPackageRequestLogs(companyId, 200);

  for (const log of logs) {
    if (log.action !== "evaluation_finish") continue;
    try {
      const requestPayload = JSON.parse(log.requestPayloadJson || "{}") as unknown;
      const responsePayload = JSON.parse(log.responsePayloadJson || "{}") as unknown;
      if (!isSuccessfulFinishLog({ httpStatus: log.httpStatus, responsePayload })) continue;
      const label = extractPackageLabelFromLogPayload(requestPayload);
      if (label) labels.add(label);
    } catch {
      // ignore malformed log payloads
    }
  }

  return labels;
}
