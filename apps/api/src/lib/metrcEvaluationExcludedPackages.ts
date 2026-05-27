import { METRC_EVALUATION_DEFAULT_PACKAGE_LABEL } from "./metrcPackageEvaluationDefaults.js";
import { listMetrcPackageRequestLogs } from "../repositories/metrcPackageRepository.js";

const EVALUATION_PACKAGE_MUTATION_ACTIONS = new Set([
  "evaluation_adjust",
  "evaluation_finish",
  "evaluation_unfinish",
]);

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
    const label = (body[0] as { Label?: unknown; label?: unknown }).Label ?? (body[0] as { label?: unknown }).label;
    if (label != null) {
      const s = String(label).trim();
      if (s) return s;
    }
  }

  if (body && typeof body === "object" && !Array.isArray(body)) {
    const label = (body as { packageLabel?: unknown }).packageLabel;
    if (label != null) {
      const s = String(label).trim();
      if (s) return s;
    }
  }

  return null;
}

/** Package labels consumed by evaluation adjust/finish/unfinish runs — exclude from transfers. */
export async function listEvaluationMutationPackageLabels(companyId: string): Promise<string[]> {
  const labels = new Set<string>();
  labels.add(METRC_EVALUATION_DEFAULT_PACKAGE_LABEL);

  const logs = await listMetrcPackageRequestLogs(companyId, 200);
  for (const log of logs) {
    if (!EVALUATION_PACKAGE_MUTATION_ACTIONS.has(log.action)) continue;
    try {
      const payload = JSON.parse(log.requestPayloadJson || "{}") as unknown;
      const label = extractPackageLabelFromLogPayload(payload);
      if (label) labels.add(label);
    } catch {
      // ignore malformed log payloads
    }
  }

  return [...labels].sort();
}
