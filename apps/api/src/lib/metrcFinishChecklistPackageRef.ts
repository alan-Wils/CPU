import {
  resolveFinishChecklistMetrcRequestPayload,
  resolveLatestFinishedEvaluationPackage,
} from "./resolveLatestFinishedEvaluationPackage.js";

export type FinishChecklistPackageRef = {
  packageLabel: string;
  packageId: string | null;
  licenseNumber: string;
};

/** @deprecated Use resolveLatestFinishedEvaluationPackage */
export function extractFinishChecklistPackageRef(root: unknown): FinishChecklistPackageRef | null {
  const resolved = resolveLatestFinishedEvaluationPackage({
    responsePayload: root,
    requestPayload: null,
  });
  if (!resolved) return null;
  return { ...resolved, packageId: null };
}

export function extractFinishChecklistPackageRefFromPayloads(input: {
  responsePayload?: unknown;
  requestPayload?: unknown;
}): FinishChecklistPackageRef | null {
  const metrcRequest = resolveFinishChecklistMetrcRequestPayload(
    input.responsePayload,
    input.requestPayload,
  );
  const resolved = resolveLatestFinishedEvaluationPackage({
    responsePayload: input.responsePayload,
    requestPayload: metrcRequest,
  });
  if (!resolved) return null;
  return { ...resolved, packageId: null };
}
