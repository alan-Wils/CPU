import { getLatestEvaluationFinishPackageRef } from "./metrcEvaluationFinishPackageRef.js";
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

function buildUnfinishPackageFromFinishResult(input: {
  packageLabel: string;
  packageId: string | null;
  licenseNumber: string;
  selectedReason: string;
}): ResolvedMetrcEvaluationPackage {
  return {
    packageLabel: input.packageLabel,
    packageId: input.packageId,
    licenseNumber: input.licenseNumber || METRC_EVALUATION_DEFAULT_PACKAGE_LICENSE,
    itemName: "",
    quantity: 0,
    unitOfMeasure: METRC_EVALUATION_DEFAULT_PACKAGE_UNIT,
    isFinished: true,
    raw: { Label: input.packageLabel, IsFinished: true, Quantity: 0 },
    source: "from_package_finish_result",
    selectedReason: input.selectedReason,
    createdViaTest: false,
    createdAt: null,
  };
}

/**
 * Resolves the package for Unfinish Package evaluation only.
 * Uses the finish checklist / request label directly — never the generic evaluation resolver.
 */
export async function resolveUnfinishPackageForEvaluation(input: {
  companyId: string;
  packageLabel?: string | null;
  packageId?: string | null;
  licenseNumber?: string | null;
}): Promise<ResolvedMetrcEvaluationPackage> {
  const requestLabel = String(input.packageLabel ?? "").trim();
  const requestId = String(input.packageId ?? "").trim();
  const licenseNumber =
    String(input.licenseNumber ?? "").trim() || METRC_EVALUATION_DEFAULT_PACKAGE_LICENSE;

  if (requestLabel) {
    return buildUnfinishPackageFromFinishResult({
      packageLabel: requestLabel,
      packageId: requestId || null,
      licenseNumber,
      selectedReason: "package_label_from_finish_checklist_result",
    });
  }

  const latestFinish = await getLatestEvaluationFinishPackageRef(input.companyId);
  if (latestFinish?.packageLabel) {
    return buildUnfinishPackageFromFinishResult({
      packageLabel: latestFinish.packageLabel,
      packageId: latestFinish.packageId ?? (requestId || null),
      licenseNumber: latestFinish.licenseNumber || licenseNumber,
      selectedReason: "from_latest_package_finish_log",
    });
  }

  throw new MetrcEvaluationPackageNotFoundError(UNFINISH_NO_PACKAGE_MESSAGE);
}
