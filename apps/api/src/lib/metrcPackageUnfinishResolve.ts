import {
  LATEST_FINISH_RESULT_REASON,
  resolveFinishChecklistMetrcRequestPayload,
  resolveLatestFinishedEvaluationPackage,
  type LatestFinishedEvaluationPackage,
} from "./resolveLatestFinishedEvaluationPackage.js";
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

export const UNFINISH_FROM_FINISH_REASON = LATEST_FINISH_RESULT_REASON;

function readTrimmed(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function buildUnfinishPackageFromFinishResult(input: {
  finish: LatestFinishedEvaluationPackage;
  packageId?: string | null;
}): ResolvedMetrcEvaluationPackage {
  return {
    packageLabel: input.finish.packageLabel,
    packageId: input.packageId?.trim() || null,
    licenseNumber: input.finish.licenseNumber || METRC_EVALUATION_DEFAULT_PACKAGE_LICENSE,
    itemName: "",
    quantity: 0,
    unitOfMeasure: METRC_EVALUATION_DEFAULT_PACKAGE_UNIT,
    isFinished: true,
    raw: { Label: input.finish.packageLabel, IsFinished: true, Quantity: 0 },
    source: "from_package_finish_result",
    selectedReason: LATEST_FINISH_RESULT_REASON,
    createdViaTest: false,
    createdAt: null,
  };
}

/**
 * Resolves the package for Unfinish Package evaluation only.
 * Consumes the latest successful package_finish checklist — never generic resolvers or DB lookup.
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

  const metrcFinishRequest = resolveFinishChecklistMetrcRequestPayload(
    input.finishChecklistResponse,
    input.finishChecklistRequest,
  );

  const fromFinish = resolveLatestFinishedEvaluationPackage({
    responsePayload: input.finishChecklistResponse,
    requestPayload: metrcFinishRequest,
  });
  if (fromFinish) {
    return buildUnfinishPackageFromFinishResult({
      finish: fromFinish,
      packageId: input.packageId,
    });
  }

  const requestLabel =
    readTrimmed(input.packageLabel) || readTrimmed(input.selectedPackageLabel);
  if (requestLabel) {
    return buildUnfinishPackageFromFinishResult({
      finish: {
        packageLabel: requestLabel,
        licenseNumber:
          readTrimmed(input.licenseNumber) || METRC_EVALUATION_DEFAULT_PACKAGE_LICENSE,
        selectedReason: LATEST_FINISH_RESULT_REASON,
      },
      packageId: input.packageId,
    });
  }

  throw new MetrcEvaluationPackageNotFoundError(UNFINISH_NO_PACKAGE_MESSAGE);
}
