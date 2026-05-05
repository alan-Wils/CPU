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
  loadSourceBatches,
  updateSourceBatch,
  deleteSourceBatchRecord,
} from "@/lib/sourceBatchApi";
import {
  loadExtractionBatches,
  createExtractionBatch,
  updateExtractionBatch,
  deleteExtractionBatchRecord,
} from "@/lib/extractionApi";
import { createPackagingBatch } from "@/lib/packagingApi";
import { createLog } from "@/lib/logsApi";
import { suggestExtractionProductNames } from "@/lib/api";

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

const optionalRepeatableTasks = ["Whip", "Adding Terps"];

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

function isCompletedSourceBatch(batch: any) {
  const status = String(batch?.status || "").toLowerCase();
  return (
    status === "complete" ||
    status === "used in extraction" ||
    status.includes("complete")
  );
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

function parseAmountToLbs(value: any) {
  const text = String(value || "").toLowerCase();

  const gramsMatch = text.match(/(\d+(\.\d+)?)\s*grams?/);
  if (gramsMatch) return num(gramsMatch[1]) / 453.592;

  const lbsMatch = text.match(/(\d+(\.\d+)?)\s*lbs?/);
  if (lbsMatch) return num(lbsMatch[1]);

  return 0;
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

/** Public code for multi-strain extraction runs (replaces EXT id in UI until AI renames). */
function makeBlendMarketBatchCodeFromSourceRows(
  rows: Array<{ acronym?: string }>,
  extractionBatchId: string
): string {
  const cleaned = rows.map((r) => cleanAcronym(r.acronym)).filter(Boolean);
  const unique = [...new Set(cleaned)];
  let core = "MIXX";
  if (unique.length === 1) {
    core = (unique[0] + "XXXX").slice(0, 4);
  } else if (unique.length === 2) {
    const a = unique[0];
    const b = unique[1];
    core = `${(a + "XX").slice(0, 2)}${(b + "XX").slice(0, 2)}`.toUpperCase().slice(0, 4);
  } else if (unique.length > 2) {
    core = unique
      .map((u) => (u.charAt(0) || "X").toUpperCase())
      .join("")
      .concat("XXXX")
      .slice(0, 4);
  }
  const datePart = extractDateCodeFromBatchId(extractionBatchId) || getDateCode();
  return `${core}.${datePart}`;
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

function makeProductionBatchId(sources: any[]) {
  const acronymMix = sources
    .map((src) => getSourceAcronym(src))
    .join("")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, 4);

  return `EXT-${acronymMix || "MIX"}-${getDateCode()}`;
}

function extractionPollTaskNodeIsEmpty(value: any): boolean {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

/** When polling, keep optimistic task progress if the server row is briefly stale. */
function mergeExtractionPollState(serverBatch: any, localBatch: any): any {
  if (!localBatch || !serverBatch || String(serverBatch.id) !== String(localBatch.id)) {
    return serverBatch || localBatch;
  }
  const ctS = Array.isArray(serverBatch.completedTasks)
    ? serverBatch.completedTasks.map(String)
    : [];
  const ctL = Array.isArray(localBatch.completedTasks)
    ? localBatch.completedTasks.map(String)
    : [];
  const completedTasks = [...ctS, ...ctL.filter((t: string) => !ctS.includes(t))];

  const tdS =
    serverBatch.taskData &&
    typeof serverBatch.taskData === "object" &&
    !Array.isArray(serverBatch.taskData)
      ? serverBatch.taskData
      : {};
  const tdL =
    localBatch.taskData &&
    typeof localBatch.taskData === "object" &&
    !Array.isArray(localBatch.taskData)
      ? localBatch.taskData
      : {};
  const keys = new Set([...Object.keys(tdS), ...Object.keys(tdL)]);
  const taskData: Record<string, unknown> = {};
  for (const k of keys) {
    const b = tdS[k];
    const a = tdL[k];
    if (extractionPollTaskNodeIsEmpty(b) && !extractionPollTaskNodeIsEmpty(a)) {
      taskData[k] = a;
    } else if (extractionPollTaskNodeIsEmpty(a) && !extractionPollTaskNodeIsEmpty(b)) {
      taskData[k] = b;
    } else if (
      typeof a === "object" &&
      typeof b === "object" &&
      a &&
      b &&
      !Array.isArray(a) &&
      !Array.isArray(b)
    ) {
      taskData[k] = { ...(b as Record<string, unknown>), ...(a as Record<string, unknown>) };
    } else {
      taskData[k] = !extractionPollTaskNodeIsEmpty(b) ? b : a;
    }
  }

  return {
    ...serverBatch,
    completedTasks: completedTasks.length ? completedTasks : serverBatch.completedTasks,
    taskData,
  };
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
      try {
        await loadBackendStore();
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
            // Prisma-backed source packages do not carry legacy weight fields.
            return !isCompletedSourceBatch(batch);
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
            .filter(([k]: [string, any]) => k)
        );
        s.extractionBatches = extractionList.map((b: any) => {
          const prev = prevExById.get(String(b?.id || ""));
          return prev ? mergeExtractionPollState(b, prev) : b;
        });

        setSelectedExt((current: any) => {
          if (current?.id) {
            const stillExists = extractionList.find((batch: any) => batch.id === current.id);
            if (stillExists) return mergeExtractionPollState(stillExists, current);
          }

          return extractionList[0] || null;
        });
        setRefresh((n) => n + 1);
      } catch (error) {
        console.error("Could not load real extraction/source tables:", error);

        try {
          await loadBackendStore();
          await hydrateTaskLogsFromApi();

          if (!active) return;

          setSelectedExt((current: any) => current || s.extractionBatches[0] || null);
          setRefresh((n) => n + 1);
        } catch (backupError) {
          console.error("Could not load backend store backup on Extraction page:", backupError);
        }
      }
    }

    loadSharedCompanyData();

    const interval = setInterval(() => {
      loadSharedCompanyData();
    }, 5000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  if (!s.sourceBatches) s.sourceBatches = [];
  if (!s.completedSourceBatches) s.completedSourceBatches = [];
  if (!s.extractionBatches) s.extractionBatches = [];
  if (!s.packagingBatches) s.packagingBatches = [];
  if (!s.logs) s.logs = [];

  const [refresh, setRefresh] = useState(0);
  const [selectedExt, setSelectedExt] = useState<any>(
    s.extractionBatches[0] || null
  );

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [viewBatch, setViewBatch] = useState<any>(null);
  const [showAiNameModal, setShowAiNameModal] = useState(false);
  const [aiNameLoading, setAiNameLoading] = useState(false);
  const [aiNameError, setAiNameError] = useState("");
  const [aiNameSuggestions, setAiNameSuggestions] = useState<string[]>([]);
  const [draftFinishBatchName, setDraftFinishBatchName] = useState("");
  const [draftFinishBatchCode, setDraftFinishBatchCode] = useState("");

  const [type, setType] = useState(productTypes[0]);
  const [sourceInputs, setSourceInputs] = useState<any[]>([
    { sourceId: "", amount: "" },
  ]);

  const [selectedTask, setSelectedTask] = useState(extractionTasks[0]);

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

  function requireWriteAccess(action = "change extraction data") {
    if (userCanWrite) return true;

    showNotice(
      "Read Only Access",
      `Your current role can view this page, but cannot ${action}.`
    );

    return false;
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

    return false;
  }

  function getDefaultTaskForBatch(batch: any) {
    if (isTaskAllowed(batch, "Whip")) return "Whip";
    return getNextAllowedTask(batch);
  }

  function getSource(sourceId: string) {
    return s.sourceBatches.find((b: any) => b.id === sourceId);
  }

  function collectStrainNamesForExtractionBatch(batch: any): string[] {
    if (!Array.isArray(batch?.sources)) return [];
    const rows = batch.sources as any[];
    const names: string[] = rows
      .map((row: any) => String(row?.name || "").trim())
      .filter((n: string) => n.length > 0);
    return [...new Set(names)];
  }

  function getSourceOriginalLbs(source: any) {
    if (!source) return 0;

    if (source.weightLbs !== undefined) return num(source.weightLbs);
    if (source.grams !== undefined) return num(source.grams) / 453.592;
    if (source.amount !== undefined) return parseAmountToLbs(source.amount);

    return 0;
  }

  function getSourceAvailable(source: any) {
    if (!source) return 0;

    const original = getSourceOriginalLbs(source);

    if (source.remainingAmount !== undefined) {
      const remaining = num(source.remainingAmount);

      if (remaining <= 0 && source.status !== "Used in Extraction") {
        return +original.toFixed(2);
      }

      return +remaining.toFixed(2);
    }

    return +original.toFixed(2);
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
    const biomassLbs = num(batch.totalBiomassUsed);

    const oilGrams =
      num(batch.finalOilGrams) ||
      num(batch?.taskData?.["Finish Batch"]?.finalOilGrams);

    const terpsGrams =
      num(batch.extraTerpsGrams) ||
      num(batch?.taskData?.["Finish Batch"]?.extraTerpsGrams);

    const totalFinalGrams = oilGrams + terpsGrams;

    if (biomassLbs <= 0 || totalFinalGrams <= 0) return "";

    const biomassGrams = biomassLbs * 453.592;
    const yieldPercent = (totalFinalGrams / biomassGrams) * 100;

    return `${yieldPercent.toFixed(2)}%`;
  }

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
      selectedExt ? getDefaultTaskForBatch(selectedExt) : extractionTasks[0]
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
      time: new Date().toLocaleString(),
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
      time: new Date().toLocaleString(),
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

  function validateTaskForm() {
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
          { label: "Total Terps", value: totalTerps },
        ])
      ) {
        return false;
      }

      if (!requirePositiveNumber("How Many Techs", terpFinishTechCount)) return false;
      if (!requireTechNames("Tech", terpFinishTechNames)) return false;
      return true;
    }

    if (selectedTask === "Start Decarb") {
      if (
        !requireFields([
          { label: "Start Decarb Date/Time", value: decarbStart },
          { label: "Start Weight", value: decarbStartWeight },
          { label: "Max Temp", value: decarbMaxTemp },
          { label: "How Many Techs", value: decarbStartTechCount },
        ])
      ) {
        return false;
      }

      if (!requirePositiveNumber("How Many Techs", decarbStartTechCount)) return false;
      if (!requireTechNames("Tech", decarbStartTechNames)) return false;
      return true;
    }

    if (selectedTask === "Finish Decarb") {
      if (
        !requireFields([
          { label: "Finish Decarb Date/Time", value: decarbEnd },
          { label: "End Weight", value: decarbEndWeight },
          { label: "How Many Techs", value: decarbFinishTechCount },
        ])
      ) {
        return false;
      }

      if (!requirePositiveNumber("How Many Techs", decarbFinishTechCount)) return false;
      if (!requireTechNames("Tech", decarbFinishTechNames)) return false;
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
      createdAt: new Date().toLocaleString(),
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
            completedAt: new Date().toLocaleString(),
          });
        }
      }
    });

    s.extractionBatches.unshift(batch);
    setSelectedExt(batch);

    const loggedBy = getLoggedBy();
    const loggedAt = new Date().toLocaleString();

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
    if (selectedTask === "Pack Socks Start") {
      return {
        startedAt: new Date().toISOString(),
        startedAtDisplay: new Date().toLocaleString(),
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
        stoppedAtDisplay: stoppedAt.toLocaleString(),
        totalSocksPacked: socks,
        sockWeightsGrams,
        averageGramsPerSock: +averageGramsPerSock.toFixed(2),
        totalPreparedGrams: +totalPreparedGrams.toFixed(2),
        totalPreparedLbs: +totalPreparedLbs.toFixed(2),
        prepDuration: startMs > 0 ? formatDuration(stopMs - startMs) : "—",
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
        notes: terpFinishNotes,
      };
    }

    if (selectedTask === "Start Decarb") {
      return {
        startDateTime: decarbStart,
        startWeight: decarbStartWeight,
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

    if (!isTaskAllowed(selectedExt, selectedTask)) {
      showNotice(
        "Task Not Allowed Yet",
        `This task is not allowed yet.`,
        `Next required task: ${getNextAllowedTask(selectedExt)}.`
      );
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
    const loggedAt = new Date().toLocaleString();
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

    if (selectedTask === "Finish Batch") {
      if (!isBlank(draftFinishBatchName)) {
        selectedExt.name = draftFinishBatchName.trim();
      }
      if (!isBlank(draftFinishBatchCode)) {
        selectedExt.marketBatchCode = draftFinishBatchCode.trim();
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

    saveLog({
      area: "Extraction",
      batch: selectedExt.id,
      task: selectedTask,
      output: buildOutput(data),
      source: selectedExt.source,
      loggedBy,
      data,
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
      time: new Date().toLocaleString(),
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
      setSelectedExt(s.extractionBatches[0] || null);
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
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
    padding: 20,
  };

  const modalStyle: any = {
    background: "#0f172a",
    color: "white",
    border: "1px solid #334155",
    borderRadius: 18,
    padding: 24,
    width: "100%",
    maxWidth: 650,
    maxHeight: "85vh",
    overflowY: "auto",
    boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
  };

  const availableSources = s.sourceBatches.filter(
    (b: any) => getSourceAvailable(b) > 0 && b.status !== "Used in Extraction"
  );

  const allowedCreateProducts = getAllowedCreateProducts();
  const allowedRunProducts = getAllowedRunProducts();

  return (
    <PageAccessGate allowedRoles={["EXTRACTION", "VIEW_ONLY"]}>
      <div style={pageStyle}>
      <div style={shellStyle}>
        <Nav />

        <div style={{ textAlign: "center", marginTop: 24 }}>
          <h1 style={{ margin: 0 }}>Extraction</h1>
          <p style={{ color: "#94a3b8", marginTop: 8 }}>
            Create extraction batches and log purge, whip, terp separation,
            decarb, testing, and finish tasks.
          </p>
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
            <div>
              <h2 style={{ margin: 0 }}>Available Source Material</h2>
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
            {s.sourceBatches.length === 0 ? (
              <p style={{ color: "#94a3b8" }}>
                No source batches available for extraction.
              </p>
            ) : (
              s.sourceBatches.map((b: any) => {
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
                          <b>{b.name || b.type || "Source package"}</b>
                          <span style={{ color: "#94a3b8", fontSize: 13 }}>
                            {" "}
                            · {b.id}
                          </span>
                          {" | Material: "}
                        </>
                      ) : (
                        <>
                          <b>{b.id}</b> | {b.name || b.type} | Material:{" "}
                        </>
                      )}
                      {materialType === "freshFrozen"
                        ? "Fresh Frozen"
                        : materialType === "dryTrim"
                        ? "Dry Trim"
                        : "Unknown"}{" "}
                      | Status: {isEmpty ? "Used in Extraction" : b.status} |
                      Available: {available} lbs
                    </div>

                    {userCanDelete ? (
                      <button
                        style={deleteButtonStyle}
                        onClick={() => deleteSourceBatch(b.id)}
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                );
              })
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

        <div style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div>
              <h2 style={{ margin: 0 }}>Extraction Batches</h2>
              <p style={{ color: "#94a3b8", margin: "6px 0 0" }}>
                {`Required path: Pack Socks Start → Pack Socks Stop → Run Extraction → Start Purge → End Purge → Testing Passed → Finish Batch. Optional tasks can be logged while purge is active.`}
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

          <div style={lockedListStyle}>
            {s.extractionBatches.length === 0 ? (
              <p style={{ color: "#94a3b8" }}>No extraction batches yet.</p>
            ) : (
              s.extractionBatches.map((b: any) => (
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
                    <b>{b.marketBatchCode || b.id}</b>
                    {b.marketBatchCode ? (
                      <span style={{ fontWeight: 600 }}> ({b.id})</span>
                    ) : null}{" "}
                    | {b.name} | Biomass Used:{" "}
                    {b.totalBiomassUsed || b.amount || "—"} lbs | Final:{" "}
                    {num(b.totalFinalGrams) || "—"} g | Yield:{" "}
                    {getYieldPercentage(b) || "—"} | Status: {b.status}
                    <div style={{ fontSize: 13, marginTop: 4 }}>
                      Next Required Task: {getNextAllowedTask(b)}
                    </div>
                  </div>

                  <button style={buttonStyle} onClick={() => setViewBatch(b)}>
                    View
                  </button>

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
                                | Available: {getSourceAvailable(b)} lbs
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
                            <b>Available Amount:</b> {selectedAvailable} lbs
                          </div>
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

                <select
                  style={inputStyle}
                  value={selectedTask}
                  onChange={(e) => setSelectedTask(e.target.value)}
                >
                  {extractionTasks.map((task) => (
                    <option
                      key={task}
                      disabled={!isTaskAllowed(selectedExt, task)}
                    >
                      {task}
                    </option>
                  ))}
                </select>

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

                {selectedTask === "Whip" && (
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
                      placeholder="Total Terps"
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
                      placeholder="Start Weight"
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
                      placeholder="End Weight"
                      value={decarbEndWeight}
                      onChange={(e) => setDecarbEndWeight(e.target.value)}
                    />

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
                        {draftFinishBatchName || selectedExt?.name || "—"}
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

        {viewBatch && (
          <div style={modalBackStyle}>
            <div style={{ ...modalStyle, maxWidth: 750 }}>
              <h2 style={{ marginTop: 0 }}>Batch Details</h2>

              <p>
                <b>{viewBatch.marketBatchCode || viewBatch.id}</b>
                {viewBatch.marketBatchCode ? (
                  <span style={{ color: "#94a3b8", fontWeight: 600 }}>
                    {" "}
                    (run {viewBatch.id})
                  </span>
                ) : null}
              </p>

              <p>
                {viewBatch.name} | Status: {viewBatch.status} | Biomass Used:{" "}
                {viewBatch.totalBiomassUsed || viewBatch.amount || "—"} lbs |
                Final: {num(viewBatch.totalFinalGrams) || "—"} g | Yield:{" "}
                {getYieldPercentage(viewBatch) || "—"}
              </p>

              {viewBatch.sourceBlendLabel ? (
                <p style={{ color: "#cbd5e1" }}>
                  <b>Blend:</b> {viewBatch.sourceBlendLabel}
                </p>
              ) : null}

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

              {viewBatch.sources ? (
                viewBatch.sources.map((src: any, index: number) => (
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

              <button style={buttonStyle} onClick={() => setViewBatch(null)}>
                Close
              </button>

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
                      <div>Time: {log.time}</div>
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