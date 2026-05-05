"use client";

import { useEffect, useState } from "react";
import Nav from "@/components/Nav";
import PageAccessGate from "@/components/PageAccessGate";
import { store } from "@/lib/store";
import {
  displayNameFromLogActor,
  getAuthDisplayName,
  getAuthUser,
} from "@/lib/auth";
import {
  hydrateTaskLogsFromApi,
  loadBackendStore,
  saveBackendStore,
} from "@/lib/backendStore";
import {
  loadPackagingBatches,
  createPackagingBatch,
  updatePackagingBatch,
  deletePackagingBatchRecord,
} from "@/lib/packagingApi";
import { loadExtractionBatches } from "@/lib/extractionApi";
import { createLog } from "@/lib/logsApi";

const PACKAGING_TASKS = [
  "Label",
  "Package",
  "Label Package",
  "Test",
  "Relabel",
  "Finish Package",
];

const TEST_TYPES = [
  "Metals",
  "Microbial",
  "Pesticides",
  "Residual Solvents",
  "Homogenous",
];

function asArray(value: any) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function isReadyPackagingBatch(batch: any) {
  const status = lower(batch?.status);
  return (
    isExtractionPackagingBatch(batch) &&
    status !== "fully packaged" &&
    status !== "packaging complete" &&
    status !== "complete" &&
    status !== "in progress" &&
    lower(batch?.sourceArea) !== "packaging"
  );
}

function isInProgressPackageSet(batch: any) {
  const status = lower(batch?.status);
  return (
    isExtractionPackagingBatch(batch) &&
    (status === "in progress" ||
      status === "partially packaged" ||
      lower(batch?.sourceArea) === "packaging") &&
    status !== "packaging complete" &&
    status !== "complete"
  );
}

function isCompletedPackageSet(batch: any) {
  const status = lower(batch?.status);
  return (
    isExtractionPackagingBatch(batch) &&
    (status === "packaging complete" ||
      status === "complete" ||
      status === "fully packaged")
  );
}

function num(value: any) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isBlank(value: any) {
  return String(value ?? "").trim() === "";
}

function lower(value: any) {
  return String(value || "").toLowerCase();
}

/** Finished extraction lots may set `marketBatchCode` (e.g. ABCD.050426); otherwise use internal id. */
function packagingBatchPublicLabel(batch: any): string {
  const code = String(batch?.marketBatchCode ?? "").trim();
  if (code) return code;
  return String(batch?.id ?? "—");
}

/** Comma-separated source package tags (FF-…), not the extraction run id. */
function packagingSourceMaterialLabel(batch: any): string {
  const raw = String(batch?.source ?? "").trim();
  if (raw) return raw;
  if (Array.isArray(batch?.extractionSources) && batch.extractionSources.length > 0) {
    return batch.extractionSources
      .map((r: any) => String(r?.sourceId ?? "").trim())
      .filter(Boolean)
      .join(", ");
  }
  const sb = batch?.sourceBatchId;
  if (sb && sb !== batch?.id) return String(sb);
  return "—";
}

function packagingBlendDescription(batch: any): string {
  return String(batch?.sourceBlendLabel ?? "").trim();
}

/** Fill packaging view from the linked extraction run (AI title, blend label, source tags). */
function mergePackagingRowWithExtraction(batch: any, exById: Map<string, any>) {
  const exId = String(batch.extractionBatchId || batch.sourceBatchId || batch.id || "").trim();
  if (!exId) return batch;
  const ex = exById.get(exId);
  if (!ex || typeof ex !== "object") return batch;
  const next = { ...batch };
  if (!String(next.marketBatchCode || "").trim() && ex.marketBatchCode) {
    next.marketBatchCode = ex.marketBatchCode;
  }
  if (!String(next.sourceBlendLabel || "").trim() && ex.sourceBlendLabel) {
    next.sourceBlendLabel = ex.sourceBlendLabel;
  }
  if (!String(next.sourceBlendLabel || "").trim() && Array.isArray(ex.sources)) {
    const derived = [
      ...new Set(
        ex.sources
          .map((r: any) => String(r?.name || "").trim())
          .filter(Boolean)
      ),
    ].join(" · ");
    if (derived) next.sourceBlendLabel = derived;
  }
  if (!String(next.source || "").trim() && ex.source) {
    next.source = ex.source;
  }
  if (
    Array.isArray(ex.sources) &&
    (!Array.isArray(next.extractionSources) || next.extractionSources.length === 0)
  ) {
    next.extractionSources = ex.sources;
  }
  const exName = String(ex.name || "").trim();
  const exProduct = String(ex.productType || "").trim();
  if (exName && exProduct && exName !== exProduct) {
    next.name = exName;
  }
  return next;
}

function isFlowerBatch(batch: any) {
  const text = `${lower(batch?.id)} ${lower(batch?.name)} ${lower(
    batch?.type
  )} ${lower(batch?.productType)} ${lower(batch?.materialType)}`;

  return (
    text.includes("a grade flower") ||
    text.includes("dry flower") ||
    text.includes("finished flower") ||
    text.includes("flower output") ||
    text.includes("popcorn") ||
    lower(batch?.type) === "a grade flower" ||
    lower(batch?.productType) === "a grade flower" ||
    lower(batch?.type) === "dry flower" ||
    lower(batch?.productType) === "dry flower" ||
    lower(batch?.type) === "popcorn" ||
    lower(batch?.productType) === "popcorn"
  );
}

function isExtractionPackagingBatch(batch: any) {
  const text = `${lower(batch?.id)} ${lower(batch?.name)} ${lower(
    batch?.type
  )} ${lower(batch?.productType)}`;

  if (isFlowerBatch(batch)) return false;

  return (
    text.includes("live resin") ||
    text.includes("cured wax") ||
    text.includes("wax") ||
    text.includes("oil") ||
    text.includes("dabbable") ||
    text.includes("gummy") ||
    text.includes("gummies") ||
    text.startsWith("ext") ||
    text.includes("ext-") ||
    lower(batch?.sourceArea) === "packaging"
  );
}

function getPackageOptions(batch: any) {
  const type = String(
    batch?.name || batch?.type || batch?.productType || ""
  ).toLowerCase();

  if (type.includes("live resin oil")) {
    return ["1 Gram Cartridges", "1 Gram Disposables"];
  }

  if (type.includes("live resin dabbable")) {
    return ["1 Gram Units", "2 Gram Units", "4 Gram Units"];
  }

  if (type.includes("cured wax")) {
    return ["2 Gram Units", "4 Gram Units"];
  }

  if (type.includes("gummy") || type.includes("gummies")) {
    return ["Blueberry", "Peach", "Watermelon"];
  }

  return ["1 Gram Units"];
}

function getUnitSizeFromPackageType(packageType: string) {
  const text = String(packageType || "").toLowerCase();

  if (text.includes("1 gram")) return 1;
  if (text.includes("2 gram")) return 2;
  if (text.includes("4 gram")) return 4;

  return 0;
}

function getTerpsGrams(batch: any) {
  return (
    num(batch?.extraTerpsGrams) ||
    num(batch?.terpsGrams) ||
    num(batch?.terpGrams) ||
    num(batch?.addedTerpsGrams)
  );
}

function getPackageableGrams(batch: any) {
  const explicitPackageable =
    num(batch?.packageableGrams) ||
    num(batch?.availableToPackageGrams) ||
    num(batch?.availableForPackagingGrams);

  if (explicitPackageable > 0) return explicitPackageable;

  const finalOilOnly = num(batch?.finalOilGrams);
  if (finalOilOnly > 0) return finalOilOnly;

  const finalBulkOnly = num(batch?.finalBulkGrams);
  if (finalBulkOnly > 0) return finalBulkOnly;

  const totalFinal = num(batch?.totalFinalGrams);
  if (totalFinal > 0) {
    return Math.max(totalFinal - getTerpsGrams(batch), 0);
  }

  return 0;
}

function makePackageSetId(sourceBatchId: string, existingSets: any[]) {
  const date = new Date();
  const stamp = `${String(date.getMonth() + 1).padStart(2, "0")}${String(
    date.getDate()
  ).padStart(2, "0")}${String(date.getFullYear()).slice(-2)}`;

  const count =
    existingSets.filter((b: any) => b.sourceBatchId === sourceBatchId).length + 1;

  return `${sourceBatchId}-PKG-${count}-${stamp}`;
}

function hasPackagingWriteAccess() {
  const role = String(getAuthUser()?.role || "").toUpperCase();
  return role !== "VIEW_ONLY" && ["PACKAGING", "MANAGER", "ADMIN", "OWNER"].includes(role);
}

export default function Packaging() {
  const s: any = store;

  if (!s.packagingBatches) s.packagingBatches = [];
  if (!s.inProgressPackagingBatches) s.inProgressPackagingBatches = [];
  if (!s.completedPackagingBatches) s.completedPackagingBatches = [];
  if (!s.logs) s.logs = [];

  const [canDeleteRecords, setCanDeleteRecords] = useState(false);
  const [canWriteRecords, setCanWriteRecords] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const role = String(getAuthUser()?.role || "").toUpperCase();
    setCanDeleteRecords(role === "OWNER" || role === "ADMIN" || role === "MANAGER");
    setCanWriteRecords(hasPackagingWriteAccess());

    let active = true;

    async function loadPackagingData() {
      try {
        await loadBackendStore();
        await hydrateTaskLogsFromApi();

        const [realPackagingBatches, extractionList] = await Promise.all([
          loadPackagingBatches().then(asArray),
          loadExtractionBatches()
            .then(asArray)
            .catch((err) => {
              console.warn("Packaging: could not load extractions for label merge:", err);
              return [];
            }),
        ]);

        if (!active) return;

        const exById = new Map<string, any>(
          extractionList
            .map((e: any): [string, any] => [String(e?.id || "").trim(), e])
            .filter(([k]: [string, any]) => k)
        );
        const mergeEx = (b: any) => mergePackagingRowWithExtraction(b, exById);

        s.packagingBatches = realPackagingBatches.filter(isReadyPackagingBatch).map(mergeEx);
        s.inProgressPackagingBatches = realPackagingBatches
          .filter(isInProgressPackageSet)
          .map(mergeEx);
        s.completedPackagingBatches = realPackagingBatches
          .filter(isCompletedPackageSet)
          .map(mergeEx);

        setRefresh((n) => n + 1);
      } catch (error) {
        console.error("Could not load real packaging table:", error);

        try {
          await loadBackendStore();
          await hydrateTaskLogsFromApi();
          if (active) setRefresh((n) => n + 1);
        } catch (backupError) {
          console.error("Could not load backend packaging store:", backupError);
        }
      }
    }

    loadPackagingData();

    const interval = setInterval(() => {
      loadPackagingData();
    }, 5000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  function getLoggedBy() {
    const user: any = getAuthUser();

    return {
      userId: user?.id || user?.userId || "",
      username: getAuthDisplayName(),
      email: user?.email || undefined,
      role: user?.role || "",
    };
  }

  function formatLoggedBy(loggedBy: any) {
    if (!loggedBy) return "Unknown User";

    const username = displayNameFromLogActor(loggedBy);
    const role = loggedBy.role ? ` (${loggedBy.role})` : "";

    return `${username}${role}`;
  }

  async function addBackendLog(log: any) {
    s.logs.unshift(log);

    try {
      await createLog({
        area: log.area,
        batch: log.batch,
        task: log.task,
        output: log.output,
        data: log.data,
      });
    } catch (error) {
      console.error("Could not save packaging log to backend:", error);
    }
  }

  function forceRefresh() {
    saveBackendStore().catch((error) => {
      console.error("Could not save backend packaging store:", error);
    });

    setRefresh((n) => n + 1);
  }

  async function saveRealPackagingBatch(batch: any) {
    if (!batch?.id || !canWriteRecords) return;

    try {
      await createPackagingBatch(batch);
    } catch (error) {
      console.error("Could not save packaging batch to real table:", error);
      showNotice(
        "Backend Save Warning",
        "Packaging was saved locally, but it did not save to the real PackagingBatch table.",
        "Check the backend terminal for errors."
      );
    }
  }

  async function updateRealPackagingBatch(batch: any) {
    if (!batch?.id || !canWriteRecords) return;

    try {
      const updated = await updatePackagingBatch(batch.id, batch);
      if (updated && typeof updated === "object") {
        Object.assign(batch, updated);
      }
    } catch (error) {
      console.error("Could not update packaging batch in real table:", error);
      showNotice(
        "Backend Save Warning",
        "Packaging was updated locally, but the real PackagingBatch table update failed.",
        "Check the backend terminal for errors."
      );
    }
  }

  function getFinalGrams(batch: any) {
    return getPackageableGrams(batch);
  }

  function getPackagedGrams(batch: any) {
    return num(batch?.packagedGrams);
  }

  function getRemainingGrams(batch: any) {
    return Math.max(getPackageableGrams(batch) - getPackagedGrams(batch), 0);
  }

  function getPackageSetPackagedGrams(batch: any) {
    return (batch?.packagingLogs || []).reduce(
      (total: number, log: any) => total + num(log?.packagedGrams),
      0
    );
  }

  function getTotalLaborMinutes(batch: any) {
    return (batch?.taskLogs || []).reduce(
      (total: number, log: any) => total + num(log?.totalLaborMinutes),
      0
    );
  }

  const activePackagingBatches = s.packagingBatches
    .filter(isExtractionPackagingBatch)
    .filter((b: any) => getRemainingGrams(b) > 0);

  const inProgressPackagingBatches =
    s.inProgressPackagingBatches.filter(isExtractionPackagingBatch);

  const completedPackagingBatches =
    s.completedPackagingBatches.filter(isExtractionPackagingBatch);

  const [selected, setSelected] = useState<any>(
    activePackagingBatches[0] || null
  );
  const [selectedInProgress, setSelectedInProgress] = useState<any>(
    inProgressPackagingBatches[0] || null
  );

  const [packageType, setPackageType] = useState(
    getPackageOptions(activePackagingBatches[0] || null)[0] || ""
  );
  const [units, setUnits] = useState("");
  const [packagedBy, setPackagedBy] = useState("");
  const [notes, setNotes] = useState("");

  const [taskType, setTaskType] = useState(PACKAGING_TASKS[0]);
  const [selectedTestTypes, setSelectedTestTypes] = useState<string[]>([]);
  const [taskPeople, setTaskPeople] = useState("");
  const [taskTime, setTaskTime] = useState("");
  const [taskNotes, setTaskNotes] = useState("");
  const [isSavingTask, setIsSavingTask] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");

  const [notificationModal, setNotificationModal] = useState<{
    open: boolean;
    title: string;
    message: string;
    details?: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm?: (() => void) | null;
  }>({
    open: false,
    title: "",
    message: "",
    details: "",
    confirmText: "",
    cancelText: "",
    onConfirm: null,
  });

  const [packageChoiceModal, setPackageChoiceModal] = useState<{
    open: boolean;
    sourceBatch: any | null;
    packagingLog: any | null;
    matchingSets: any[];
    selectedPackageSetId: string;
  }>({
    open: false,
    sourceBatch: null,
    packagingLog: null,
    matchingSets: [],
    selectedPackageSetId: "",
  });

  const [taskHistoryModal, setTaskHistoryModal] = useState<{
    open: boolean;
    batch: any | null;
  }>({
    open: false,
    batch: null,
  });

  function showNotice(title: string, message: string, details = "") {
    setNotificationModal({
      open: true,
      title,
      message,
      details,
      confirmText: "OK",
      cancelText: "",
      onConfirm: null,
    });
  }

  function showConfirm(
    title: string,
    message: string,
    onConfirm: () => void,
    details = ""
  ) {
    setNotificationModal({
      open: true,
      title,
      message,
      details,
      confirmText: "Confirm",
      cancelText: "Cancel",
      onConfirm,
    });
  }

  function closeNotificationModal() {
    setNotificationModal({
      open: false,
      title: "",
      message: "",
      details: "",
      confirmText: "",
      cancelText: "",
      onConfirm: null,
    });
  }

  function showSyncMessageNotice(message: string) {
    setSyncMessage(message);
    window.setTimeout(() => setSyncMessage(""), 2200);
  }

  function confirmNotificationModal() {
    const action = notificationModal.onConfirm;
    closeNotificationModal();

    if (action) {
      action();
    }
  }

  function requireField(value: any, label: string) {
    if (isBlank(value)) {
      showNotice("Missing Required Field", `${label} is required.`);
      return false;
    }

    return true;
  }

  function openTaskHistory(batch: any) {
    setTaskHistoryModal({
      open: true,
      batch,
    });
  }

  function closeTaskHistory() {
    setTaskHistoryModal({
      open: false,
      batch: null,
    });
  }

  function closePackageChoiceModal() {
    setPackageChoiceModal({
      open: false,
      sourceBatch: null,
      packagingLog: null,
      matchingSets: [],
      selectedPackageSetId: "",
    });
  }

  function selectBatch(batch: any) {
    setSelected(batch);
    setPackageType(getPackageOptions(batch)[0] || "");
    setUnits("");
    setPackagedBy("");
    setNotes("");
  }

  function selectInProgressBatch(batch: any) {
    setSelectedInProgress(batch);
    setTaskType(PACKAGING_TASKS[0]);
    setSelectedTestTypes([]);
    setTaskPeople("");
    setTaskTime("");
    setTaskNotes("");
  }

  function toggleTestType(type: string) {
    setSelectedTestTypes((current) => {
      if (current.includes(type)) {
        return current.filter((item) => item !== type);
      }

      return [...current, type];
    });
  }

  function getSelectedTestTypesText() {
    return selectedTestTypes.length > 0 ? selectedTestTypes.join(", ") : "";
  }

  function getThisEntryGrams() {
    const unitSize = getUnitSizeFromPackageType(packageType);
    return num(units) * unitSize;
  }

  function getInProgressSetsForSource(sourceBatchId: string) {
    return s.inProgressPackagingBatches.filter(
      (b: any) => b.sourceBatchId === sourceBatchId
    );
  }

  function syncSourceRemainingToOpenPackageSets(sourceBatch: any) {
    const remaining = getRemainingGrams(sourceBatch);

    s.inProgressPackagingBatches = s.inProgressPackagingBatches.map((b: any) => {
      if (b.sourceBatchId === sourceBatch.id) {
        return {
          ...b,
          sourcePackageableGrams: getPackageableGrams(sourceBatch),
          sourceRemainingGrams: remaining,
        };
      }

      return b;
    });
  }

  function createPackageSet(sourceBatch: any, firstLog: any) {
    const allSets = [
      ...s.inProgressPackagingBatches,
      ...s.completedPackagingBatches,
    ];

    const packageSet = {
      ...sourceBatch,
      id: makePackageSetId(sourceBatch.id, allSets),
      sourceBatchId: sourceBatch.id,
      sourceBatchName:
        sourceBatch.name || sourceBatch.type || sourceBatch.productType || "",
      sourceArea: "Packaging",
      name: sourceBatch.name || sourceBatch.type || sourceBatch.productType || "",
      type: sourceBatch.type,
      productType: sourceBatch.productType,
      materialType: sourceBatch.materialType,
      packageableGrams: getPackageableGrams(sourceBatch),
      sourcePackageableGrams: getPackageableGrams(sourceBatch),
      sourceRemainingGrams: getRemainingGrams(sourceBatch),
      packagedUnits: firstLog.units,
      packagedGrams: firstLog.packagedGrams,
      packagingLogs: [firstLog],
      taskLogs: [],
      status: "In Progress",
      startedPackagingAt: new Date().toLocaleString(),
      startedBy: firstLog.loggedBy || getLoggedBy(),
    };

    s.inProgressPackagingBatches.unshift(packageSet);
    return packageSet;
  }

  function addToPackageSet(packageSet: any, packagingLog: any, sourceBatch: any) {
    if (!packageSet.packagingLogs) packageSet.packagingLogs = [];
    if (!packageSet.taskLogs) packageSet.taskLogs = [];

    packageSet.packagingLogs.push(packagingLog);
    packageSet.packagedUnits = num(packageSet.packagedUnits) + packagingLog.units;
    packageSet.packagedGrams =
      num(packageSet.packagedGrams) + packagingLog.packagedGrams;
    packageSet.sourcePackageableGrams = getPackageableGrams(sourceBatch);
    packageSet.sourceRemainingGrams = getRemainingGrams(sourceBatch);
    packageSet.status = "In Progress";
    packageSet.startedPackagingAt =
      packageSet.startedPackagingAt || new Date().toLocaleString();

    s.inProgressPackagingBatches = s.inProgressPackagingBatches.map((b: any) =>
      b.id === packageSet.id ? packageSet : b
    );

    return packageSet;
  }

  async function commitPackagingChoice(
    sourceBatch: any,
    packagingLog: any,
    choice: "existing" | "new",
    selectedPackageSetId?: string
  ) {
    if (!canWriteRecords) {
      showNotice("Read Only Mode", "Your role can view packaging data but cannot save changes.");
      return;
    }

    if (!sourceBatch || !packagingLog) return;

    if (!sourceBatch.packagingLogs) sourceBatch.packagingLogs = [];
    if (!sourceBatch.taskLogs) sourceBatch.taskLogs = [];

    sourceBatch.packagingLogs.push(packagingLog);
    sourceBatch.packagedUnits =
      num(sourceBatch.packagedUnits) + packagingLog.units;
    sourceBatch.packagedGrams =
      num(sourceBatch.packagedGrams) + packagingLog.packagedGrams;
    sourceBatch.packageableGrams = getPackageableGrams(sourceBatch);
    sourceBatch.remainingGrams = getRemainingGrams(sourceBatch);

    if (sourceBatch.remainingGrams <= 0) {
      sourceBatch.status = "Fully Packaged";
    } else {
      sourceBatch.status = "Partially Packaged";
    }

    let packageSet: any = null;
    const matchingInProgressSets = getInProgressSetsForSource(sourceBatch.id);

    if (choice === "existing") {
      const targetPackageSet =
        matchingInProgressSets.find((b: any) => b.id === selectedPackageSetId) ||
        matchingInProgressSets[0];

      if (!targetPackageSet) {
        showNotice("Package Set Required", "Select an existing package set first.");
        return;
      }

      packageSet = addToPackageSet(targetPackageSet, packagingLog, sourceBatch);
    } else {
      packageSet = createPackageSet(sourceBatch, packagingLog);
      packageSet.sourceRemainingGrams = getRemainingGrams(sourceBatch);
    }

    syncSourceRemainingToOpenPackageSets(sourceBatch);

    await updateRealPackagingBatch(sourceBatch);
    await saveRealPackagingBatch(packageSet);

    s.packagingBatches = s.packagingBatches.map((b: any) =>
      b.id === sourceBatch.id ? sourceBatch : b
    );

    if (sourceBatch.remainingGrams <= 0) {
      s.packagingBatches = s.packagingBatches.filter(
        (b: any) => b.id !== sourceBatch.id
      );
    }

    await addBackendLog({
      area: "Packaging",
      batch: sourceBatch.id,
      task: "Packaging Saved",
      output: `Source Batch: ${sourceBatch.id} | Package Set: ${
        packageSet.id
      } | Package Type: ${packagingLog.packageType} | Units: ${
        packagingLog.units
      } | Packaged: ${packagingLog.packagedGrams || "N/A"}g | Source Remaining: ${
        sourceBatch.remainingGrams
      }g | Status: ${sourceBatch.status}`,
      loggedBy: packagingLog.loggedBy || getLoggedBy(),
      data: {
        packagingLog,
        packageSetId: packageSet.id,
        sourceBatchId: sourceBatch.id,
      },
      time: new Date().toLocaleString(),
    });

    const nextSelected =
      s.packagingBatches
        .filter(isExtractionPackagingBatch)
        .filter((b: any) => getRemainingGrams(b) > 0)[0] || null;

    setSelected(sourceBatch.remainingGrams > 0 ? sourceBatch : nextSelected);
    setSelectedInProgress(packageSet);
    setPackageType(
      getPackageOptions(
        sourceBatch.remainingGrams > 0 ? sourceBatch : nextSelected
      )[0] || ""
    );
    setUnits("");
    setPackagedBy("");
    setNotes("");
    closePackageChoiceModal();
    forceRefresh();
  }

  function savePackaging() {
    if (!canWriteRecords) {
      showNotice("Read Only Mode", "Your role can view packaging data but cannot save packaging entries.");
      return;
    }

    if (!selected) {
      showNotice("No Batch Selected", "Select a packaging batch first.");
      return;
    }

    if (!isExtractionPackagingBatch(selected)) {
      showNotice(
        "Wrong Packaging Area",
        "Finished flower is packaged on the cultivation side, not this packaging page."
      );
      return;
    }

    if (!requireField(packageType, "Package Type")) return;
    if (!requireField(units, "How Many Units")) return;
    if (!requireField(packagedBy, "Packaged By")) return;

    const unitsNum = num(units);
    const unitSize = getUnitSizeFromPackageType(packageType);
    const totalPackaged = unitsNum * unitSize;
    const sourceRemainingBefore = getRemainingGrams(selected);

    if (unitsNum <= 0) {
      showNotice("Invalid Units", "How Many Units must be greater than 0.");
      return;
    }

    if (unitSize > 0 && totalPackaged > sourceRemainingBefore) {
      showNotice(
        "Not Enough Material Available",
        `You only have ${sourceRemainingBefore} grams remaining.`,
        `This entry would package ${totalPackaged} grams.`
      );
      return;
    }

    const loggedBy = getLoggedBy();

    const packagingLog = {
      packageType,
      units: unitsNum,
      unitSizeGrams: unitSize,
      packagedGrams: totalPackaged,
      packagedBy,
      notes,
      loggedBy,
      loggedAt: new Date().toLocaleString(),
      loggedAtIso: new Date().toISOString(),
      time: new Date().toLocaleString(),
    };

    const matchingInProgressSets = getInProgressSetsForSource(selected.id);

    if (matchingInProgressSets.length > 0) {
      setPackageChoiceModal({
        open: true,
        sourceBatch: selected,
        packagingLog,
        matchingSets: matchingInProgressSets,
        selectedPackageSetId: matchingInProgressSets[0]?.id || "",
      });
      return;
    }

    commitPackagingChoice(selected, packagingLog, "new");
  }

  async function savePackagingTask() {
    if (isSavingTask) return;
    if (!canWriteRecords) {
      showNotice("Read Only Mode", "Your role can view packaging data but cannot save packaging tasks.");
      return;
    }

    if (!selectedInProgress) {
      showNotice("No Package Selected", "Select an in-progress package first.");
      return;
    }
    setIsSavingTask(true);

    if (!requireField(taskType, "Task")) {
      setIsSavingTask(false);
      return;
    }

    if (taskType === "Test" && selectedTestTypes.length === 0) {
      showNotice(
        "Test Type Required",
        "Select at least one test type before saving the test task."
      );
      setIsSavingTask(false);
      return;
    }

    const isFinishPackage = taskType === "Finish Package";

    if (!isFinishPackage) {
      if (!requireField(taskPeople, "People")) {
        setIsSavingTask(false);
        return;
      }
      if (!requireField(taskTime, "Time")) {
        setIsSavingTask(false);
        return;
      }
    }

    const taskPeopleNum = isFinishPackage ? 0 : num(taskPeople);
    const taskTimeNum = isFinishPackage ? 0 : num(taskTime);
    const totalLaborMinutes = taskPeopleNum * taskTimeNum;

    if (!isFinishPackage && taskPeopleNum <= 0) {
      showNotice("Invalid People Count", "People must be greater than 0.");
      setIsSavingTask(false);
      return;
    }

    if (!isFinishPackage && taskTimeNum <= 0) {
      showNotice("Invalid Time", "Time must be greater than 0.");
      setIsSavingTask(false);
      return;
    }

    const selectedTestTypesText = getSelectedTestTypesText();
    const loggedBy = getLoggedBy();

    if (!selectedInProgress.taskLogs) selectedInProgress.taskLogs = [];

    selectedInProgress.taskLogs.push({
      task: taskType,
      testTypes: taskType === "Test" ? selectedTestTypes : [],
      testType: taskType === "Test" ? selectedTestTypesText : "",
      people: taskPeopleNum,
      timeMinutes: taskTimeNum,
      totalLaborMinutes,
      notes: taskNotes,
      loggedBy,
      loggedAt: new Date().toLocaleString(),
      loggedAtIso: new Date().toISOString(),
    });

    selectedInProgress.totalLaborMinutes =
      num(selectedInProgress.totalLaborMinutes) + totalLaborMinutes;

    if (taskType === "Finish Package") {
      selectedInProgress.status = "Packaging Complete";
      selectedInProgress.completedAt = new Date().toLocaleString();

      const alreadyCompleted = s.completedPackagingBatches.some(
        (b: any) => b.id === selectedInProgress.id
      );

      if (!alreadyCompleted) {
        s.completedPackagingBatches.unshift(selectedInProgress);
      } else {
        s.completedPackagingBatches = s.completedPackagingBatches.map((b: any) =>
          b.id === selectedInProgress.id ? selectedInProgress : b
        );
      }

      s.inProgressPackagingBatches = s.inProgressPackagingBatches.filter(
        (b: any) => b.id !== selectedInProgress.id
      );

      await addBackendLog({
        area: "Packaging",
        batch: selectedInProgress.id,
        task: "Finish Package",
        output: `Package set finished. Source Batch: ${
          selectedInProgress.sourceBatchId || selectedInProgress.id
        } | Units: ${selectedInProgress.packagedUnits || 0} | Total Packaged: ${
          selectedInProgress.packagedGrams || 0
        }g | Labor Time: ${getTotalLaborMinutes(selectedInProgress)} min`,
        loggedBy,
        data: {
          packageSetId: selectedInProgress.id,
          sourceBatchId: selectedInProgress.sourceBatchId || selectedInProgress.id,
          totalLaborMinutes: getTotalLaborMinutes(selectedInProgress),
        },
        time: new Date().toLocaleString(),
      });

      const nextInProgress =
        s.inProgressPackagingBatches.filter(isExtractionPackagingBatch)[0] || null;

      setSelectedInProgress(nextInProgress);
    } else {
      selectedInProgress.status =
        taskType === "Test" ? `Test - ${selectedTestTypesText}` : taskType;

      s.inProgressPackagingBatches = s.inProgressPackagingBatches.map((b: any) =>
        b.id === selectedInProgress.id ? selectedInProgress : b
      );

      await addBackendLog({
        area: "Packaging",
        batch: selectedInProgress.id,
        task: taskType,
        output: `Source Batch: ${
          selectedInProgress.sourceBatchId || selectedInProgress.id
        }${taskType === "Test" ? ` | Test Types: ${selectedTestTypesText}` : ""} | People: ${taskPeopleNum} | Time: ${taskTimeNum} min | Labor Time: ${totalLaborMinutes} min${
          taskNotes ? ` | Notes: ${taskNotes}` : ""
        }`,
        loggedBy,
        data: {
          packageSetId: selectedInProgress.id,
          sourceBatchId: selectedInProgress.sourceBatchId || selectedInProgress.id,
          testTypes: taskType === "Test" ? selectedTestTypes : [],
          people: taskPeopleNum,
          timeMinutes: taskTimeNum,
          totalLaborMinutes,
          notes: taskNotes,
        },
        time: new Date().toLocaleString(),
      });
    }

    setTaskType(PACKAGING_TASKS[0]);
    setSelectedTestTypes([]);
    setTaskPeople("");
    setTaskTime("");
    setTaskNotes("");
    forceRefresh();

    try {
      showSyncMessageNotice("Task saved locally. Syncing to server...");
      await updateRealPackagingBatch(selectedInProgress);
      showSyncMessageNotice("Task synced to server.");
    } finally {
      setIsSavingTask(false);
    }
  }

  async function runDeletePackagingBatch(batchId: string) {
    const deletedRecord =
      s.packagingBatches.find((b: any) => b.id === batchId) ||
      s.inProgressPackagingBatches.find((b: any) => b.id === batchId) ||
      s.completedPackagingBatches.find((b: any) => b.id === batchId) ||
      null;
    const loggedBy = getLoggedBy();

    await addBackendLog({
      area: "Audit",
      batch: batchId,
      task: "Deleted Record",
      output: `Deleted packaging batch: ${batchId}`,
      loggedBy,
      data: {
        deletedRecordType: "Packaging Batch",
        deletedRecordId: batchId,
        deletedRecord,
        deletedBy: loggedBy,
        deletedAtIso: new Date().toISOString(),
      },
      time: new Date().toLocaleString(),
    });

    s.packagingBatches = s.packagingBatches.filter((b: any) => b.id !== batchId);
    s.inProgressPackagingBatches = s.inProgressPackagingBatches.filter(
      (b: any) => b.id !== batchId
    );
    s.completedPackagingBatches = s.completedPackagingBatches.filter(
      (b: any) => b.id !== batchId
    );

    if (selected?.id === batchId) {
      const nextSelected =
        s.packagingBatches
          .filter(isExtractionPackagingBatch)
          .filter((b: any) => getRemainingGrams(b) > 0)[0] || null;

      setSelected(nextSelected);
      setPackageType(getPackageOptions(nextSelected)[0] || "");
      setUnits("");
      setPackagedBy("");
      setNotes("");
    }

    if (selectedInProgress?.id === batchId) {
      const nextInProgress =
        s.inProgressPackagingBatches.filter(isExtractionPackagingBatch)[0] || null;

      setSelectedInProgress(nextInProgress);
      setTaskType(PACKAGING_TASKS[0]);
      setSelectedTestTypes([]);
      setTaskPeople("");
      setTaskTime("");
      setTaskNotes("");
    }

    try {
      await deletePackagingBatchRecord(batchId);
    } catch (error) {
      console.error("Could not delete packaging batch from real table:", error);
      showNotice(
        "Backend Delete Warning",
        "Packaging was removed locally, but the real PackagingBatch table delete failed.",
        "Check the backend terminal for errors."
      );
    }

    forceRefresh();
  }

  function deletePackagingBatch(batchId: string) {
    if (!canDeleteRecords) {
      showNotice(
        "Access Denied",
        "Only Manager, Admin, or Owner users can delete packaging records."
      );
      return;
    }

    showConfirm(
      "Delete Packaging Batch",
      `Delete packaging batch "${batchId}"?`,
      () => runDeletePackagingBatch(batchId),
      "This removes it from available, in-progress, and completed packaging lists."
    );
  }

  const pageStyle: any = {
    minHeight: "100vh",
    background: "#020617",
    color: "white",
    padding: 20,
  };

  const shellStyle: any = {
    maxWidth: 1100,
    margin: "0 auto",
  };

  const cardStyle: any = {
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: 16,
    padding: 18,
    marginTop: 18,
  };

  const rowStyle: any = {
    padding: 12,
    marginBottom: 8,
    borderRadius: 12,
    border: "1px solid #334155",
    cursor: "pointer",
  };

  const inputStyle: any = {
    width: "100%",
    padding: 10,
    borderRadius: 10,
    border: "1px solid #334155",
    background: "#020617",
    color: "white",
  };

  const buttonStyle: any = {
    background: "#334155",
    color: "white",
    border: "1px solid #475569",
    borderRadius: 10,
    padding: "10px 12px",
    cursor: "pointer",
  };

  const greenButtonStyle: any = {
    ...buttonStyle,
    background: "#22c55e",
    color: "black",
    border: "1px solid #22c55e",
    fontWeight: 700,
  };

  const blueButtonStyle: any = {
    ...buttonStyle,
    background: "#2563eb",
    border: "1px solid #3b82f6",
    fontWeight: 700,
  };

  const yellowButtonStyle: any = {
    ...buttonStyle,
    background: "#facc15",
    color: "black",
    border: "1px solid #facc15",
    fontWeight: 700,
  };

  const deleteButtonStyle: any = {
    ...buttonStyle,
    background: "#7f1d1d",
    border: "1px solid #ef4444",
  };

  const historyButtonStyle: any = {
    ...buttonStyle,
    background: "#0ea5e9",
    border: "1px solid #38bdf8",
    fontWeight: 700,
  };

  const modalOverlayStyle: any = {
    position: "fixed",
    inset: 0,
    background: "rgba(2, 6, 23, 0.78)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    padding: 20,
  };

  const modalStyle: any = {
    width: "100%",
    maxWidth: 760,
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: 18,
    padding: 24,
    boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
    maxHeight: "85vh",
    overflowY: "auto",
  };

  const testCheckboxStyle: any = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: 10,
    border: "1px solid #334155",
    background: "#020617",
    cursor: "pointer",
  };

  return (
    <PageAccessGate allowedRoles={["PACKAGING", "VIEW_ONLY"]}>
      <div style={pageStyle}>
      <div style={shellStyle}>
        <Nav />

        <div style={{ textAlign: "center", marginTop: 24 }}>
          <h1 style={{ margin: 0 }}>Packaging</h1>
          <p style={{ color: "#94a3b8", marginTop: 8 }}>
            Package finished extraction batches into sellable units.
          </p>
        </div>

        {!canWriteRecords && (
          <div
            style={{
              ...cardStyle,
              border: "1px solid rgba(250, 204, 21, 0.55)",
              background: "rgba(113, 63, 18, 0.28)",
              color: "#fde68a",
              textAlign: "center",
              fontWeight: 800,
            }}
          >
            Read Only Mode: You can view packaging data and task history, but you cannot save packaging entries or tasks.
          </div>
        )}

        <div style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Available Packaging Batches</h2>

          {activePackagingBatches.length === 0 ? (
            <p style={{ color: "#94a3b8" }}>No extraction batches ready for packaging.</p>
          ) : (
            activePackagingBatches.map((b: any) => (
              <div
                key={b.id}
                onClick={() => selectBatch(b)}
                style={{
                  ...rowStyle,
                  background: selected?.id === b.id ? "#22c55e" : "#1e293b",
                  color: selected?.id === b.id ? "black" : "white",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <div>
                  <b>{packagingBatchPublicLabel(b)}</b>
                  {b.marketBatchCode ? (
                    <span style={{ fontWeight: 700 }}> ({b.id})</span>
                  ) : null}{" "}
                  | {b.name || b.type || b.productType}
                  {packagingBlendDescription(b)
                    ? ` | Blend: ${packagingBlendDescription(b)}`
                    : ""}{" "}
                  | Available to
                  Package: {getFinalGrams(b) || "—"}g | Packaged:{" "}
                  {getPackagedGrams(b) || 0}g | Remaining:{" "}
                  {getRemainingGrams(b) || "—"}g | Yield: {b.yieldPercentage || "—"} |
                  Status: {b.status || "Ready"}
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    style={historyButtonStyle}
                    onClick={(e) => {
                      e.stopPropagation();
                      openTaskHistory(b);
                    }}
                  >
                    View Task History
                  </button>

                  {canDeleteRecords && (
                    <button
                      style={deleteButtonStyle}
                      onClick={(e) => {
                        e.stopPropagation();
                        deletePackagingBatch(b.id);
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {syncMessage ? (
          <div
            style={{
              position: "fixed",
              right: 18,
              bottom: 18,
              zIndex: 11000,
              background: "rgba(15, 23, 42, 0.96)",
              border: "1px solid rgba(56, 189, 248, 0.6)",
              color: "#bae6fd",
              borderRadius: 10,
              padding: "8px 12px",
              fontSize: 13,
              boxShadow: "0 10px 28px rgba(0,0,0,0.35)",
            }}
          >
            {syncMessage}
          </div>
        ) : null}

        <div style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Package Selected Batch</h2>

          {!selected ? (
            <p style={{ color: "#94a3b8" }}>Select an extraction batch to package.</p>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              <input
                style={inputStyle}
                value={
                  selected.marketBatchCode
                    ? `${packagingBatchPublicLabel(selected)} (run ${selected.id})`
                    : selected.id || ""
                }
                readOnly
              />

              <input
                style={inputStyle}
                value={`Source packages: ${packagingSourceMaterialLabel(selected)}`}
                readOnly
              />

              <input
                style={inputStyle}
                value={selected.name || selected.type || selected.productType || ""}
                readOnly
              />

              {packagingBlendDescription(selected) ? (
                <input
                  style={inputStyle}
                  value={`Blend (strains): ${packagingBlendDescription(selected)}`}
                  readOnly
                />
              ) : null}

              <input
                style={inputStyle}
                value={`Available to Package: ${getFinalGrams(selected) || "—"}g`}
                readOnly
              />

              <input
                style={inputStyle}
                value={`Already Packaged: ${getPackagedGrams(selected) || 0}g`}
                readOnly
              />

              <input
                style={inputStyle}
                value={`Remaining: ${getRemainingGrams(selected) || "—"}g`}
                readOnly
              />

              <select
                style={inputStyle}
                required
                value={packageType}
                onChange={(e) => setPackageType(e.target.value)}
                disabled={!canWriteRecords}
              >
                {getPackageOptions(selected).map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>

              <input
                style={inputStyle}
                placeholder="How Many Units"
                required
                value={units}
                onChange={(e) => setUnits(e.target.value)}
                disabled={!canWriteRecords}
              />

              <input
                style={inputStyle}
                value={`Total Packaged This Entry: ${getThisEntryGrams() || 0}g`}
                readOnly
              />

              <input
                style={inputStyle}
                placeholder="Packaged By"
                required
                value={packagedBy}
                onChange={(e) => setPackagedBy(e.target.value)}
                disabled={!canWriteRecords}
              />

              <input
                style={inputStyle}
                placeholder="Notes (optional)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={!canWriteRecords}
              />

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                {canDeleteRecords && (
                  <button
                    style={deleteButtonStyle}
                    onClick={() => deletePackagingBatch(selected.id)}
                  >
                    Delete Batch
                  </button>
                )}

                {canWriteRecords && (
                  <button style={greenButtonStyle} onClick={savePackaging}>
                    Save Packaging
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>In Progress Packaging Batches</h2>

          {inProgressPackagingBatches.length === 0 ? (
            <p style={{ color: "#94a3b8" }}>No packaging batches in progress.</p>
          ) : (
            inProgressPackagingBatches.map((b: any) => (
              <div
                key={b.id}
                onClick={() => selectInProgressBatch(b)}
                style={{
                  ...rowStyle,
                  background: selectedInProgress?.id === b.id ? "#facc15" : "#1e293b",
                  color: selectedInProgress?.id === b.id ? "black" : "white",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <div>
                  <b>{packagingBatchPublicLabel(b)}</b>
                  {b.marketBatchCode ? <span> ({b.id})</span> : null} | Source packages:{" "}
                  {packagingSourceMaterialLabel(b)} |{" "}
                  {b.name || b.type || b.productType} | Units: {b.packagedUnits || 0} |
                  This Set Packaged: {b.packagedGrams || 0}g | Source Remaining:{" "}
                  {b.sourceRemainingGrams ?? 0}g | Labor Time:{" "}
                  {getTotalLaborMinutes(b)} min | Status: {b.status || "In Progress"}
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    style={historyButtonStyle}
                    onClick={(e) => {
                      e.stopPropagation();
                      openTaskHistory(b);
                    }}
                  >
                    View Task History
                  </button>

                  {canDeleteRecords && (
                    <button
                      style={deleteButtonStyle}
                      onClick={(e) => {
                        e.stopPropagation();
                        deletePackagingBatch(b.id);
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <div style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Perform Packaging Task</h2>

          {!selectedInProgress ? (
            <p style={{ color: "#94a3b8" }}>
              Select an in-progress package to perform a task.
            </p>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              <input style={inputStyle} value={selectedInProgress.id || ""} readOnly />

              <input
                style={inputStyle}
                value={`Source packages: ${packagingSourceMaterialLabel(selectedInProgress)}`}
                readOnly
              />

              <input
                style={inputStyle}
                value={`Extraction run: ${
                  selectedInProgress.extractionBatchId ||
                  selectedInProgress.sourceBatchId ||
                  selectedInProgress.id
                }`}
                readOnly
              />

              <input
                style={inputStyle}
                value={
                  selectedInProgress.name ||
                  selectedInProgress.type ||
                  selectedInProgress.productType ||
                  ""
                }
                readOnly
              />

              <input
                style={inputStyle}
                value={`This Package Set: ${
                  selectedInProgress.packagedGrams ||
                  getPackageSetPackagedGrams(selectedInProgress)
                }g packaged`}
                readOnly
              />

              <input
                style={inputStyle}
                value={`Total Labor Time: ${getTotalLaborMinutes(
                  selectedInProgress
                )} minutes`}
                readOnly
              />

              <select
                style={inputStyle}
                value={taskType}
                onChange={(e) => {
                  setTaskType(e.target.value);
                  if (e.target.value !== "Test") {
                    setSelectedTestTypes([]);
                  }
                }}
                disabled={!canWriteRecords}
              >
                {PACKAGING_TASKS.map((task) => (
                  <option key={task}>{task}</option>
                ))}
              </select>

              {taskType === "Test" ? (
                <div
                  style={{
                    background: "#020617",
                    border: "1px solid #334155",
                    borderRadius: 12,
                    padding: 12,
                    display: "grid",
                    gap: 8,
                  }}
                >
                  <div style={{ color: "#cbd5e1", fontWeight: 700 }}>
                    Select Test Types
                  </div>

                  {TEST_TYPES.map((type) => (
                    <label
                      key={type}
                      style={{
                        ...testCheckboxStyle,
                        border: selectedTestTypes.includes(type)
                          ? "1px solid #22c55e"
                          : "1px solid #334155",
                        background: selectedTestTypes.includes(type)
                          ? "rgba(34, 197, 94, 0.12)"
                          : "#020617",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedTestTypes.includes(type)}
                        onChange={() => toggleTestType(type)}
                        disabled={!canWriteRecords}
                      />
                      <span>{type}</span>
                    </label>
                  ))}

                  <input
                    style={inputStyle}
                    value={`Selected Tests: ${
                      selectedTestTypes.length > 0
                        ? selectedTestTypes.join(", ")
                        : "None selected"
                    }`}
                    readOnly
                  />
                </div>
              ) : null}

              <input
                style={inputStyle}
                placeholder="How Many People"
                required
                value={taskPeople}
                onChange={(e) => setTaskPeople(e.target.value)}
                disabled={!canWriteRecords}
              />

              <input
                style={inputStyle}
                placeholder="Time Spent in Minutes"
                required
                value={taskTime}
                onChange={(e) => setTaskTime(e.target.value)}
                disabled={!canWriteRecords}
              />

              <input
                style={inputStyle}
                value={`Labor Time This Task: ${num(taskPeople) * num(taskTime)} minutes`}
                readOnly
              />

              <input
                style={inputStyle}
                placeholder="Notes (optional)"
                value={taskNotes}
                onChange={(e) => setTaskNotes(e.target.value)}
                disabled={!canWriteRecords}
              />

              {canWriteRecords && (
                <button
                  style={greenButtonStyle}
                  onClick={savePackagingTask}
                  disabled={isSavingTask}
                >
                  {isSavingTask ? "Saving..." : "Save Task"}
                </button>
              )}

              <div style={{ marginTop: 12 }}>
                <h3 style={{ marginBottom: 8 }}>Packaging Entries</h3>

                {!selectedInProgress.packagingLogs ||
                selectedInProgress.packagingLogs.length === 0 ? (
                  <p style={{ color: "#94a3b8" }}>No packaging entries yet.</p>
                ) : (
                  selectedInProgress.packagingLogs.map((log: any, index: number) => (
                    <div key={index} style={{ ...rowStyle, background: "#020617" }}>
                      <b>{log.packageType}</b> | Units: {log.units || 0} | Unit Size:{" "}
                      {log.unitSizeGrams || 0}g | Packaged: {log.packagedGrams || 0}g |
                      By: {log.packagedBy || "—"} | Logged By: {formatLoggedBy(log.loggedBy)} | Time: {log.loggedAt || log.time || "—"}
                      {log.notes ? ` | Notes: ${log.notes}` : ""}
                    </div>
                  ))
                )}
              </div>

              <div style={{ marginTop: 12 }}>
                <h3 style={{ marginBottom: 8 }}>Task History</h3>

                {!selectedInProgress.taskLogs ||
                selectedInProgress.taskLogs.length === 0 ? (
                  <p style={{ color: "#94a3b8" }}>No tasks completed yet.</p>
                ) : (
                  selectedInProgress.taskLogs.map((log: any, index: number) => (
                    <div key={index} style={{ ...rowStyle, background: "#020617" }}>
                      <b>
                        {log.task}
                        {log.testType ? ` - ${log.testType}` : ""}
                      </b>{" "}
                      | People: {log.people || 0} | Time: {log.timeMinutes || 0} min |
                      Labor Time: {log.totalLaborMinutes || 0} min | Logged:{" "}
                      {log.loggedAt || log.time} | Logged By: {formatLoggedBy(log.loggedBy)}
                      {log.notes ? ` | Notes: ${log.notes}` : ""}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <div style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Completed Packaging Batches</h2>

          {completedPackagingBatches.length === 0 ? (
            <p style={{ color: "#94a3b8" }}>
              No completed extraction packaging batches yet.
            </p>
          ) : (
            completedPackagingBatches.map((b: any) => (
              <div
                key={b.id}
                style={{
                  ...rowStyle,
                  background: "#111827",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <div>
                  <b>{packagingBatchPublicLabel(b)}</b>
                  {b.marketBatchCode ? <span> ({b.id})</span> : null} | Source packages:{" "}
                  {packagingSourceMaterialLabel(b)} |{" "}
                  {b.name || b.type || b.productType} | Units: {b.packagedUnits || 0} |
                  This Set Packaged: {b.packagedGrams || 0}g | Labor Time:{" "}
                  {getTotalLaborMinutes(b)} min | Yield: {b.yieldPercentage || "—"} |
                  Completed: {b.completedAt}
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    style={historyButtonStyle}
                    onClick={() => openTaskHistory(b)}
                  >
                    View Task History
                  </button>

                  {canDeleteRecords && (
                    <button
                      style={deleteButtonStyle}
                      onClick={() => deletePackagingBatch(b.id)}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {notificationModal.open && (
        <div style={modalOverlayStyle}>
          <div style={{ ...modalStyle, maxWidth: 560 }}>
            <h2 style={{ marginTop: 0, marginBottom: 10 }}>
              {notificationModal.title}
            </h2>

            <p style={{ color: "#cbd5e1", marginTop: 0, lineHeight: 1.6 }}>
              {notificationModal.message}
            </p>

            {notificationModal.details ? (
              <div
                style={{
                  background: "#020617",
                  border: "1px solid #334155",
                  borderRadius: 12,
                  padding: 12,
                  marginTop: 12,
                  marginBottom: 18,
                  color: "#cbd5e1",
                }}
              >
                {notificationModal.details}
              </div>
            ) : null}

            <div
              style={{
                display: "flex",
                gap: 10,
                justifyContent: "center",
                flexWrap: "wrap",
                marginTop: 18,
              }}
            >
              {notificationModal.cancelText ? (
                <button style={buttonStyle} onClick={closeNotificationModal}>
                  {notificationModal.cancelText}
                </button>
              ) : null}

              <button
                style={notificationModal.onConfirm ? deleteButtonStyle : blueButtonStyle}
                onClick={
                  notificationModal.onConfirm
                    ? confirmNotificationModal
                    : closeNotificationModal
                }
              >
                {notificationModal.confirmText || "OK"}
              </button>
            </div>
          </div>
        </div>
      )}

      {packageChoiceModal.open && (
        <div style={modalOverlayStyle}>
          <div style={modalStyle}>
            <h2 style={{ marginTop: 0, marginBottom: 10 }}>Packaging Options</h2>

            <p style={{ color: "#cbd5e1", marginTop: 0, lineHeight: 1.6 }}>
              This source batch already has{" "}
              <b>{packageChoiceModal.matchingSets.length}</b> package set
              {packageChoiceModal.matchingSets.length === 1 ? "" : "s"} in progress.
            </p>

            <div
              style={{
                background: "#020617",
                border: "1px solid #334155",
                borderRadius: 12,
                padding: 12,
                marginTop: 12,
                marginBottom: 18,
              }}
            >
              <div style={{ marginBottom: 8 }}>
                <b>Source Batch:</b> {packageChoiceModal.sourceBatch?.id || "—"}
              </div>

              <div style={{ marginBottom: 8 }}>
                <b>Product:</b>{" "}
                {packageChoiceModal.sourceBatch?.name ||
                  packageChoiceModal.sourceBatch?.type ||
                  packageChoiceModal.sourceBatch?.productType ||
                  "—"}
              </div>

              <div style={{ marginBottom: 8 }}>
                <b>Package Type:</b>{" "}
                {packageChoiceModal.packagingLog?.packageType || "—"}
              </div>

              <div style={{ marginBottom: 8 }}>
                <b>Units:</b> {packageChoiceModal.packagingLog?.units || 0}
              </div>

              <div style={{ marginBottom: 8 }}>
                <b>This Entry:</b>{" "}
                {packageChoiceModal.packagingLog?.packagedGrams || 0}g
              </div>

              <div>
                <b>Source Remaining After This Entry:</b>{" "}
                {Math.max(
                  getRemainingGrams(packageChoiceModal.sourceBatch) -
                    num(packageChoiceModal.packagingLog?.packagedGrams),
                  0
                )}
                g
              </div>
            </div>

            <div
              style={{
                background: "#020617",
                border: "1px solid #334155",
                borderRadius: 12,
                padding: 12,
                marginBottom: 18,
              }}
            >
              <h3 style={{ marginTop: 0, marginBottom: 10 }}>
                Choose Existing Package Set
              </h3>

              {packageChoiceModal.matchingSets.length === 0 ? (
                <p style={{ color: "#94a3b8" }}>No existing package sets found.</p>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {packageChoiceModal.matchingSets.map((set: any) => (
                    <label
                      key={set.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: 10,
                        borderRadius: 10,
                        border:
                          packageChoiceModal.selectedPackageSetId === set.id
                            ? "1px solid #facc15"
                            : "1px solid #334155",
                        background:
                          packageChoiceModal.selectedPackageSetId === set.id
                            ? "rgba(250, 204, 21, 0.15)"
                            : "#0f172a",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="radio"
                        checked={packageChoiceModal.selectedPackageSetId === set.id}
                        onChange={() =>
                          setPackageChoiceModal((current) => ({
                            ...current,
                            selectedPackageSetId: set.id,
                          }))
                        }
                      />

                      <div>
                        <div>
                          <b>{set.id}</b>
                        </div>
                        <div style={{ color: "#cbd5e1", fontSize: 14 }}>
                          Units: {set.packagedUnits || 0} | This Set Packaged:{" "}
                          {set.packagedGrams || 0}g | Status:{" "}
                          {set.status || "In Progress"}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div
              style={{
                display: "flex",
                gap: 10,
                justifyContent: "center",
                flexWrap: "wrap",
              }}
            >
              {canWriteRecords && (
                <button
                  style={blueButtonStyle}
                  onClick={() =>
                    commitPackagingChoice(
                      packageChoiceModal.sourceBatch,
                      packageChoiceModal.packagingLog,
                      "new"
                    )
                  }
                >
                  Create New Package Set
                </button>
              )}

              {canWriteRecords && (
                <button
                  style={yellowButtonStyle}
                  onClick={() =>
                    commitPackagingChoice(
                      packageChoiceModal.sourceBatch,
                      packageChoiceModal.packagingLog,
                      "existing",
                      packageChoiceModal.selectedPackageSetId
                    )
                  }
                >
                  Add To Selected Package Set
                </button>
              )}

              <button style={buttonStyle} onClick={closePackageChoiceModal}>
                Do Nothing
              </button>
            </div>
          </div>
        </div>
      )}

      {taskHistoryModal.open && (
        <div style={modalOverlayStyle}>
          <div style={modalStyle}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                marginBottom: 16,
              }}
            >
              <div>
                <h2 style={{ margin: 0 }}>Task History</h2>
                <p style={{ color: "#94a3b8", marginBottom: 0 }}>
                  <b style={{ color: "#e2e8f0" }}>
                    {packagingBatchPublicLabel(taskHistoryModal.batch)}
                  </b>
                  {taskHistoryModal.batch?.marketBatchCode ? (
                    <span> (run {taskHistoryModal.batch.id})</span>
                  ) : null}{" "}
                  | Source packages: {packagingSourceMaterialLabel(taskHistoryModal.batch)}
                </p>
              </div>

              <button style={buttonStyle} onClick={closeTaskHistory}>
                Close
              </button>
            </div>

            <div
              style={{
                background: "#020617",
                border: "1px solid #334155",
                borderRadius: 12,
                padding: 12,
                marginBottom: 18,
              }}
            >
              <div style={{ marginBottom: 8 }}>
                <b>Product:</b>{" "}
                {taskHistoryModal.batch?.name ||
                  taskHistoryModal.batch?.type ||
                  taskHistoryModal.batch?.productType ||
                  "—"}
              </div>

              {packagingBlendDescription(taskHistoryModal.batch) ? (
                <div style={{ marginBottom: 8 }}>
                  <b>Blend:</b> {packagingBlendDescription(taskHistoryModal.batch)}
                </div>
              ) : null}

              <div style={{ marginBottom: 8 }}>
                <b>Status:</b> {taskHistoryModal.batch?.status || "Ready"}
              </div>

              <div style={{ marginBottom: 8 }}>
                <b>Packaged Units:</b> {taskHistoryModal.batch?.packagedUnits || 0}
              </div>

              <div style={{ marginBottom: 8 }}>
                <b>Packaged Grams:</b> {taskHistoryModal.batch?.packagedGrams || 0}g
              </div>

              <div>
                <b>Total Labor Time:</b>{" "}
                {getTotalLaborMinutes(taskHistoryModal.batch)} minutes
              </div>
            </div>

            <h3 style={{ marginBottom: 8 }}>Packaging Entries</h3>

            {!taskHistoryModal.batch?.packagingLogs ||
            taskHistoryModal.batch?.packagingLogs.length === 0 ? (
              <p style={{ color: "#94a3b8" }}>No packaging entries yet.</p>
            ) : (
              taskHistoryModal.batch.packagingLogs.map((log: any, index: number) => (
                <div key={index} style={{ ...rowStyle, background: "#020617" }}>
                  <b>{log.packageType || "Packaging Entry"}</b> | Units:{" "}
                  {log.units || 0} | Unit Size: {log.unitSizeGrams || 0}g |
                  Packaged: {log.packagedGrams || 0}g | By:{" "}
                  {log.packagedBy || "—"} | Logged By: {formatLoggedBy(log.loggedBy)} | Time: {log.loggedAt || log.time || "—"}
                  {log.notes ? ` | Notes: ${log.notes}` : ""}
                </div>
              ))
            )}

            <h3 style={{ marginTop: 20, marginBottom: 8 }}>Task Logs</h3>

            {!taskHistoryModal.batch?.taskLogs ||
            taskHistoryModal.batch?.taskLogs.length === 0 ? (
              <p style={{ color: "#94a3b8" }}>No tasks completed yet.</p>
            ) : (
              taskHistoryModal.batch.taskLogs.map((log: any, index: number) => (
                <div key={index} style={{ ...rowStyle, background: "#020617" }}>
                  <b>
                    {log.task}
                    {log.testType ? ` - ${log.testType}` : ""}
                  </b>{" "}
                  | People: {log.people || 0} | Time: {log.timeMinutes || 0} min |
                  Labor Time: {log.totalLaborMinutes || 0} min | Logged:{" "}
                  {log.loggedAt || log.time || "—"} | Logged By: {formatLoggedBy(log.loggedBy)}
                  {log.notes ? ` | Notes: ${log.notes}` : ""}
                </div>
              ))
            )}
          </div>
        </div>
      )}
      </div>
    </PageAccessGate>
  );
}