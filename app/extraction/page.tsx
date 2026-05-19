"use client";

import { useEffect, useMemo, useState } from "react";
import Nav from "@/components/Nav";
import PageAccessGate from "@/components/PageAccessGate";
import SectionCalendarLauncher from "@/components/SectionCalendarLauncher";
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
  loadSourceBatches,
  updateSourceBatch,
  deleteSourceBatchRecord,
  patchSourcePackageCanonicalName,
} from "@/lib/sourceBatchApi";
import { makeExtractionMarketBatchCode } from "@/lib/batchChainCodes";
import { getSourceAvailable, isCompletedSourceBatch } from "@/lib/sourceBatchActive";
import {
  freshFrozenAvailableLine,
  freshFrozenPackageDisplay,
  GRAMS_PER_LB,
  sourceRowBundles,
  sourceRowTotalLbs,
} from "@/lib/freshFrozenPackageDisplay";
import {
  loadExtractionBatches,
  createExtractionBatch,
  updateExtractionBatch,
  deleteExtractionBatchRecord,
} from "@/lib/extractionApi";
import { createPackagingBatch } from "@/lib/packagingApi";
import { createLog } from "@/lib/logsApi";
import {
  apiRequest,
  getSelectedCompanyId,
  suggestExtractionProductNames,
} from "@/lib/api";
import { fetchCachedCompanyConfig, invalidateCompanyConfigClientCache } from "@/lib/configClient";
import {
  clampDymoLabelPrintCopies,
  defaultDymoLabelCalibrationSettings,
  resolveDymoLabelCalibration,
  validateDymoLabelCalibrationSettings,
  writeDymoCalibrationToLocalStorage,
  type DymoLabelCalibrationSettings,
} from "@/lib/dymoLabelCalibration";
import { extractRewardsFromCompanyConfig } from "@/lib/rewardsConfig";
import {
  extractCustomTasksRewardDefsFromCompanyConfig,
  mergeWorkflowTaskList,
  type CustomTasksRewardDefs,
} from "@/lib/customTasksConfig";
import {
  EXTRACTION_UI_STAGE_META,
  EXTRACTION_UI_STAGE_ORDER,
  extractionUiStageFromBatch,
  groupExtractionBatchesByUiStage,
  type ExtractionUiStageKey,
} from "@/lib/extractionBatchUiStage";
import {
  extractionBatchBiomassLbs,
  extractionBatchOilGrams,
  extractionCombineUsesOilGrams,
  applyExtractionPartnerUncombineRestore,
  captureExtractionPreMergeUiSnapshot,
  extractionBatchPutPayloadAfterUncombinePartner,
  extractionBatchPutPayloadAfterUncombineSurvivor,
  extractionBatchPutPayloadForDetailEdit,
  filterActiveExtractionBatches,
  findMergedExtractionPartnerBatch,
  applyPrunedCombinedFromBatchIds,
  getValidatedCombinedPartnerIds,
  isExtractionBatchActiveForCombine,
  isExtractionBatchMergedAbsorbed,
  isPartnerMergedIntoSurvivor,
  mergeExtractionPollState,
  mergeExtractionSourceRows,
  sweepMergedExtractionBatchesToCompleted,
  sweepPhantomCombinedLinksOnBatches,
  sanitizeExtractionBatchMergeState,
  survivorPutPayloadAfterPhantomMergeClear,
  rebuildExtractionBatchSourceSummary,
  ensureExtractionBatchMaterialTotals,
  resolveExtractionBatchSourceRows,
  resolveAbsorbedForUncombine,
  setExtractionBatchCombinedOilGrams,
  setExtractionBatchTotalBiomassLbs,
  subtractExtractionSourceRows,
} from "@/lib/extractionMergeHelpers";
import {
  buildFinishDecarbYieldTaskFields,
  computeExtractionYieldMetrics,
  formatYieldGramsDisplay,
  formatYieldPercentDisplay,
  getLegacyFinishBatchYieldPercent,
  readTotalTerpsCollectedGrams,
  readTerpAddBackPercentFromConfig,
  syncExtractionYieldFieldsToBatch,
} from "@/lib/extractionYieldHelpers";
import { ExtractionBatchYieldSummary } from "@/components/extraction/ExtractionBatchYieldSummary";
import { buildTaskChallengeAttachment } from "@/lib/taskChallengePayload";
import {
  formatLogDisplayTime,
  nowIsoForLog,
  syncCompanyTimezoneFromConfigPayload,
} from "@/lib/companyTimezone";
import { DymoLabelCalibrationPanel } from "@/components/extraction/DymoLabelCalibrationPanel";
import {
  buildExtractionBatchLabelFields,
  ExtractionBatchLabelPreview,
  openExtractionBatchLabelPrintWindow,
} from "@/components/extraction/ExtractionBatchLabelPrint";
import {
  collectExtractionCultivationSourceLabels,
  extractionBatchMarketBatchCode,
  extractionBatchSavedMarketBatchCode,
  findActiveExtractionBatchWithMarketCode,
  formatExtractionCultivationSourceFooter,
} from "@/lib/extractionBatchDisplay";

const sourceMaterialTypes = {
  freshFrozen: [
    "Live Resin Oil",
    "Live Resin Dabbable",
    "Live Resin Oil (Edible)",
  ],
  dryTrim: ["Cured Wax"],
};

const productTypes = [
  "Live Resin Oil",
  "Live Resin Dabbable",
  "Live Resin Oil (Edible)",
  "Cured Wax",
];

const extractionTasks = [
  "Pack Socks Start",
  "Pack Socks Stop",
  "Combine Batches",
  "Undo Combine",
  "Print Batch Label",
  "Run Extraction",
  "Start Purge",
  "Whip",
  "Start Terp Separation",
  "Finish Terp Separation",
  "Start Decarb",
  "Finish Decarb",
  "Adding Terps",
  "End Purge",
  "Testing",
  "Finish Batch",
];

const optionalRepeatableTasks = ["Whip", "Adding Terps", "Print Batch Label"];

const testingOptions = [
  "Metals",
  "Microbial",
  "Residual Solvents",
  "Pesticides",
  "Potency",
  "Homogeneity",
];

const testingStatuses = ["Submitted", "Failed", "Test Passed"];

function asArray(value: any) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

/** True when `id` is a Prisma `SourcePackage` cuid (merged from the real DB), not a legacy `FF-…` / `TRIM-…` tag. */
function isLikelyDatabaseSourcePackageId(id: unknown): boolean {
  const s = String(id ?? "").trim();
  if (!s) return false;
  if (/^(FF|TRIM)-/i.test(s)) return false;
  if (/^[A-Z]{2,4}-[A-Z0-9.-]+\d{6}/i.test(s) && s.length < 36) return false;
  return /^c[a-z0-9]{20,}$/i.test(s) || (!s.includes("-") && s.length >= 22);
}

const ROLE_LEVELS: Record<string, number> = {
  VIEW_ONLY: 1,
  CULTIVATION: 2,
  EXTRACTION: 2,
  PACKAGING: 2,
  MANAGER: 3,
  ADMIN: 4,
  OWNER: 5,
};

function hasMinimumRole(userRole: any, minimumRole: string) {
  const role = String(userRole || "").toUpperCase();

  if (String(minimumRole || "").toUpperCase() === "MANAGER") {
    return role === "OWNER" || role === "ADMIN" || role === "MANAGER";
  }

  const currentLevel = ROLE_LEVELS[role] || 0;
  const requiredLevel = ROLE_LEVELS[String(minimumRole || "").toUpperCase()] || 0;
  return currentLevel >= requiredLevel;
}

function canWriteExtraction(userRole: any) {
  const role = String(userRole || "").toUpperCase();

  return (
    role === "EXTRACTION" ||
    role === "EXTRACTION_SPECIALIST" ||
    role === "OPERATIONS_MANAGER" ||
    role === "MANAGER" ||
    role === "ADMIN" ||
    role === "OWNER"
  );
}

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


function num(value: any) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isBlank(value: any) {
  return String(value ?? "").trim() === "";
}

function getDateCode() {
  const today = new Date();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const yy = String(today.getFullYear()).slice(-2);

  return `${mm}${dd}${yy}`;
}

function extractDateCodeFromBatchId(batchId: string): string | null {
  const m = String(batchId || "").match(/-(\d{6})$/);
  return m ? m[1] : null;
}

/** First 4 letters of the creative name + . + MMDDYY (from extraction id suffix when present). */
function makeMarketBatchCode(creativeName: string, extractionBatchId: string): string {
  const letters = String(creativeName || "")
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase();
  const core = (letters + "XXXX").slice(0, 4);
  const datePart = extractDateCodeFromBatchId(extractionBatchId) || getDateCode();
  return `${core}.${datePart}`;
}

/** Public lot code when creating an extraction run from source rows (acronym + extraction date). */
function makeBlendMarketBatchCodeFromSourceRows(
  rows: Array<{ acronym?: string }>,
  extractionBatchId: string,
): string {
  const acronyms = rows.map((r) => cleanAcronym(r.acronym)).filter(Boolean);
  const dateFromExt = extractDateCodeFromBatchId(extractionBatchId);
  const isoDate = dateFromExt
    ? `20${dateFromExt.slice(4, 6)}-${dateFromExt.slice(0, 2)}-${dateFromExt.slice(2, 4)}`
    : new Date().toISOString().slice(0, 10);
  return makeExtractionMarketBatchCode(acronyms, isoDate);
}

function sourcePackageDisplayId(row: { id?: string; harvestCode?: string }): string {
  return String(row.harvestCode || row.id || "").trim();
}

function cleanAcronym(value: any) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
}

function getSourceAcronym(src: any) {
  const genericPrefixes = new Set([
    "FF",
    "FRESH",
    "FROZEN",
    "FRESHFROZEN",
    "DRY",
    "TRIM",
    "DRYTRIM",
    "SOURCE",
    "SRC",
    "BATCH",
  ]);

  const directFields = [
    src?.strainAcronym,
    src?.strainCode,
    src?.acronym,
    src?.strain?.acronym,
    src?.strain?.code,
  ];

  for (const field of directFields) {
    const cleaned = cleanAcronym(field);
    if (cleaned && !genericPrefixes.has(cleaned)) {
      return cleaned;
    }
  }

  const id = String(src?.sourceId || src?.id || "");
  const idParts = id
    .split("-")
    .map((part) => cleanAcronym(part))
    .filter(Boolean);

  for (const part of idParts) {
    if (!genericPrefixes.has(part) && !/^\d+$/.test(part)) {
      return part;
    }
  }

  const nameText = String(src?.strainName || src?.name || src?.type || "");
  const acronymMatch = nameText.match(/\(([A-Za-z0-9]+)\)/);

  if (acronymMatch) {
    const cleaned = cleanAcronym(acronymMatch[1]);
    if (cleaned && !genericPrefixes.has(cleaned)) {
      return cleaned;
    }
  }

  const words = nameText
    .replace(/fresh frozen|dry trim|trim|source|batch/gi, "")
    .split(/\s+/)
    .map((word) => cleanAcronym(word))
    .filter(Boolean);

  if (words.length > 1) {
    return words.map((word) => word[0]).join("").slice(0, 4);
  }

  if (words.length === 1) {
    return words[0].slice(0, 4);
  }

  return "MIX";
}

type BlendNameHistoryRow = {
  id: string;
  blendKey: string;
  blendLabel: string;
  productName: string;
  lastUsedAt: string;
};

function makeProductionBatchId(sources: any[]) {
  const acronymMix = sources
    .map((src) => getSourceAcronym(src))
    .join("")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, 4);

  return `EXT-${acronymMix || "MIX"}-${getDateCode()}`;
}

export default function Extraction() {
  const s: any = store;
  const [userCanDelete, setUserCanDelete] = useState(false);
  const [userCanWrite, setUserCanWrite] = useState(false);

  useEffect(() => {
    const user = getAuthUser();
    setUserCanDelete(hasMinimumRole(user?.role, "MANAGER"));
    setUserCanWrite(canWriteExtraction(user?.role));

    let active = true;

    async function loadSharedCompanyData() {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        await loadBackendStore({ skipFullStoreIfUnchanged: true });
        await hydrateTaskLogsFromApi();

        const [realSourceBatches, realExtractionBatches] = await Promise.all([
          loadSourceBatches(),
          loadExtractionBatches(),
        ]);

        if (!active) return;

        const sourceList = asArray(realSourceBatches);
        const extractionList = asArray(realExtractionBatches);

        s.sourceBatches = sourceList.filter((batch: any) => {
          const isDbSourcePackage = isLikelyDatabaseSourcePackageId(batch?.id);
          if (isDbSourcePackage) {
            // Prisma-backed source packages can still be stale if available was consumed to 0.
            return !isCompletedSourceBatch(batch) && getSourceAvailable(batch) > 0;
          }
          return !isCompletedSourceBatch(batch) && getSourceAvailable(batch) > 0;
        });
        s.completedSourceBatches = sourceList.filter((batch: any) => {
          const isDbSourcePackage = isLikelyDatabaseSourcePackageId(batch?.id);
          if (isDbSourcePackage) {
            return isCompletedSourceBatch(batch);
          }
          return isCompletedSourceBatch(batch) || getSourceAvailable(batch) <= 0;
        });
        const prevExById = new Map<string, any>(
          (s.extractionBatches || [])
            .map((b: any): [string, any] => [String(b?.id || ""), b])
            .filter(([k]: [string, any]) => k),
        );
        const prevCompletedExById = new Map<string, any>(
          (s.completedExtractionBatches || [])
            .map((b: any): [string, any] => [String(b?.id || ""), b])
            .filter(([k]: [string, any]) => k),
        );
        const activeExtraction: any[] = [];
        const completedMergedExtraction: any[] = [];
        for (const b of extractionList) {
          const id = String(b?.id || "");
          const prev = prevExById.get(id) || prevCompletedExById.get(id);
          const row = sanitizeExtractionBatchMergeState(
            prev ? mergeExtractionPollState(b, prev) : b,
          );
          if (isExtractionBatchMergedAbsorbed(row)) {
            completedMergedExtraction.push(row);
          } else {
            activeExtraction.push(row);
          }
        }
        s.extractionBatches = activeExtraction;
        s.completedExtractionBatches = completedMergedExtraction;
        sweepMergedExtractionBatchesToCompleted(s);
        sweepPhantomCombinedLinksOnBatches(s.extractionBatches, s.completedExtractionBatches);

        setSelectedExt((current: any) => {
          if (current?.id) {
            const stillExists = activeExtraction.find((batch: any) => batch.id === current.id);
            if (stillExists) return mergeExtractionPollState(stillExists, current);
          }
          return null;
        });
        setRefresh((n) => n + 1);
      } catch (error) {
        console.error("Could not load real extraction/source tables:", error);

        try {
          await loadBackendStore();
          await hydrateTaskLogsFromApi();

          if (!active) return;

          setSelectedExt((current: any) => current ?? null);
          setRefresh((n) => n + 1);
        } catch (backupError) {
          console.error("Could not load backend store backup on Extraction page:", backupError);
        }
      }
    }

    loadSharedCompanyData();

    const interval = setInterval(() => {
      loadSharedCompanyData();
    }, 15_000);

    const onVis = () => {
      if (!document.hidden) void loadSharedCompanyData();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      active = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  useEffect(() => {
    void loadBlendNameHistory();
  }, []);

  if (!s.sourceBatches) s.sourceBatches = [];
  if (!s.completedSourceBatches) s.completedSourceBatches = [];
  if (!s.extractionBatches) s.extractionBatches = [];
  if (!s.completedExtractionBatches) s.completedExtractionBatches = [];
  if (!s.packagingBatches) s.packagingBatches = [];
  if (!s.logs) s.logs = [];

  const [refresh, setRefresh] = useState(0);
  const [selectedExtractionStage, setSelectedExtractionStage] = useState<ExtractionUiStageKey | null>(null);
  const [selectedExt, setSelectedExt] = useState<any>(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editSourcePackage, setEditSourcePackage] = useState<any>(null);
  const [editSourceSaving, setEditSourceSaving] = useState(false);
  const [editSourceId, setEditSourceId] = useState("");
  const [editSourceName, setEditSourceName] = useState("");
  const [editSourceType, setEditSourceType] = useState("Fresh Frozen");
  const [editSourceCultivationId, setEditSourceCultivationId] = useState("");
  const [editSourceBundles, setEditSourceBundles] = useState("");
  const [editSourceGrams, setEditSourceGrams] = useState("");
  const [editSourceWeightLbs, setEditSourceWeightLbs] = useState("");
  const [editSourceStatus, setEditSourceStatus] = useState("");
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [viewBatch, setViewBatch] = useState<any>(null);
  const [viewBatchEditing, setViewBatchEditing] = useState(false);
  const [editBatchSaving, setEditBatchSaving] = useState(false);
  const [editBatchName, setEditBatchName] = useState("");
  const [editProductType, setEditProductType] = useState("");
  const [editMarketBatchCode, setEditMarketBatchCode] = useState("");
  const [editSourceBlendLabel, setEditSourceBlendLabel] = useState("");
  const [showAiNameModal, setShowAiNameModal] = useState(false);
  const [aiNameLoading, setAiNameLoading] = useState(false);
  const [aiNameError, setAiNameError] = useState("");
  const [aiNameSuggestions, setAiNameSuggestions] = useState<string[]>([]);
  const [draftFinishBatchName, setDraftFinishBatchName] = useState("");
  const [draftFinishBatchCode, setDraftFinishBatchCode] = useState("");
  const [finishBatchManualName, setFinishBatchManualName] = useState("");
  const [blendNameHistory, setBlendNameHistory] = useState<BlendNameHistoryRow[]>([]);
  const [terpAddBackPercentOfOilWeight, setTerpAddBackPercentOfOilWeight] = useState(0);

  const [dymoSavedCalibration, setDymoSavedCalibration] =
    useState<DymoLabelCalibrationSettings>(defaultDymoLabelCalibrationSettings);
  const [dymoDraftCalibration, setDymoDraftCalibration] =
    useState<DymoLabelCalibrationSettings>(defaultDymoLabelCalibrationSettings);
  const [dymoSaveBusy, setDymoSaveBusy] = useState(false);
  const [dymoSaveError, setDymoSaveError] = useState<string | null>(null);
  const [dymoLabelPrintCopies, setDymoLabelPrintCopies] = useState(1);
  const dymoLabelPrintCopiesClamped = useMemo(
    () => clampDymoLabelPrintCopies(dymoLabelPrintCopies),
    [dymoLabelPrintCopies],
  );

  const [type, setType] = useState(productTypes[0]);
  const [sourceInputs, setSourceInputs] = useState<any[]>([
    { sourceId: "", amount: "" },
  ]);

  const [extractionTaskList, setExtractionTaskList] = useState<string[]>(() =>
    mergeWorkflowTaskList(extractionTasks, []),
  );
  const [rewardsCfg, setRewardsCfg] = useState<ReturnType<typeof extractRewardsFromCompanyConfig> | null>(null);
  const [customTasksRewardDefs, setCustomTasksRewardDefs] = useState<CustomTasksRewardDefs>(() =>
    extractCustomTasksRewardDefsFromCompanyConfig({}),
  );
  const extractionCustomTaskLabels = useMemo(
    () => new Set(customTasksRewardDefs.extraction.map((d) => d.label.trim()).filter(Boolean)),
    [customTasksRewardDefs],
  );

  const [selectedTask, setSelectedTask] = useState(extractionTasks[0]);
  const [combinePartnerBatchId, setCombinePartnerBatchId] = useState("");
  const [combineSurvivorLbs, setCombineSurvivorLbs] = useState("");
  const [combinePartnerLbs, setCombinePartnerLbs] = useState("");
  const [combineNotes, setCombineNotes] = useState("");
  const [undoCombinePartnerId, setUndoCombinePartnerId] = useState("");
  const [uncombineBusyPartnerId, setUncombineBusyPartnerId] = useState("");

  const combineUsesOilGrams = Boolean(
    selectedExt && selectedTask === "Combine Batches" && extractionCombineUsesOilGrams(selectedExt),
  );

  useEffect(() => {
    if (selectedTask !== "Combine Batches" || !selectedExt) return;
    if (extractionCombineUsesOilGrams(selectedExt)) {
      const grams = extractionBatchOilGrams(selectedExt);
      setCombineSurvivorLbs(grams > 0 ? String(grams) : "");
      return;
    }
    const lbs = extractionBatchBiomassLbs(selectedExt);
    setCombineSurvivorLbs(lbs > 0 ? String(lbs) : "");
  }, [selectedTask, selectedExt?.id]);

  useEffect(() => {
    if (selectedTask !== "Combine Batches" || !combinePartnerBatchId.trim()) return;
    const partner = s.extractionBatches.find((b: any) => b?.id === combinePartnerBatchId.trim());
    if (!partner) return;
    if (selectedExt && extractionCombineUsesOilGrams(selectedExt)) {
      const grams = extractionBatchOilGrams(partner);
      setCombinePartnerLbs(grams > 0 ? String(grams) : "");
      return;
    }
    const lbs = extractionBatchBiomassLbs(partner);
    setCombinePartnerLbs(lbs > 0 ? String(lbs) : "");
  }, [selectedTask, combinePartnerBatchId, selectedExt?.id]);

  useEffect(() => {
    if (selectedTask !== "Undo Combine" || !selectedExt) return;
    const merged = getMergedPartnerIds(selectedExt);
    setUndoCombinePartnerId(merged[0] || "");
  }, [selectedTask, selectedExt?.id]);

  const [packSockTechCount, setPackSockTechCount] = useState("1");
  const [packSockTechNames, setPackSockTechNames] = useState<string[]>([""]);
  const [totalSocksPacked, setTotalSocksPacked] = useState("");
  const [sockGramInputs, setSockGramInputs] = useState<string[]>([]);

  const [runTime, setRunTime] = useState("");
  const [finalProduct, setFinalProduct] = useState(productTypes[0]);
  const [totalGasLoss, setTotalGasLoss] = useState("");
  const [totalSilicaUsed, setTotalSilicaUsed] = useState("");
  const [totalB80Used, setTotalB80Used] = useState("");
  const [howManyTechs, setHowManyTechs] = useState("1");
  const [techNames, setTechNames] = useState<string[]>([""]);

  const [dateInOven, setDateInOven] = useState("");
  const [ovenTemp, setOvenTemp] = useState("");
  const [dateOutOven, setDateOutOven] = useState("");

  const [whipPeople, setWhipPeople] = useState("");
  const [whipTime, setWhipTime] = useState("");

  const [terpStart, setTerpStart] = useState("");
  const [terpStartTechCount, setTerpStartTechCount] = useState("1");
  const [terpStartTechNames, setTerpStartTechNames] = useState<string[]>([""]);
  const [terpStartNotes, setTerpStartNotes] = useState("");

  const [terpEnd, setTerpEnd] = useState("");
  const [terpFinishTechCount, setTerpFinishTechCount] = useState("1");
  const [terpFinishTechNames, setTerpFinishTechNames] = useState<string[]>([""]);
  const [totalTerps, setTotalTerps] = useState("");
  const [terpFinishNotes, setTerpFinishNotes] = useState("");

  const [decarbStart, setDecarbStart] = useState("");
  const [decarbStartWeight, setDecarbStartWeight] = useState("");
  const [decarbMaxTemp, setDecarbMaxTemp] = useState("");
  const [decarbStartTechCount, setDecarbStartTechCount] = useState("1");
  const [decarbStartTechNames, setDecarbStartTechNames] = useState<string[]>([""]);
  const [decarbStartNotes, setDecarbStartNotes] = useState("");

  const [decarbEnd, setDecarbEnd] = useState("");
  const [decarbEndWeight, setDecarbEndWeight] = useState("");
  const [decarbFinishTechCount, setDecarbFinishTechCount] = useState("1");
  const [decarbFinishTechNames, setDecarbFinishTechNames] = useState<string[]>([""]);
  const [decarbFinishNotes, setDecarbFinishNotes] = useState("");

  const [addingTerpsPeople, setAddingTerpsPeople] = useState("");
  const [addingTerpsTime, setAddingTerpsTime] = useState("");
  const [totalTerpsAdded, setTotalTerpsAdded] = useState("");
  const [addingTerpsNotes, setAddingTerpsNotes] = useState("");

  const [selectedTests, setSelectedTests] = useState<string[]>([]);
  const [testingStatus, setTestingStatus] = useState(testingStatuses[0]);
  const [dateSubmitted, setDateSubmitted] = useState("");

  const [finalOilGrams, setFinalOilGrams] = useState("");
  const [extraTerpsGrams, setExtraTerpsGrams] = useState("");
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

  useEffect(() => {
    setViewBatchEditing(false);
  }, [viewBatch?.id]);

  useEffect(() => {
    const grouped = groupExtractionBatchesByUiStage(filterActiveExtractionBatches(s.extractionBatches));
    if (selectedExtractionStage === null) {
      setSelectedExt(null);
      return;
    }
    const list = grouped[selectedExtractionStage];
    setSelectedExt((prev: any) => {
      if (prev && list.some((b: any) => b.id === prev.id)) return prev;
      return list[0] ?? null;
    });
  }, [selectedExtractionStage, s.extractionBatches, refresh]);

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
    details = "",
    confirmText = "Confirm",
    cancelText = "Cancel",
  ) {
    setNotificationModal({
      open: true,
      title,
      message,
      details,
      confirmText,
      cancelText,
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

  function requireWriteAccess(action = "change extraction data") {
    if (userCanWrite) return true;

    showNotice(
      "Read Only Access",
      `Your current role can view this page, but cannot ${action}.`
    );

    return false;
  }

  function startViewBatchEdit() {
    if (!viewBatch) return;
    if (!requireWriteAccess("edit extraction batch details")) return;
    setEditBatchName(String(viewBatch.name ?? ""));
    setEditProductType(
      String(viewBatch.productType || viewBatch.name || productTypes[0] || ""),
    );
    setEditMarketBatchCode(String(viewBatch.marketBatchCode ?? ""));
    setEditSourceBlendLabel(String(viewBatch.sourceBlendLabel ?? ""));
    setViewBatchEditing(true);
  }

  function cancelViewBatchEdit() {
    setViewBatchEditing(false);
  }

  function openCombineForMarketBatchCodeConflict(survivor: any, partner: any) {
    setViewBatchEditing(false);
    setViewBatch(null);
    setSelectedExt(survivor);
    setCombinePartnerBatchId(String(partner.id || ""));
    if (extractionCombineUsesOilGrams(survivor)) {
      const survivorOil = extractionBatchOilGrams(survivor);
      const partnerOil = extractionBatchOilGrams(partner);
      setCombineSurvivorLbs(survivorOil > 0 ? String(survivorOil) : "");
      setCombinePartnerLbs(partnerOil > 0 ? String(partnerOil) : "");
    } else {
      const survivorLbs = extractionBatchBiomassLbs(survivor);
      const partnerLbs = extractionBatchBiomassLbs(partner);
      setCombineSurvivorLbs(survivorLbs > 0 ? String(survivorLbs) : "");
      setCombinePartnerLbs(partnerLbs > 0 ? String(partnerLbs) : "");
    }
    setCombineNotes("");
    setSelectedTask("Combine Batches");
    setShowTaskModal(true);
    showSyncMessageNotice(
      "Use Combine Batches to merge, or cancel and pick a unique market batch code.",
    );
  }

  function promptIfDuplicateMarketBatchCode(
    nextCode: string,
    batchId: string,
    onProceed: () => void,
  ): boolean {
    const trimmed = String(nextCode || "").trim();
    if (!trimmed) {
      onProceed();
      return true;
    }

    const previousCode = extractionBatchSavedMarketBatchCode(
      s.extractionBatches.find((b: any) => b.id === batchId) || {},
    );
    if (previousCode && previousCode.toLowerCase() === trimmed.toLowerCase()) {
      onProceed();
      return true;
    }

    const conflict = findActiveExtractionBatchWithMarketCode(
      filterActiveExtractionBatches(s.extractionBatches || []),
      trimmed,
      batchId,
    );
    if (!conflict) {
      onProceed();
      return true;
    }

    const survivor =
      s.extractionBatches.find((b: any) => b.id === batchId) ||
      (viewBatch?.id === batchId ? viewBatch : null);
    if (!survivor) {
      showNotice(
        "Market batch code in use",
        `Another active batch (${extractionBatchMarketBatchCode(conflict)}) already uses "${trimmed}". Choose a different code.`,
        `Conflicting run id: ${conflict.id}`,
      );
      return false;
    }

    const conflictLabel = extractionBatchMarketBatchCode(conflict);
    showConfirm(
      "Market batch code already in use",
      `Another active batch (${conflictLabel}, run ${conflict.id}) already uses "${trimmed}". Merge that batch into this one?`,
      () => openCombineForMarketBatchCodeConflict(survivor, conflict),
      `If you do not want to merge, pick a unique code (for example ${trimmed}.2 or a different date). Saving was not applied.`,
      "Merge batches",
      "Change code",
    );
    return false;
  }

  async function saveViewBatchEdits() {
    if (!viewBatch) return;
    if (!requireWriteAccess("edit extraction batch details")) return;
    if (
      !requireFields([
        { label: "Batch / product name", value: editBatchName },
        { label: "Product type", value: editProductType },
      ])
    ) {
      return;
    }

    const nextMarketCode = editMarketBatchCode.trim();
    if (
      !promptIfDuplicateMarketBatchCode(nextMarketCode, viewBatch.id, () => {
        void runSaveViewBatchEdits(nextMarketCode);
      })
    ) {
      return;
    }
  }

  async function runSaveViewBatchEdits(nextMarketCode: string) {
    if (!viewBatch) return;

    const latest =
      s.extractionBatches.find((b: any) => b.id === viewBatch.id) || viewBatch;
    const payload: any = extractionBatchPutPayloadForDetailEdit({
      ...latest,
      name: editBatchName.trim(),
      productType: editProductType.trim(),
      marketBatchCode: nextMarketCode,
      sourceBlendLabel: editSourceBlendLabel.trim(),
    });

    setEditBatchSaving(true);
    try {
      const updated = await updateExtractionBatch(viewBatch.id, payload);
      if (updated && typeof updated === "object") {
        const cleaned = sanitizeExtractionBatchMergeState(updated);
        const row = s.extractionBatches.find((b: any) => b.id === viewBatch.id);
        if (row) Object.assign(row, cleaned);
        s.completedExtractionBatches = (s.completedExtractionBatches || []).filter(
          (b: any) => String(b?.id || "") !== String(viewBatch.id),
        );
        sweepMergedExtractionBatchesToCompleted(s);
        setViewBatch((prev: any) =>
          prev && prev.id === viewBatch.id ? { ...prev, ...cleaned } : prev,
        );
        setSelectedExt((cur: any) =>
          cur?.id === viewBatch.id ? { ...cur, ...cleaned } : cur,
        );
        setViewBatchEditing(false);
        showSyncMessageNotice("Batch details saved.");
        forceRefresh();
      }
    } catch (error) {
      console.error("Could not save extraction batch edits:", error);
      showNotice(
        "Backend Save Failed",
        error instanceof Error
          ? error.message
          : "The server rejected the update.",
      );
    } finally {
      setEditBatchSaving(false);
    }
  }

  function requireFields(fields: { label: string; value: any }[]) {
    const missing = fields.filter((field) => isBlank(field.value));

    if (missing.length > 0) {
      showNotice(
        "Missing Required Fields",
        "Please fill out the required field(s).",
        missing.map((field) => field.label).join(", ")
      );
      return false;
    }

    return true;
  }

  function requirePositiveNumber(label: string, value: any) {
    if (isBlank(value) || num(value) <= 0) {
      showNotice(
        "Invalid Number",
        `Please enter a number greater than 0 for ${label}.`
      );
      return false;
    }

    return true;
  }

  function requireTechNames(label: string, names: string[]) {
    const missingIndex = names.findIndex((name) => isBlank(name));

    if (missingIndex >= 0) {
      showNotice(
        "Missing Tech Name",
        `Please fill out ${label} ${missingIndex + 1}.`
      );
      return false;
    }

    return true;
  }

  function forceRefresh() {
    setRefresh((n) => n + 1);

    saveBackendStore().catch((error) => {
      console.error("Could not save backend store from Extraction page:", error);
    });
  }

  function makeBlendSignatureFromBatch(batch: any) {
    const parts = collectStrainNamesForExtractionBatch(batch)
      .map((n) => String(n || "").trim())
      .filter(Boolean)
      .map((n) => n.toLowerCase())
      .sort();
    return {
      blendKey: parts.join("|"),
      blendLabel: parts
        .map((p) => p.replace(/\b\w/g, (c) => c.toUpperCase()))
        .join(" · "),
    };
  }

  async function loadBlendNameHistory() {
    try {
      const cfg = await fetchCachedCompanyConfig<any>("/api/config/extraction");
      syncCompanyTimezoneFromConfigPayload(cfg);
      const rows = Array.isArray(cfg?.extraction?.blendNameHistory)
        ? cfg.extraction.blendNameHistory
        : [];
      setBlendNameHistory(rows as BlendNameHistoryRow[]);
      setTerpAddBackPercentOfOilWeight(readTerpAddBackPercentFromConfig(cfg?.extraction));
      setRewardsCfg(extractRewardsFromCompanyConfig(cfg));
      const defs = extractCustomTasksRewardDefsFromCompanyConfig(cfg);
      setCustomTasksRewardDefs(defs);
      const merged = mergeWorkflowTaskList(extractionTasks, defs.extraction);
      setExtractionTaskList(merged);
      setSelectedTask((prev) => (merged.includes(prev) ? prev : merged[0] || extractionTasks[0]));
      const cid = getSelectedCompanyId();
      const dymoResolved = resolveDymoLabelCalibration(cid, cfg);
      setDymoSavedCalibration(dymoResolved);
      setDymoDraftCalibration(dymoResolved);
      setDymoSaveError(null);
    } catch (error) {
      console.error("Could not load extraction blend name history:", error);
      const cid = getSelectedCompanyId();
      const fallback = resolveDymoLabelCalibration(cid, {});
      setDymoSavedCalibration(fallback);
      setDymoDraftCalibration(fallback);
    }
  }

  async function saveBlendNameToConfig(batch: any, productName: string) {
    const cleanName = String(productName || "").trim();
    if (!batch || !cleanName) return;
    const { blendKey, blendLabel } = makeBlendSignatureFromBatch(batch);
    if (!blendKey) return;
    const nowIso = new Date().toISOString();
    const cfg = await fetchCachedCompanyConfig<any>("/api/config/extraction", { skipCache: true });
    syncCompanyTimezoneFromConfigPayload(cfg);
    const extractionCfg =
      cfg?.extraction && typeof cfg.extraction === "object" ? cfg.extraction : {};
    const current = Array.isArray(extractionCfg?.blendNameHistory)
      ? [...extractionCfg.blendNameHistory]
      : [];
    const existing = current.find(
      (row) =>
        String(row.blendKey || "") === blendKey &&
        String(row.productName || "").trim().toLowerCase() === cleanName.toLowerCase()
    );
    const nextRows = existing
      ? current.map((row) =>
          row.id === existing.id ? { ...row, blendLabel, lastUsedAt: nowIso } : row
        )
      : [
          {
            id: `blend-name-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
            blendKey,
            blendLabel,
            productName: cleanName,
            lastUsedAt: nowIso,
          },
          ...current,
        ];
    await apiRequest("/api/config", {
      method: "PUT",
      body: {
        extraction: {
          ...extractionCfg,
          blendNameHistory: nextRows,
        },
      },
    });
    invalidateCompanyConfigClientCache();
    setBlendNameHistory(nextRows);
  }

  async function saveDymoCalibrationSettings() {
    setDymoSaveError(null);
    const validated = validateDymoLabelCalibrationSettings(dymoDraftCalibration);
    if (!validated.ok) {
      const msg = validated.errors.join("; ");
      setDymoSaveError(msg);
      showNotice("DYMO calibration", msg);
      return;
    }
    setDymoSaveBusy(true);
    try {
      const cfg = await fetchCachedCompanyConfig<any>("/api/config/extraction", { skipCache: true });
      syncCompanyTimezoneFromConfigPayload(cfg);
      const extractionCfg =
        cfg?.extraction && typeof cfg.extraction === "object" ? cfg.extraction : {};
      await apiRequest("/api/config", {
        method: "PUT",
        body: {
          extraction: {
            ...extractionCfg,
            dymoLabelCalibration: validated.value,
          },
        },
      });
      invalidateCompanyConfigClientCache();
      writeDymoCalibrationToLocalStorage(getSelectedCompanyId(), validated.value);
      setDymoSavedCalibration(validated.value);
      setDymoDraftCalibration(validated.value);
      showNotice(
        "DYMO calibration saved",
        "Extraction batch labels will use these dimensions and offsets on every workstation that loads company config.",
      );
    } catch (error) {
      console.error("Could not save DYMO calibration:", error);
      writeDymoCalibrationToLocalStorage(getSelectedCompanyId(), validated.value);
      setDymoSavedCalibration(validated.value);
      setDymoDraftCalibration(validated.value);
      setDymoSaveError("Could not reach API; backup saved in this browser only.");
      showNotice(
        "DYMO calibration (offline backup)",
        "Settings were saved only in this browser. Reconnect or check permissions, then tap Save again so all devices pick them up.",
      );
    } finally {
      setDymoSaveBusy(false);
    }
  }

  function saveLog(log: any) {
    s.logs.unshift(log);

    createLog({
      area: log.area || "Extraction",
      batch: log.batch,
      task: log.task || "Log",
      output: log.output || "",
      source: log.source,
      linkedBatch: log.linkedBatch,
      data: {
        ...(log.data || {}),
        loggedBy: log.loggedBy,
        time: log.time,
      },
    }).catch((error) => {
      console.error("Could not save extraction log to backend:", error);
    });
  }

  function getCompletedTasks(batch: any) {
    if (!batch.completedTasks) batch.completedTasks = [];
    return batch.completedTasks;
  }

  function taskDataShowsCompleted(batch: any, task: string): boolean {
    const td = batch?.taskData?.[task];
    if (td === undefined || td === null) return false;
    if (Array.isArray(td)) return td.length > 0;
    if (typeof td === "object") return Object.keys(td).length > 0;
    return Boolean(td);
  }

  function hasCompletedTask(batch: any, task: string) {
    if (optionalRepeatableTasks.includes(task)) {
      return (
        getCompletedTasks(batch).includes(task) ||
        getCompletedTasks(batch).some((t: string) => t.startsWith(`${task} `))
      );
    }
    if (task === "Testing") {
      return getTestingStatus(batch) === "Test Passed";
    }
    if (getCompletedTasks(batch).includes(task)) return true;
    return taskDataShowsCompleted(batch, task);
  }

  function getTestingStatus(batch: any) {
    return batch?.taskData?.Testing?.testingStatus || "";
  }

  function formatDuration(ms: number) {
    if (!Number.isFinite(ms) || ms <= 0) return "—";

    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }

  function getPackSockStartTime(batch: any) {
    return batch?.taskData?.["Pack Socks Start"]?.startedAt || "";
  }

  function getPackSockPrepStats(batch: any) {
    const startTime = getPackSockStartTime(batch);
    const stopData = batch?.taskData?.["Pack Socks Stop"] || {};
    const stoppedAt = stopData.stoppedAt || "";
    const startMs = startTime ? new Date(startTime).getTime() : 0;
    const stopMs = stoppedAt ? new Date(stoppedAt).getTime() : 0;
    const totalPreparedGrams = num(stopData.totalPreparedGrams);
    const totalPreparedLbs = num(stopData.totalPreparedLbs);

    return {
      startTime,
      stoppedAt,
      duration: startMs > 0 && stopMs > 0 ? formatDuration(stopMs - startMs) : "—",
      totalSocks: num(stopData.totalSocksPacked),
      sockWeightsGrams: Array.isArray(stopData.sockWeightsGrams)
        ? stopData.sockWeightsGrams.map((value: any) => num(value))
        : [],
      averageGramsPerSock:
        num(stopData.averageGramsPerSock) ||
        num(stopData.totalGramsPerSock) ||
        (num(stopData.totalSocksPacked) > 0
          ? +(totalPreparedGrams / num(stopData.totalSocksPacked)).toFixed(2)
          : 0),
      totalPreparedGrams,
      totalPreparedLbs,
    };
  }

  function getCurrentPackSockDuration(batch: any) {
    const startTime = getPackSockStartTime(batch);
    const startMs = startTime ? new Date(startTime).getTime() : 0;

    if (startMs <= 0) return "—";

    return formatDuration(Date.now() - startMs);
  }

  function getNextAllowedTask(batch: any) {
    if (!hasCompletedTask(batch, "Pack Socks Start")) return "Pack Socks Start";
    if (!hasCompletedTask(batch, "Pack Socks Stop")) return "Pack Socks Stop";
    if (!hasCompletedTask(batch, "Run Extraction")) return "Run Extraction";
    if (!hasCompletedTask(batch, "Start Purge")) return "Start Purge";
    if (!hasCompletedTask(batch, "End Purge")) return "End Purge";
    if (getTestingStatus(batch) !== "Test Passed") return "Testing";
    if (!hasCompletedTask(batch, "Finish Batch")) return "Finish Batch";
    return "Complete";
  }

  function isTaskAllowed(batch: any, task: string) {
    const packSocksStarted = hasCompletedTask(batch, "Pack Socks Start");
    const packSocksStopped = hasCompletedTask(batch, "Pack Socks Stop");
    const hasRun = hasCompletedTask(batch, "Run Extraction");
    const purgeStarted = hasCompletedTask(batch, "Start Purge");
    const purgeEnded = hasCompletedTask(batch, "End Purge");
    const terpStarted = hasCompletedTask(batch, "Start Terp Separation");
    const terpFinished = hasCompletedTask(batch, "Finish Terp Separation");
    const decarbStarted = hasCompletedTask(batch, "Start Decarb");
    const decarbFinished = hasCompletedTask(batch, "Finish Decarb");
    const finished = hasCompletedTask(batch, "Finish Batch");

    if (task === "Pack Socks Start") return !packSocksStarted;
    if (task === "Pack Socks Stop") return packSocksStarted && !packSocksStopped;
    /** Anytime reprint; does not gate other tasks. */
    if (task === "Print Batch Label") return true;
    if (task === "Run Extraction") return packSocksStopped && !hasRun;
    if (task === "Start Purge") return hasRun && !purgeStarted;

    if (task === "Start Terp Separation") {
      return purgeStarted && !terpStarted && !finished;
    }

    if (task === "Finish Terp Separation") {
      return terpStarted && !terpFinished && !finished;
    }

    if (task === "Start Decarb") {
      return purgeStarted && !decarbStarted && !finished;
    }

    if (task === "Finish Decarb") {
      return decarbStarted && !decarbFinished && !finished;
    }

    if (optionalRepeatableTasks.includes(task)) {
      return purgeStarted && !finished;
    }

    if (task === "End Purge") return purgeStarted && !purgeEnded;
    if (task === "Testing") return purgeEnded && !finished;

    if (task === "Finish Batch") {
      return getTestingStatus(batch) === "Test Passed" && !finished;
    }

    if (task === "Combine Batches") {
      return isExtractionBatchActiveForCombine(batch);
    }

    if (task === "Undo Combine") {
      return getMergedPartnerIds(batch).length > 0;
    }

    if (extractionCustomTaskLabels.has(task)) {
      const hasRun = hasCompletedTask(batch, "Run Extraction");
      const fin = hasCompletedTask(batch, "Finish Batch");
      return hasRun && !fin;
    }

    return false;
  }

  function getDefaultTaskForBatch(batch: any) {
    if (isTaskAllowed(batch, "Whip")) return "Whip";
    return getNextAllowedTask(batch);
  }

  function getExtractionSourceRowsForDisplay(batch: any) {
    return resolveExtractionBatchSourceRows(batch, getSource);
  }

  function getSource(sourceId: string) {
    return s.sourceBatches.find((b: any) => b.id === sourceId);
  }

  function extractionBatchCultivationFooter(batch: any): string {
    return formatExtractionCultivationSourceFooter(
      collectExtractionCultivationSourceLabels(batch, getSource),
    );
  }

  function collectStrainNamesForExtractionBatch(batch: any): string[] {
    if (!Array.isArray(batch?.sources)) return [];
    const rows = batch.sources as any[];
    const names: string[] = rows
      .map((row: any) => String(row?.name || "").trim())
      .filter((n: string) => n.length > 0);
    return [...new Set(names)];
  }

  function getSavedNamesForSelectedBlend(batch: any): BlendNameHistoryRow[] {
    const { blendKey } = makeBlendSignatureFromBatch(batch);
    if (!blendKey) return [];
    return blendNameHistory
      .filter((row) => String(row?.blendKey || "") === blendKey)
      .sort(
        (a, b) =>
          new Date(String(b.lastUsedAt || 0)).getTime() -
          new Date(String(a.lastUsedAt || 0)).getTime()
      );
  }

  function getSourceMaterialType(source: any) {
    const text = String(
      source?.materialType ||
        source?.sourceMaterialType ||
        source?.type ||
        source?.name ||
        ""
    ).toLowerCase();

    if (
      text.includes("fresh frozen") ||
      text.includes("freshfrozen") ||
      text.includes("fresh")
    ) {
      return "freshFrozen";
    }

    if (
      text.includes("dry trim") ||
      text.includes("drytrim") ||
      text.includes("trim")
    ) {
      return "dryTrim";
    }

    return "";
  }

  function getAllowedProductsFromSources(sources: any[]) {
    const materialTypes = new Set(
      sources.map((src) => getSourceMaterialType(src)).filter(Boolean)
    );

    if (materialTypes.has("dryTrim") && materialTypes.has("freshFrozen")) {
      return [];
    }

    if (materialTypes.has("dryTrim")) {
      return sourceMaterialTypes.dryTrim;
    }

    if (materialTypes.has("freshFrozen")) {
      return sourceMaterialTypes.freshFrozen;
    }

    return productTypes;
  }

  function getAllowedCreateProducts() {
    const selectedSources = sourceInputs
      .map((row) => getSource(row.sourceId))
      .filter(Boolean);

    return getAllowedProductsFromSources(selectedSources);
  }

  function getAllowedRunProducts() {
    if (!selectedExt?.sources) return productTypes;

    const selectedSources = selectedExt.sources
      .map((src: any) => getSource(src.sourceId))
      .filter(Boolean);

    return getAllowedProductsFromSources(selectedSources);
  }

  function getYieldPercentage(batch: any) {
    return getLegacyFinishBatchYieldPercent(batch);
  }

  const finishDecarbYieldPreview = useMemo(() => {
    if (!selectedExt || selectedTask !== "Finish Decarb") return null;
    const finalOil = num(decarbEndWeight);
    if (finalOil <= 0) return null;
    return computeExtractionYieldMetrics(
      {
        ...selectedExt,
        finalDecarbedOilGrams: finalOil,
        totalTerpsCollectedGrams: readTotalTerpsCollectedGrams(selectedExt),
      },
      terpAddBackPercentOfOilWeight,
    );
  }, [selectedExt, selectedTask, decarbEndWeight, terpAddBackPercentOfOilWeight]);

  function getFirstAvailableSourceId() {
    const firstAvailable = s.sourceBatches.find(
      (b: any) => getSourceAvailable(b) > 0
    );

    return firstAvailable?.id || "";
  }

  function makeUniqueBatchId(baseId: string) {
    const existingIds = s.extractionBatches.map((b: any) => b.id);

    if (!existingIds.includes(baseId)) return baseId;

    let count = 2;
    let nextId = `${baseId}-${count}`;

    while (existingIds.includes(nextId)) {
      count += 1;
      nextId = `${baseId}-${count}`;
    }

    return nextId;
  }

  function allPackagingLotIds(): string[] {
    const chunks = [
      s.packagingBatches,
      s.inProgressPackagingBatches,
      s.completedPackagingBatches,
    ];
    const out: string[] = [];
    for (const arr of chunks) {
      if (!Array.isArray(arr)) continue;
      for (const b of arr) {
        const id = String(b?.id || "").trim();
        if (id) out.push(id);
      }
    }
    return out;
  }

  function makeUniquePackagingLotId(baseId: string) {
    const existing = new Set(allPackagingLotIds());
    if (!existing.has(baseId)) return baseId;
    let count = 2;
    let nextId = `${baseId}-${count}`;
    while (existing.has(nextId)) {
      count += 1;
      nextId = `${baseId}-${count}`;
    }
    return nextId;
  }

  function updateSourceInput(index: number, key: string, value: string) {
    const next = [...sourceInputs];
    next[index] = { ...next[index], [key]: value };
    setSourceInputs(next);

    if (key === "sourceId") {
      const selectedSources = next
        .map((row) => getSource(row.sourceId))
        .filter(Boolean);

      const allowedProducts = getAllowedProductsFromSources(selectedSources);

      if (allowedProducts.length > 0 && !allowedProducts.includes(type)) {
        setType(allowedProducts[0]);
      }
    }
  }

  function addSourceRow() {
    if (!requireWriteAccess("edit extraction batch sources")) return;

    setSourceInputs([
      ...sourceInputs,
      { sourceId: getFirstAvailableSourceId(), amount: "" },
    ]);
  }

  function removeSourceRow(index: number) {
    if (!requireWriteAccess("edit extraction batch sources")) return;

    const next = sourceInputs.filter((_, i) => i !== index);

    if (next.length === 0) {
      setSourceInputs([{ sourceId: getFirstAvailableSourceId(), amount: "" }]);
      return;
    }

    setSourceInputs(next);
  }

  function resetCreateForm() {
    setType(productTypes[0]);
    setSourceInputs([{ sourceId: getFirstAvailableSourceId(), amount: "" }]);
  }

  function openCreateModal() {
    if (!requireWriteAccess("create extraction batches")) return;

    const firstSourceId = getFirstAvailableSourceId();
    const firstSource = getSource(firstSourceId);
    const allowedProducts = getAllowedProductsFromSources(
      firstSource ? [firstSource] : []
    );

    setType(allowedProducts[0] || productTypes[0]);
    setSourceInputs([{ sourceId: firstSourceId, amount: "" }]);
    setShowCreateModal(true);
  }

  function updateHowManyTechs(value: string) {
    setHowManyTechs(value);

    const count = Math.max(1, Math.floor(num(value)));
    const nextNames = [...techNames];

    while (nextNames.length < count) nextNames.push("");
    while (nextNames.length > count) nextNames.pop();

    setTechNames(nextNames);
  }

  function updateTechName(index: number, value: string) {
    const next = [...techNames];
    next[index] = value;
    setTechNames(next);
  }

  function updateTerpStartTechCount(value: string) {
    setTerpStartTechCount(value);

    const count = Math.max(1, Math.floor(num(value)));
    const nextNames = [...terpStartTechNames];

    while (nextNames.length < count) nextNames.push("");
    while (nextNames.length > count) nextNames.pop();

    setTerpStartTechNames(nextNames);
  }

  function updateTerpStartTechName(index: number, value: string) {
    const next = [...terpStartTechNames];
    next[index] = value;
    setTerpStartTechNames(next);
  }

  function updateTerpFinishTechCount(value: string) {
    setTerpFinishTechCount(value);

    const count = Math.max(1, Math.floor(num(value)));
    const nextNames = [...terpFinishTechNames];

    while (nextNames.length < count) nextNames.push("");
    while (nextNames.length > count) nextNames.pop();

    setTerpFinishTechNames(nextNames);
  }

  function updateTerpFinishTechName(index: number, value: string) {
    const next = [...terpFinishTechNames];
    next[index] = value;
    setTerpFinishTechNames(next);
  }

  function updateDecarbStartTechCount(value: string) {
    setDecarbStartTechCount(value);

    const count = Math.max(1, Math.floor(num(value)));
    const nextNames = [...decarbStartTechNames];

    while (nextNames.length < count) nextNames.push("");
    while (nextNames.length > count) nextNames.pop();

    setDecarbStartTechNames(nextNames);
  }

  function updateDecarbStartTechName(index: number, value: string) {
    const next = [...decarbStartTechNames];
    next[index] = value;
    setDecarbStartTechNames(next);
  }

  function updateDecarbFinishTechCount(value: string) {
    setDecarbFinishTechCount(value);

    const count = Math.max(1, Math.floor(num(value)));
    const nextNames = [...decarbFinishTechNames];

    while (nextNames.length < count) nextNames.push("");
    while (nextNames.length > count) nextNames.pop();

    setDecarbFinishTechNames(nextNames);
  }

  function updateDecarbFinishTechName(index: number, value: string) {
    const next = [...decarbFinishTechNames];
    next[index] = value;
    setDecarbFinishTechNames(next);
  }

  function updatePackSockTechCount(value: string) {
    setPackSockTechCount(value);

    const count = Math.max(1, Math.floor(num(value)));
    const nextNames = [...packSockTechNames];

    while (nextNames.length < count) nextNames.push("");
    while (nextNames.length > count) nextNames.pop();

    setPackSockTechNames(nextNames);
  }

  function updatePackSockTechName(index: number, value: string) {
    const next = [...packSockTechNames];
    next[index] = value;
    setPackSockTechNames(next);
  }

  function updateTotalSocksPacked(value: string) {
    setTotalSocksPacked(value);

    const count = Math.max(0, Math.floor(num(value)));
    const nextWeights = [...sockGramInputs];

    while (nextWeights.length < count) nextWeights.push("");
    while (nextWeights.length > count) nextWeights.pop();

    setSockGramInputs(nextWeights);
  }

  function updateSockGramInput(index: number, value: string) {
    const nextWeights = [...sockGramInputs];
    nextWeights[index] = value;
    setSockGramInputs(nextWeights);
  }

  function getSockGramTotal(values: any[] = sockGramInputs) {
    return values.reduce((sum, value) => sum + num(value), 0);
  }

  function resetTaskForm() {
    setSelectedTask(
      selectedExt ? getDefaultTaskForBatch(selectedExt) : extractionTaskList[0] || extractionTasks[0]
    );

    setPackSockTechCount("1");
    setPackSockTechNames([""]);
    setTotalSocksPacked("");
    setSockGramInputs([]);

    setRunTime("");
    setFinalProduct(productTypes[0]);
    setTotalGasLoss("");
    setTotalSilicaUsed("");
    setTotalB80Used("");
    setHowManyTechs("1");
    setTechNames([""]);

    setDateInOven("");
    setOvenTemp("");
    setDateOutOven("");

    setWhipPeople("");
    setWhipTime("");

    setTerpStart("");
    setTerpStartTechCount("1");
    setTerpStartTechNames([""]);
    setTerpStartNotes("");

    setTerpEnd("");
    setTerpFinishTechCount("1");
    setTerpFinishTechNames([""]);
    setTotalTerps("");
    setTerpFinishNotes("");

    setDecarbStart("");
    setDecarbStartWeight("");
    setDecarbMaxTemp("");
    setDecarbStartTechCount("1");
    setDecarbStartTechNames([""]);
    setDecarbStartNotes("");

    setDecarbEnd("");
    setDecarbEndWeight("");
    setDecarbFinishTechCount("1");
    setDecarbFinishTechNames([""]);
    setDecarbFinishNotes("");

    setAddingTerpsPeople("");
    setAddingTerpsTime("");
    setTotalTerpsAdded("");
    setAddingTerpsNotes("");

    setSelectedTests([]);
    setTestingStatus(testingStatuses[0]);
    setDateSubmitted("");

    setFinalOilGrams("");
    setExtraTerpsGrams("");

    setShowAiNameModal(false);
    setAiNameLoading(false);
    setAiNameError("");
    setAiNameSuggestions([]);
    setDraftFinishBatchName("");
    setDraftFinishBatchCode("");
    setFinishBatchManualName("");
    setCombinePartnerBatchId("");
    setCombineSurvivorLbs("");
    setCombinePartnerLbs("");
    setCombineNotes("");
    setUndoCombinePartnerId("");
  }

  async function generateAiProductNames() {
    if (!selectedExt) return;
    const strains = collectStrainNamesForExtractionBatch(selectedExt);
    if (strains.length === 0) {
      showNotice(
        "No strain names",
        "Could not read strain names from this batch's saved source rows. Open batch details to confirm sources, then try again.",
      );
      return;
    }
    setAiNameError("");
    setAiNameSuggestions([]);
    setAiNameLoading(true);
    try {
      const res = await suggestExtractionProductNames(strains);
      setAiNameSuggestions(Array.isArray(res?.suggestions) ? res.suggestions : []);
    } catch (e: any) {
      setAiNameError(e?.message || "Could not get suggestions.");
    } finally {
      setAiNameLoading(false);
    }
  }

  function openTaskModal(batch?: any) {
    if (!requireWriteAccess("log extraction tasks")) return;

    const b = batch || selectedExt;
    if (!b) return;

    setSelectedExt(b);

    const allowedProducts = b.sources
      ? getAllowedProductsFromSources(
          b.sources.map((src: any) => getSource(src.sourceId)).filter(Boolean)
        )
      : productTypes;

    setFinalProduct(allowedProducts[0] || b.productType || productTypes[0]);
    setDraftFinishBatchName("");
    setDraftFinishBatchCode("");
    setFinishBatchManualName("");
    setCombinePartnerBatchId("");
    setCombineNotes("");
    setSelectedTask(getDefaultTaskForBatch(b));
    setShowTaskModal(true);
  }

  function toggleTest(test: string) {
    if (selectedTests.includes(test)) {
      setSelectedTests(selectedTests.filter((t) => t !== test));
    } else {
      setSelectedTests([...selectedTests, test]);
    }
  }

  async function runDeleteSourceBatch(batchId: string) {
    const deletedRecord = s.sourceBatches.find((b: any) => b.id === batchId) || null;
    const loggedBy = getLoggedBy();

    try {
      await deleteSourceBatchRecord(batchId);
    } catch (error) {
      console.error("Could not delete source batch from real table:", error);
      const msg =
        error instanceof Error
          ? error.message
          : "The server rejected the delete.";
      showNotice("Backend delete failed", msg);
      return;
    }

    saveLog({
      area: "Audit",
      batch: batchId,
      task: "Deleted Record",
      output: `Deleted source batch: ${batchId}`,
      loggedBy,
      data: {
        deletedRecordType: "Source Batch",
        deletedRecordId: batchId,
        deletedRecord,
        deletedBy: loggedBy,
        deletedAtIso: new Date().toISOString(),
      },
      time: nowIsoForLog(),
    });

    s.sourceBatches = s.sourceBatches.filter((b: any) => b.id !== batchId);

    setSourceInputs((prev) => {
      const next = prev.filter((row) => row.sourceId !== batchId);

      if (next.length === 0) {
        return [{ sourceId: getFirstAvailableSourceId(), amount: "" }];
      }

      return next;
    });

    forceRefresh();
  }

  function deleteSourceBatch(batchId: string) {
    if (!userCanDelete) {
      showNotice("Access Denied", "Only Manager, Admin, or Owner users can delete records.");
      return;
    }

    showConfirm(
      "Delete Source Batch",
      `Delete source batch "${batchId}" from Available Source Material?`,
      () => runDeleteSourceBatch(batchId),
      "This removes the source material from the available extraction list."
    );
  }

  function openEditSourcePackage(row: any) {
    if (!requireWriteAccess("edit source packages")) return;
    const materialType = getSourceMaterialType(row);
    setEditSourcePackage(row);
    setEditSourceId(sourcePackageDisplayId(row));
    setEditSourceName(String(row.name || row.type || "").trim());
    setEditSourceType(
      materialType === "dryTrim"
        ? "Dry Trim"
        : materialType === "freshFrozen"
          ? "Fresh Frozen"
          : String(row.type || "Fresh Frozen").trim() || "Fresh Frozen",
    );
    setEditSourceCultivationId(String(row.source || "").trim());
    setEditSourceBundles(String(row.bundles ?? ""));
    setEditSourceGrams(String(row.grams ?? ""));
    const lbs =
      row.weightLbs != null && row.weightLbs !== ""
        ? row.weightLbs
        : row.grams != null && Number(row.grams) > 0
          ? +(Number(row.grams) / GRAMS_PER_LB).toFixed(4)
          : "";
    setEditSourceWeightLbs(String(lbs ?? ""));
    setEditSourceStatus(
      String(row.status || "Available for Extraction").trim() || "Available for Extraction",
    );
  }

  function closeEditSourcePackage() {
    setEditSourcePackage(null);
    setEditSourceSaving(false);
  }

  async function saveEditSourcePackage() {
    if (!editSourcePackage) return;
    if (!requireWriteAccess("edit source packages")) return;

    const originalId = String(editSourcePackage.id || "").trim();
    const nextId = editSourceId.trim();
    const name = editSourceName.trim();
    const type = editSourceType.trim();
    const source = editSourceCultivationId.trim();
    const bundles = Math.max(0, Math.floor(num(editSourceBundles)));
    const grams = Math.max(0, num(String(editSourceGrams).replace(/,/g, "")));
    const weightLbs = Math.max(0, num(String(editSourceWeightLbs).replace(/,/g, "")));
    const status = editSourceStatus.trim() || "Available for Extraction";

    if (
      !requireFields([
        { label: "Harvest package code", value: nextId },
        { label: "Display name", value: name },
        { label: "Material type", value: type },
        { label: "Cultivation batch", value: source },
      ])
    ) {
      return;
    }

    const isDb = isLikelyDatabaseSourcePackageId(originalId);
    if (isDb && nextId !== originalId) {
      showNotice(
        "Package code locked",
        "Database source packages keep their system id. Change the display name or harvest code field on legacy packages.",
      );
      return;
    }

    const amount =
      type === "Fresh Frozen"
        ? `${bundles} bundles / ${grams} grams`
        : `${weightLbs} lbs`;

    const payload: Record<string, unknown> = {
      id: nextId,
      name,
      type,
      source,
      strain: editSourcePackage.strain || "",
      status,
      bundles,
      grams,
      weightLbs,
      amount,
      harvestCode: nextId,
    };

    if (type === "Fresh Frozen" && grams > 0 && !weightLbs) {
      payload.weightLbs = +(grams / GRAMS_PER_LB).toFixed(4);
    }
    if (type === "Fresh Frozen" && weightLbs > 0 && !grams) {
      payload.grams = Math.round(weightLbs * GRAMS_PER_LB);
    }

    setEditSourceSaving(true);
    try {
      if (isDb) {
        await patchSourcePackageCanonicalName(originalId, name);
        const updated = await updateSourceBatch(originalId, {
          ...editSourcePackage,
          name,
          type,
          source,
          status,
          bundles,
          grams: payload.grams ?? grams,
          weightLbs: payload.weightLbs ?? weightLbs,
          amount,
        });
        applySourcePackageLocalUpdate(originalId, originalId, updated || { ...editSourcePackage, ...payload });
      } else {
        const updated = await updateSourceBatch(originalId, {
          ...editSourcePackage,
          ...payload,
        });
        applySourcePackageLocalUpdate(originalId, nextId, updated || { ...editSourcePackage, ...payload, id: nextId });
      }
      closeEditSourcePackage();
      showSyncMessageNotice("Source package saved.");
      forceRefresh();
    } catch (error) {
      console.error("Could not save source package:", error);
      showNotice(
        "Backend Save Failed",
        error instanceof Error ? error.message : "The server rejected the update.",
      );
    } finally {
      setEditSourceSaving(false);
    }
  }

  function applySourcePackageLocalUpdate(
    originalId: string,
    nextId: string,
    row: Record<string, unknown>,
  ) {
    const patchLists = (list: any[]) => {
      const idx = list.findIndex((b) => String(b?.id || "") === originalId);
      if (idx < 0) return;
      const prev = list[idx];
      if (nextId !== originalId) {
        list.splice(idx, 1);
        list.unshift({ ...prev, ...row, id: nextId });
      } else {
        list[idx] = { ...prev, ...row, id: nextId };
      }
    };
    patchLists(s.sourceBatches);
    if (Array.isArray(s.productionBatches)) patchLists(s.productionBatches);
    setSourceInputs((prev) =>
      prev.map((r) =>
        r.sourceId === originalId ? { ...r, sourceId: nextId } : r,
      ),
    );
  }

  async function runDeleteCompletedSourceBatch(batchId: string) {
    const deletedRecord = s.completedSourceBatches.find((b: any) => b.id === batchId) || null;
    const loggedBy = getLoggedBy();

    try {
      await deleteSourceBatchRecord(batchId);
    } catch (error) {
      console.error("Could not delete completed source batch from real table:", error);
      const msg =
        error instanceof Error
          ? error.message
          : "The server rejected the delete.";
      showNotice("Backend delete failed", msg);
      return;
    }

    saveLog({
      area: "Audit",
      batch: batchId,
      task: "Deleted Record",
      output: `Deleted completed source batch: ${batchId}`,
      loggedBy,
      data: {
        deletedRecordType: "Completed Source Batch",
        deletedRecordId: batchId,
        deletedRecord,
        deletedBy: loggedBy,
        deletedAtIso: new Date().toISOString(),
      },
      time: nowIsoForLog(),
    });

    s.completedSourceBatches = s.completedSourceBatches.filter(
      (b: any) => b.id !== batchId
    );

    forceRefresh();
  }

  function deleteCompletedSourceBatch(batchId: string) {
    if (!userCanDelete) {
      showNotice("Access Denied", "Only Manager, Admin, or Owner users can delete records.");
      return;
    }

    showConfirm(
      "Delete Completed Source Batch",
      `Delete completed source batch "${batchId}"?`,
      () => runDeleteCompletedSourceBatch(batchId),
      "This removes it from the completed / used source batch list."
    );
  }

  function validateCreateForm() {
    const rowsWithAnyValue = sourceInputs.filter(
      (row) => !isBlank(row.sourceId) || !isBlank(row.amount)
    );

    if (rowsWithAnyValue.length === 0) {
      showNotice(
        "Missing Source Material",
        "Please select at least one source batch and enter lbs used."
      );
      return false;
    }

    for (let i = 0; i < rowsWithAnyValue.length; i += 1) {
      const row = rowsWithAnyValue[i];

      if (!requireFields([{ label: `Source ${i + 1}`, value: row.sourceId }])) {
        return false;
      }

      if (!requirePositiveNumber(`Source ${i + 1} lbs used`, row.amount)) {
        return false;
      }
    }

    return requireFields([{ label: "Product Type", value: type }]);
  }

  function getMergedPartnerIds(batch: any): string[] {
    return getValidatedCombinedPartnerIds(
      batch,
      s.extractionBatches || [],
      s.completedExtractionBatches || [],
    );
  }

  async function runClearPhantomMergeLink(survivor: any, partnerId: string): Promise<boolean> {
    const sid = String(survivor?.id || "").trim();
    const pid = String(partnerId || "").trim();
    if (!sid || !pid) return false;

    applyPrunedCombinedFromBatchIds(
      survivor,
      s.extractionBatches,
      s.completedExtractionBatches,
    );
    const row = s.extractionBatches.find((b: any) => b?.id === sid);
    if (row && row !== survivor) {
      applyPrunedCombinedFromBatchIds(
        row,
        s.extractionBatches,
        s.completedExtractionBatches,
      );
    }

    try {
      const live = getLiveExtractionBatch(sid) || survivor;
      await updateExtractionBatch(
        sid,
        survivorPutPayloadAfterPhantomMergeClear(live),
      );
      showSyncMessageNotice(
        "Cleared false merge link — these batches were never combined.",
      );
      forceRefresh();
      return true;
    } catch (error) {
      console.error("Could not clear phantom merge link:", error);
      showNotice(
        "Clear merge link failed",
        error instanceof Error ? error.message : "Server update failed.",
      );
      return false;
    }
  }

  function getLiveExtractionBatch(batchId: string) {
    return s.extractionBatches.find((b: any) => b?.id === batchId) || null;
  }

  async function runUncombineMergedPartner(survivor: any, partnerIdRaw: string) {
    const sid = String(survivor?.id || "");
    const pid = String(partnerIdRaw || "").trim();
    if (!sid || !pid) return false;

    const idxPartner = Array.isArray(survivor.combinedFromBatchIds)
      ? survivor.combinedFromBatchIds.findIndex((x: any) => String(x) === pid)
      : -1;
    if (idxPartner < 0) {
      showNotice("Uncombine failed", "The merged-batch list changed. Refresh and retry.");
      return false;
    }

    const located = findMergedExtractionPartnerBatch(
      pid,
      sid,
      s.extractionBatches,
      s.completedExtractionBatches,
    );
    if (!located) {
      const partnerRow =
        s.extractionBatches.find((b: any) => b?.id === pid) ||
        s.completedExtractionBatches.find((b: any) => b?.id === pid);
      if (partnerRow && !isPartnerMergedIntoSurvivor(partnerRow, sid)) {
        setUncombineBusyPartnerId(pid);
        try {
          return await runClearPhantomMergeLink(survivor, pid);
        } finally {
          setUncombineBusyPartnerId("");
        }
      }
      showNotice(
        "Uncombine failed",
        "The absorbed batch could not be found as a merged record. Try refreshing.",
      );
      return false;
    }
    const pRestore = located.batch;

    const resolved = resolveAbsorbedForUncombine(pRestore, s.logs, sid, pid);
    if (!resolved) {
      showNotice(
        "Uncombine failed",
        "Could not resolve merge snapshot or Combine Batches log entry is missing.",
      );
      return false;
    }

    survivor.combinedFromBatchIds.splice(idxPartner, 1);
    if (survivor.combinedFromBatchIds.length === 0) {
      delete survivor.combinedFromBatchIds;
    }

    const survivorSources = Array.isArray(survivor.sources) ? survivor.sources : [];
    const restoredSources = subtractExtractionSourceRows(survivorSources, resolved.sources);
    rebuildExtractionBatchSourceSummary(survivor, restoredSources);

    if (resolved.combineWeightUnit === "grams") {
      const priorSurvivorOil = extractionBatchOilGrams(survivor);
      setExtractionBatchCombinedOilGrams(
        survivor,
        Math.max(0, priorSurvivorOil - (resolved.oilGrams ?? 0)),
      );
    } else {
      const priorSurvivorLbs = extractionBatchBiomassLbs(survivor);
      setExtractionBatchTotalBiomassLbs(
        survivor,
        Math.max(0, priorSurvivorLbs - resolved.biomassLbs),
      );
    }

    pRestore.status = resolved.statusBeforeMerge;
    delete pRestore.completedAt;
    applyExtractionPartnerUncombineRestore(pRestore, resolved);
    delete pRestore.mergedIntoSnapshot;
    pRestore.mergedIntoBatchId = undefined;

    if (located.storage === "completed") {
      s.completedExtractionBatches.splice(located.index, 1);
    } else {
      s.extractionBatches.splice(located.index, 1);
    }
    s.extractionBatches.unshift(pRestore);

    saveLog({
      area: "Extraction",
      batch: sid,
      task: "Uncombine Batches",
      output:
        resolved.combineWeightUnit === "grams"
          ? `Restored ${pid} (${(resolved.oilGrams ?? 0).toFixed(2)} g oil) from survivor ${sid}`
          : `Restored ${pid} (${resolved.biomassLbs.toFixed(2)} lbs) from survivor ${sid}`,
      source: survivor.source,
      loggedBy: getLoggedBy(),
      data: {
        uncombineBatches: true,
        survivorBatchId: sid,
        restoredBatchId: pid,
        combineWeightUnit: resolved.combineWeightUnit,
        biomassRestored: resolved.biomassLbs,
        oilRestored: resolved.oilGrams,
      },
      time: nowIsoForLog(),
    });

    forceRefresh();
    setViewBatch((cur: any) => (cur?.id === sid ? { ...survivor } : cur));
    setSelectedExt((cur: any) => (cur?.id === sid ? { ...survivor } : cur));
    setShowTaskModal(false);
    resetTaskForm();

    showSyncMessageNotice("Uncombine saved locally. Syncing to server...");
    let ok = await updateExtractionBatch(
      sid,
      extractionBatchPutPayloadAfterUncombineSurvivor(survivor),
    );
    ok =
      (await updateExtractionBatch(
        pid,
        extractionBatchPutPayloadAfterUncombinePartner(pRestore),
      )) && ok;
    showSyncMessageNotice(
      ok ? "Uncombine synced to server." : "Uncombine saved locally — server sync failed.",
    );
    return true;
  }

  function finalizeMergedPartnerExtractionBatch(
    absorbed: any,
    survivorId: string,
    snapshot: {
      biomassAbsorbed: number;
      oilAbsorbed?: number;
      combineWeightUnit?: "lbs" | "grams";
      sourcesSnapshot: any[];
      statusBeforeMerge: string;
      uiStageBeforeMerge: ExtractionUiStageKey;
      preMergeUiSnapshot?: Record<string, unknown>;
    },
  ) {
    absorbed.mergedIntoSnapshot = {
      survivorBatchId: survivorId,
      biomassAbsorbed: snapshot.biomassAbsorbed,
      ...(snapshot.preMergeUiSnapshot && Object.keys(snapshot.preMergeUiSnapshot).length > 0
        ? { preMergeUiSnapshot: snapshot.preMergeUiSnapshot }
        : {}),
      ...(snapshot.combineWeightUnit === "grams"
        ? {
            combineWeightUnit: "grams" as const,
            oilAbsorbed: snapshot.oilAbsorbed ?? 0,
          }
        : {}),
      sourcesSnapshot: snapshot.sourcesSnapshot.map((r: any) => ({ ...r })),
      statusBeforeMerge: snapshot.statusBeforeMerge,
      uiStageBeforeMerge: snapshot.uiStageBeforeMerge,
    };
    absorbed.status = "Merged - Complete";
    absorbed.mergedIntoBatchId = survivorId;
    absorbed.completedAt = nowIsoForLog();
    const idx = s.extractionBatches.findIndex((b: any) => b?.id === absorbed.id);
    if (idx >= 0) {
      s.extractionBatches.splice(idx, 1);
    }
    if (!s.completedExtractionBatches.some((b: any) => b?.id === absorbed.id)) {
      s.completedExtractionBatches.unshift(absorbed);
    }
    sweepMergedExtractionBatchesToCompleted(s);
  }

  function getUncombinePreview(survivor: any, partnerIdRaw: string) {
    const sid = String(survivor?.id || "");
    const pid = String(partnerIdRaw || "").trim();
    if (!sid || !pid) return { error: "Select a batch to restore." };

    if (!getMergedPartnerIds(survivor).includes(pid)) {
      return { error: "That batch is not listed as merged into this survivor." };
    }

    const located = findMergedExtractionPartnerBatch(
      pid,
      sid,
      s.extractionBatches,
      s.completedExtractionBatches,
    );
    if (!located) {
      return {
        error: "The absorbed batch could not be found as a merged record. Try refreshing.",
      };
    }

    const resolved = resolveAbsorbedForUncombine(located.batch, s.logs, sid, pid);
    if (!resolved) {
      return {
        error: "Could not resolve merge snapshot or Combine Batches log entry is missing.",
      };
    }

    const restoreDetail =
      resolved.combineWeightUnit === "grams"
        ? `${(resolved.oilGrams ?? 0).toFixed(2)} g extracted oil`
        : `${resolved.biomassLbs.toFixed(2)} lbs biomass`;

    return { sid, pid, restoreDetail, resolved };
  }

  function promptUncombineMergedPartner(survivor: any, partnerIdRaw: string) {
    if (!requireWriteAccess("uncombine extraction batches")) return;
    if (uncombineBusyPartnerId) return;

    const preview = getUncombinePreview(survivor, partnerIdRaw);
    if ("error" in preview) {
      showNotice("Uncombine failed", preview.error || "Could not uncombine.");
      return;
    }

    const liveSurvivor = getLiveExtractionBatch(preview.sid) || survivor;

    showConfirm(
      "Undo combine?",
      `Restore ${preview.pid} (${preview.restoreDetail}) as its own active batch and subtract that amount from survivor ${preview.sid}?`,
      () => {
        void (async () => {
          setUncombineBusyPartnerId(preview.pid);
          try {
            await runUncombineMergedPartner(liveSurvivor, preview.pid);
          } catch (error) {
            console.error("Uncombine extraction batches failed:", error);
            showNotice(
              "Uncombine failed",
              error instanceof Error ? error.message : "Could not sync uncombine to the server.",
            );
          } finally {
            setUncombineBusyPartnerId("");
          }
        })();
      },
      "This reverses a Combine Batches merge when the wrong partner was absorbed.",
    );
  }

  function validateTaskForm() {
    if (selectedTask === "Undo Combine") {
      if (!requireFields([{ label: "Batch to restore", value: undoCombinePartnerId }])) {
        return false;
      }
      const preview = getUncombinePreview(selectedExt, undoCombinePartnerId);
      if ("error" in preview) {
        showNotice("Undo combine failed", preview.error || "Could not undo this merge.");
        return false;
      }
      return true;
    }

    if (selectedTask === "Combine Batches") {
      if (!requireFields([{ label: "Partner batch", value: combinePartnerBatchId }])) {
        return false;
      }
      const survivorLabel = combineUsesOilGrams
        ? "This batch extracted oil (g)"
        : "This batch total (lbs)";
      const partnerLabel = combineUsesOilGrams
        ? "Partner batch extracted oil (g)"
        : "Partner batch total (lbs)";
      if (!requirePositiveNumber(survivorLabel, combineSurvivorLbs)) {
        return false;
      }
      if (!requirePositiveNumber(partnerLabel, combinePartnerLbs)) {
        return false;
      }
      return true;
    }

    if (selectedTask === "Pack Socks Start") {
      if (
        !requireFields([
          { label: "How Many Techs", value: packSockTechCount },
        ])
      ) {
        return false;
      }

      if (!requirePositiveNumber("How Many Techs", packSockTechCount)) return false;
      if (!requireTechNames("Tech", packSockTechNames)) return false;
      return true;
    }

    if (selectedTask === "Pack Socks Stop") {
      if (
        !requireFields([
          { label: "Total Socks Packed", value: totalSocksPacked },
        ])
      ) {
        return false;
      }

      if (!requirePositiveNumber("Total Socks Packed", totalSocksPacked)) return false;

      const sockCount = Math.floor(num(totalSocksPacked));

      if (sockCount <= 0) {
        showNotice("Invalid Sock Count", "Enter at least 1 sock packed.");
        return false;
      }

      if (sockGramInputs.length !== sockCount) {
        showNotice(
          "Sock Weight Mismatch",
          "The sock weight inputs do not match the total socks packed.",
          "Change the Total Socks Packed field so the app can rebuild the sock weight inputs."
        );
        return false;
      }

      const missingSockIndex = sockGramInputs.findIndex(
        (value) => isBlank(value) || num(value) <= 0
      );

      if (missingSockIndex >= 0) {
        showNotice(
          "Missing Sock Weight",
          `Enter a grams amount greater than 0 for Sock ${missingSockIndex + 1}.`
        );
        return false;
      }

      return true;
    }

    if (selectedTask === "Print Batch Label") {
      return true;
    }

    if (selectedTask === "Run Extraction") {
      if (
        !requireFields([
          { label: "Run Time", value: runTime },
          { label: "Final Product", value: finalProduct },
          { label: "Total Gas Loss", value: totalGasLoss },
          { label: "Total Silica Used", value: totalSilicaUsed },
          { label: "Total B80 Clay Used", value: totalB80Used },
          { label: "How Many Techs", value: howManyTechs },
        ])
      ) {
        return false;
      }

      if (!requirePositiveNumber("How Many Techs", howManyTechs)) return false;
      if (!requireTechNames("Tech", techNames)) return false;
      return true;
    }

    if (selectedTask === "Start Purge") {
      return requireFields([
        { label: "Date In Oven", value: dateInOven },
        { label: "Oven Temp", value: ovenTemp },
      ]);
    }

    if (selectedTask === "End Purge") {
      return requireFields([{ label: "Date Out Oven", value: dateOutOven }]);
    }

    if (selectedTask === "Whip") {
      return requireFields([
        { label: "How Many People", value: whipPeople },
        { label: "Time", value: whipTime },
      ]);
    }

    if (selectedTask === "Start Terp Separation") {
      if (
        !requireFields([
          { label: "Start Terp Separation Date/Time", value: terpStart },
          { label: "How Many Techs", value: terpStartTechCount },
        ])
      ) {
        return false;
      }

      if (!requirePositiveNumber("How Many Techs", terpStartTechCount)) return false;
      if (!requireTechNames("Tech", terpStartTechNames)) return false;
      return true;
    }

    if (selectedTask === "Finish Terp Separation") {
      if (
        !requireFields([
          { label: "Finish Terp Separation Date/Time", value: terpEnd },
          { label: "How Many Techs", value: terpFinishTechCount },
          { label: "Terps collected (grams)", value: totalTerps },
        ])
      ) {
        return false;
      }

      if (!requirePositiveNumber("How Many Techs", terpFinishTechCount)) return false;
      if (!requireTechNames("Tech", terpFinishTechNames)) return false;
      if (!requirePositiveNumber("Terps collected (grams)", totalTerps)) return false;
      return true;
    }

    if (selectedTask === "Start Decarb") {
      if (
        !requireFields([
          { label: "Start Decarb Date/Time", value: decarbStart },
          { label: "Starting crystal weight (grams)", value: decarbStartWeight },
          { label: "Max Temp", value: decarbMaxTemp },
          { label: "How Many Techs", value: decarbStartTechCount },
        ])
      ) {
        return false;
      }

      if (!requirePositiveNumber("How Many Techs", decarbStartTechCount)) return false;
      if (!requireTechNames("Tech", decarbStartTechNames)) return false;
      if (!requirePositiveNumber("Starting crystal weight (grams)", decarbStartWeight)) {
        return false;
      }
      return true;
    }

    if (selectedTask === "Finish Decarb") {
      if (
        !requireFields([
          { label: "Finish Decarb Date/Time", value: decarbEnd },
          { label: "Final decarbed oil (grams)", value: decarbEndWeight },
          { label: "How Many Techs", value: decarbFinishTechCount },
        ])
      ) {
        return false;
      }

      if (!requirePositiveNumber("How Many Techs", decarbFinishTechCount)) return false;
      if (!requireTechNames("Tech", decarbFinishTechNames)) return false;
      if (!requirePositiveNumber("Final decarbed oil (grams)", decarbEndWeight)) return false;
      return true;
    }

    if (selectedTask === "Adding Terps") {
      return requireFields([
        { label: "People", value: addingTerpsPeople },
        { label: "Time", value: addingTerpsTime },
        { label: "Total Terps Added", value: totalTerpsAdded },
      ]);
    }

    if (selectedTask === "Testing") {
      if (selectedTests.length === 0) {
        showNotice("Testing Required", "Select at least one test received.");
        return false;
      }

      return requireFields([
        { label: "Testing Status", value: testingStatus },
        { label: "Date Submitted", value: dateSubmitted },
      ]);
    }

    if (extractionCustomTaskLabels.has(selectedTask)) {
      return requireFields([
        { label: "How Many People", value: whipPeople },
        { label: "Time", value: whipTime },
      ]);
    }

    if (selectedTask === "Finish Batch") {
      return requireFields([
        { label: "Total Weight Final Oil", value: finalOilGrams },
        { label: "Total Weight Extra Terps", value: extraTerpsGrams },
      ]);
    }

    return true;
  }

  async function create() {
    if (!requireWriteAccess("create extraction batches")) return;
    if (!validateCreateForm()) return;

    const usedSources = sourceInputs
      .filter((row) => row.sourceId && num(row.amount) > 0)
      .map((row) => {
        const source = getSource(row.sourceId);

        return {
          sourceId: row.sourceId,
          name: source?.name || source?.type || row.sourceId,
          acronym: getSourceAcronym(source || row),
          materialType: getSourceMaterialType(source),
          amountUsed: +num(row.amount).toFixed(2),
        };
      });

    if (usedSources.length === 0) {
      showNotice(
        "Missing Source Material",
        "Add at least one source batch and amount used."
      );
      return;
    }

    const actualSources = usedSources.map((row) => getSource(row.sourceId));
    const allowedProducts = getAllowedProductsFromSources(actualSources);

    if (allowedProducts.length === 0) {
      showNotice(
        "Invalid Source Mix",
        "You cannot mix Fresh Frozen and Dry Trim source material in the same extraction batch."
      );
      return;
    }

    if (!allowedProducts.includes(type)) {
      showNotice(
        "Invalid Product Type",
        `Selected source material only allows: ${allowedProducts.join(", ")}`
      );
      return;
    }

    const duplicateSourceIds = usedSources
      .map((row) => row.sourceId)
      .filter((sourceId, index, all) => all.indexOf(sourceId) !== index);

    if (duplicateSourceIds.length > 0) {
      showNotice(
        "Duplicate Source Selected",
        `You selected the same source more than once: ${[
          ...new Set(duplicateSourceIds),
        ].join(", ")}.`,
        "Use one row per source batch."
      );
      return;
    }

    for (const row of usedSources) {
      const source = getSource(row.sourceId);
      const available = getSourceAvailable(source);

      if (!source) {
        showNotice("Source Not Found", `Source batch ${row.sourceId} was not found.`);
        return;
      }

      if (available <= 0 || source.status === "Used in Extraction") {
        showNotice(
          "Source Unavailable",
          `${row.sourceId} has 0 lbs available and cannot be used.`
        );
        return;
      }

      if (row.amountUsed > available) {
        showNotice(
          "Not Enough Source Material",
          `${row.sourceId} only has ${available} lbs available.`,
          `You entered ${row.amountUsed} lbs.`
        );
        return;
      }
    }

    const sourceUpdatePlans = usedSources.map((row) => {
      const source = getSource(row.sourceId);
      const available = getSourceAvailable(source);
      const remaining = Math.max(available - row.amountUsed, 0);
      const updatedSource = {
        ...source,
        remainingAmount: +remaining.toFixed(2),
        status: remaining <= 0 ? "Used in Extraction" : "Partially Used in Extraction",
      };
      return {
        sourceId: row.sourceId,
        source,
        remaining,
        updatedSource,
        originalSource: source ? { ...source } : null,
      };
    });

    const totalAmount = usedSources.reduce(
      (sum, row) => sum + num(row.amountUsed),
      0
    );

    const productionBatchId = makeUniqueBatchId(
      makeProductionBatchId(usedSources)
    );

    const sourceBlendLabel = [
      ...new Set(
        usedSources
          .map((row) => String(row.name || "").trim())
          .filter(Boolean)
      ),
    ].join(" · ");

    const batch = {
      id: productionBatchId,
      name: type,
      productType: type,
      sources: usedSources,
      source: usedSources.map((row) => row.sourceId).join(", "),
      sourceBlendLabel,
      marketBatchCode: makeBlendMarketBatchCodeFromSourceRows(
        usedSources,
        productionBatchId
      ),
      amount: `${+totalAmount.toFixed(2)} lbs`,
      totalBiomassUsed: +totalAmount.toFixed(2),
      status: "Ready For Pack Socks Start",
      completedTasks: [],
      taskData: {},
      createdAt: nowIsoForLog(),
    };

    let sourcesPersisted = false;
    try {
      await Promise.all(
        sourceUpdatePlans.map((plan) => {
          return plan.source
            ? updateSourceBatch(plan.source.id, plan.updatedSource)
            : Promise.resolve();
        })
      );
      sourcesPersisted = true;
      await createExtractionBatch(batch);
    } catch (error) {
      if (sourcesPersisted) {
        await Promise.all(
          sourceUpdatePlans.map((plan) =>
            plan.source && plan.originalSource
              ? updateSourceBatch(plan.source.id, plan.originalSource).catch(() => undefined)
              : Promise.resolve()
          )
        );
      }
      console.error("Could not save extraction/source real tables:", error);
      showNotice(
        "Backend Save Failed",
        "Could not persist extraction and source updates together. No extraction batch was created.",
        "Please refresh and try again."
      );
      return;
    }

    sourceUpdatePlans.forEach((plan) => {
      if (!plan.source) return;
      Object.assign(plan.source, plan.updatedSource);
      if (plan.remaining <= 0) {
        const alreadyCompleted = s.completedSourceBatches.some(
          (b: any) => b.id === plan.source.id
        );
        if (!alreadyCompleted) {
          s.completedSourceBatches.unshift({
            ...plan.updatedSource,
            status: "Complete",
            completedAt: nowIsoForLog(),
          });
        }
      }
    });

    s.extractionBatches.unshift(batch);
    setSelectedExt(batch);

    const loggedBy = getLoggedBy();
    const loggedAt = nowIsoForLog();

    saveLog({
      area: "Extraction",
      batch: batch.id,
      task: "Extraction Batch Created",
      output: `Created ${type} using ${+totalAmount.toFixed(2)} lbs from ${usedSources
        .map((row) => `${row.sourceId}: ${row.amountUsed} lbs`)
        .join(" | ")}`,
      source: batch.source,
      loggedBy,
      data: {
        loggedBy,
        loggedAt,
        loggedAtIso: new Date().toISOString(),
      },
      time: loggedAt,
    });

    resetCreateForm();
    setShowCreateModal(false);
    forceRefresh();
  }

  function buildTaskData() {
    if (selectedTask === "Combine Batches") {
      if (combineUsesOilGrams) {
        return {
          survivorOilGrams: num(combineSurvivorLbs),
          partnerOilGrams: num(combinePartnerLbs),
          notes: combineNotes.trim(),
        };
      }
      return {
        survivorLbs: num(combineSurvivorLbs),
        partnerLbs: num(combinePartnerLbs),
        notes: combineNotes.trim(),
      };
    }

    if (selectedTask === "Pack Socks Start") {
      return {
        startedAt: new Date().toISOString(),
        startedAtDisplay: nowIsoForLog(),
        techCount: packSockTechCount,
        leadTechName: packSockTechNames[0] || "",
        techNames: packSockTechNames,
      };
    }

    if (selectedTask === "Pack Socks Stop") {
      const stoppedAt = new Date();
      const startTime = getPackSockStartTime(selectedExt);
      const startMs = startTime ? new Date(startTime).getTime() : 0;
      const stopMs = stoppedAt.getTime();
      const socks = Math.floor(num(totalSocksPacked));
      const sockWeightsGrams = sockGramInputs
        .slice(0, socks)
        .map((value) => +num(value).toFixed(2));
      const totalPreparedGrams = getSockGramTotal(sockWeightsGrams);
      const totalPreparedLbs = totalPreparedGrams / 453.592;
      const averageGramsPerSock =
        socks > 0 ? totalPreparedGrams / socks : 0;

      return {
        stoppedAt: stoppedAt.toISOString(),
        stoppedAtDisplay: stoppedAt.toISOString(),
        totalSocksPacked: socks,
        sockWeightsGrams,
        averageGramsPerSock: +averageGramsPerSock.toFixed(2),
        totalPreparedGrams: +totalPreparedGrams.toFixed(2),
        totalPreparedLbs: +totalPreparedLbs.toFixed(2),
        prepDuration: startMs > 0 ? formatDuration(stopMs - startMs) : "—",
      };
    }

    if (selectedTask === "Print Batch Label") {
      const label = buildExtractionBatchLabelFields(selectedExt, getSource);
      return {
        label,
        dymoCalibration: dymoSavedCalibration,
        labelPrintCopies: dymoLabelPrintCopiesClamped,
        printerModel: "DYMO LabelWriter",
        labelStock: `${dymoSavedCalibration.labelWidth} × ${dymoSavedCalibration.labelHeight}`,
      };
    }

    if (selectedTask === "Run Extraction") {
      return {
        runTime,
        finalProduct,
        totalGasLossLbs: totalGasLoss,
        totalSilicaUsedGrams: totalSilicaUsed,
        totalB80UsedGrams: totalB80Used,
        howManyTechs,
        leadTechName: techNames[0] || "",
        techNames,
      };
    }

    if (selectedTask === "Start Purge") {
      return {
        dateInOven,
        ovenTemp,
      };
    }

    if (selectedTask === "End Purge") {
      return {
        dateOutOven,
      };
    }

    if (selectedTask === "Whip") {
      return {
        people: whipPeople,
        time: whipTime,
      };
    }

    if (selectedTask === "Start Terp Separation") {
      return {
        startDateTime: terpStart,
        techCount: terpStartTechCount,
        leadTechName: terpStartTechNames[0] || "",
        techNames: terpStartTechNames,
        notes: terpStartNotes,
      };
    }

    if (selectedTask === "Finish Terp Separation") {
      return {
        endDateTime: terpEnd,
        techCount: terpFinishTechCount,
        leadTechName: terpFinishTechNames[0] || "",
        techNames: terpFinishTechNames,
        totalTerps,
        totalTerpsCollectedGrams: num(totalTerps),
        notes: terpFinishNotes,
      };
    }

    if (selectedTask === "Start Decarb") {
      return {
        startDateTime: decarbStart,
        startWeight: decarbStartWeight,
        startCrystalWeightGrams: num(decarbStartWeight),
        maxTemp: decarbMaxTemp,
        techCount: decarbStartTechCount,
        leadTechName: decarbStartTechNames[0] || "",
        techNames: decarbStartTechNames,
        notes: decarbStartNotes,
      };
    }

    if (selectedTask === "Finish Decarb") {
      return {
        endDateTime: decarbEnd,
        endWeight: decarbEndWeight,
        techCount: decarbFinishTechCount,
        leadTechName: decarbFinishTechNames[0] || "",
        techNames: decarbFinishTechNames,
        notes: decarbFinishNotes,
        ...buildFinishDecarbYieldTaskFields(
          selectedExt,
          num(decarbEndWeight),
          terpAddBackPercentOfOilWeight,
        ),
      };
    }

    if (selectedTask === "Adding Terps") {
      return {
        people: addingTerpsPeople,
        time: addingTerpsTime,
        totalTerpsAdded,
        notes: addingTerpsNotes,
      };
    }

    if (selectedTask === "Testing") {
      return {
        testsReceived: selectedTests,
        testingStatus,
        dateSubmitted,
      };
    }

    if (extractionCustomTaskLabels.has(selectedTask)) {
      return {
        people: whipPeople,
        time: whipTime,
      };
    }

    if (selectedTask === "Finish Batch") {
      return {
        finalOilGrams,
        extraTerpsGrams,
        totalFinalGrams: num(finalOilGrams) + num(extraTerpsGrams),
        yieldPercentage: getYieldPercentage({
          ...selectedExt,
          finalOilGrams,
          extraTerpsGrams,
        }),
      };
    }

    return {};
  }

  function buildOutput(data: any) {
    return Object.entries(data)
      .filter(([key]: [string, unknown]) => !["loggedBy", "loggedAtIso"].includes(key))
      .map(([key, value]: [string, unknown]) => {
        if (Array.isArray(value)) return `${key}: ${value.join(", ")}`;
        if (typeof value === "object" && value !== null) return "";
        return `${key}: ${value || "—"}`;
      })
      .filter(Boolean)
      .join(" | ");
  }

  async function saveTask() {
    if (isSavingTask) return;
    if (!requireWriteAccess("log extraction tasks")) return;

    if (!selectedExt) {
      showNotice("No Batch Selected", "Select an extraction batch first.");
      return;
    }

    if (
      selectedTask !== "Undo Combine" &&
      !isTaskAllowed(selectedExt, selectedTask)
    ) {
      showNotice(
        "Task Not Allowed Yet",
        `This task is not allowed yet.`,
        `Next required task: ${getNextAllowedTask(selectedExt)}.`
      );
      return;
    }

    if (selectedTask === "Undo Combine") {
      if (!requireWriteAccess("uncombine extraction batches")) return;
      if (!validateTaskForm()) return;
      const liveSurvivor = getLiveExtractionBatch(selectedExt.id) || selectedExt;
      promptUncombineMergedPartner(liveSurvivor, undoCombinePartnerId);
      return;
    }

    if (selectedTask === "Combine Batches") {
      if (!validateTaskForm()) return;
      setIsSavingTask(true);

      const pid = combinePartnerBatchId.trim();
      const partnerIdx = s.extractionBatches.findIndex((b: any) => b?.id === pid);
      const partner = partnerIdx >= 0 ? s.extractionBatches[partnerIdx] : null;

      if (!partner) {
        showNotice("Merge failed", "Partner batch not found in active extraction batches.");
        setIsSavingTask(false);
        return;
      }
      if (partner.id === selectedExt.id) {
        showNotice("Merge failed", "Select a different batch to merge.");
        setIsSavingTask(false);
        return;
      }
      if (!isExtractionBatchActiveForCombine(partner)) {
        showNotice("Merge failed", "That batch is already finished or merged.");
        setIsSavingTask(false);
        return;
      }

      const stageA = extractionUiStageFromBatch(selectedExt);
      const stageB = extractionUiStageFromBatch(partner);
      if (stageA !== stageB) {
        showNotice(
          "Merge failed",
          `Both batches must be in the same workflow stage (${EXTRACTION_UI_STAGE_META[stageA].label}).`,
        );
        setIsSavingTask(false);
        return;
      }

      const survivorSources = Array.isArray(selectedExt.sources) ? selectedExt.sources : [];
      const partnerSources = Array.isArray(partner.sources) ? partner.sources : [];
      const mergedSources = mergeExtractionSourceRows(survivorSources, partnerSources);
      const mergedSourceObjects = mergedSources
        .map((row: any) => getSource(row.sourceId))
        .filter(Boolean);
      if (getAllowedProductsFromSources(mergedSourceObjects.length ? mergedSourceObjects : mergedSources).length === 0) {
        showNotice(
          "Merge failed",
          "Combining these batches would mix Fresh Frozen and Dry Trim source material.",
        );
        setIsSavingTask(false);
        return;
      }

      const usesOilGrams = extractionCombineUsesOilGrams(selectedExt);
      const priorSurvivorWeight = num(combineSurvivorLbs);
      const priorPartnerWeight = num(combinePartnerLbs);
      const combinedWeight = +(priorSurvivorWeight + priorPartnerWeight).toFixed(2);
      const notes = combineNotes.trim();
      const survivorId = selectedExt.id;
      const partnerId = partner.id;
      const partnerBiomassLbs = extractionBatchBiomassLbs(partner);

      if (!Array.isArray(selectedExt.combinedFromBatchIds)) {
        selectedExt.combinedFromBatchIds = [];
      }
      selectedExt.combinedFromBatchIds.push(partnerId);
      rebuildExtractionBatchSourceSummary(selectedExt, mergedSources);
      ensureExtractionBatchMaterialTotals(selectedExt, getSource);

      let mergeData: Record<string, unknown>;
      let survivorOutput: string;
      let partnerOutput: string;

      if (usesOilGrams) {
        setExtractionBatchCombinedOilGrams(selectedExt, combinedWeight);
        survivorOutput = `Merged ${partnerId} (${priorPartnerWeight} g oil) into ${survivorId} — total extracted oil now ${combinedWeight} g${
          notes ? `. Notes: ${notes}` : ""
        }`;
        partnerOutput = `Merged into survivor ${survivorId} (${priorSurvivorWeight} + ${priorPartnerWeight} = ${combinedWeight} g oil on survivor)${
          notes ? `. Notes: ${notes}` : ""
        }`;
        mergeData = {
          combineBatches: true,
          survivorBatchId: survivorId,
          absorbedBatchId: partnerId,
          combineWeightUnit: "grams",
          oilBeforeSurvivor: priorSurvivorWeight,
          oilBeforePartner: priorPartnerWeight,
          oilAfterCombine: combinedWeight,
          biomassBeforePartner: partnerBiomassLbs,
          uiStageBucket: stageA,
          notes,
        };
      } else {
        setExtractionBatchTotalBiomassLbs(selectedExt, combinedWeight);
        survivorOutput = `Merged ${partnerId} (${priorPartnerWeight} lbs) into ${survivorId} — total biomass now ${combinedWeight} lbs${
          notes ? `. Notes: ${notes}` : ""
        }`;
        partnerOutput = `Merged into survivor ${survivorId} (${priorSurvivorWeight} + ${priorPartnerWeight} = ${combinedWeight} lbs on survivor)${
          notes ? `. Notes: ${notes}` : ""
        }`;
        mergeData = {
          combineBatches: true,
          survivorBatchId: survivorId,
          absorbedBatchId: partnerId,
          combineWeightUnit: "lbs",
          biomassBeforeSurvivor: priorSurvivorWeight,
          biomassBeforePartner: priorPartnerWeight,
          biomassAfterCombine: combinedWeight,
          uiStageBucket: stageA,
          notes,
        };
      }

      const loggedBy = getLoggedBy();
      const loggedAt = nowIsoForLog();

      saveLog({
        area: "Extraction",
        batch: partnerId,
        task: "Combine Batches",
        output: partnerOutput,
        source: partner.source,
        linkedBatch: survivorId,
        loggedBy,
        data: { ...mergeData, loggedBy, loggedAt, loggedAtIso: new Date().toISOString() },
        time: loggedAt,
      });

      saveLog({
        area: "Extraction",
        batch: survivorId,
        task: "Combine Batches",
        output: survivorOutput,
        source: selectedExt.source,
        linkedBatch: partnerId,
        loggedBy,
        data: { ...mergeData, loggedBy, loggedAt, loggedAtIso: new Date().toISOString() },
        time: loggedAt,
      });

      finalizeMergedPartnerExtractionBatch(partner, survivorId, {
        biomassAbsorbed: partnerBiomassLbs,
        preMergeUiSnapshot: captureExtractionPreMergeUiSnapshot(partner),
        ...(usesOilGrams
          ? {
              combineWeightUnit: "grams" as const,
              oilAbsorbed: priorPartnerWeight,
            }
          : {}),
        sourcesSnapshot: partnerSources.map((r: any) => ({ ...r })),
        statusBeforeMerge: String(partner.status || "Ready For Pack Socks Start"),
        uiStageBeforeMerge: stageB,
      });

      setCombinePartnerBatchId("");
      setCombineSurvivorLbs("");
      setCombinePartnerLbs("");
      setCombineNotes("");
      const localSnapshot = { ...selectedExt };
      setSelectedExt(localSnapshot);
      resetTaskForm();
      setShowTaskModal(false);
      forceRefresh();

      try {
        showSyncMessageNotice("Merge saved locally. Syncing to server...");
        let ok = await updateExtractionBatch(survivorId, localSnapshot);
        ok = (await updateExtractionBatch(partnerId, partner)) && ok;
        showSyncMessageNotice(
          ok ? "Merge synced to server." : "Merge saved locally — server sync failed (check connectivity).",
        );
        const mergedPartnerId = partnerId;
        const mergedSurvivorId = survivorId;
        showConfirm(
          "Batches combined",
          `Merged ${mergedPartnerId} into ${mergedSurvivorId}.`,
          () => {
            const survivor =
              getLiveExtractionBatch(mergedSurvivorId) || localSnapshot;
            promptUncombineMergedPartner(survivor, mergedPartnerId);
          },
          "Combined the wrong batches? You can undo this merge now to restore the partner as its own active batch.",
          "Undo combine",
          "Keep merge",
        );
      } catch (error) {
        console.error("Could not sync extraction merge:", error);
        showNotice(
          "Backend Save Failed",
          "The merge was saved locally, but the server update failed.",
        );
      } finally {
        setIsSavingTask(false);
      }
      return;
    }

    if (selectedTask === "Run Extraction") {
      const allowedProducts = getAllowedRunProducts();

      if (allowedProducts.length === 0) {
        showNotice(
          "Invalid Source Mix",
          "This batch has mixed source material types and cannot be run.",
          "Do not mix Fresh Frozen and Dry Trim."
        );
        return;
      }

      if (!allowedProducts.includes(finalProduct)) {
        showNotice(
          "Invalid Final Product",
          `This source material only allows: ${allowedProducts.join(", ")}`
        );
        return;
      }
    }

    if (!validateTaskForm()) return;
    setIsSavingTask(true);

    const loggedBy = getLoggedBy();
    const loggedAt = nowIsoForLog();
    const loggedAtIso = new Date().toISOString();

    const data = {
      ...buildTaskData(),
      loggedBy,
      loggedAt,
      loggedAtIso,
    };

    if (!selectedExt.taskData) selectedExt.taskData = {};
    if (!selectedExt.completedTasks) selectedExt.completedTasks = [];

    if (optionalRepeatableTasks.includes(selectedTask)) {
      const existing = selectedExt.taskData[selectedTask];
      if (existing != null && !Array.isArray(existing)) {
        selectedExt.taskData[selectedTask] = [existing];
      }
      if (!selectedExt.taskData[selectedTask]) {
        selectedExt.taskData[selectedTask] = [];
      }

      selectedExt.taskData[selectedTask].push(data);
    } else {
      selectedExt.taskData[selectedTask] = data;
    }

    if (!optionalRepeatableTasks.includes(selectedTask)) {
      if (!selectedExt.completedTasks.includes(selectedTask)) {
        selectedExt.completedTasks.push(selectedTask);
      }
    } else {
      selectedExt.completedTasks.push(`${selectedTask} ${loggedAt}`);
    }

    if (selectedTask === "Run Extraction") {
      selectedExt.productType = finalProduct;
      selectedExt.name = finalProduct;
    }

    if (selectedTask === "Finish Terp Separation") {
      selectedExt.totalTerpsCollectedGrams = num(totalTerps);
      syncExtractionYieldFieldsToBatch(selectedExt, terpAddBackPercentOfOilWeight);
    }

    if (selectedTask === "Start Decarb") {
      selectedExt.startCrystalWeightGrams = num(decarbStartWeight);
    }

    if (selectedTask === "Finish Decarb") {
      selectedExt.finalDecarbedOilGrams = num(decarbEndWeight);
      syncExtractionYieldFieldsToBatch(selectedExt, terpAddBackPercentOfOilWeight);
    }

    if (selectedTask === "Finish Batch") {
      const sourceNames = collectStrainNamesForExtractionBatch(selectedExt);
      const singleSourceName = sourceNames.length === 1 ? sourceNames[0] : "";
      const chosenName =
        finishBatchManualName.trim() || draftFinishBatchName.trim() || singleSourceName;

      if (sourceNames.length > 1 && isBlank(chosenName)) {
        showNotice(
          "Batch Name Required",
          "This extraction uses multiple source packages, so the finished batch must be named.",
          "Enter a manual name or use AI to generate one."
        );
        setIsSavingTask(false);
        return;
      }

      let finishMarketCode = "";
      if (!isBlank(chosenName)) {
        selectedExt.name = chosenName.trim();
        finishMarketCode = !isBlank(draftFinishBatchCode)
          ? draftFinishBatchCode.trim()
          : makeMarketBatchCode(chosenName.trim(), selectedExt.id);
        const conflict = findActiveExtractionBatchWithMarketCode(
          filterActiveExtractionBatches(s.extractionBatches || []),
          finishMarketCode,
          selectedExt.id,
        );
        if (conflict) {
          const conflictLabel = extractionBatchMarketBatchCode(conflict);
          showConfirm(
            "Market batch code already in use",
            `Another active batch (${conflictLabel}, run ${conflict.id}) already uses "${finishMarketCode}". Merge that batch into this one before finishing?`,
            () => openCombineForMarketBatchCodeConflict(selectedExt, conflict),
            "Pick a unique market batch code on the Finish Batch step, or merge first. Finish Batch was not saved.",
            "Merge batches",
            "Change code",
          );
          setIsSavingTask(false);
          return;
        }
        selectedExt.marketBatchCode = finishMarketCode;
      }
      selectedExt.status = "Finished - Sent To Packaging";
      selectedExt.finalOilGrams = finalOilGrams;
      selectedExt.extraTerpsGrams = extraTerpsGrams;
      selectedExt.totalFinalGrams = num(finalOilGrams) + num(extraTerpsGrams);
      selectedExt.yieldPercentage = getYieldPercentage(selectedExt);

      const alreadyInPackaging = s.packagingBatches.some(
        (b: any) =>
          String(b.extractionBatchId || "") === String(selectedExt.id) ||
          String(b.sourceBatchId || "") === String(selectedExt.id) ||
          b.id === selectedExt.id
      );

      if (!alreadyInPackaging) {
        const productLabel = String(selectedExt.productType || "").trim();
        const displayName = String(selectedExt.name || "").trim();
        const useCreativeProductionId =
          displayName.length > 0 && displayName !== productLabel;
        const productionLotBase = useCreativeProductionId
          ? makeMarketBatchCode(displayName, `P-${getDateCode()}`)
          : String(selectedExt.id);
        const packagingLotId = useCreativeProductionId
          ? makeUniquePackagingLotId(productionLotBase)
          : selectedExt.id;
        if (useCreativeProductionId) {
          selectedExt.productionPackagingLotId = packagingLotId;
          selectedExt.marketBatchCode = packagingLotId;
        }

        const packagingBatch = {
          id: packagingLotId,
          name: selectedExt.name,
          type: selectedExt.productType,
          productType: selectedExt.productType,
          source: selectedExt.source,
          marketBatchCode: selectedExt.marketBatchCode,
          sourceBlendLabel: selectedExt.sourceBlendLabel,
          extractionSources: Array.isArray(selectedExt.sources)
            ? selectedExt.sources
            : [],
          sourceBatchId: selectedExt.id,
          extractionBatchId: selectedExt.id,
          finalOilGrams,
          extraTerpsGrams,
          totalFinalGrams: selectedExt.totalFinalGrams,
          packageableGrams: num(finalOilGrams),
          yieldPercentage: selectedExt.yieldPercentage,
          status: "Ready For Packaging",
          createdAt: loggedAt,
        };

        s.packagingBatches.unshift(packagingBatch);

        try {
          await createPackagingBatch(packagingBatch);
        } catch (error) {
          console.error("Could not create packaging real table batch:", error);
          showNotice(
            "Packaging Save Warning",
            "The batch was sent to packaging locally, but it did not save to the real PackagingBatch table.",
            "The backup sync will still try to save the current store."
          );
        }
      }
    } else {
      const nextTask = getNextAllowedTask(selectedExt);

      if (
        hasCompletedTask(selectedExt, "Start Purge") &&
        !hasCompletedTask(selectedExt, "End Purge")
      ) {
        selectedExt.status = "Purge Active";
      } else {
        selectedExt.status =
          nextTask === "Complete" ? "Complete" : `Ready For ${nextTask}`;
      }
    }

    let logData: Record<string, unknown> = { ...data };
    const peopleNum = num(logData.people);
    const timeNum = num(logData.time);
    if (peopleNum > 0 && timeNum > 0) {
      logData.people = peopleNum;
      logData.minutes = timeNum;
    }

    if (rewardsCfg?.enabled && rewardsCfg.taskChallenge.enabled && peopleNum > 0 && timeNum > 0) {
      const tcAttach = buildTaskChallengeAttachment({
        rewards: rewardsCfg,
        area: "Extraction",
        task: selectedTask,
        customTasksRewardDefs,
        logs: s.logs as any[],
        normalizedMinutesPerPerson: timeNum,
        user: getAuthUser(),
        optedIn: true,
        laborGateOk: true,
      });
      if (tcAttach) {
        logData = { ...logData, taskChallenge: tcAttach };
      }
    }

    saveLog({
      area: "Extraction",
      batch: selectedExt.id,
      task: selectedTask,
      output: buildOutput(data),
      source: selectedExt.source,
      loggedBy,
      data: logData,
      time: loggedAt,
    });

    const targetBatchId = selectedExt.id;
    const localSnapshot = { ...selectedExt };
    setSelectedExt(localSnapshot);
    resetTaskForm();
    setShowTaskModal(false);
    forceRefresh();

    try {
      showSyncMessageNotice("Task saved locally. Syncing to server...");
      const updated = await updateExtractionBatch(targetBatchId, localSnapshot);
      if (selectedTask === "Finish Batch" && !isBlank(localSnapshot?.name)) {
        try {
          await saveBlendNameToConfig(localSnapshot, String(localSnapshot.name));
        } catch (historyError) {
          console.error("Could not save blend-name history:", historyError);
        }
      }
      if (updated && typeof updated === "object") {
        const row = s.extractionBatches.find((b: any) => b.id === targetBatchId);
        if (row) Object.assign(row, updated);
        setSelectedExt((cur: any) =>
          cur?.id === targetBatchId ? { ...cur, ...updated } : cur
        );
      }
      showSyncMessageNotice("Task synced to server.");
    } catch (error) {
      console.error("Could not update extraction real table:", error);
      showNotice(
        "Backend Save Failed",
        "The extraction task was saved locally, but the real database update failed.",
        "The backup sync will still try to save the current store."
      );
    } finally {
      setIsSavingTask(false);
    }
  }

  async function runDeleteBatch(batchId: string) {
    const deletedExtraction = s.extractionBatches.find((b: any) => b.id === batchId) || null;
    const deletedPackaging =
      s.packagingBatches.find(
        (b: any) =>
          b.id === batchId ||
          String(b.extractionBatchId || "") === batchId ||
          String(b.sourceBatchId || "") === batchId
      ) || null;
    const loggedBy = getLoggedBy();

    try {
      await deleteExtractionBatchRecord(batchId);
    } catch (error) {
      console.error("Could not delete extraction batch from real table:", error);
      const msg =
        error instanceof Error
          ? error.message
          : "The server rejected the delete.";
      showNotice("Backend delete failed", msg);
      return;
    }

    saveLog({
      area: "Audit",
      batch: batchId,
      task: "Deleted Record",
      output: `Deleted extraction batch: ${batchId}${deletedPackaging ? " and linked packaging batch" : ""}`,
      loggedBy,
      data: {
        deletedRecordType: "Extraction Batch",
        deletedRecordId: batchId,
        deletedExtraction,
        deletedPackaging,
        deletedBy: loggedBy,
        deletedAtIso: new Date().toISOString(),
      },
      time: nowIsoForLog(),
    });

    s.extractionBatches = s.extractionBatches.filter(
      (b: any) => b.id !== batchId
    );
    const packagingRemove = (b: any) =>
      !(
        String(b.extractionBatchId || "") === batchId ||
        String(b.sourceBatchId || "") === batchId ||
        b.id === batchId
      );
    s.packagingBatches = s.packagingBatches.filter(packagingRemove);
    if (Array.isArray(s.inProgressPackagingBatches)) {
      s.inProgressPackagingBatches = s.inProgressPackagingBatches.filter(packagingRemove);
    }
    if (Array.isArray(s.completedPackagingBatches)) {
      s.completedPackagingBatches = s.completedPackagingBatches.filter(packagingRemove);
    }

    if (selectedExt?.id === batchId) {
      if (selectedExtractionStage === null) {
        setSelectedExt(null);
      } else {
        const grouped = groupExtractionBatchesByUiStage(filterActiveExtractionBatches(s.extractionBatches));
        setSelectedExt(grouped[selectedExtractionStage][0] ?? null);
      }
    }

    if (viewBatch?.id === batchId) {
      setViewBatch(null);
    }

    forceRefresh();
  }

  function deleteBatch(batchId: string) {
    if (!userCanDelete) {
      showNotice("Access Denied", "Only Manager, Admin, or Owner users can delete records.");
      return;
    }

    showConfirm(
      "Delete Extraction Batch",
      `Delete extraction batch "${batchId}"?`,
      () => runDeleteBatch(batchId),
      "The server will refuse the delete if any packaging lots are still linked to this run in the database—delete or unlink those first."
    );
  }

  const selectedLogs = viewBatch
    ? s.logs.filter(
        (log: any) =>
          log.batch === viewBatch.id ||
          log.source === viewBatch.id ||
          log.linkedBatch === viewBatch.id
      )
    : [];

  const pageStyle: any = {
    minHeight: "100vh",
    background: "#020617",
    color: "white",
    padding: 20,
  };

  const shellStyle: any = {
    maxWidth: 1150,
    margin: "0 auto",
  };

  const cardStyle: any = {
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: 16,
    padding: 18,
    marginTop: 18,
    boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
  };

  const sectionTitleStyle: any = {
    margin: "0 0 12px",
    textAlign: "center",
    fontWeight: 900,
    fontSize: 18,
  };

  const stageCardsWrapStyle: any = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 12,
    marginTop: 10,
  };

  const lockedListStyle: any = {
    maxHeight: 260,
    overflowY: "auto",
    paddingRight: 6,
    marginTop: 16,
    borderTop: "1px solid #1e293b",
    paddingTop: 12,
  };

  const rowStyle: any = {
    padding: 12,
    marginBottom: 8,
    borderRadius: 12,
    border: "1px solid #334155",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  };

  const buttonStyle: any = {
    background: "#334155",
    color: "white",
    border: "1px solid #475569",
    borderRadius: 10,
    padding: "9px 12px",
    cursor: "pointer",
  };

  const deleteButtonStyle: any = {
    ...buttonStyle,
    background: "#7f1d1d",
    border: "1px solid #ef4444",
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

  const inputStyle: any = {
    width: "100%",
    padding: 10,
    borderRadius: 10,
    border: "1px solid #334155",
    background: "#020617",
    color: "white",
  };

  const modalBackStyle: any = {
    position: "fixed",
    inset: 0,
    background: "rgba(2, 6, 23, 0.78)",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    zIndex: 9999,
    padding: "28px 18px 36px",
    overflowY: "auto",
    overscrollBehavior: "contain",
    WebkitOverflowScrolling: "touch",
  };

  const modalStyle: any = {
    background: "#0f172a",
    color: "white",
    border: "1px solid #334155",
    borderRadius: 18,
    padding: 24,
    width: "100%",
    maxWidth: 650,
    marginTop: "max(0px, env(safe-area-inset-top))",
    marginBottom: 32,
    overflow: "visible",
    boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
  };

  const availableSources = s.sourceBatches.filter(
    (b: any) => getSourceAvailable(b) > 0 && b.status !== "Used in Extraction"
  );

  let availableSourcesTotalLbs = 0;
  let availableSourcesTotalBundles = 0;
  let availableSourcesHasFreshFrozen = false;
  for (const b of availableSources) {
    const avail = getSourceAvailable(b);
    availableSourcesTotalLbs += avail;
    if (getSourceMaterialType(b) === "freshFrozen") {
      availableSourcesHasFreshFrozen = true;
      const origLbs = sourceRowTotalLbs(b);
      const bundles = sourceRowBundles(b);
      if (origLbs > 0 && bundles > 0) {
        availableSourcesTotalBundles += Math.floor((avail / origLbs) * bundles + 1e-9);
      } else if (bundles > 0 && avail > 0) {
        availableSourcesTotalBundles += bundles;
      }
    }
  }
  const availableSourcesTotalGrams = Math.round(availableSourcesTotalLbs * GRAMS_PER_LB);

  const allowedCreateProducts = getAllowedCreateProducts();
  const allowedRunProducts = getAllowedRunProducts();

  const combinePartnerOptions = selectedExt
    ? s.extractionBatches.filter((b: any) => {
        if (!b?.id || b.id === selectedExt.id) return false;
        if (!isExtractionBatchActiveForCombine(b)) return false;
        if (extractionUiStageFromBatch(b) !== extractionUiStageFromBatch(selectedExt)) {
          return false;
        }
        const merged = mergeExtractionSourceRows(
          Array.isArray(selectedExt.sources) ? selectedExt.sources : [],
          Array.isArray(b.sources) ? b.sources : [],
        );
        const mergedSourceObjects = merged
          .map((row: any) => getSource(row.sourceId))
          .filter(Boolean);
        return (
          getAllowedProductsFromSources(mergedSourceObjects.length ? mergedSourceObjects : merged).length > 0
        );
      })
    : [];

  const activeExtractionBatches = filterActiveExtractionBatches(s.extractionBatches);
  const extractionBatchesByStage = groupExtractionBatchesByUiStage(activeExtractionBatches);
  const visibleExtractionBatches = selectedExtractionStage
    ? extractionBatchesByStage[selectedExtractionStage]
    : [];
  const completedMergedExtractionBatches = Array.isArray(s.completedExtractionBatches)
    ? s.completedExtractionBatches.filter((b: any) => isExtractionBatchMergedAbsorbed(b))
    : [];

  return (
    <PageAccessGate allowedRoles={["EXTRACTION", "VIEW_ONLY"]}>
      <div style={pageStyle}>
      <div style={shellStyle}>
        <Nav />

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
            marginTop: 24,
          }}
        >
          <div style={{ textAlign: "center" }}>
            <h1 style={{ margin: 0 }}>Extraction</h1>
            <p style={{ color: "#94a3b8", marginTop: 8 }}>
              Create extraction batches and log purge, whip, terp separation,
              decarb, testing, and finish tasks.
            </p>
          </div>
          <SectionCalendarLauncher
            section="extraction"
            taskSuggestions={extractionTaskList}
            readOnly={!userCanWrite}
          />
        </div>

        {!userCanWrite && (
          <div
            style={{
              ...cardStyle,
              border: "1px solid rgba(250, 204, 21, 0.45)",
              background: "rgba(120, 53, 15, 0.28)",
              color: "#fde68a",
            }}
          >
            <b>Read Only Mode:</b> You can view extraction records and task
            history, but your role cannot create extraction batches, log tasks,
            or change extraction data.
          </div>
        )}

        <div style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "baseline",
                  gap: "10px 14px",
                }}
              >
                <h2 style={{ margin: 0 }}>Available Source Material</h2>
                {availableSources.length > 0 ? (
                  <span
                    style={{
                      color: "#cbd5e1",
                      fontWeight: 700,
                      fontSize: 15,
                      lineHeight: 1.35,
                    }}
                  >
                    Total available:{" "}
                    <span style={{ color: "#f8fafc" }}>
                      {+availableSourcesTotalLbs.toFixed(2)} lbs
                    </span>
                    {" · "}
                    <span style={{ color: "#f8fafc" }}>
                      {availableSourcesTotalGrams.toLocaleString()} g
                    </span>
                    {" · "}
                    <span style={{ color: "#f8fafc" }}>
                      {availableSourcesHasFreshFrozen
                        ? `${availableSourcesTotalBundles} bundle${
                            availableSourcesTotalBundles === 1 ? "" : "s"
                          }`
                        : "—"}
                    </span>
                  </span>
                ) : null}
              </div>
              <p style={{ color: "#94a3b8", margin: "6px 0 0" }}>
                Fresh Frozen can only make live resin products. Dry Trim can only make cured wax.
              </p>
            </div>

            {userCanWrite ? (
              <button
                style={greenButtonStyle}
                onClick={openCreateModal}
                disabled={availableSources.length === 0}
              >
                + Create Extraction Batch
              </button>
            ) : null}
          </div>

          <div style={lockedListStyle}>
            {availableSources.length === 0 ? (
              <p style={{ color: "#94a3b8" }}>
                No source batches available for extraction.
              </p>
            ) : (
              availableSources.map((b: any) => {
                const available = getSourceAvailable(b);
                const isEmpty =
                  available <= 0 || b.status === "Used in Extraction";
                const materialType = getSourceMaterialType(b);

                return (
                  <div
                    key={b.id}
                    style={{
                      ...rowStyle,
                      background: isEmpty ? "#111827" : "#1e293b",
                      color: isEmpty ? "#94a3b8" : "white",
                      opacity: isEmpty ? 0.75 : 1,
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      {isLikelyDatabaseSourcePackageId(b.id) ? (
                        <>
                          <b>{sourcePackageDisplayId(b)}</b>
                          <span style={{ color: "#94a3b8", fontSize: 13 }}>
                            {" "}
                            · {b.name || b.type || "Source package"}
                          </span>
                          {" | Cultivation: "}
                          {b.source || "—"}
                          {" | Material: "}
                        </>
                      ) : (
                        <>
                          <b>{sourcePackageDisplayId(b)}</b> | {b.name || b.type} | Cultivation:{" "}
                          {b.source || "—"} | Material:{" "}
                        </>
                      )}
                      {materialType === "freshFrozen"
                        ? "Fresh Frozen"
                        : materialType === "dryTrim"
                        ? "Dry Trim"
                        : "Unknown"}{" "}
                      | Status: {isEmpty ? "Used in Extraction" : b.status}
                      {materialType === "freshFrozen" ? (
                        <>
                          {" "}
                          | {freshFrozenPackageDisplay(b).packageLine} |{" "}
                          {freshFrozenAvailableLine(available)}
                        </>
                      ) : (
                        <> | Available: {available} lbs</>
                      )}
                    </div>

                    <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                      {userCanWrite ? (
                        <button
                          style={blueButtonStyle}
                          onClick={() => openEditSourcePackage(b)}
                        >
                          Edit
                        </button>
                      ) : null}
                      {userCanDelete ? (
                        <button
                          style={deleteButtonStyle}
                          onClick={() => deleteSourceBatch(b.id)}
                        >
                          Delete
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 280px" }}>
              <h2 style={{ margin: 0 }}>Extraction Batches</h2>
              <p style={{ color: "#94a3b8", margin: "6px 0 0" }}>
                {`Required path: Pack Socks Start → Pack Socks Stop → Run Extraction → Start Purge → End Purge → Testing Passed → Finish Batch. Print Batch Label is available anytime (reprints allowed). Optional tasks (Whip, Adding Terps, etc.) can be logged while purge is active.`}
              </p>
            </div>

            {userCanWrite ? (
              <button
                style={greenButtonStyle}
                onClick={() => openTaskModal()}
                disabled={!selectedExt}
              >
                + Log Task
              </button>
            ) : null}
          </div>

          <h3 style={sectionTitleStyle}>Batches by stage</h3>
          <div style={stageCardsWrapStyle}>
            {EXTRACTION_UI_STAGE_ORDER.map((stageKey) => {
              const meta = EXTRACTION_UI_STAGE_META[stageKey];
              const count = extractionBatchesByStage[stageKey].length;
              const selected = selectedExtractionStage === stageKey;
              const batchLabel = count === 1 ? "1 Batch" : `${count} Batches`;
              return (
                <button
                  key={stageKey}
                  type="button"
                  style={{
                    ...buttonStyle,
                    width: "100%",
                    minHeight: 86,
                    textAlign: "left",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    gap: 4,
                    background: "#0f172a",
                    border: selected
                      ? "1px solid rgba(34, 211, 238, 0.65)"
                      : "1px solid #334155",
                    boxShadow: selected ? "0 0 0 1px rgba(34, 211, 238, 0.2)" : undefined,
                  }}
                  onClick={() => setSelectedExtractionStage(stageKey)}
                >
                  <span style={{ fontWeight: 900, fontSize: 16, color: "#f8fafc" }}>{meta.label}</span>
                  <span style={{ color: "#cbd5e1", fontWeight: 700 }}>{batchLabel}</span>
                  <span style={{ color: "#93c5fd", fontWeight: 600, fontSize: 13, lineHeight: 1.35 }}>
                    {meta.helper}
                  </span>
                  <span style={{ color: "#22d3ee", fontWeight: 800, fontSize: 12, marginTop: 4 }}>
                    View this stage →
                  </span>
                </button>
              );
            })}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              marginTop: 18,
              borderTop: "1px solid #1e293b",
              paddingTop: 14,
            }}
          >
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "#e2e8f0" }}>
              {selectedExtractionStage
                ? `${EXTRACTION_UI_STAGE_META[selectedExtractionStage].label} (${visibleExtractionBatches.length})`
                : "Batch list"}
            </h3>
            {selectedExtractionStage ? (
              <button
                type="button"
                style={{ ...buttonStyle, fontSize: 13 }}
                onClick={() => setSelectedExtractionStage(null)}
              >
                Clear stage filter
              </button>
            ) : null}
          </div>

          <div style={{ ...lockedListStyle, maxHeight: selectedExtractionStage ? 420 : 120 }}>
            {selectedExtractionStage === null ? (
              <p style={{ color: "#94a3b8", margin: 0 }}>
                {activeExtractionBatches.length === 0
                  ? "No extraction batches yet. Create a batch above, then pick a stage card to filter the list."
                  : "Select a stage above to view batches. Your team’s workflow is grouped the same way as cultivation stages."}
              </p>
            ) : visibleExtractionBatches.length === 0 ? (
              <p style={{ color: "#94a3b8", margin: 0 }}>No batches in this stage yet.</p>
            ) : (
              visibleExtractionBatches.map((b: any) => (
                <div
                  key={b.id}
                  style={{
                    ...rowStyle,
                    background:
                      selectedExt?.id === b.id ? "#22c55e" : "#1e293b",
                    color: selectedExt?.id === b.id ? "black" : "white",
                  }}
                >
                  <div
                    onClick={() => setSelectedExt(b)}
                    style={{ flex: 1, cursor: "pointer" }}
                  >
                    <b>{extractionBatchMarketBatchCode(b)}</b> | {b.name} | Biomass Used:{" "}
                    {extractionBatchBiomassLbs(b) > 0
                      ? `${extractionBatchBiomassLbs(b)} lbs`
                      : "—"}{" "}
                    | Final:{" "}
                    {(() => {
                      const finalG =
                        num(b.totalFinalGrams) ||
                        extractionBatchOilGrams(b) + num(b.extraTerpsGrams);
                      return finalG > 0 ? `${finalG} g` : "—";
                    })()}{" "}
                    | Status: {b.status}
                    <ExtractionBatchYieldSummary
                      batch={b}
                      terpAddBackPercent={terpAddBackPercentOfOilWeight}
                    />
                    <div style={{ fontSize: 13, marginTop: 4 }}>
                      Next Required Task: {getNextAllowedTask(b)}
                    </div>
                    {getMergedPartnerIds(b).length > 0 ? (
                      <div style={{ fontSize: 12, marginTop: 6, color: "#fbbf24", fontWeight: 600 }}>
                        Merged with {getMergedPartnerIds(b).length} batch
                        {getMergedPartnerIds(b).length === 1 ? "" : "es"} — use Undo Combine to restore
                      </div>
                    ) : null}
                    {extractionBatchCultivationFooter(b) ? (
                      <div
                        style={{
                          fontSize: 11,
                          marginTop: 6,
                          fontWeight: 500,
                          opacity: selectedExt?.id === b.id ? 0.8 : 0.92,
                        }}
                      >
                        Source (cultivation): {extractionBatchCultivationFooter(b)}
                      </div>
                    ) : null}
                  </div>

                  <button style={buttonStyle} onClick={() => setViewBatch(b)}>
                    View
                  </button>

                  {userCanWrite && getMergedPartnerIds(b).length > 0 ? (
                    <button
                      type="button"
                      style={{
                        ...buttonStyle,
                        background: "#9a3412",
                        border: "1px solid #ea580c",
                        color: "white",
                      }}
                      disabled={Boolean(uncombineBusyPartnerId)}
                      onClick={(e) => {
                        e.stopPropagation();
                        const live = getLiveExtractionBatch(b.id) || b;
                        const firstMerged = getMergedPartnerIds(live)[0];
                        if (firstMerged) {
                          promptUncombineMergedPartner(live, firstMerged);
                        }
                      }}
                    >
                      Undo
                    </button>
                  ) : null}

                  {userCanWrite ? (
                    <button style={buttonStyle} onClick={() => openTaskModal(b)}>
                      Task
                    </button>
                  ) : null}

                  {userCanDelete ? (
                    <button
                      style={deleteButtonStyle}
                      onClick={() => deleteBatch(b.id)}
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>

        <div style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Completed / Merged Extraction Batches</h2>
          <p style={{ color: "#94a3b8", margin: "0 0 12px", fontSize: 13, lineHeight: 1.45 }}>
            Batches absorbed into another run via <b>Combine Batches</b>. They stay here until you undo
            the merge from the survivor batch.
          </p>

          <div style={lockedListStyle}>
            {completedMergedExtractionBatches.length === 0 ? (
              <p style={{ color: "#94a3b8", margin: 0 }}>No merged extraction batches yet.</p>
            ) : (
              completedMergedExtractionBatches.map((b: any) => (
                <div key={b.id} style={{ ...rowStyle, background: "#111827" }}>
                  <div style={{ flex: 1 }}>
                    <b>{extractionBatchMarketBatchCode(b)}</b> | {b.name || "—"} | Status:{" "}
                    {b.status || "Merged"}
                    {b.mergedIntoBatchId ? (
                      <span style={{ color: "#fbbf24" }}> | Merged into {b.mergedIntoBatchId}</span>
                    ) : null}
                    {b.completedAt ? (
                      <span style={{ color: "#94a3b8", fontSize: 13 }}>
                        {" "}
                        | Completed: {b.completedAt}
                      </span>
                    ) : null}
                  </div>

                  <button style={buttonStyle} onClick={() => setViewBatch(b)}>
                    View
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Completed / Used Source Batches</h2>

          <div style={lockedListStyle}>
            {s.completedSourceBatches.length === 0 ? (
              <p style={{ color: "#94a3b8" }}>
                No completed source batches yet.
              </p>
            ) : (
              s.completedSourceBatches.map((b: any) => (
                <div key={b.id} style={{ ...rowStyle, background: "#111827" }}>
                  <div style={{ flex: 1 }}>
                    {isLikelyDatabaseSourcePackageId(b.id) ? (
                      <>
                        <b>{b.name || b.type || "Source package"}</b>
                        <span style={{ color: "#94a3b8", fontSize: 13 }}>
                          {" "}
                          · {b.id}
                        </span>
                        {" | Status: Complete | Completed: "}
                      </>
                    ) : (
                      <>
                        <b>{b.id}</b> | {b.name || b.type} | Status: Complete |
                        Completed:{" "}
                      </>
                    )}
                    {b.completedAt}
                  </div>

                  {userCanDelete ? (
                    <button
                      style={deleteButtonStyle}
                      onClick={() => deleteCompletedSourceBatch(b.id)}
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>

        {showCreateModal && (
          <div style={modalBackStyle}>
            <div style={modalStyle}>
              <h2 style={{ marginTop: 0 }}>Create Extraction Batch</h2>

              <div style={{ display: "grid", gap: 10 }}>
                <select
                  style={inputStyle}
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                >
                  {(allowedCreateProducts.length > 0
                    ? allowedCreateProducts
                    : productTypes
                  ).map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>

                {allowedCreateProducts.length === 0 && (
                  <p style={{ color: "#f87171", margin: 0 }}>
                    Fresh Frozen and Dry Trim cannot be mixed in the same extraction batch.
                  </p>
                )}

                <h3 style={{ marginBottom: 0 }}>Biomass Sources</h3>

                {sourceInputs.map((row, index) => {
                  const selectedSource = getSource(row.sourceId);
                  const selectedAvailable = selectedSource
                    ? getSourceAvailable(selectedSource)
                    : 0;
                  const selectedMaterialType = selectedSource
                    ? getSourceMaterialType(selectedSource)
                    : "";

                  return (
                    <div key={index} style={{ display: "grid", gap: 8 }}>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 130px 42px",
                          gap: 8,
                          alignItems: "center",
                        }}
                      >
                        <select
                          style={inputStyle}
                          value={row.sourceId}
                          onChange={(e) =>
                            updateSourceInput(index, "sourceId", e.target.value)
                          }
                        >
                          <option value="">Select source</option>
                          {availableSources.map((b: any) => {
                            const materialType = getSourceMaterialType(b);

                            return (
                              <option key={b.id} value={b.id}>
                                {b.id} | {b.name || b.type} |{" "}
                                {materialType === "freshFrozen"
                                  ? "Fresh Frozen"
                                  : materialType === "dryTrim"
                                  ? "Dry Trim"
                                  : "Unknown"}{" "}
                                {materialType === "freshFrozen"
                                  ? `| ${freshFrozenPackageDisplay(b).packageLine} | ${freshFrozenAvailableLine(getSourceAvailable(b))}`
                                  : `| Available: ${getSourceAvailable(b)} lbs`}
                              </option>
                            );
                          })}
                        </select>

                        <input
                          style={inputStyle}
                          placeholder={
                            selectedSource
                              ? `Lbs used (max ${selectedAvailable} lbs)`
                              : "Lbs used"
                          }
                          value={row.amount}
                          onChange={(e) =>
                            updateSourceInput(index, "amount", e.target.value)
                          }
                        />

                        <button
                          style={buttonStyle}
                          onClick={() => removeSourceRow(index)}
                          disabled={sourceInputs.length === 1}
                        >
                          X
                        </button>
                      </div>

                      {selectedSource && (
                        <div
                          style={{
                            background: "#1e293b",
                            border: "1px solid #334155",
                            borderRadius: 10,
                            padding: "10px 12px",
                            color: "#cbd5e1",
                            fontSize: 14,
                          }}
                        >
                          <div>
                            <b>Selected Package:</b> {selectedSource.id}
                          </div>
                          <div>
                            <b>Name:</b> {selectedSource.name || selectedSource.type}
                          </div>
                          <div>
                            <b>Material:</b>{" "}
                            {selectedMaterialType === "freshFrozen"
                              ? "Fresh Frozen"
                              : selectedMaterialType === "dryTrim"
                              ? "Dry Trim"
                              : "Unknown"}
                          </div>
                          <div>
                            <b>Available Amount:</b>{" "}
                            {selectedMaterialType === "freshFrozen"
                              ? freshFrozenAvailableLine(selectedAvailable)
                              : `${selectedAvailable} lbs`}
                          </div>
                          {selectedMaterialType === "freshFrozen" ? (
                            <div>
                              <b>Package (total):</b> {freshFrozenPackageDisplay(selectedSource).packageLine}
                            </div>
                          ) : null}
                        </div>
                      )}

                      {selectedSource &&
                        !isBlank(row.amount) &&
                        num(row.amount) > selectedAvailable && (
                          <div
                            style={{
                              color: "#f87171",
                              fontSize: 13,
                              marginTop: -2,
                            }}
                          >
                            Entered amount is greater than the available amount.
                          </div>
                        )}
                    </div>
                  );
                })}

                {userCanWrite ? (
                  <button style={buttonStyle} onClick={addSourceRow}>
                    + Add Another Source Batch
                  </button>
                ) : null}

                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: 8,
                  }}
                >
                  <button
                    style={buttonStyle}
                    onClick={() => {
                      resetCreateForm();
                      setShowCreateModal(false);
                    }}
                  >
                    Cancel
                  </button>

                  {userCanWrite ? (
                    <button style={greenButtonStyle} onClick={create}>
                      Create
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        )}

        {showTaskModal && selectedExt && (
          <div style={modalBackStyle}>
            <div style={modalStyle}>
              <h2 style={{ marginTop: 0 }}>Log Extraction Task</h2>

              <div style={{ display: "grid", gap: 10 }}>
                <input style={inputStyle} value={selectedExt.id} readOnly />

                {getMergedPartnerIds(selectedExt).length > 0 ? (
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 10,
                      background: "rgba(30, 27, 75, 0.35)",
                      border: "1px solid rgba(251, 191, 36, 0.45)",
                    }}
                  >
                    <p style={{ margin: "0 0 10px", fontSize: 13, color: "#fbbf24", lineHeight: 1.45 }}>
                      This batch absorbed {getMergedPartnerIds(selectedExt).length} other batch
                      {getMergedPartnerIds(selectedExt).length === 1 ? "" : "es"} via <b>Combine Batches</b>.
                      Choose <b>Undo Combine</b> below (or the orange Undo button on the list) if the wrong
                      partner was merged.
                    </p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {getMergedPartnerIds(selectedExt).map((mergedId) => (
                        <button
                          key={mergedId}
                          type="button"
                          style={{
                            ...buttonStyle,
                            background: "#9a3412",
                            border: "1px solid #ea580c",
                            color: "white",
                          }}
                          disabled={Boolean(uncombineBusyPartnerId)}
                          onClick={() =>
                            promptUncombineMergedPartner(
                              getLiveExtractionBatch(selectedExt.id) || selectedExt,
                              mergedId,
                            )
                          }
                        >
                          {uncombineBusyPartnerId === mergedId
                            ? "Restoring…"
                            : `Undo ${mergedId}`}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <select
                  style={inputStyle}
                  value={selectedTask}
                  onChange={(e) => setSelectedTask(e.target.value)}
                >
                  {extractionTaskList.map((task) => (
                    <option
                      key={task}
                      disabled={!isTaskAllowed(selectedExt, task)}
                    >
                      {task}
                    </option>
                  ))}
                </select>

                {selectedTask === "Combine Batches" && (
                  <>
                    <p style={{ color: "#94a3b8", margin: 0, lineHeight: 1.5 }}>
                      Merge another active extraction batch in the same workflow stage into this survivor.
                      {combineUsesOilGrams
                        ? " Enter the total extracted oil weight (g) for each batch; source rows are linked and the partner is marked complete."
                        : " Enter the total biomass weight (lbs) for each batch; source rows are linked and the partner is marked complete."}
                    </p>
                    <input
                      style={inputStyle}
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder={
                        combineUsesOilGrams
                          ? "This batch extracted oil (g)"
                          : "This batch total (lbs)"
                      }
                      value={combineSurvivorLbs}
                      onChange={(e) => setCombineSurvivorLbs(e.target.value)}
                      required
                    />
                    <select
                      style={inputStyle}
                      value={combinePartnerBatchId}
                      onChange={(e) => setCombinePartnerBatchId(e.target.value)}
                    >
                      <option value="">Select partner batch…</option>
                      {combinePartnerOptions.map((b: any) => (
                        <option key={b.id} value={b.id}>
                          {extractionBatchMarketBatchCode(b)}
                          {b.sourceBlendLabel ? ` · ${b.sourceBlendLabel}` : ""}
                          {combineUsesOilGrams
                            ? extractionBatchOilGrams(b) > 0
                              ? ` (${extractionBatchOilGrams(b).toFixed(2)} g oil on file)`
                              : ""
                            : extractionBatchBiomassLbs(b) > 0
                              ? ` (${extractionBatchBiomassLbs(b).toFixed(2)} lbs on file)`
                              : ""}
                        </option>
                      ))}
                    </select>
                    {combinePartnerOptions.length === 0 ? (
                      <p style={{ color: "#64748b", margin: 0, fontSize: 13 }}>
                        No other active batches in this stage with a compatible source mix.
                      </p>
                    ) : null}
                    <input
                      style={inputStyle}
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder={
                        combineUsesOilGrams
                          ? "Partner batch extracted oil (g)"
                          : "Partner batch total (lbs)"
                      }
                      value={combinePartnerLbs}
                      onChange={(e) => setCombinePartnerLbs(e.target.value)}
                      disabled={!combinePartnerBatchId.trim()}
                      required
                    />
                    {num(combineSurvivorLbs) > 0 && num(combinePartnerLbs) > 0 ? (
                      <p style={{ color: "#cbd5e1", margin: 0, fontSize: 13 }}>
                        Combined total:{" "}
                        <b>
                          {(num(combineSurvivorLbs) + num(combinePartnerLbs)).toFixed(2)}{" "}
                          {combineUsesOilGrams ? "g" : "lbs"}
                        </b>
                      </p>
                    ) : null}
                    <input
                      style={inputStyle}
                      placeholder="Notes (optional)"
                      value={combineNotes}
                      onChange={(e) => setCombineNotes(e.target.value)}
                    />
                  </>
                )}

                {selectedTask === "Undo Combine" && (
                  <>
                    <p style={{ color: "#94a3b8", margin: 0, lineHeight: 1.5 }}>
                      Restore an absorbed partner batch as its own active batch. Biomass or extracted oil
                      totals on this survivor are reduced by the amount that was merged in.
                    </p>
                    <select
                      style={inputStyle}
                      value={undoCombinePartnerId}
                      onChange={(e) => setUndoCombinePartnerId(e.target.value)}
                    >
                      <option value="">Select batch to restore…</option>
                      {getMergedPartnerIds(selectedExt).map((mergedId) => (
                        <option key={mergedId} value={mergedId}>
                          {mergedId}
                        </option>
                      ))}
                    </select>
                    {undoCombinePartnerId.trim() ? (
                      <p style={{ color: "#cbd5e1", margin: 0, fontSize: 13 }}>
                        {(() => {
                          const preview = getUncombinePreview(selectedExt, undoCombinePartnerId);
                          if ("error" in preview) {
                            return preview.error;
                          }
                          return `Will restore ${preview.pid} (${preview.restoreDetail}) and update survivor ${preview.sid}.`;
                        })()}
                      </p>
                    ) : null}
                  </>
                )}

                {selectedTask === "Pack Socks Start" && (
                  <>
                    <p style={{ color: "#94a3b8", margin: 0 }}>
                      This starts biomass preparation. The app will use this start time to calculate total prep time when Pack Socks Stop is saved.
                    </p>

                    <input
                      style={inputStyle}
                      placeholder="How Many Techs"
                      value={packSockTechCount}
                      onChange={(e) => updatePackSockTechCount(e.target.value)}
                    />

                    {packSockTechNames.map((name, index) => (
                      <input
                        key={index}
                        style={inputStyle}
                        placeholder={
                          index === 0
                            ? "Tech 1 Name / Lead Tech"
                            : `Tech ${index + 1} Name`
                        }
                        value={name}
                        onChange={(e) =>
                          updatePackSockTechName(index, e.target.value)
                        }
                      />
                    ))}
                  </>
                )}

                {selectedTask === "Pack Socks Stop" && (
                  <>
                    <p style={{ color: "#94a3b8", margin: 0 }}>
                      Prep Time So Far: {getCurrentPackSockDuration(selectedExt)}
                    </p>

                    <input
                      style={inputStyle}
                      placeholder="Total Socks Packed"
                      value={totalSocksPacked}
                      onChange={(e) => updateTotalSocksPacked(e.target.value)}
                    />

                    {sockGramInputs.length > 0 && (
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                          gap: 8,
                          background: "#020617",
                          border: "1px solid #334155",
                          borderRadius: 12,
                          padding: 10,
                        }}
                      >
                        {sockGramInputs.map((grams, sockIndex) => (
                          <input
                            key={sockIndex}
                            style={inputStyle}
                            placeholder={`Sock ${sockIndex + 1} grams`}
                            value={grams}
                            onChange={(e) =>
                              updateSockGramInput(sockIndex, e.target.value)
                            }
                          />
                        ))}
                      </div>
                    )}

                    <p style={{ color: "#94a3b8", margin: 0 }}>
                      Total Socks Prepared: {num(totalSocksPacked) || "—"}
                    </p>

                    <p style={{ color: "#94a3b8", margin: 0 }}>
                      Total Biomass Prepared: {
                        sockGramInputs.length > 0 && getSockGramTotal() > 0
                          ? `${+getSockGramTotal().toFixed(2)} g / ${+(getSockGramTotal() / 453.592).toFixed(2)} lbs`
                          : "—"
                      }
                    </p>

                    <p style={{ color: "#94a3b8", margin: 0 }}>
                      Average Per Sock: {
                        sockGramInputs.length > 0 && getSockGramTotal() > 0
                          ? `${+(getSockGramTotal() / sockGramInputs.length).toFixed(2)} g`
                          : "—"
                      }
                    </p>
                  </>
                )}

                {selectedTask === "Print Batch Label" && selectedExt && (
                  <>
                    <p
                      style={{
                        color: "#94a3b8",
                        margin: "0 auto 16px",
                        maxWidth: 560,
                        textAlign: "center",
                        lineHeight: 1.45,
                      }}
                    >
                      This task is <strong style={{ color: "#e2e8f0" }}>always available</strong> at
                      any workflow stage so you can reprint labels. Layout is anchored to the{" "}
                      <strong style={{ color: "#e2e8f0" }}>top</strong> of one sticker with lines using the full
                      calibrated width — sized from{" "}
                      <strong style={{ color: "#e2e8f0" }}>DYMO calibration</strong> below.{" "}
                      <strong style={{ color: "#e2e8f0" }}>Print label</strong> uses{" "}
                      <strong style={{ color: "#e2e8f0" }}>saved</strong> settings; use{" "}
                      <strong style={{ color: "#e2e8f0" }}>Test print</strong> to try draft values.
                      Set <strong style={{ color: "#e2e8f0" }}>Labels to print</strong> for how many identical stickers
                      go out in one job. Then save each print to the log as usual.
                    </p>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 20,
                        width: "100%",
                      }}
                    >
                      <DymoLabelCalibrationPanel
                        draft={dymoDraftCalibration}
                        onDraftChange={setDymoDraftCalibration}
                        onSave={() => saveDymoCalibrationSettings()}
                        onReset={() => {
                          setDymoDraftCalibration({ ...defaultDymoLabelCalibrationSettings });
                          setDymoSaveError(null);
                        }}
                        printCopies={dymoLabelPrintCopies}
                        onPrintCopiesChange={(n) => setDymoLabelPrintCopies(clampDymoLabelPrintCopies(n))}
                        onTestPrint={() => {
                          const ok = openExtractionBatchLabelPrintWindow(
                            buildExtractionBatchLabelFields(selectedExt, getSource),
                            {
                              calibration: dymoDraftCalibration,
                              copies: dymoLabelPrintCopiesClamped,
                            },
                          );
                          if (!ok) {
                            showNotice(
                              "Print could not start",
                              "Could not start print (iframe document failed). Try again or use a different browser.",
                            );
                          }
                        }}
                        saveBusy={dymoSaveBusy}
                        saveError={dymoSaveError}
                        inputStyle={inputStyle}
                      />
                      <ExtractionBatchLabelPreview
                        fields={buildExtractionBatchLabelFields(selectedExt, getSource)}
                        calibration={dymoDraftCalibration}
                      />
                      <button
                        type="button"
                        style={{
                          ...inputStyle,
                          cursor: "pointer",
                          fontWeight: 600,
                          minWidth: "min(320px, 100%)",
                          maxWidth: 400,
                          width: "100%",
                          padding: "12px 20px",
                          background: "linear-gradient(135deg, #6366f1, #4f46e5)",
                          border: "1px solid #818cf8",
                          color: "#f8fafc",
                        }}
                        onClick={() => {
                          const ok = openExtractionBatchLabelPrintWindow(
                            buildExtractionBatchLabelFields(selectedExt, getSource),
                            {
                              calibration: dymoSavedCalibration,
                              copies: dymoLabelPrintCopiesClamped,
                            },
                          );
                          if (!ok) {
                            showNotice(
                              "Print could not start",
                              "Could not start print (iframe document failed). Try again or use a different browser.",
                            );
                          }
                        }}
                      >
                        Print label (saved calibration: {dymoSavedCalibration.labelWidth} ×{" "}
                        {dymoSavedCalibration.labelHeight}
                        {dymoLabelPrintCopiesClamped > 1
                          ? ` · ×${dymoLabelPrintCopiesClamped}`
                          : ""}
                        )
                      </button>
                      <p
                        style={{
                          color: "#64748b",
                          margin: 0,
                          fontSize: 12,
                          maxWidth: 480,
                          textAlign: "center",
                          lineHeight: 1.4,
                        }}
                      >
                        If the job lands between stickers, decrease{" "}
                        <strong style={{ color: "#cbd5e1" }}>Top/start offset</strong> (more negative)
                        and run <strong style={{ color: "#cbd5e1" }}>Test print</strong>. In Chrome/Edge, open{" "}
                        <strong style={{ color: "#cbd5e1" }}>More settings</strong> and set{" "}
                        <strong style={{ color: "#cbd5e1" }}>Paper size</strong> and{" "}
                        <strong style={{ color: "#cbd5e1" }}>margins</strong> to match your DYMO stock, and use{" "}
                        <strong style={{ color: "#cbd5e1" }}>100% scale</strong> (Chrome may still show a Letter-sized
                        preview even when ink lands on the die-cut).
                      </p>
                    </div>
                  </>
                )}

                {selectedTask === "Run Extraction" && (
                  <>
                    <input
                      style={inputStyle}
                      placeholder="Run Time"
                      value={runTime}
                      onChange={(e) => setRunTime(e.target.value)}
                    />

                    <select
                      style={inputStyle}
                      value={finalProduct}
                      onChange={(e) => setFinalProduct(e.target.value)}
                    >
                      {(allowedRunProducts.length > 0
                        ? allowedRunProducts
                        : productTypes
                      ).map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </select>

                    <input
                      style={inputStyle}
                      placeholder="Total Gas Loss (lbs)"
                      value={totalGasLoss}
                      onChange={(e) => setTotalGasLoss(e.target.value)}
                    />

                    <input
                      style={inputStyle}
                      placeholder="Total Silica Used (grams)"
                      value={totalSilicaUsed}
                      onChange={(e) => setTotalSilicaUsed(e.target.value)}
                    />

                    <input
                      style={inputStyle}
                      placeholder="Total B80 Clay Used (grams)"
                      value={totalB80Used}
                      onChange={(e) => setTotalB80Used(e.target.value)}
                    />

                    <input
                      style={inputStyle}
                      placeholder="How Many Techs"
                      value={howManyTechs}
                      onChange={(e) => updateHowManyTechs(e.target.value)}
                    />

                    {techNames.map((name, index) => (
                      <input
                        key={index}
                        style={inputStyle}
                        placeholder={
                          index === 0
                            ? "Tech 1 Name / Lead Tech"
                            : `Tech ${index + 1} Name`
                        }
                        value={name}
                        onChange={(e) =>
                          updateTechName(index, e.target.value)
                        }
                      />
                    ))}
                  </>
                )}

                {selectedTask === "Start Purge" && (
                  <>
                    <input
                      style={inputStyle}
                      type="datetime-local"
                      value={dateInOven}
                      onChange={(e) => setDateInOven(e.target.value)}
                    />

                    <input
                      style={inputStyle}
                      placeholder="Oven Temp"
                      value={ovenTemp}
                      onChange={(e) => setOvenTemp(e.target.value)}
                    />
                  </>
                )}

                {selectedTask === "End Purge" && (
                  <input
                    style={inputStyle}
                    type="datetime-local"
                    value={dateOutOven}
                    onChange={(e) => setDateOutOven(e.target.value)}
                  />
                )}

                {(selectedTask === "Whip" || extractionCustomTaskLabels.has(selectedTask)) && (
                  <>
                    <input
                      style={inputStyle}
                      placeholder="How Many People"
                      value={whipPeople}
                      onChange={(e) => setWhipPeople(e.target.value)}
                    />

                    <input
                      style={inputStyle}
                      placeholder="Time"
                      value={whipTime}
                      onChange={(e) => setWhipTime(e.target.value)}
                    />
                  </>
                )}

                {selectedTask === "Start Terp Separation" && (
                  <>
                    <input
                      style={inputStyle}
                      type="datetime-local"
                      value={terpStart}
                      onChange={(e) => setTerpStart(e.target.value)}
                    />

                    <input
                      style={inputStyle}
                      placeholder="How Many Techs"
                      value={terpStartTechCount}
                      onChange={(e) =>
                        updateTerpStartTechCount(e.target.value)
                      }
                    />

                    {terpStartTechNames.map((name, index) => (
                      <input
                        key={index}
                        style={inputStyle}
                        placeholder={
                          index === 0
                            ? "Tech 1 Name / Lead Tech"
                            : `Tech ${index + 1} Name`
                        }
                        value={name}
                        onChange={(e) =>
                          updateTerpStartTechName(index, e.target.value)
                        }
                      />
                    ))}

                    <input
                      style={inputStyle}
                      placeholder="Start Notes"
                      value={terpStartNotes}
                      onChange={(e) => setTerpStartNotes(e.target.value)}
                    />
                  </>
                )}

                {selectedTask === "Finish Terp Separation" && (
                  <>
                    <input
                      style={inputStyle}
                      type="datetime-local"
                      value={terpEnd}
                      onChange={(e) => setTerpEnd(e.target.value)}
                    />

                    <input
                      style={inputStyle}
                      placeholder="How Many Techs"
                      value={terpFinishTechCount}
                      onChange={(e) =>
                        updateTerpFinishTechCount(e.target.value)
                      }
                    />

                    {terpFinishTechNames.map((name, index) => (
                      <input
                        key={index}
                        style={inputStyle}
                        placeholder={
                          index === 0
                            ? "Tech 1 Name / Lead Tech"
                            : `Tech ${index + 1} Name`
                        }
                        value={name}
                        onChange={(e) =>
                          updateTerpFinishTechName(index, e.target.value)
                        }
                      />
                    ))}

                    <input
                      style={inputStyle}
                      placeholder="Terps collected (grams)"
                      value={totalTerps}
                      onChange={(e) => setTotalTerps(e.target.value)}
                    />

                    <input
                      style={inputStyle}
                      placeholder="Finish Notes"
                      value={terpFinishNotes}
                      onChange={(e) => setTerpFinishNotes(e.target.value)}
                    />
                  </>
                )}

                {selectedTask === "Start Decarb" && (
                  <>
                    <input
                      style={inputStyle}
                      type="datetime-local"
                      value={decarbStart}
                      onChange={(e) => setDecarbStart(e.target.value)}
                    />

                    <input
                      style={inputStyle}
                      placeholder="Starting crystal weight (grams)"
                      value={decarbStartWeight}
                      onChange={(e) => setDecarbStartWeight(e.target.value)}
                    />

                    <input
                      style={inputStyle}
                      placeholder="Max Temp"
                      value={decarbMaxTemp}
                      onChange={(e) => setDecarbMaxTemp(e.target.value)}
                    />

                    <input
                      style={inputStyle}
                      placeholder="How Many Techs"
                      value={decarbStartTechCount}
                      onChange={(e) =>
                        updateDecarbStartTechCount(e.target.value)
                      }
                    />

                    {decarbStartTechNames.map((name, index) => (
                      <input
                        key={index}
                        style={inputStyle}
                        placeholder={
                          index === 0
                            ? "Tech 1 Name / Lead Tech"
                            : `Tech ${index + 1} Name`
                        }
                        value={name}
                        onChange={(e) =>
                          updateDecarbStartTechName(index, e.target.value)
                        }
                      />
                    ))}

                    <input
                      style={inputStyle}
                      placeholder="Start Notes"
                      value={decarbStartNotes}
                      onChange={(e) => setDecarbStartNotes(e.target.value)}
                    />
                  </>
                )}

                {selectedTask === "Finish Decarb" && (
                  <>
                    <input
                      style={inputStyle}
                      type="datetime-local"
                      value={decarbEnd}
                      onChange={(e) => setDecarbEnd(e.target.value)}
                    />

                    <input
                      style={inputStyle}
                      placeholder="Final decarbed oil (grams)"
                      value={decarbEndWeight}
                      onChange={(e) => setDecarbEndWeight(e.target.value)}
                    />

                    {finishDecarbYieldPreview ? (
                      <div
                        style={{
                          padding: 12,
                          borderRadius: 8,
                          background: "#0f172a",
                          border: "1px solid #334155",
                          fontSize: 13,
                          color: "#cbd5e1",
                        }}
                      >
                        <p style={{ margin: "0 0 6px" }}>
                          Final decarbed oil:{" "}
                          {formatYieldGramsDisplay(finishDecarbYieldPreview.finalDecarbedOilGrams)}
                        </p>
                        <p style={{ margin: "0 0 6px" }}>
                          Configured terp add-back:{" "}
                          {formatYieldPercentDisplay(finishDecarbYieldPreview.terpAddBackPercent)}
                        </p>
                        <p style={{ margin: "0 0 6px" }}>
                          Terps to add back:{" "}
                          {formatYieldGramsDisplay(finishDecarbYieldPreview.terpsToAddBackGrams)}
                          {finishDecarbYieldPreview.terpAddBackCapped ? (
                            <span style={{ color: "#fbbf24", marginLeft: 8 }}>
                              (capped at collected — only{" "}
                              {formatYieldGramsDisplay(
                                finishDecarbYieldPreview.actualTerpsAddedBackGrams,
                              )}{" "}
                              will be added)
                            </span>
                          ) : null}
                        </p>
                        <p style={{ margin: 0 }}>
                          Leftover terps:{" "}
                          {formatYieldGramsDisplay(finishDecarbYieldPreview.leftoverTerpsGrams)}
                        </p>
                      </div>
                    ) : null}

                    <input
                      style={inputStyle}
                      placeholder="How Many Techs"
                      value={decarbFinishTechCount}
                      onChange={(e) =>
                        updateDecarbFinishTechCount(e.target.value)
                      }
                    />

                    {decarbFinishTechNames.map((name, index) => (
                      <input
                        key={index}
                        style={inputStyle}
                        placeholder={
                          index === 0
                            ? "Tech 1 Name / Lead Tech"
                            : `Tech ${index + 1} Name`
                        }
                        value={name}
                        onChange={(e) =>
                          updateDecarbFinishTechName(index, e.target.value)
                        }
                      />
                    ))}

                    <input
                      style={inputStyle}
                      placeholder="Finish Notes"
                      value={decarbFinishNotes}
                      onChange={(e) => setDecarbFinishNotes(e.target.value)}
                    />
                  </>
                )}

                {selectedTask === "Adding Terps" && (
                  <>
                    <input
                      style={inputStyle}
                      placeholder="People"
                      value={addingTerpsPeople}
                      onChange={(e) => setAddingTerpsPeople(e.target.value)}
                    />

                    <input
                      style={inputStyle}
                      placeholder="Time"
                      value={addingTerpsTime}
                      onChange={(e) => setAddingTerpsTime(e.target.value)}
                    />

                    <input
                      style={inputStyle}
                      placeholder="Total Terps Added"
                      value={totalTerpsAdded}
                      onChange={(e) => setTotalTerpsAdded(e.target.value)}
                    />

                    <input
                      style={inputStyle}
                      placeholder="Notes / Terps Added"
                      value={addingTerpsNotes}
                      onChange={(e) => setAddingTerpsNotes(e.target.value)}
                    />
                  </>
                )}

                {selectedTask === "Testing" && (
                  <>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 8,
                      }}
                    >
                      {testingOptions.map((test) => (
                        <button
                          key={test}
                          style={{
                            ...buttonStyle,
                            background: selectedTests.includes(test)
                              ? "#22c55e"
                              : "#334155",
                            color: selectedTests.includes(test)
                              ? "black"
                              : "white",
                          }}
                          onClick={() => toggleTest(test)}
                        >
                          {test}
                        </button>
                      ))}
                    </div>

                    <select
                      style={inputStyle}
                      value={testingStatus}
                      onChange={(e) => setTestingStatus(e.target.value)}
                    >
                      {testingStatuses.map((status) => (
                        <option key={status}>{status}</option>
                      ))}
                    </select>

                    <input
                      style={inputStyle}
                      type="date"
                      value={dateSubmitted}
                      onChange={(e) => setDateSubmitted(e.target.value)}
                    />
                  </>
                )}

                {selectedTask === "Finish Batch" && (
                  <>
                    <input
                      style={inputStyle}
                      placeholder="Batch name (required for multi-source; optional for single source)"
                      value={finishBatchManualName}
                      onChange={(e) => {
                        setFinishBatchManualName(e.target.value);
                        if (!isBlank(e.target.value)) {
                          setDraftFinishBatchCode("");
                        }
                      }}
                    />

                    <input
                      style={inputStyle}
                      placeholder="Total Weight Final Oil (grams)"
                      value={finalOilGrams}
                      onChange={(e) => setFinalOilGrams(e.target.value)}
                    />

                    <input
                      style={inputStyle}
                      placeholder="Total Weight Extra Terps (grams)"
                      value={extraTerpsGrams}
                      onChange={(e) => setExtraTerpsGrams(e.target.value)}
                    />

                    <p style={{ color: "#94a3b8" }}>
                      Total Final Weight:{" "}
                      {num(finalOilGrams) + num(extraTerpsGrams) || "—"} g
                    </p>

                    <p style={{ color: "#94a3b8" }}>
                      Yield:{" "}
                      {getYieldPercentage({
                        ...selectedExt,
                        finalOilGrams,
                        extraTerpsGrams,
                      }) || "—"}
                    </p>

                    <p style={{ color: "#94a3b8" }}>
                      This will finish the extraction batch and send it to packaging.
                    </p>

                    <p style={{ color: "#cbd5e1", fontSize: 14 }}>
                      Product title:{" "}
                      <b style={{ color: "#e2e8f0" }}>
                        {finishBatchManualName ||
                          draftFinishBatchName ||
                          (collectStrainNamesForExtractionBatch(selectedExt).length === 1
                            ? collectStrainNamesForExtractionBatch(selectedExt)[0]
                            : "") ||
                          selectedExt?.name ||
                          "—"}
                      </b>
                      {(draftFinishBatchCode || selectedExt?.marketBatchCode) ? (
                        <>
                          {" "}
                          | Public code:{" "}
                          <b style={{ color: "#e2e8f0" }}>
                            {draftFinishBatchCode || selectedExt?.marketBatchCode}
                          </b>
                        </>
                      ) : null}
                    </p>

                    {selectedExt ? (
                      (() => {
                        const savedNames = getSavedNamesForSelectedBlend(selectedExt);
                        if (savedNames.length === 0) return null;
                        return (
                          <div
                            style={{
                              border: "1px solid #334155",
                              borderRadius: 10,
                              padding: 10,
                              background: "#0b1220",
                              display: "grid",
                              gap: 8,
                            }}
                          >
                            <div style={{ color: "#93c5fd", fontSize: 13, fontWeight: 700 }}>
                              Previously used names for this blend
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                              {savedNames.slice(0, 12).map((row) => (
                                <button
                                  key={row.id}
                                  type="button"
                                  style={{
                                    ...buttonStyle,
                                    background: "#1e293b",
                                    border: "1px solid #38bdf8",
                                    color: "#bae6fd",
                                    fontWeight: 700,
                                  }}
                                  onClick={() => {
                                    setFinishBatchManualName(row.productName || "");
                                    setDraftFinishBatchName("");
                                    setDraftFinishBatchCode(
                                      makeMarketBatchCode(row.productName || "", selectedExt.id)
                                    );
                                  }}
                                >
                                  {row.productName}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })()
                    ) : null}

                    {userCanWrite ? (
                      <button
                        type="button"
                        style={{
                          ...buttonStyle,
                          background: "rgba(168, 85, 247, 0.2)",
                          border: "1px solid rgba(168, 85, 247, 0.45)",
                          color: "#e9d5ff",
                          fontWeight: 800,
                        }}
                        onClick={() => {
                          setAiNameError("");
                          setAiNameSuggestions([]);
                          setShowAiNameModal(true);
                        }}
                      >
                        Create new name (AI)
                      </button>
                    ) : null}
                  </>
                )}

                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: 8,
                  }}
                >
                  <button
                    style={buttonStyle}
                    onClick={() => {
                      resetTaskForm();
                      setShowTaskModal(false);
                    }}
                  >
                    Cancel
                  </button>

                  {userCanWrite ? (
                    <button
                      style={greenButtonStyle}
                      onClick={saveTask}
                      disabled={isSavingTask}
                    >
                      {isSavingTask ? "Saving..." : "Save Task"}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        )}

        {showAiNameModal && selectedExt && (
          <div style={{ ...modalBackStyle, zIndex: 10050 }}>
            <div style={{ ...modalStyle, maxWidth: 520 }}>
              <h2 style={{ marginTop: 0 }}>AI product name</h2>
              <p style={{ color: "#94a3b8", fontSize: 14, lineHeight: 1.5 }}>
                Strain labels from this batch&apos;s source rows (sent to the model):
              </p>
              <ul style={{ color: "#e2e8f0", marginTop: 8, paddingLeft: 20 }}>
                {collectStrainNamesForExtractionBatch(selectedExt).length === 0 ? (
                  <li style={{ color: "#f87171" }}>No source names found on this batch.</li>
                ) : (
                  collectStrainNamesForExtractionBatch(selectedExt).map((sn) => (
                    <li key={sn}>{sn}</li>
                  ))
                )}
              </ul>

              {aiNameError ? (
                <p style={{ color: "#fca5a5", fontSize: 14 }}>{aiNameError}</p>
              ) : null}

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                <button
                  type="button"
                  style={greenButtonStyle}
                  disabled={aiNameLoading}
                  onClick={() => void generateAiProductNames()}
                >
                  {aiNameLoading ? "Generating…" : "Generate suggestions"}
                </button>
                <button
                  type="button"
                  style={buttonStyle}
                  disabled={aiNameLoading}
                  onClick={() => setShowAiNameModal(false)}
                >
                  Close
                </button>
              </div>

              {aiNameSuggestions.length > 0 ? (
                <div style={{ marginTop: 18 }}>
                  <div style={{ color: "#94a3b8", fontSize: 13, marginBottom: 8 }}>
                    Tap a suggestion to set the title and public code (first 4 letters of the name +
                    the run date). This is saved only when you save the Finish Batch task.
                  </div>
                  <div style={{ display: "grid", gap: 8 }}>
                    {aiNameSuggestions.map((sug) => (
                      <button
                        key={sug}
                        type="button"
                        style={{
                          ...buttonStyle,
                          textAlign: "left",
                          background: "#1e293b",
                          border: "1px solid #38bdf8",
                          color: "#bae6fd",
                          cursor: "pointer",
                        }}
                        onClick={() => {
                          if (!selectedExt) return;
                          const marketBatchCode = makeMarketBatchCode(sug, selectedExt.id);
                          setDraftFinishBatchName(sug);
                          setDraftFinishBatchCode(marketBatchCode);
                          setFinishBatchManualName("");
                          setShowAiNameModal(false);
                        }}
                      >
                        {sug}
                        <span
                          style={{
                            display: "block",
                            fontSize: 12,
                            color: "#94a3b8",
                            marginTop: 4,
                          }}
                        >
                          Code: {makeMarketBatchCode(sug, selectedExt.id)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}

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

        {editSourcePackage ? (
          <div style={modalBackStyle}>
            <div style={{ ...modalStyle, maxWidth: 560 }}>
              <h2 style={{ marginTop: 0 }}>Edit source package</h2>
              <p style={{ fontSize: 13, color: "#94a3b8", marginTop: 0 }}>
                Harvest code uses strain acronym + harvest date (e.g. GMO.051226). Cultivation batch
                id is the clone/flower lot; extraction runs get a new market code when created.
              </p>

              <label style={{ display: "block", marginBottom: 6, fontSize: 13 }}>
                Harvest package code
              </label>
              <input
                style={{ ...inputStyle, marginBottom: 14 }}
                value={editSourceId}
                onChange={(e) => setEditSourceId(e.target.value)}
                disabled={isLikelyDatabaseSourcePackageId(editSourcePackage.id)}
                autoComplete="off"
              />

              <label style={{ display: "block", marginBottom: 6, fontSize: 13 }}>
                Display name
              </label>
              <input
                style={{ ...inputStyle, marginBottom: 14 }}
                value={editSourceName}
                onChange={(e) => setEditSourceName(e.target.value)}
                autoComplete="off"
              />

              <label style={{ display: "block", marginBottom: 6, fontSize: 13 }}>
                Material type
              </label>
              <select
                style={{ ...inputStyle, marginBottom: 14 }}
                value={editSourceType}
                onChange={(e) => setEditSourceType(e.target.value)}
              >
                <option value="Fresh Frozen">Fresh Frozen</option>
                <option value="Dry Trim">Dry Trim</option>
              </select>

              <label style={{ display: "block", marginBottom: 6, fontSize: 13 }}>
                Cultivation batch id
              </label>
              <input
                style={{ ...inputStyle, marginBottom: 14 }}
                value={editSourceCultivationId}
                onChange={(e) => setEditSourceCultivationId(e.target.value)}
                autoComplete="off"
              />

              {editSourceType === "Fresh Frozen" ? (
                <>
                  <label style={{ display: "block", marginBottom: 6, fontSize: 13 }}>
                    Bundles
                  </label>
                  <input
                    style={{ ...inputStyle, marginBottom: 14 }}
                    value={editSourceBundles}
                    onChange={(e) => setEditSourceBundles(e.target.value)}
                    autoComplete="off"
                  />
                  <label style={{ display: "block", marginBottom: 6, fontSize: 13 }}>
                    Grams
                  </label>
                  <input
                    style={{ ...inputStyle, marginBottom: 14 }}
                    value={editSourceGrams}
                    onChange={(e) => setEditSourceGrams(e.target.value)}
                    autoComplete="off"
                  />
                </>
              ) : null}

              <label style={{ display: "block", marginBottom: 6, fontSize: 13 }}>
                Weight (lbs)
              </label>
              <input
                style={{ ...inputStyle, marginBottom: 14 }}
                value={editSourceWeightLbs}
                onChange={(e) => setEditSourceWeightLbs(e.target.value)}
                autoComplete="off"
              />

              <label style={{ display: "block", marginBottom: 6, fontSize: 13 }}>
                Status
              </label>
              <select
                style={{ ...inputStyle, marginBottom: 16 }}
                value={editSourceStatus}
                onChange={(e) => setEditSourceStatus(e.target.value)}
              >
                <option value="Available for Extraction">Available for Extraction</option>
                <option value="Partially Used in Extraction">Partially Used in Extraction</option>
                <option value="Used in Extraction">Used in Extraction</option>
              </select>

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button type="button" style={buttonStyle} onClick={closeEditSourcePackage}>
                  Cancel
                </button>
                <button
                  type="button"
                  style={greenButtonStyle}
                  onClick={() => void saveEditSourcePackage()}
                  disabled={editSourceSaving}
                >
                  {editSourceSaving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {viewBatch && (
          <div style={modalBackStyle}>
            <div style={{ ...modalStyle, maxWidth: 750 }}>
              <h2 style={{ marginTop: 0 }}>Batch Details</h2>

              <p style={{ fontSize: 13, color: "#94a3b8", marginTop: 0 }}>
                Run id (fixed):{" "}
                <code style={{ color: "#e2e8f0" }}>{viewBatch.id}</code>
              </p>

              {viewBatchEditing ? (
                <div
                  style={{
                    padding: 14,
                    background: "#1e293b",
                    borderRadius: 12,
                    marginBottom: 16,
                    border: "1px solid #334155",
                  }}
                >
                  <h3 style={{ marginTop: 0, marginBottom: 12 }}>Edit batch</h3>
                  <label style={{ display: "block", marginBottom: 6, fontSize: 13 }}>
                    Batch / product name
                  </label>
                  <input
                    style={{ ...inputStyle, marginBottom: 14 }}
                    value={editBatchName}
                    onChange={(e) => setEditBatchName(e.target.value)}
                    autoComplete="off"
                  />
                  <label style={{ display: "block", marginBottom: 6, fontSize: 13 }}>
                    Product type
                  </label>
                  <select
                    style={{ ...inputStyle, marginBottom: 14 }}
                    value={editProductType}
                    onChange={(e) => setEditProductType(e.target.value)}
                  >
                    {[...new Set([...productTypes, editProductType].filter(Boolean))].map(
                      (pt) => (
                        <option key={pt} value={pt}>
                          {pt}
                        </option>
                      ),
                    )}
                  </select>
                  <label style={{ display: "block", marginBottom: 6, fontSize: 13 }}>
                    Market batch code{" "}
                    <span style={{ color: "#64748b", fontWeight: 400 }}>
                      (optional; shared lot-style code)
                    </span>
                  </label>
                  <input
                    style={{ ...inputStyle, marginBottom: 14 }}
                    value={editMarketBatchCode}
                    onChange={(e) => setEditMarketBatchCode(e.target.value)}
                    autoComplete="off"
                  />
                  <label style={{ display: "block", marginBottom: 6, fontSize: 13 }}>
                    Blend label
                  </label>
                  <input
                    style={{ ...inputStyle, marginBottom: 4 }}
                    value={editSourceBlendLabel}
                    onChange={(e) => setEditSourceBlendLabel(e.target.value)}
                    autoComplete="off"
                  />
                  <p style={{ fontSize: 12, color: "#64748b", margin: "8px 0 0" }}>
                    Sources and completed tasks are unchanged here — use workflow tasks to log
                    process steps.
                  </p>
                </div>
              ) : (
                <>
                  <p>
                    <b>{extractionBatchMarketBatchCode(viewBatch)}</b>
                  </p>

                  <p>
                    {viewBatch.name} | Status: {viewBatch.status} | Biomass Used:{" "}
                    {extractionBatchBiomassLbs(viewBatch) > 0
                      ? `${extractionBatchBiomassLbs(viewBatch)} lbs`
                      : "—"}{" "}
                    | Final: {num(viewBatch.totalFinalGrams) || "—"} g
                  </p>
                  <ExtractionBatchYieldSummary
                    batch={viewBatch}
                    terpAddBackPercent={terpAddBackPercentOfOilWeight}
                    compact={false}
                  />

                  {viewBatch.sourceBlendLabel ? (
                    <p style={{ color: "#cbd5e1" }}>
                      <b>Blend:</b> {viewBatch.sourceBlendLabel}
                    </p>
                  ) : null}

                  {extractionBatchCultivationFooter(viewBatch) ? (
                    <p style={{ fontSize: 12, color: "#94a3b8", margin: "8px 0 0" }}>
                      Source (cultivation): {extractionBatchCultivationFooter(viewBatch)}
                    </p>
                  ) : null}

                  {Array.isArray(viewBatch.combinedFromBatchIds) &&
                  viewBatch.combinedFromBatchIds.length > 0 ? (
                    <div
                      style={{
                        marginTop: 14,
                        padding: 12,
                        borderRadius: 10,
                        background: "rgba(15,23,42,0.65)",
                        border: "1px solid rgba(56,189,248,0.35)",
                      }}
                    >
                      <p style={{ margin: "0 0 10px", fontSize: 13, color: "#fbbf24" }}>
                        This batch absorbed others via <b>Combine Batches</b>. Use <b>Undo combine</b> if
                        the wrong partner was merged — restores that batch and fixes survivor totals.
                      </p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {viewBatch.combinedFromBatchIds.map((mergedId: string) => (
                          <button
                            key={mergedId}
                            type="button"
                            style={buttonStyle}
                            disabled={Boolean(uncombineBusyPartnerId)}
                            onClick={() =>
                              promptUncombineMergedPartner(
                                s.extractionBatches.find((b: any) => b.id === viewBatch.id) || viewBatch,
                                mergedId,
                              )
                            }
                          >
                            {uncombineBusyPartnerId === mergedId
                              ? "Restoring…"
                              : `Undo ${mergedId}`}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </>
              )}

              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 10,
                  marginTop: 4,
                  marginBottom: 12,
                  alignItems: "center",
                }}
              >
                {userCanWrite && !viewBatchEditing ? (
                  <button type="button" style={blueButtonStyle} onClick={startViewBatchEdit}>
                    Edit details
                  </button>
                ) : null}
                {viewBatchEditing ? (
                  <>
                    <button
                      type="button"
                      style={buttonStyle}
                      onClick={cancelViewBatchEdit}
                      disabled={editBatchSaving}
                    >
                      Cancel edit
                    </button>
                    <button
                      type="button"
                      style={greenButtonStyle}
                      onClick={() => void saveViewBatchEdits()}
                      disabled={editBatchSaving}
                    >
                      {editBatchSaving ? "Saving…" : "Save changes"}
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  style={buttonStyle}
                  onClick={() => {
                    setViewBatch(null);
                    setViewBatchEditing(false);
                  }}
                >
                  Close
                </button>
              </div>

              {hasCompletedTask(viewBatch, "Pack Socks Stop") && (
                <div
                  style={{
                    padding: 12,
                    background: "#1e293b",
                    borderRadius: 10,
                    marginBottom: 12,
                    border: "1px solid #334155",
                  }}
                >
                  <h3 style={{ marginTop: 0 }}>Sock Prep Summary</h3>
                  <div>Prep Time: {getPackSockPrepStats(viewBatch).duration}</div>
                  <div>Total Socks Prepared: {getPackSockPrepStats(viewBatch).totalSocks}</div>
                  <div>Average Per Sock: {getPackSockPrepStats(viewBatch).averageGramsPerSock} g</div>
                  <div>Prepared Biomass: {getPackSockPrepStats(viewBatch).totalPreparedGrams} g / {getPackSockPrepStats(viewBatch).totalPreparedLbs} lbs</div>
                  {getPackSockPrepStats(viewBatch).sockWeightsGrams.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <b>Sock Weights:</b>{" "}
                      {getPackSockPrepStats(viewBatch).sockWeightsGrams
                        .map((weight: number, index: number) => `Sock ${index + 1}: ${weight} g`)
                        .join(" | ")}
                    </div>
                  )}
                </div>
              )}

              <h3>Completed Tasks</h3>
              <p>
                {getCompletedTasks(viewBatch).join(" → ") ||
                  "No tasks completed yet."}
              </p>

              <h3>Sources Used</h3>

              {getExtractionSourceRowsForDisplay(viewBatch).length > 0 ? (
                getExtractionSourceRowsForDisplay(viewBatch).map((src: any, index: number) => (
                  <div
                    key={index}
                    style={{
                      padding: 10,
                      background: "#1e293b",
                      borderRadius: 10,
                      marginBottom: 8,
                    }}
                  >
                    {src.sourceId} | {src.name} | Material:{" "}
                    {src.materialType === "freshFrozen"
                      ? "Fresh Frozen"
                      : src.materialType === "dryTrim"
                      ? "Dry Trim"
                      : "Unknown"}{" "}
                    | Used: {src.amountUsed} lbs
                  </div>
                ))
              ) : (
                <p>{viewBatch.source}</p>
              )}

              <div style={{ marginTop: 18 }}>
                <h3>Task History</h3>

                {selectedLogs.length === 0 ? (
                  <p style={{ color: "#94a3b8" }}>No logs for this batch yet.</p>
                ) : (
                  selectedLogs.map((log: any, index: number) => (
                    <div
                      key={index}
                      style={{
                        padding: 12,
                        background: "#1e293b",
                        borderRadius: 10,
                        marginBottom: 8,
                        border: "1px solid #334155",
                      }}
                    >
                      <div>
                        <b>{log.task}</b>
                      </div>
                      <div>Output: {log.output || "—"}</div>
                      <div>Time: {formatLogDisplayTime(log)}</div>
                      <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
                        Logged By: {formatLoggedBy(log.loggedBy || log.data?.loggedBy)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {notificationModal.open && (
          <div style={modalBackStyle}>
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
                  style={
                    notificationModal.onConfirm
                      ? deleteButtonStyle
                      : blueButtonStyle
                  }
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
      </div>
    </div>
    </PageAccessGate>
  );
}