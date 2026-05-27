import {
  extractFinishChecklistPackageRefFromPayloads,
  type FinishChecklistPackageRef,
} from "./metrcFinishChecklistPackageRef.js";
import {
  METRC_EVALUATION_DEFAULT_PACKAGE_LICENSE,
  METRC_EVALUATION_DEFAULT_PACKAGE_UNIT,
} from "./metrcPackageEvaluationDefaults.js";
import {
  MetrcEvaluationPackageNotFoundError,
  type ResolvedMetrcEvaluationPackage,
} from "./metrcPackageResolve.js";

const UNFINISH_NO_PACKAGE_MESSAGE =
  "No finished evaluation package found. Run Finish Package first.";

export const UNFINISH_FROM_FINISH_REASON = "latest_finish_result";

function buildUnfinishPackageFromFinishResult(
  ref: FinishChecklistPackageRef,
): ResolvedMetrcEvaluationPackage {
  return {
    packageLabel: ref.packageLabel,
    packageId: ref.packageId,
    licenseNumber: ref.licenseNumber || METRC_EVALUATION_DEFAULT_PACKAGE_LICENSE,
    itemName: "",
    quantity: 0,
    unitOfMeasure: METRC_EVALUATION_DEFAULT_PACKAGE_UNIT,
    isFinished: true,
    raw: { Label: ref.packageLabel, IsFinished: true, Quantity: 0 },
    source: "from_package_finish_result",
    selectedReason: UNFINISH_FROM_FINISH_REASON,
    createdViaTest: false,
    createdAt: null,
  };
}

function readTrimmed(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

/**
 * Resolves the package for Unfinish Package evaluation only.
 * Reuses the latest successful package_finish checklist result — never the generic resolver.
 */
export async function resolveUnfinishPackageForEvaluation(input: {
  companyId: string;
  packageLabel?: string | null;
  selectedPackageLabel?: string | null;
  packageId?: string | null;
  licenseNumber?: string | null;
  finishChecklistResponse?: unknown;
  finishChecklistRequest?: unknown;
}): Promise<ResolvedMetrcEvaluationPackage> {
  void input.companyId;

  const requestLabel =
    readTrimmed(input.packageLabel) || readTrimmed(input.selectedPackageLabel);
  const requestId = readTrimmed(input.packageId);
  const requestLicense = readTrimmed(input.licenseNumber);

  if (requestLabel) {
    return buildUnfinishPackageFromFinishResult({
      packageLabel: requestLabel,
      packageId: requestId || null,
      licenseNumber: requestLicense || METRC_EVALUATION_DEFAULT_PACKAGE_LICENSE,
    });
  }

  const fromChecklist = extractFinishChecklistPackageRefFromPayloads({
    responsePayload: input.finishChecklistResponse,
    requestPayload: input.finishChecklistRequest,
  });
  if (fromChecklist) {
    return buildUnfinishPackageFromFinishResult({
      packageLabel: fromChecklist.packageLabel,
      packageId: fromChecklist.packageId ?? (requestId || null),
      licenseNumber: fromChecklist.licenseNumber || requestLicense || METRC_EVALUATION_DEFAULT_PACKAGE_LICENSE,
    });
  }

  throw new MetrcEvaluationPackageNotFoundError(UNFINISH_NO_PACKAGE_MESSAGE);
}
