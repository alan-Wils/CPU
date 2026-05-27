import { METRC_EVALUATION_DEFAULT_PACKAGE_LABEL } from "./metrcPackageEvaluationDefaults.js";
import { listMetrcPackageRequestLogs } from "../repositories/metrcPackageRepository.js";

export type EvaluationCreatedPackageRef = {
  packageLabel: string;
  createdAt: Date;
  createdViaTest: true;
};

function extractTagFromCreateBody(body: unknown): string | null {
  if (!Array.isArray(body) || !body[0] || typeof body[0] !== "object") return null;
  const row = body[0] as Record<string, unknown>;
  const tag = row.Tag ?? row.tag ?? row.Label ?? row.label;
  if (tag == null) return null;
  const s = String(tag).trim();
  return s || null;
}

function extractPackageLabelFromCreateLogPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;

  const fromBody = extractTagFromCreateBody(root.body);
  if (fromBody) return fromBody;

  const requestBody = root.requestBody;
  if (Array.isArray(requestBody)) {
    const fromRequest = extractTagFromCreateBody(requestBody);
    if (fromRequest) return fromRequest;
  }

  const packageTag = root.packageTag;
  if (packageTag != null) {
    const s = String(packageTag).trim();
    if (s) return s;
  }

  return null;
}

/** Newest-first package labels created by evaluation / sandbox create-test. */
export async function listEvaluationCreatedPackageRefs(
  companyId: string,
): Promise<EvaluationCreatedPackageRef[]> {
  const logs = await listMetrcPackageRequestLogs(companyId, 200);
  const byLabel = new Map<string, EvaluationCreatedPackageRef>();

  for (const log of logs) {
    if (log.action !== "create_test") continue;
    if (log.httpStatus != null && log.httpStatus >= 400) continue;
    try {
      const payload = JSON.parse(log.requestPayloadJson || "{}") as unknown;
      const label = extractPackageLabelFromCreateLogPayload(payload);
      if (!label || label === METRC_EVALUATION_DEFAULT_PACKAGE_LABEL) continue;
      const existing = byLabel.get(label);
      if (existing && existing.createdAt >= log.createdAt) continue;
      byLabel.set(label, {
        packageLabel: label,
        createdAt: log.createdAt,
        createdViaTest: true,
      });
    } catch {
      // ignore malformed log payloads
    }
  }

  return [...byLabel.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function listEvaluationCreatedPackageLabels(companyId: string): Promise<string[]> {
  return (await listEvaluationCreatedPackageRefs(companyId)).map((row) => row.packageLabel);
}
