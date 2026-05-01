"use client";

import { useEffect, useRef, useState } from "react";
import Nav from "@/components/Nav";
import PageAccessGate from "@/components/PageAccessGate";
import { store } from "@/lib/store";
import { getAuthUser } from "@/lib/auth";
import { loadBackendStore, saveBackendStore } from "@/lib/backendStore";
import {
  loadCultivationBatches,
  createCultivationBatch,
  updateCultivationBatch,
  deleteCultivationBatch,
} from "@/lib/cultivationApi";
import { createSourceBatch } from "@/lib/sourceBatchApi";
import { createLog } from "@/lib/logsApi";

type ConfigStrain = {
  id?: string;
  name?: string;
  strain?: string;
  acronym?: string;
  dominance?: string;
  potency?: string;
  averageYield?: string;
};

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

const flowerRoomOptions = ["1", "2", "3", "4"] as const;
const flowerBayOptions = ["A", "B", "C"] as const;
const flowerTableOptions = ["1", "2", "3", "4", "5"] as const;

const defaultCloneTasks = [
  "Maintenance",
  "Feed",
  "Burp",
  "Fill Pots",
  "Clone → Veg",
];

const defaultVegTasks = [
  "Set Irrigation Up",
  "Plant Work",
  "IPM",
  "Move to Flower",
];

const defaultFlowerTasks = [
  "Set Irrigation Up",
  "Trellis",
  "Plant Work",
  "IPM",
  "Harvest",
];

const dryFlowerTasks = [
  "Bucking",
  "Trimming",
  "Decontamination",
  "Burping",
  "Packaging",
];

const ROLE_LEVELS: Record<string, number> = {
  VIEW_ONLY: 1,
  CULTIVATION: 2,
  EXTRACTION: 2,
  PACKAGING: 2,
  MANAGER: 3,
  ADMIN: 4,
  OWNER: 5,
};

function hasManagerDeleteAccess() {
  const user: any = getAuthUser();
  const role = String(user?.role || "").toUpperCase();
  return role === "OWNER" || role === "ADMIN" || role === "MANAGER";
}

function hasCultivationWriteAccess() {
  const user: any = getAuthUser();
  const role = String(user?.role || "").toUpperCase();

  return ["CULTIVATION", "MANAGER", "ADMIN", "OWNER"].includes(role);
}

function makeDateCode(date: string) {
  const value = date || new Date().toISOString().slice(0, 10);
  const parts = value.split("-");

  if (parts.length === 3) {
    const yyyy = parts[0] || "";
    const mm = parts[1] || "";
    const dd = parts[2] || "";
    return `${mm}${dd}${yyyy.slice(-2)}`;
  }

  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) {
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const yy = String(d.getFullYear()).slice(-2);
    return `${mm}${dd}${yy}`;
  }

  return value.replaceAll("-", "").slice(-6);
}

function makeBatchId(acronym: string, date: string, existingBatches: any[] = []) {
  const cleanAcronym = acronym.trim().toUpperCase() || "BATCH";
  const dateCode = makeDateCode(date);

  const sameStrainSameDay = existingBatches.filter((batch: any) => {
    const id = String(batch?.id || "");
    return (
      id === `${cleanAcronym}.${dateCode}` ||
      id.startsWith(`${cleanAcronym}.`) && id.endsWith(`.${dateCode}`)
    );
  });

  if (sameStrainSameDay.length === 0) {
    return `${cleanAcronym}.${dateCode}`;
  }

  return `${cleanAcronym}.${sameStrainSameDay.length + 1}.${dateCode}`;
}

function getDryBatchColor(batch: any, selectedId?: string) {
  if (selectedId === batch.id) return "#22c55e";
  if (batch.status === "Complete") return "#064e3b";
  if (batch.testStatus === "Test Failed") return "#7f1d1d";
  if (batch.testStatus === "Test Passed") return "#14532d";
  if (batch.testStatus === "Submitted to Testing") return "#78350f";
  return "#1e293b";
}

function num(value: any) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function getConfigStrainName(item: ConfigStrain) {
  return String(item?.name || item?.strain || "").trim();
}

function getConfigStrainAcronym(item: ConfigStrain) {
  return String(item?.acronym || "").trim().toUpperCase();
}

function getCloneStrainByName(strainName: string, strainList: ConfigStrain[]) {
  return (strainList || []).find((item) => getConfigStrainName(item) === strainName) || null;
}

function formatFlowerTables(batchOrTables: any) {
  const tables = Array.isArray(batchOrTables)
    ? batchOrTables
    : Array.isArray(batchOrTables?.flowerTables)
    ? batchOrTables.flowerTables
    : batchOrTables?.flowerTable
    ? [batchOrTables.flowerTable]
    : [];

  return tables.length > 0 ? tables.join(", ") : "—";
}

function getDryFlowerFinalWeights(batch: any) {
  const aGradeBeforeDecon = num(batch?.trimmedWeightLbs);
  const popcornBeforeDecon = num(batch?.popcornWeightLbs);
  const beforeDeconTotal = aGradeBeforeDecon + popcornBeforeDecon;
  const usableTotal =
    num(batch?.deconWeightLbs) ||
    beforeDeconTotal ||
    num(batch?.buckedWeightLbs);

  let usableAGrade = aGradeBeforeDecon;
  let usablePopcorn = popcornBeforeDecon;

  if (num(batch?.deconWeightLbs) > 0 && beforeDeconTotal > 0) {
    usableAGrade = usableTotal * (aGradeBeforeDecon / beforeDeconTotal);
    usablePopcorn = usableTotal * (popcornBeforeDecon / beforeDeconTotal);
  }

  const packagedAGrade =
    batch?.packagedAGradeLbs !== undefined && batch?.packagedAGradeLbs !== ""
      ? num(batch?.packagedAGradeLbs)
      : num(batch?.finalAGradeFlowerLbs);
  const packagedPopcorn =
    batch?.packagedPopcornLbs !== undefined && batch?.packagedPopcornLbs !== ""
      ? num(batch?.packagedPopcornLbs)
      : num(batch?.finalPopcornLbs);
  const packagedTotal = packagedAGrade + packagedPopcorn || num(batch?.packagedWeightLbs);

  return {
    usableAGradeLbs: +usableAGrade.toFixed(2),
    usablePopcornLbs: +usablePopcorn.toFixed(2),
    usableTotalLbs: +usableTotal.toFixed(2),
    finalAGradeFlowerLbs: +packagedAGrade.toFixed(2),
    finalPopcornLbs: +packagedPopcorn.toFixed(2),
    totalFinalPackagedLbs: +packagedTotal.toFixed(2),
    totalFinalPackagedGrams: +(packagedTotal * 453.592).toFixed(2),
  };
}

function getDryFlowerPackagingAvailability(batch: any) {
  const weights = getDryFlowerFinalWeights(batch);

  const packagedAGrade =
    batch?.packagedAGradeLbs !== undefined && batch?.packagedAGradeLbs !== ""
      ? num(batch?.packagedAGradeLbs)
      : num(batch?.finalAGradeFlowerLbs);

  const packagedPopcorn =
    batch?.packagedPopcornLbs !== undefined && batch?.packagedPopcornLbs !== ""
      ? num(batch?.packagedPopcornLbs)
      : num(batch?.finalPopcornLbs);

  const remainingAGrade = Math.max(weights.usableAGradeLbs - packagedAGrade, 0);
  const remainingPopcorn = Math.max(weights.usablePopcornLbs - packagedPopcorn, 0);

  return {
    usableAGradeLbs: +weights.usableAGradeLbs.toFixed(2),
    usablePopcornLbs: +weights.usablePopcornLbs.toFixed(2),
    usableTotalLbs: +weights.usableTotalLbs.toFixed(2),
    packagedAGradeLbs: +packagedAGrade.toFixed(2),
    packagedPopcornLbs: +packagedPopcorn.toFixed(2),
    remainingAGradeLbs: +remainingAGrade.toFixed(2),
    remainingPopcornLbs: +remainingPopcorn.toFixed(2),
    remainingTotalLbs: +(remainingAGrade + remainingPopcorn).toFixed(2),
  };
}


function isBlank(value: any) {
  return value === undefined || value === null || String(value).trim() === "";
}

function isPositiveNumber(value: any) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function isZeroOrPositiveNumber(value: any) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0;
}

function requireFields(fields: { label: string; value: any; positive?: boolean; zeroOrPositive?: boolean }[]) {
  const missing = fields.filter((field) => {
    if (field.positive) return !isPositiveNumber(field.value);
    if (field.zeroOrPositive) return !isZeroOrPositiveNumber(field.value);
    return isBlank(field.value);
  });

  if (missing.length > 0) {
    console.warn(`Please fill out the required field(s): ${missing.map((field) => field.label).join(", ")}.`);
    return false;
  }

  return true;
}

export default function Cultivation() {
  const s: any = store;

  const [refresh, setRefresh] = useState(0);
  const [canDeleteRecords, setCanDeleteRecords] = useState(false);
  const [canWriteRecords, setCanWriteRecords] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState<any>(
    s.cultivationBatches[0] || null
  );
  const [viewBatch, setViewBatch] = useState<any>(null);

  const [showCreateBatch, setShowCreateBatch] = useState(false);
  const [showTaskWindow, setShowTaskWindow] = useState(false);
  const [showDryTaskWindow, setShowDryTaskWindow] = useState(false);
  const [showAddTaskWindow, setShowAddTaskWindow] = useState(false);

  const [cloneTasks, setCloneTasks] = useState(defaultCloneTasks);
  const [vegTasks, setVegTasks] = useState(defaultVegTasks);
  const [flowerTasks, setFlowerTasks] = useState(defaultFlowerTasks);

  const [newCloneTask, setNewCloneTask] = useState("");
  const [newVegTask, setNewVegTask] = useState("");
  const [newFlowerTask, setNewFlowerTask] = useState("");

  const [configStrains, setConfigStrains] = useState<ConfigStrain[]>([]);
  const [strain, setStrain] = useState("");
  const [acronym, setAcronym] = useState("");
  const [cloneDate, setCloneDate] = useState("");
  const [cloneCount, setCloneCount] = useState("");
  const [clonePeople, setClonePeople] = useState("");
  const [cloneMinutes, setCloneMinutes] = useState("");

  const [selectedTask, setSelectedTask] = useState("Maintenance");
  const [people, setPeople] = useState("");
  const [minutes, setMinutes] = useState("");
  const [output, setOutput] = useState("");
  const [flowerRoom, setFlowerRoom] = useState("1");
  const [flowerBay, setFlowerBay] = useState("A");
  const [flowerTables, setFlowerTables] = useState<string[]>([]);

  const [harvestType, setHarvestType] = useState("A Grade Flower");
  const [harvestPlants, setHarvestPlants] = useState("");
  const [freshFrozenBundles, setFreshFrozenBundles] = useState("");
  const [freshFrozenGrams, setFreshFrozenGrams] = useState("");

  const [selectedDryFlowerBatch, setSelectedDryFlowerBatch] = useState<any>(null);
  const [selectedDryFlowerTask, setSelectedDryFlowerTask] = useState(
    dryFlowerTasks[0]
  );
  const [dryPeople, setDryPeople] = useState("");
  const [dryMinutes, setDryMinutes] = useState("");
  const [dryOutput, setDryOutput] = useState("");
  const [dryTrimWeight, setDryTrimWeight] = useState("");
  const [dryPopcornWeight, setDryPopcornWeight] = useState("");
  const [dryPackagingMode, setDryPackagingMode] = useState("Single package by weight");
  const [dryPackageCategory, setDryPackageCategory] = useState("A Grade Flower");
  const [dryPackageCount, setDryPackageCount] = useState("");

  const [failBatch, setFailBatch] = useState<any>(null);
  const [failureReason, setFailureReason] = useState("");

  const repeatTaskBypassRef = useRef<{ batchId: string; taskName: string } | null>(null);

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
    setCanDeleteRecords(hasManagerDeleteAccess());
    setCanWriteRecords(hasCultivationWriteAccess());

    let mounted = true;

    async function loadConfigStrains() {
      try {
        const token = typeof window !== "undefined" ? localStorage.getItem("token") || "" : "";

        const res = await fetch(`${API_BASE}/api/config`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (!res.ok) {
          throw new Error("Could not load company config strains");
        }

        const data = await res.json();
        const strains = Array.isArray(data?.cultivation?.strains)
          ? data.cultivation.strains
          : [];

        if (!mounted) return;

        setConfigStrains(
          strains.filter((item: ConfigStrain) => {
            return getConfigStrainName(item) && getConfigStrainAcronym(item);
          })
        );
      } catch (error) {
        console.error("Could not load config strain list:", error);

        if (mounted) {
          setConfigStrains([]);
        }
      }
    }

    async function loadSharedData() {
      try {
        await loadBackendStore();
        await loadConfigStrains();

        const realCultivationBatches = await loadCultivationBatches();

        if (!mounted) return;

        if (Array.isArray(realCultivationBatches)) {
          s.cultivationBatches = realCultivationBatches.filter(
            (batch: any) => batch.status !== "Complete"
          );

          s.completedCultivationBatches = realCultivationBatches.filter(
            (batch: any) => batch.status === "Complete"
          );
        }

        setSelectedBatch((current: any) => {
          if (current?.id) {
            const stillExists =
              s.cultivationBatches.find((b: any) => b.id === current.id) ||
              s.completedCultivationBatches.find((b: any) => b.id === current.id);

            if (stillExists) return stillExists;
          }

          return s.cultivationBatches[0] || null;
        });

        setSelectedDryFlowerBatch((current: any) => {
          if (current?.id) {
            const stillExists = (s.dryFlowerBatches || []).find(
              (b: any) => b.id === current.id
            );

            if (stillExists) return stillExists;
          }

          return s.dryFlowerBatches?.[0] || null;
        });

        setRefresh((n) => n + 1);
      } catch (error) {
        console.error("Could not load cultivation data:", error);
      }
    }

    loadSharedData();

    const interval = setInterval(() => {
      loadSharedData();
    }, 5000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  if (!s.completedCultivationBatches) s.completedCultivationBatches = [];
  if (!s.dryFlowerBatches) s.dryFlowerBatches = [];
  if (!s.productionBatches) s.productionBatches = [];
  if (!s.logs) s.logs = [];
  if (!s.sourceBatches) s.sourceBatches = [];
  if (!s.packagingBatches) s.packagingBatches = [];

  function showReadOnlyNotice() {
    showNotice(
      "Read Only Access",
      "Your account can view cultivation data, but it cannot create, edit, or save records."
    );
  }

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

  function confirmNotificationModal() {
    const action = notificationModal.onConfirm;
    closeNotificationModal();

    if (action) {
      action();
    }
  }

  function requireFieldsStyled(
    fields: { label: string; value: any; positive?: boolean; zeroOrPositive?: boolean }[]
  ) {
    const missing = fields.filter((field) => {
      if (field.positive) return !isPositiveNumber(field.value);
      if (field.zeroOrPositive) return !isZeroOrPositiveNumber(field.value);
      return isBlank(field.value);
    });

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


  function getLoggedBy() {
    const user: any = getAuthUser();

    return {
      userId: user?.id || user?.userId || "",
      username: user?.username || "Unknown User",
      role: user?.role || "",
    };
  }

  function formatLoggedBy(loggedBy: any) {
    if (!loggedBy) return "Unknown User";

    const username = loggedBy.username || "Unknown User";
    const role = loggedBy.role ? ` (${loggedBy.role})` : "";

    return `${username}${role}`;
  }

  function withLoggedBy(log: any) {
    const loggedBy = getLoggedBy();
    const loggedAt = new Date().toLocaleString();
    const loggedAtIso = new Date().toISOString();

    const finalLog = {
      ...log,
      loggedBy,
      loggedAt,
      loggedAtIso,
      time: log.time || loggedAt,
      data: {
        ...(log.data || {}),
        people: log.people,
        minutes: log.minutes,
        room: log.room,
        bay: log.bay,
        tables: log.tables,
        source: log.source,
        linkedBatch: log.linkedBatch,
        loggedBy,
        loggedAt,
        loggedAtIso,
      },
    };

    createLog({
      area: finalLog.area,
      batch: finalLog.batch,
      task: finalLog.task,
      output: finalLog.output,
      data: finalLog.data,
    }).catch((err) => {
      console.error("Failed to save log to backend:", err);
    });

    return finalLog;
  }

  function getAllBatchLists() {
    return [
      ...(s.cultivationBatches || []),
      ...(s.completedCultivationBatches || []),
      ...(s.dryFlowerBatches || []),
      ...(s.productionBatches || []),
      ...(s.sourceBatches || []),
      ...(s.packagingBatches || []),
    ];
  }

  function persistStore() {
    if (typeof window === "undefined") return;

    try {
      if (typeof s.save === "function") {
        s.save();
      }

      if (typeof s.persist === "function") {
        s.persist();
      }

      const snapshot = {
        cultivationBatches: s.cultivationBatches || [],
        completedCultivationBatches: s.completedCultivationBatches || [],
        dryFlowerBatches: s.dryFlowerBatches || [],
        productionBatches: s.productionBatches || [],
        sourceBatches: s.sourceBatches || [],
        packagingBatches: s.packagingBatches || [],
        logs: s.logs || [],
      };

      window.localStorage.setItem("cpuAppStore", JSON.stringify(snapshot));
      window.localStorage.setItem("cultivationStore", JSON.stringify(snapshot));
    } catch (error) {
      console.error("Could not save CPU app store:", error);
    }
  }

  const activeBatches = s.cultivationBatches.filter(
    (batch: any) => batch.status !== "Complete"
  );

  const activeDryFlowerBatches = s.dryFlowerBatches.filter(
    (batch: any) => batch.status !== "Complete"
  );

  function getTasksForStage(stage: string) {
    if (stage === "Clone") return cloneTasks;
    if (stage === "Veg") return vegTasks;
    if (stage === "Flower") return flowerTasks;
    if (stage === "Partially Harvested") return flowerTasks;
    return [];
  }

  const currentTasks = getTasksForStage(selectedBatch?.stage || "Clone");

  function forceRefresh() {
    persistStore();

    saveBackendStore().catch((error) => {
      console.error("Could not save backend store:", error);
    });

    setRefresh((n) => n + 1);
  }

  function saveRealCultivationBatch(batch: any) {
    if (!batch?.id || !canWriteRecords) return;

    updateCultivationBatch(batch.id, batch).catch((error) => {
      console.error("Could not update real cultivation table:", error);
    });
  }

  function createRealCultivationBatch(batch: any) {
    if (!batch?.id || !canWriteRecords) return;

    createCultivationBatch(batch).catch((error) => {
      console.error("Could not create real cultivation batch:", error);
    });
  }

  function deleteRealCultivationBatchIfNeeded(batchId: string, wasCultivationBatch: boolean) {
    if (!batchId || !wasCultivationBatch) return;

    deleteCultivationBatch(batchId).catch((error) => {
      console.error("Could not delete real cultivation batch:", error);
    });
  }

  function upsertDryFlowerPackagingBatch(batch: any) {
    const weights = getDryFlowerFinalWeights(batch);
    const availability = getDryFlowerPackagingAvailability(batch);
    const existing = s.packagingBatches.find((p: any) => p.id === batch.id);
    const packagingData = {
      id: batch.id,
      name: batch.name,
      type: batch.type || "Dry Flower",
      productType: batch.type || "Dry Flower",
      source: batch.source,
      sourceBatchId: batch.id,
      cultivationBatchId: batch.source,
      originalBatchId: batch.source,
      status: batch.status,
      availableWeightLbs: num(batch.trimmedWeightLbs) + num(batch.popcornWeightLbs),
      aGradeFlowerWeightLbs: num(batch.trimmedWeightLbs),
      popcornWeightLbs: num(batch.popcornWeightLbs),
      packagedAGradeLbs: num(batch.packagedAGradeLbs),
      packagedPopcornLbs: num(batch.packagedPopcornLbs),
      finalAGradeFlowerLbs: weights.finalAGradeFlowerLbs,
      finalPopcornLbs: weights.finalPopcornLbs,
      totalFinalPackagedLbs: weights.totalFinalPackagedLbs,
      packagedWeightLbs: weights.totalFinalPackagedLbs,
      packagedGrams: weights.totalFinalPackagedGrams,
      remainingAGradeLbs: availability.remainingAGradeLbs,
      remainingPopcornLbs: availability.remainingPopcornLbs,
      remainingPackableLbs: Math.max(
        num(batch.trimmedWeightLbs) +
          num(batch.popcornWeightLbs) -
          num(batch.packagedAGradeLbs) -
          num(batch.packagedPopcornLbs),
        0
      ),
      completedAt: batch.completedAt || "",
      updatedAt: new Date().toLocaleString(),
      packagingLogs: batch.packagingLogs || [],
    };

    if (existing) {
      Object.assign(existing, packagingData);
    } else {
      s.packagingBatches.unshift({
        ...packagingData,
        createdAt: new Date().toLocaleString(),
      });
    }
  }


  function hasTaskAlreadyBeenDone(batchId: string, taskName: string) {
    return s.logs.some((log: any) => {
      const logBatch = log.batch === batchId || log.source === batchId || log.linkedBatch === batchId;
      const logTask = String(log.task || "");

      if (!logBatch) return false;

      if (taskName === "Harvest") {
        return logTask === "Harvest" || logTask.startsWith("Harvest -");
      }

      return logTask === taskName;
    });
  }

  function confirmRepeatTask(
    batchId: string,
    taskName: string,
    onConfirm: () => void
  ) {
    const bypass = repeatTaskBypassRef.current;

    if (bypass?.batchId === batchId && bypass?.taskName === taskName) {
      repeatTaskBypassRef.current = null;
      return true;
    }

    if (!hasTaskAlreadyBeenDone(batchId, taskName)) return true;

    showConfirm(
      "Task Already Completed",
      `The task "${taskName}" has already been done for this batch.`,
      () => {
        repeatTaskBypassRef.current = { batchId, taskName };
        onConfirm();
      },
      "Confirm if you want to log this task again."
    );

    return false;
  }

  function selectBatch(batch: any) {
    setSelectedBatch(batch);

    const taskList = getTasksForStage(batch.stage || "Clone");
    if (taskList.length > 0) {
      setSelectedTask(taskList[0]);
    }
  }

  function addCustomTask(stage: "Clone" | "Veg" | "Flower") {
    if (!canWriteRecords) {
      showReadOnlyNotice();
      return;
    }

    const taskName = stage === "Clone" ? newCloneTask : stage === "Veg" ? newVegTask : newFlowerTask;

    if (!requireFieldsStyled([{ label: `${stage} Task Name`, value: taskName }])) {
      return;
    }

    if (stage === "Clone" && newCloneTask.trim()) {
      setCloneTasks([...cloneTasks, newCloneTask.trim()]);
      setNewCloneTask("");
    }

    if (stage === "Veg" && newVegTask.trim()) {
      setVegTasks([...vegTasks, newVegTask.trim()]);
      setNewVegTask("");
    }

    if (stage === "Flower" && newFlowerTask.trim()) {
      setFlowerTasks([...flowerTasks, newFlowerTask.trim()]);
      setNewFlowerTask("");
    }

    setShowAddTaskWindow(false);
  }

  function createCloneBatch() {
    if (!canWriteRecords) {
      showReadOnlyNotice();
      return;
    }

    const selectedCloneStrain = getCloneStrainByName(strain, configStrains);
    const finalAcronym = (getConfigStrainAcronym(selectedCloneStrain || {}) || acronym).trim().toUpperCase();
    const finalStrain = getConfigStrainName(selectedCloneStrain || {}) || strain;

    if (
      !requireFieldsStyled([
        { label: "Strain", value: finalStrain },
        { label: "Strain Acronym", value: finalAcronym },
        { label: "Clone Date", value: cloneDate },
        { label: "Clone Count", value: cloneCount, positive: true },
        { label: "People", value: clonePeople },
        { label: "Minutes", value: cloneMinutes, positive: true },
      ])
    ) {
      return;
    }

    const id = makeBatchId(finalAcronym, cloneDate, getAllBatchLists());

    const newBatch = {
      id,
      strain: finalStrain,
      acronym: finalAcronym,
      cloneDate,
      cloneCount: Number(cloneCount || 0),
      stage: "Clone",
      plants: Number(cloneCount || 0),
      originalPlants: Number(cloneCount || 0),
      status: "Active",
    };

    s.cultivationBatches.unshift(newBatch);
    setSelectedBatch(newBatch);
    setSelectedTask("Maintenance");

    s.logs.unshift(withLoggedBy({
      area: "Cultivation",
      batch: id,
      task: "Cloning",
      people: clonePeople,
      minutes: cloneMinutes,
      output: `${cloneCount} clones taken`,
      time: new Date().toLocaleString(),
    }))

    setStrain("");
    setAcronym("");
    setCloneDate("");
    setCloneCount("");
    setClonePeople("");
    setCloneMinutes("");
    setShowCreateBatch(false);
    createRealCultivationBatch(newBatch);
    forceRefresh();
  }

  function runDeleteBatch(batchId: string) {
    const deletedRecords = getAllBatchLists().filter((b: any) => b?.id === batchId);
    const deletedLogCount = s.logs.filter(
      (log: any) =>
        log.batch === batchId ||
        log.source === batchId ||
        log.linkedBatch === batchId
    ).length;

    const wasCultivationBatch =
      s.cultivationBatches.some((b: any) => b.id === batchId) ||
      s.completedCultivationBatches.some((b: any) => b.id === batchId);

    s.cultivationBatches = s.cultivationBatches.filter(
      (b: any) => b.id !== batchId
    );
    s.completedCultivationBatches = s.completedCultivationBatches.filter(
      (b: any) => b.id !== batchId
    );
    s.dryFlowerBatches = s.dryFlowerBatches.filter(
      (b: any) => b.id !== batchId
    );
    s.productionBatches = s.productionBatches.filter(
      (b: any) => b.id !== batchId
    );
    s.sourceBatches = s.sourceBatches.filter((b: any) => b.id !== batchId);
    s.packagingBatches = s.packagingBatches.filter(
      (b: any) => b.id !== batchId
    );

    s.logs = s.logs.filter((log: any) => {
      return (
        log.batch !== batchId &&
        log.source !== batchId &&
        log.linkedBatch !== batchId
      );
    });

    s.logs.unshift(withLoggedBy({
      area: "Audit",
      batch: batchId,
      task: "Deleted Record",
      output: `Deleted cultivation-related record(s): ${batchId} | Records removed: ${deletedRecords.length} | Related logs removed: ${deletedLogCount}`,
      data: {
        deletedRecordType: "Cultivation Batch Chain",
        deletedRecordId: batchId,
        deletedRecords,
        deletedLogCount,
        deletedAtIso: new Date().toISOString(),
      },
      time: new Date().toLocaleString(),
    }));

    if (selectedBatch?.id === batchId) {
      const nextBatch = s.cultivationBatches[0] || null;
      setSelectedBatch(nextBatch);

      if (nextBatch) {
        const taskList = getTasksForStage(nextBatch.stage || "Clone");
        setSelectedTask(taskList[0] || "");
      }
    }

    if (selectedDryFlowerBatch?.id === batchId) setSelectedDryFlowerBatch(null);
    if (viewBatch?.id === batchId) setViewBatch(null);
    if (failBatch?.id === batchId) setFailBatch(null);

    deleteRealCultivationBatchIfNeeded(batchId, wasCultivationBatch);
    forceRefresh();
  }

  function deleteBatch(batchId: string) {
    if (!canDeleteRecords) {
      showNotice("Access Denied", "Only Manager, Admin, or Owner users can delete records.");
      return;
    }

    showConfirm(
      "Delete Batch",
      `Delete batch "${batchId}"?`,
      () => runDeleteBatch(batchId),
      "This removes the batch and related task history from cultivation, dry flower, production, source, and packaging lists."
    );
  }

  function moveBatchToCompleted(batch: any) {
    batch.status = "Complete";
    batch.stage = "Complete";
    batch.completedAt = new Date().toLocaleString();

    const alreadyCompleted = s.completedCultivationBatches.some(
      (b: any) => b.id === batch.id
    );

    if (!alreadyCompleted) {
      s.completedCultivationBatches.unshift(batch);
    }

    s.logs.unshift(withLoggedBy({
      area: "Cultivation",
      batch: batch.id,
      task: "Batch Auto-Completed",
      people: "",
      minutes: "",
      output: "All plants harvested",
      time: new Date().toLocaleString(),
    }))

    const nextActive = s.cultivationBatches.find(
      (b: any) => b.status !== "Complete"
    );

    if (nextActive) {
      selectBatch(nextActive);
    }
  }

  async function saveHarvest() {
    if (!canWriteRecords) {
      showReadOnlyNotice();
      return;
    }

    if (!selectedBatch) return;

    const requiredHarvestFields: { label: string; value: any; positive?: boolean; zeroOrPositive?: boolean }[] = [
      { label: "Harvest Type", value: harvestType },
      { label: "Plants Harvested", value: harvestPlants, positive: true },
      { label: "People", value: people },
      { label: "Minutes", value: minutes, positive: true },
    ];

    if (harvestType === "Fresh Frozen") {
      requiredHarvestFields.push(
        { label: "Bundles", value: freshFrozenBundles, positive: true },
        { label: "Grams", value: freshFrozenGrams, positive: true }
      );
    }

    if (!requireFieldsStyled(requiredHarvestFields)) {
      return;
    }

    const plantsHarvested = Number(harvestPlants || 0);
    const currentPlants = Number(selectedBatch.plants || 0);
    const remainingPlants = Math.max(currentPlants - plantsHarvested, 0);

    selectedBatch.plants = remainingPlants;
    selectedBatch.stage =
      remainingPlants > 0 ? "Partially Harvested" : "Harvested";

    if (harvestType === "A Grade Flower") {
      const dryBatch = {
        id: `DRY-${selectedBatch.id}-${Date.now().toString().slice(-4)}`,
        name: `${selectedBatch.strain} A Grade Flower`,
        type: "A Grade Flower",
        source: selectedBatch.id,
        status: "Drying / Curing",
        testStatus: "Not Submitted",
        plantsHarvested,
        buckedWeightLbs: "",
        trimmedWeightLbs: "",
        totalTrimLbs: "",
        popcornWeightLbs: "",
        deconWeightLbs: "",
        packagedWeightLbs: 0,
        packagedAGradeLbs: 0,
        packagedPopcornLbs: 0,
        remainingPackableLbs: "",
        createdAt: new Date().toLocaleString(),
      };

      s.dryFlowerBatches.unshift(dryBatch);
      s.productionBatches.unshift(dryBatch);
      setSelectedDryFlowerBatch(dryBatch);

      s.logs.unshift(withLoggedBy({
        area: "Cultivation",
        batch: selectedBatch.id,
        task: "Harvest - A Grade Flower",
        people,
        minutes,
        output: `${plantsHarvested} plants harvested for A Grade Flower. No weight recorded until bucking.`,
        linkedBatch: dryBatch.id,
        time: new Date().toLocaleString(),
      }))
    }

    if (harvestType === "Fresh Frozen") {
      const freshFrozenBatch = {
        id: `FF-${selectedBatch.id}-${Date.now().toString().slice(-4)}`,
        name: `${selectedBatch.strain} Fresh Frozen`,
        type: "Fresh Frozen",
        amount: `${freshFrozenBundles || 0} bundles / ${
          freshFrozenGrams || 0
        } grams`,
        bundles: Number(freshFrozenBundles || 0),
        grams: Number(freshFrozenGrams || 0),
        plantsHarvested,
        source: selectedBatch.id,
        status: "Available for Extraction",
        createdAt: new Date().toLocaleString(),
      };

      s.sourceBatches.unshift(freshFrozenBatch);
      s.productionBatches.unshift(freshFrozenBatch);

      try {
        await createSourceBatch(freshFrozenBatch);
      } catch (error) {
        console.error("Could not save Fresh Frozen source batch to real table:", error);
        showNotice(
          "Backend Save Warning",
          "Fresh Frozen was added locally, but it did not save to the real SourceBatch table.",
          "Check the backend terminal for errors."
        );
      }

      s.logs.unshift(withLoggedBy({
        area: "Cultivation",
        batch: selectedBatch.id,
        task: "Harvest - Fresh Frozen",
        people,
        minutes,
        output: `${plantsHarvested} plants harvested for Fresh Frozen | ${
          freshFrozenBundles || 0
        } bundles / ${freshFrozenGrams || 0} grams`,
        linkedBatch: freshFrozenBatch.id,
        time: new Date().toLocaleString(),
      }))
    }

    if (remainingPlants <= 0) {
      moveBatchToCompleted(selectedBatch);
    }

    setPeople("");
    setMinutes("");
    setOutput("");
    setHarvestPlants("");
    setFreshFrozenBundles("");
    setFreshFrozenGrams("");
    setShowTaskWindow(false);
    saveRealCultivationBatch(selectedBatch);
    forceRefresh();
  }

  function setDryFlowerTestStatus(batch: any, status: string) {
    if (!canWriteRecords) {
      showReadOnlyNotice();
      return;
    }

    batch.testStatus = status;

    if (status === "Submitted to Testing") {
      batch.status = "Submitted to Testing";

      s.logs.unshift(withLoggedBy({
        area: "Cultivation",
        batch: batch.id,
        task: "Submitted to Testing",
        people: "",
        minutes: "",
        output: "Dry flower batch submitted to testing",
        source: batch.source,
        time: new Date().toLocaleString(),
      }))
    }

    if (status === "Test Passed") {
      batch.status = "Passed / Ready for Packaging";
      batch.testFailureReason = "";

      const alreadyInPackaging = s.packagingBatches.some(
        (b: any) => b.id === batch.id
      );

      if (!alreadyInPackaging) {
        const weights = getDryFlowerFinalWeights(batch);

        s.packagingBatches.unshift({
          id: batch.id,
          name: batch.name,
          type: batch.type || "Dry Flower",
          productType: batch.type || "Dry Flower",
          source: batch.source,
          sourceBatchId: batch.id,
          cultivationBatchId: batch.source,
          originalBatchId: batch.source,
          status: "Passed",
          availableWeightLbs: num(batch.trimmedWeightLbs) + num(batch.popcornWeightLbs),
          aGradeFlowerWeightLbs: num(batch.trimmedWeightLbs),
          popcornWeightLbs: num(batch.popcornWeightLbs),
          packagedAGradeLbs: 0,
          packagedPopcornLbs: 0,
          finalAGradeFlowerLbs: 0,
          finalPopcornLbs: 0,
          totalFinalPackagedLbs: 0,
          packagedWeightLbs: 0,
          packagedGrams: 0,
          remainingAGradeLbs: weights.usableAGradeLbs,
          remainingPopcornLbs: weights.usablePopcornLbs,
          remainingPackableLbs: weights.usableTotalLbs,
          packagingLogs: [],
          createdAt: new Date().toLocaleString(),
        });
      }

      s.logs.unshift(withLoggedBy({
        area: "Cultivation",
        batch: batch.id,
        task: "Test Passed",
        people: "",
        minutes: "",
        output: "Dry flower batch passed testing and is ready for packaging",
        source: batch.source,
        time: new Date().toLocaleString(),
      }))
    }

    forceRefresh();
  }

  function saveFailedTest() {
    if (!canWriteRecords) {
      showReadOnlyNotice();
      return;
    }

    if (!failBatch) return;

    if (!requireFieldsStyled([{ label: "Failure Reason", value: failureReason }])) {
      return;
    }

    failBatch.testStatus = "Test Failed";
    failBatch.status = "Test Failed";
    failBatch.testFailureReason = failureReason;

    s.logs.unshift(withLoggedBy({
      area: "Cultivation",
      batch: failBatch.id,
      task: "Test Failed",
      people: "",
      minutes: "",
      output: failureReason || "No failure reason entered",
      source: failBatch.source,
      time: new Date().toLocaleString(),
    }))

    setFailBatch(null);
    setFailureReason("");
    forceRefresh();
  }

  async function saveDryFlowerTask() {
    if (!canWriteRecords) {
      showReadOnlyNotice();
      return;
    }

    if (!selectedDryFlowerBatch) return;

    const dryRequiredFields: { label: string; value: any; positive?: boolean; zeroOrPositive?: boolean }[] = [
      { label: "People", value: dryPeople },
      { label: "Minutes", value: dryMinutes, positive: true },
    ];

    if (selectedDryFlowerTask === "Bucking") {
      dryRequiredFields.push({ label: "Bucked Weight", value: dryOutput, positive: true });
    }

    if (selectedDryFlowerTask === "Trimming") {
      dryRequiredFields.push(
        { label: "Total A Grade Flower", value: dryOutput, zeroOrPositive: true },
        { label: "Total Popcorn", value: dryPopcornWeight, zeroOrPositive: true },
        { label: "Total Trim", value: dryTrimWeight, zeroOrPositive: true }
      );
    }

    if (selectedDryFlowerTask === "Decontamination") {
      dryRequiredFields.push({ label: "Decon Output Weight", value: dryOutput, positive: true });
    }

    if (selectedDryFlowerTask === "Packaging") {
      dryRequiredFields.push(
        { label: "Package Category", value: dryPackageCategory },
        { label: "Packaging Mode", value: dryPackagingMode },
        dryPackagingMode === "Multiple 1 lb packages"
          ? { label: "Package Count", value: dryPackageCount, positive: true }
          : { label: "Package Weight", value: dryOutput, positive: true }
      );
    }

    if (!requireFieldsStyled(dryRequiredFields)) {
      return;
    }

    const shouldConfirmRepeatTask = selectedDryFlowerTask !== "Packaging";

    if (
      shouldConfirmRepeatTask &&
      !confirmRepeatTask(selectedDryFlowerBatch.id, selectedDryFlowerTask, saveDryFlowerTask)
    ) {
      return;
    }

    const enteredWeight =
      selectedDryFlowerTask === "Packaging" &&
      dryPackagingMode === "Multiple 1 lb packages"
        ? num(dryPackageCount)
        : num(dryOutput);

    if (selectedDryFlowerTask === "Bucking") {
      selectedDryFlowerBatch.buckedWeightLbs = enteredWeight;
      selectedDryFlowerBatch.status = "Bucked";

      s.logs.unshift(withLoggedBy({
        area: "Cultivation",
        batch: selectedDryFlowerBatch.id,
        task: "Bucking",
        people: dryPeople,
        minutes: dryMinutes,
        output: `Bucked weight: ${enteredWeight} lbs`,
        source: selectedDryFlowerBatch.source,
        time: new Date().toLocaleString(),
      }))
    }

    if (selectedDryFlowerTask === "Trimming") {
      const aGradeFlowerWeight = enteredWeight;
      const popcornWeight = num(dryPopcornWeight);
      const totalTrimWeight = num(dryTrimWeight);
      const totalPackableFlower = aGradeFlowerWeight + popcornWeight;

      selectedDryFlowerBatch.trimmedWeightLbs = aGradeFlowerWeight;
      selectedDryFlowerBatch.popcornWeightLbs = popcornWeight;
      selectedDryFlowerBatch.totalTrimLbs = totalTrimWeight;
      selectedDryFlowerBatch.remainingPackableLbs = totalPackableFlower;
      selectedDryFlowerBatch.status = "Trimmed";

      s.logs.unshift(withLoggedBy({
        area: "Cultivation",
        batch: selectedDryFlowerBatch.id,
        task: "Trimming",
        people: dryPeople,
        minutes: dryMinutes,
        output: `Total A Grade Flower: ${aGradeFlowerWeight} lbs | Total Popcorn: ${popcornWeight} lbs | Total Trim: ${totalTrimWeight} lbs`,
        source: selectedDryFlowerBatch.source,
        time: new Date().toLocaleString(),
      }))

      if (totalTrimWeight > 0) {
        const trimBatch = {
          id: `TRIM-${selectedDryFlowerBatch.id}-${Date.now()
            .toString()
            .slice(-4)}`,
          name: `${selectedDryFlowerBatch.name} Trim`,
          type: "Dry Trim",
          amount: `${totalTrimWeight} lbs`,
          weightLbs: totalTrimWeight,
          source: selectedDryFlowerBatch.id,
          parentCultivationBatch: selectedDryFlowerBatch.source,
          status: "Available for Extraction",
          createdAt: new Date().toLocaleString(),
        };

        s.sourceBatches.unshift(trimBatch);
        s.productionBatches.unshift(trimBatch);

        try {
          await createSourceBatch(trimBatch);
        } catch (error) {
          console.error("Could not save Dry Trim source batch to real table:", error);
          showNotice(
            "Backend Save Warning",
            "Dry Trim was added locally, but it did not save to the real SourceBatch table.",
            "Check the backend terminal for errors."
          );
        }

        s.logs.unshift(withLoggedBy({
          area: "Cultivation",
          batch: selectedDryFlowerBatch.id,
          task: "Trim Available for Extraction",
          people: "",
          minutes: "",
          output: `${totalTrimWeight} lbs dry trim is available for extraction`,
          linkedBatch: trimBatch.id,
          source: selectedDryFlowerBatch.source,
          time: new Date().toLocaleString(),
        }))
      }
    }

    if (selectedDryFlowerTask === "Decontamination") {
      const previousWeight =
        num(selectedDryFlowerBatch.trimmedWeightLbs) +
          num(selectedDryFlowerBatch.popcornWeightLbs) ||
        num(selectedDryFlowerBatch.buckedWeightLbs);
      const loss = Math.max(previousWeight - enteredWeight, 0);

      selectedDryFlowerBatch.deconWeightLbs = enteredWeight;
      selectedDryFlowerBatch.remainingPackableLbs = enteredWeight;
      selectedDryFlowerBatch.status = "Decontaminated";

      s.logs.unshift(withLoggedBy({
        area: "Cultivation",
        batch: selectedDryFlowerBatch.id,
        task: "Decontamination",
        people: dryPeople,
        minutes: dryMinutes,
        output: `Decon output weight: ${enteredWeight} lbs | Loss from previous stage: ${loss} lbs`,
        source: selectedDryFlowerBatch.source,
        time: new Date().toLocaleString(),
      }))
    }

    if (selectedDryFlowerTask === "Burping") {
      selectedDryFlowerBatch.status = "Burping";

      s.logs.unshift(withLoggedBy({
        area: "Cultivation",
        batch: selectedDryFlowerBatch.id,
        task: "Burping",
        people: dryPeople,
        minutes: dryMinutes,
        output:
          dryOutput || "Burping jars / curing process ongoing",
        source: selectedDryFlowerBatch.source,
        time: new Date().toLocaleString(),
      }))
    }

    if (selectedDryFlowerTask === "Packaging") {
      if (selectedDryFlowerBatch.testStatus !== "Test Passed") {
        showNotice("Testing Required", "This batch must pass testing before packaging.");
        return;
      }

      const availability = getDryFlowerPackagingAvailability(selectedDryFlowerBatch);
      const selectedAvailable =
        dryPackageCategory === "A Grade Flower"
          ? availability.remainingAGradeLbs
          : availability.remainingPopcornLbs;

      if (availability.usableTotalLbs <= 0) {
        showNotice("Usable Weight Required", "This batch needs a usable flower weight before packaging.");
        return;
      }

      if (selectedAvailable <= 0) {
        showNotice("No Material Available", `No ${dryPackageCategory} is available to package.`);
        return;
      }

      const requestedPackageUnits =
        dryPackagingMode === "Multiple 1 lb packages"
          ? Math.max(0, Math.floor(num(dryPackageCount)))
          : 1;
      const requestedPackagedWeight =
        dryPackagingMode === "Multiple 1 lb packages"
          ? requestedPackageUnits * 1
          : enteredWeight;

      if (requestedPackagedWeight <= 0) {
        showNotice("Invalid Package Amount", "Enter a package weight or package count greater than 0.");
        return;
      }

      if (requestedPackagedWeight > selectedAvailable) {
        showNotice(
          "Not Enough Material Available",
          `You only have ${selectedAvailable.toFixed(2)} lbs of ${dryPackageCategory} available.`,
          `You tried to package ${requestedPackagedWeight.toFixed(2)} lbs.`
        );
        return;
      }

      const packagedThisRound = requestedPackagedWeight;
      const actualPackageUnits =
        dryPackagingMode === "Multiple 1 lb packages"
          ? requestedPackageUnits
          : packagedThisRound > 0
          ? 1
          : 0;

      const newPackagedAGrade =
        dryPackageCategory === "A Grade Flower"
          ? availability.packagedAGradeLbs + packagedThisRound
          : availability.packagedAGradeLbs;
      const newPackagedPopcorn =
        dryPackageCategory === "Popcorn"
          ? availability.packagedPopcornLbs + packagedThisRound
          : availability.packagedPopcornLbs;

      const newTotalPackaged = newPackagedAGrade + newPackagedPopcorn;
      const remainingAGrade = Math.max(availability.usableAGradeLbs - newPackagedAGrade, 0);
      const remainingPopcorn = Math.max(availability.usablePopcornLbs - newPackagedPopcorn, 0);
      const remainingTotal = remainingAGrade + remainingPopcorn;
      const completionTolerance = 0.0001;
      const isComplete = remainingTotal <= completionTolerance;

      selectedDryFlowerBatch.packagedAGradeLbs = +newPackagedAGrade.toFixed(2);
      selectedDryFlowerBatch.packagedPopcornLbs = +newPackagedPopcorn.toFixed(2);
      selectedDryFlowerBatch.finalAGradeFlowerLbs = +newPackagedAGrade.toFixed(2);
      selectedDryFlowerBatch.finalPopcornLbs = +newPackagedPopcorn.toFixed(2);
      selectedDryFlowerBatch.packagedWeightLbs = +newTotalPackaged.toFixed(2);
      selectedDryFlowerBatch.totalFinalPackagedLbs = +newTotalPackaged.toFixed(2);
      selectedDryFlowerBatch.packagedGrams = +(newTotalPackaged * 453.592).toFixed(2);
      selectedDryFlowerBatch.remainingAGradeLbs = isComplete ? 0 : +remainingAGrade.toFixed(2);
      selectedDryFlowerBatch.remainingPopcornLbs = isComplete ? 0 : +remainingPopcorn.toFixed(2);
      selectedDryFlowerBatch.remainingPackableLbs = isComplete ? 0 : +remainingTotal.toFixed(2);
      selectedDryFlowerBatch.status = isComplete ? "Complete" : "Partially Packaged";

      if (!selectedDryFlowerBatch.packagingLogs) selectedDryFlowerBatch.packagingLogs = [];

      selectedDryFlowerBatch.packagingLogs.unshift({
        time: new Date().toLocaleString(),
        flowerType: dryPackageCategory,
        packageType: selectedDryFlowerBatch.type || "Dry Flower",
        packageMode: dryPackagingMode,
        packageUnits: actualPackageUnits,
        unitSizeGrams:
          dryPackagingMode === "Multiple 1 lb packages" ? 454 : "Variable",
        packagedLbs: packagedThisRound,
        totalPackagedLbs: selectedDryFlowerBatch.packagedWeightLbs,
        packagedAGradeLbs: selectedDryFlowerBatch.packagedAGradeLbs,
        packagedPopcornLbs: selectedDryFlowerBatch.packagedPopcornLbs,
        remainingAGradeLbs: selectedDryFlowerBatch.remainingAGradeLbs,
        remainingPopcornLbs: selectedDryFlowerBatch.remainingPopcornLbs,
        packagedGrams: selectedDryFlowerBatch.packagedGrams,
        packagedBy: dryPeople,
        notes: dryOutput,
      });

      if (isComplete) {
        selectedDryFlowerBatch.completedAt = new Date().toLocaleString();
      }

      upsertDryFlowerPackagingBatch(selectedDryFlowerBatch);

      s.logs.unshift(withLoggedBy({
        area: "Cultivation",
        batch: selectedDryFlowerBatch.id,
        task: "Packaging",
        people: dryPeople,
        minutes: dryMinutes,
        output: `Flower type: ${dryPackageCategory} | Mode: ${dryPackagingMode} | Units: ${actualPackageUnits} | Packaged: ${packagedThisRound} lbs | Total packaged: ${selectedDryFlowerBatch.packagedWeightLbs} lbs | A Grade remaining: ${selectedDryFlowerBatch.remainingAGradeLbs} lbs | Popcorn remaining: ${selectedDryFlowerBatch.remainingPopcornLbs} lbs`,
        source: selectedDryFlowerBatch.source,
        time: new Date().toLocaleString(),
      }))

      if (isComplete) {
        setSelectedDryFlowerBatch(null);
      }
    }


    setDryPeople("");
    setDryMinutes("");
    setDryOutput("");
    setDryTrimWeight("");
    setDryPopcornWeight("");
    setDryPackagingMode("Single package by weight");
    setDryPackageCategory("A Grade Flower");
    setDryPackageCount("");
    setShowDryTaskWindow(false);
    forceRefresh();
  }

  function toggleFlowerTable(table: string) {
    setFlowerTables((current) =>
      current.includes(table)
        ? current.filter((item) => item !== table)
        : [...current, table].sort((a, b) => Number(a) - Number(b))
    );
  }

  function save() {
    if (!canWriteRecords) {
      showReadOnlyNotice();
      return;
    }

    if (!selectedBatch) return;

    const taskRequiredFields: { label: string; value: any; positive?: boolean; zeroOrPositive?: boolean }[] = [
      { label: "People", value: people },
      { label: "Minutes", value: minutes, positive: true },
    ];

    if (selectedTask === "Clone → Veg") {
      taskRequiredFields.push({ label: "Plants Moved to Veg", value: output, positive: true });
    }

    if (selectedTask === "Move to Flower") {
      taskRequiredFields.push(
        { label: "Plants Moved to Flower", value: output, positive: true },
        { label: "Flower Room", value: flowerRoom },
        { label: "Flower Bay", value: flowerBay },
        { label: "Flower Table", value: flowerTables.length > 0 ? flowerTables.join(",") : "" }
      );
    }

    if (!requireFieldsStyled(taskRequiredFields)) {
      return;
    }

    if (!confirmRepeatTask(selectedBatch.id, selectedTask, save)) {
      return;
    }

    if (selectedTask === "Harvest") {
      saveHarvest();
      return;
    }

    let taskOutput = output;

    if (selectedTask === "Move to Flower") {
      taskOutput = `${output || selectedBatch.plants || 0} plants moved to Flower | Room: ${flowerRoom || "—"} | Bay: ${flowerBay || "—"} | Tables: ${formatFlowerTables(flowerTables)}`;
    }

    s.logs.unshift(withLoggedBy({
      area: "Cultivation",
      batch: selectedBatch.id,
      task: selectedTask,
      people,
      minutes,
      output: taskOutput,
      room: selectedTask === "Move to Flower" ? flowerRoom : undefined,
      bay: selectedTask === "Move to Flower" ? flowerBay : undefined,
      tables: selectedTask === "Move to Flower" ? [...flowerTables] : undefined,
      time: new Date().toLocaleString(),
    }))

    if (selectedTask === "Clone → Veg") {
      selectedBatch.stage = "Veg";
      selectedBatch.plants = Number(output || selectedBatch.plants || 0);
      setSelectedTask("Set Irrigation Up");
    }

    if (selectedTask === "Move to Flower") {
      selectedBatch.stage = "Flower";
      selectedBatch.plants = Number(output || selectedBatch.plants || 0);
      selectedBatch.flowerRoom = flowerRoom;
      selectedBatch.flowerBay = flowerBay;
      selectedBatch.flowerTables = [...flowerTables];
      setSelectedTask("Set Irrigation Up");
    }

    setPeople("");
    setMinutes("");
    setOutput("");
    setFlowerRoom("1");
    setFlowerBay("A");
    setFlowerTables([]);
    setShowTaskWindow(false);
    saveRealCultivationBatch(selectedBatch);
    forceRefresh();
  }

  const selectedBatchLogs = viewBatch
    ? s.logs.filter(
        (log: any) =>
          log.batch === viewBatch.id ||
          log.linkedBatch === viewBatch.id ||
          log.source === viewBatch.id
      )
    : [];


  const pageStyle = {
    minHeight: "100vh",
    background:
      "radial-gradient(circle at top, #1e293b 0, #020617 45%, #020617 100%)",
    color: "white",
    padding: 20,
  } as const;

  const shellStyle = {
    width: "100%",
    maxWidth: 1200,
    margin: "0 auto",
  } as const;

  const headerStyle = {
    textAlign: "center",
    margin: "24px 0",
  } as const;

  const gridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: 18,
    alignItems: "start",
  } as const;

  const cardStyle = {
    background: "rgba(15, 23, 42, 0.9)",
    border: "1px solid #334155",
    borderRadius: 18,
    padding: 18,
    boxShadow: "0 18px 40px rgba(0,0,0,0.25)",
  } as const;

  const sectionTitleStyle = {
    margin: "0 0 12px",
    textAlign: "center",
  } as const;

  const rowStyle = {
    padding: 10,
    background: "#0f172a",
    color: "white",
    marginBottom: 8,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    border: "1px solid #334155",
  } as const;

  const buttonStyle = {
    border: "1px solid #475569",
    background: "#1e293b",
    color: "white",
    borderRadius: 10,
    padding: "8px 12px",
    cursor: "pointer",
  } as const;

  const primaryButtonStyle = {
    ...buttonStyle,
    background: "#22c55e",
    color: "black",
    border: "1px solid #22c55e",
    fontWeight: 700,
  } as const;

  const dangerButtonStyle = {
    ...buttonStyle,
    background: "#7f1d1d",
    border: "1px solid #ef4444",
  } as const;

  const modalOverlayStyle = {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.75)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
    padding: 20,
  } as const;

  const modalStyle = {
    background: "#020617",
    color: "white",
    border: "1px solid #334155",
    borderRadius: 18,
    padding: 22,
    width: "100%",
    maxWidth: 560,
    maxHeight: "84vh",
    overflowY: "auto",
    boxShadow: "0 25px 80px rgba(0,0,0,0.55)",
  } as const;

  const formStyle = {
    display: "grid",
    gap: 10,
  } as const;

  const inputStyle = {
    width: "100%",
    borderRadius: 10,
    border: "1px solid #334155",
    background: "#0f172a",
    color: "white",
    padding: "10px 12px",
  } as const;

  const modalButtonRowStyle = {
    display: "flex",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 14,
  } as const;


  return (
    <PageAccessGate allowedRoles={["CULTIVATION", "VIEW_ONLY"]}>
      <div style={pageStyle}>
      <div style={shellStyle}>
        <Nav />

        <div style={headerStyle}>
          <h1 style={{ marginBottom: 6 }}>Cultivation</h1>
          <p style={{ color: "#cbd5e1", margin: 0 }}>
            Manage clone, veg, flower, dry flower, testing, packaging, and completed batch history.
          </p>
        </div>

        <div style={{ ...cardStyle, marginBottom: 18, textAlign: "center" }}>
          {canWriteRecords ? (
            <button style={primaryButtonStyle} onClick={() => setShowCreateBatch(true)}>
              + Create Clone Batch
            </button>
          ) : (
            <div style={{ color: "#94a3b8", fontWeight: 800 }}>
              Read Only Access: you can view cultivation data, but cannot create or edit records.
            </div>
          )}
        </div>

        <div style={gridStyle}>
          <section style={cardStyle}>
            <h3 style={sectionTitleStyle}>Active Cultivation Batches</h3>

            {activeBatches.length === 0 ? (
              <p style={{ textAlign: "center", color: "#cbd5e1" }}>No active cultivation batches.</p>
            ) : (
              activeBatches.map((b: any) => (
                <div
                  key={b.id}
                  style={{
                    ...rowStyle,
                    background: selectedBatch?.id === b.id ? "#22c55e" : "#0f172a",
                    color: selectedBatch?.id === b.id ? "black" : "white",
                    border: selectedBatch?.id === b.id ? "1px solid #22c55e" : "1px solid #334155",
                  }}
                >
                  <div
                    onClick={() => selectBatch(b)}
                    style={{ cursor: "pointer", flex: 1, lineHeight: 1.5 }}
                  >
                    <b>{b.id}</b>
                    <br />
                    {b.strain} | Stage: {b.stage} | Plants Left: {b.plants}
                    {b.stage === "Flower" && (b.flowerRoom || b.flowerBay || b.flowerTable || b.flowerTables) && (
                      <>
                        <br />
                        Room: {b.flowerRoom || "—"} | Bay: {b.flowerBay || "—"} | Tables: {formatFlowerTables(b)}
                      </>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <button style={buttonStyle} onClick={() => setViewBatch(b)}>
                      View
                    </button>
                    {canDeleteRecords && (

                      <button style={dangerButtonStyle} onClick={() => deleteBatch(b.id)}>

                        Delete

                      </button>

                    )}
                  </div>
                </div>
              ))
            )}
          </section>

          <section style={cardStyle}>
            <h3 style={sectionTitleStyle}>
              {selectedBatch ? `${selectedBatch.stage} Stage Tasks` : "Stage Tasks"}
            </h3>

            {!selectedBatch || selectedBatch.status === "Complete" ? (
              <p style={{ textAlign: "center", color: "#cbd5e1" }}>Select an active batch.</p>
            ) : (
              <>
                <p style={{ textAlign: "center" }}>
                  Selected: <b>{selectedBatch.id}</b>
                </p>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                  {currentTasks.length === 0 ? (
                    <p>No tasks available for this stage.</p>
                  ) : (
                    currentTasks.map((t: string) => (
                      <button
                        key={t}
                        onClick={() => setSelectedTask(t)}
                        style={{
                          ...buttonStyle,
                          background: selectedTask === t ? "#22c55e" : "#334155",
                          color: selectedTask === t ? "black" : "white",
                          border: selectedTask === t ? "1px solid #22c55e" : "1px solid #475569",
                        }}
                      >
                        {t}
                      </button>
                    ))
                  )}
                </div>

                {canWriteRecords ? (
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "center",
                      gap: 10,
                      marginTop: 16,
                      flexWrap: "wrap",
                    }}
                  >
                    <button style={primaryButtonStyle} onClick={() => setShowTaskWindow(true)}>
                      Log Selected Task
                    </button>
                    <button style={buttonStyle} onClick={() => setShowAddTaskWindow(true)}>
                      + Add Task
                    </button>
                  </div>
                ) : (
                  <p style={{ color: "#94a3b8", textAlign: "center", marginTop: 16 }}>
                    Read Only Access: task logging is disabled for your account.
                  </p>
                )}
              </>
            )}
          </section>
        </div>

        <section style={{ ...cardStyle, marginTop: 18 }}>
          <h3 style={sectionTitleStyle}>Dry Flower / Burping Batches</h3>

          {activeDryFlowerBatches.length === 0 ? (
            <p style={{ textAlign: "center", color: "#cbd5e1" }}>No active dry flower batches yet.</p>
          ) : (
            activeDryFlowerBatches.map((b: any) => (
              <div
                key={b.id}
                style={{
                  ...rowStyle,
                  background: getDryBatchColor(b, selectedDryFlowerBatch?.id),
                  color: selectedDryFlowerBatch?.id === b.id ? "black" : "white",
                }}
              >
                <div
                  onClick={() => setSelectedDryFlowerBatch(b)}
                  style={{ flex: 1, cursor: "pointer", lineHeight: 1.5 }}
                >
                  <b>{b.id}</b> | {b.name}
                  <br />
                  Status: {b.status} | Test: {b.testStatus || "Not Submitted"} | Bucked:{" "}
                  {b.buckedWeightLbs || "—"} lbs | A Grade: {b.trimmedWeightLbs || "—"} lbs | Popcorn: {b.popcornWeightLbs || "—"} lbs | Trim:{" "}
                  {b.totalTrimLbs || "—"} lbs | Decon: {b.deconWeightLbs || "—"} lbs | Packaged:{" "}
                  {b.packagedWeightLbs || 0} lbs | Remaining:{" "}
                  {b.remainingPackableLbs === "" ? "—" : b.remainingPackableLbs} lbs | A Grade Available: {getDryFlowerPackagingAvailability(b).remainingAGradeLbs} lbs | Popcorn Available: {getDryFlowerPackagingAvailability(b).remainingPopcornLbs} lbs | Final A Grade: {b.finalAGradeFlowerLbs || "—"} lbs | Final Popcorn: {b.finalPopcornLbs || "—"} lbs
                </div>

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {canWriteRecords && (
                    <>
                      <button style={buttonStyle} onClick={() => setDryFlowerTestStatus(b, "Submitted to Testing")}>
                        Submitted
                      </button>
                      <button style={buttonStyle} onClick={() => setDryFlowerTestStatus(b, "Test Passed")}>
                        Passed
                      </button>
                      <button style={buttonStyle} onClick={() => setFailBatch(b)}>
                        Failed
                      </button>
                    </>
                  )}
                  <button style={buttonStyle} onClick={() => setViewBatch(b)}>
                    View
                  </button>
                  {canDeleteRecords && (

                    <button style={dangerButtonStyle} onClick={() => deleteBatch(b.id)}>

                      Delete

                    </button>

                  )}
                </div>
              </div>
            ))
          )}

          {selectedDryFlowerBatch && selectedDryFlowerBatch.status !== "Complete" && (
            <div style={{ marginTop: 16, textAlign: "center" }}>
              <p>
                Selected Dry Batch: <b>{selectedDryFlowerBatch.id}</b>
              </p>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                {dryFlowerTasks.map((task) => (
                  <button
                    key={task}
                    onClick={() => setSelectedDryFlowerTask(task)}
                    style={{
                      ...buttonStyle,
                      background: selectedDryFlowerTask === task ? "#22c55e" : "#334155",
                      color: selectedDryFlowerTask === task ? "black" : "white",
                      border: selectedDryFlowerTask === task ? "1px solid #22c55e" : "1px solid #475569",
                    }}
                  >
                    {task}
                  </button>
                ))}
              </div>

              {canWriteRecords ? (
                <button
                  style={{ ...primaryButtonStyle, marginTop: 14 }}
                  onClick={() => setShowDryTaskWindow(true)}
                >
                  Log Dry Flower Task
                </button>
              ) : (
                <p style={{ color: "#94a3b8", marginTop: 14 }}>
                  Read Only Access: dry flower task logging is disabled for your account.
                </p>
              )}
            </div>
          )}
        </section>

        <div style={{ ...gridStyle, marginTop: 18 }}>
          <section style={cardStyle}>
            <h3 style={sectionTitleStyle}>Production Batches / Completed Outputs</h3>

            {s.productionBatches.length === 0 ? (
              <p style={{ textAlign: "center", color: "#cbd5e1" }}>No production batches yet.</p>
            ) : (
              s.productionBatches.map((b: any) => (
                <div key={b.id} style={rowStyle}>
                  <div style={{ flex: 1, lineHeight: 1.5 }}>
                    <b>{b.id}</b>
                    <br />
                    {b.name || b.type} | Type: {b.type} | Source: {b.source} | Status: {b.status}
                  </div>

                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button style={buttonStyle} onClick={() => setViewBatch(b)}>
                      View
                    </button>
                    {canDeleteRecords && (

                      <button style={dangerButtonStyle} onClick={() => deleteBatch(b.id)}>

                        Delete

                      </button>

                    )}
                  </div>
                </div>
              ))
            )}
          </section>

          <section style={cardStyle}>
            <h3 style={sectionTitleStyle}>Completed Cultivation Batches</h3>

            {s.completedCultivationBatches.length === 0 ? (
              <p style={{ textAlign: "center", color: "#cbd5e1" }}>No completed cultivation batches yet.</p>
            ) : (
              s.completedCultivationBatches.map((b: any) => (
                <div key={b.id} style={rowStyle}>
                  <div style={{ flex: 1, lineHeight: 1.5 }}>
                    <b>{b.id}</b>
                    <br />
                    {b.strain} | Stage: {b.stage} | Plants Left: {b.plants} | Completed: {b.completedAt}
                    {(b.flowerRoom || b.flowerBay || b.flowerTable || b.flowerTables) && (
                      <>
                        <br />
                        Room: {b.flowerRoom || "—"} | Bay: {b.flowerBay || "—"} | Tables: {formatFlowerTables(b)}
                      </>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button style={buttonStyle} onClick={() => setViewBatch(b)}>
                      View
                    </button>
                    {canDeleteRecords && (

                      <button style={dangerButtonStyle} onClick={() => deleteBatch(b.id)}>

                        Delete

                      </button>

                    )}
                  </div>
                </div>
              ))
            )}
          </section>
        </div>
      </div>

      {showCreateBatch && (
        <div style={modalOverlayStyle}>
          <div style={modalStyle}>
            <h2 style={{ textAlign: "center", marginTop: 0 }}>Create Clone Batch</h2>

            <div style={formStyle}>
              <select
                style={inputStyle}
                value={strain}
                onChange={(e) => {
                  const selectedCloneStrain = getCloneStrainByName(e.target.value, configStrains);
                  setStrain(getConfigStrainName(selectedCloneStrain || {}));
                  setAcronym(getConfigStrainAcronym(selectedCloneStrain || {}));
                }}
              >
                <option value="">Select strain</option>
                {configStrains.map((item) => {
                  const strainName = getConfigStrainName(item);
                  const strainAcronym = getConfigStrainAcronym(item);

                  return (
                    <option key={item.id || strainAcronym || strainName} value={strainName}>
                      {strainName} ({strainAcronym})
                    </option>
                  );
                })}
              </select>
              <input style={inputStyle} placeholder="Strain Acronym" value={acronym} readOnly />
              <input style={inputStyle} type="date" value={cloneDate} onChange={(e) => setCloneDate(e.target.value)} />
              <input style={inputStyle} placeholder="How many clones were taken" value={cloneCount} onChange={(e) => setCloneCount(e.target.value)} />
              <input style={inputStyle} placeholder="People" value={clonePeople} onChange={(e) => setClonePeople(e.target.value)} />
              <input style={inputStyle} placeholder="Minutes" value={cloneMinutes} onChange={(e) => setCloneMinutes(e.target.value)} />
            </div>

            <div style={modalButtonRowStyle}>
              <button style={buttonStyle} onClick={() => setShowCreateBatch(false)}>
                Cancel
              </button>
              <button style={primaryButtonStyle} onClick={createCloneBatch}>
                Create Clone Batch
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddTaskWindow && selectedBatch && (
        <div style={modalOverlayStyle}>
          <div style={modalStyle}>
            <h2 style={{ textAlign: "center", marginTop: 0 }}>Add Task</h2>
            <p style={{ textAlign: "center", color: "#cbd5e1" }}>
              Add a new task for the current {selectedBatch.stage} stage.
            </p>

            <div style={formStyle}>
              {selectedBatch?.stage === "Clone" && (
                <input style={inputStyle} placeholder="Add new Clone task" value={newCloneTask} onChange={(e) => setNewCloneTask(e.target.value)} />
              )}

              {selectedBatch?.stage === "Veg" && (
                <input style={inputStyle} placeholder="Add new Veg task" value={newVegTask} onChange={(e) => setNewVegTask(e.target.value)} />
              )}

              {(selectedBatch?.stage === "Flower" || selectedBatch?.stage === "Partially Harvested") && (
                <input style={inputStyle} placeholder="Add new Flower task" value={newFlowerTask} onChange={(e) => setNewFlowerTask(e.target.value)} />
              )}
            </div>

            <div style={modalButtonRowStyle}>
              <button style={buttonStyle} onClick={() => setShowAddTaskWindow(false)}>
                Cancel
              </button>
              <button
                style={primaryButtonStyle}
                onClick={() => {
                  if (selectedBatch.stage === "Clone") addCustomTask("Clone");
                  if (selectedBatch.stage === "Veg") addCustomTask("Veg");
                  if (selectedBatch.stage === "Flower" || selectedBatch.stage === "Partially Harvested") addCustomTask("Flower");
                }}
              >
                Save Task
              </button>
            </div>
          </div>
        </div>
      )}

      {showTaskWindow && selectedBatch && (
        <div style={modalOverlayStyle}>
          <div style={modalStyle}>
            <h2 style={{ textAlign: "center", marginTop: 0 }}>Log Task</h2>
            <p style={{ textAlign: "center", color: "#cbd5e1" }}>
              {selectedBatch.id} | {selectedTask}
            </p>

            <div style={formStyle}>
              <input style={inputStyle} value={selectedBatch.id} readOnly />
              <input style={inputStyle} value={selectedTask} readOnly />

              {selectedTask === "Harvest" && (
                <>
                  <select style={inputStyle} value={harvestType} onChange={(e) => setHarvestType(e.target.value)}>
                    <option>A Grade Flower</option>
                    <option>Fresh Frozen</option>
                  </select>

                  <input style={inputStyle} placeholder="Plants harvested" value={harvestPlants} onChange={(e) => setHarvestPlants(e.target.value)} />

                  {harvestType === "Fresh Frozen" && (
                    <>
                      <input style={inputStyle} placeholder="Bundles" value={freshFrozenBundles} onChange={(e) => setFreshFrozenBundles(e.target.value)} />
                      <input style={inputStyle} placeholder="Grams" value={freshFrozenGrams} onChange={(e) => setFreshFrozenGrams(e.target.value)} />
                    </>
                  )}
                </>
              )}

              {selectedTask !== "Harvest" && (
                <input
                  style={inputStyle}
                  placeholder={
                    selectedTask === "Clone → Veg"
                      ? "Plants moved to Veg"
                      : selectedTask === "Move to Flower"
                      ? "Plants moved to Flower"
                      : "Output / notes / result"
                  }
                  value={output}
                  onChange={(e) => setOutput(e.target.value)}
                />
              )}

              {selectedTask === "Move to Flower" && (
                <>
                  <select style={inputStyle} value={flowerRoom} onChange={(e) => setFlowerRoom(e.target.value)}>
                    {flowerRoomOptions.map((room) => (
                      <option key={room} value={room}>
                        Room {room}
                      </option>
                    ))}
                  </select>

                  <select style={inputStyle} value={flowerBay} onChange={(e) => setFlowerBay(e.target.value)}>
                    {flowerBayOptions.map((bay) => (
                      <option key={bay} value={bay}>
                        Bay {bay}
                      </option>
                    ))}
                  </select>

                  <div style={{ ...inputStyle, display: "grid", gap: 8 }}>
                    <b>Tables</b>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {flowerTableOptions.map((table) => (
                        <label
                          key={table}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            border: "1px solid #334155",
                            borderRadius: 10,
                            padding: "8px 10px",
                            background: flowerTables.includes(table) ? "#22c55e" : "#1e293b",
                            color: flowerTables.includes(table) ? "black" : "white",
                            cursor: "pointer",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={flowerTables.includes(table)}
                            onChange={() => toggleFlowerTable(table)}
                          />
                          Table {table}
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <input style={inputStyle} placeholder="People" value={people} onChange={(e) => setPeople(e.target.value)} />
              <input style={inputStyle} placeholder="Minutes" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            </div>

            <div style={modalButtonRowStyle}>
              <button style={buttonStyle} onClick={() => setShowTaskWindow(false)}>
                Cancel
              </button>
              <button style={primaryButtonStyle} onClick={save}>
                Save Task to Batch
              </button>
            </div>
          </div>
        </div>
      )}

      {showDryTaskWindow && selectedDryFlowerBatch && (
        <div style={modalOverlayStyle}>
          <div style={modalStyle}>
            <h2 style={{ textAlign: "center", marginTop: 0 }}>Log Dry Flower Task</h2>
            <p style={{ textAlign: "center", color: "#cbd5e1" }}>
              {selectedDryFlowerBatch.id} | {selectedDryFlowerTask}
            </p>

            <div style={formStyle}>
              <input style={inputStyle} value={selectedDryFlowerBatch.id} readOnly />
              <input style={inputStyle} value={selectedDryFlowerTask} readOnly />
              <input style={inputStyle} placeholder="People" value={dryPeople} onChange={(e) => setDryPeople(e.target.value)} />
              <input style={inputStyle} placeholder="Minutes" value={dryMinutes} onChange={(e) => setDryMinutes(e.target.value)} />

              {selectedDryFlowerTask === "Trimming" ? (
                <>
                  <input style={inputStyle} placeholder="Total A Grade Flower in lbs" value={dryOutput} onChange={(e) => setDryOutput(e.target.value)} />
                  <input style={inputStyle} placeholder="Total Popcorn in lbs" value={dryPopcornWeight} onChange={(e) => setDryPopcornWeight(e.target.value)} />
                  <input style={inputStyle} placeholder="Total Trim in lbs" value={dryTrimWeight} onChange={(e) => setDryTrimWeight(e.target.value)} />
                </>
              ) : selectedDryFlowerTask === "Packaging" ? (
                <>
                  <div
                    style={{
                      ...inputStyle,
                      display: "grid",
                      gap: 6,
                      background: "#111827",
                    }}
                  >
                    <b>Available to Package</b>
                    <span>
                      A Grade Flower: {getDryFlowerPackagingAvailability(selectedDryFlowerBatch).remainingAGradeLbs} lbs
                    </span>
                    <span>
                      Popcorn: {getDryFlowerPackagingAvailability(selectedDryFlowerBatch).remainingPopcornLbs} lbs
                    </span>
                  </div>

                  <select
                    style={inputStyle}
                    value={dryPackageCategory}
                    onChange={(e) => setDryPackageCategory(e.target.value)}
                  >
                    <option>A Grade Flower</option>
                    <option>Popcorn</option>
                  </select>

                  <select
                    style={inputStyle}
                    value={dryPackagingMode}
                    onChange={(e) => setDryPackagingMode(e.target.value)}
                  >
                    <option>Single package by weight</option>
                    <option>Multiple 1 lb packages</option>
                  </select>

                  {dryPackagingMode === "Single package by weight" ? (
                    <input
                      style={inputStyle}
                      placeholder={`${dryPackageCategory} package weight in lbs`}
                      value={dryOutput}
                      onChange={(e) => setDryOutput(e.target.value)}
                    />
                  ) : (
                    <>
                      <input
                        style={inputStyle}
                        placeholder="How many 454g / 1lb packages"
                        value={dryPackageCount}
                        onChange={(e) => setDryPackageCount(e.target.value)}
                      />
                      <p style={{ color: "#cbd5e1", margin: 0 }}>
                        Total {dryPackageCategory} package weight: {num(dryPackageCount)} lbs /{" "}
                        {(num(dryPackageCount) * 454).toFixed(0)} grams
                      </p>
                    </>
                  )}
                </>
              ) : (
                <input
                  style={inputStyle}
                  placeholder={
                    selectedDryFlowerTask === "Bucking"
                      ? "Bucked weight in lbs"
                      : selectedDryFlowerTask === "Decontamination"
                      ? "Decon output weight in lbs"
                      : "Output / notes"
                  }
                  value={dryOutput}
                  onChange={(e) => setDryOutput(e.target.value)}
                />
              )}
            </div>

            <div style={modalButtonRowStyle}>
              <button style={buttonStyle} onClick={() => setShowDryTaskWindow(false)}>
                Cancel
              </button>
              <button style={primaryButtonStyle} onClick={saveDryFlowerTask}>
                Save Dry Flower Task
              </button>
            </div>
          </div>
        </div>
      )}

      {viewBatch && (
        <div style={modalOverlayStyle}>
          <div style={{ ...modalStyle, maxWidth: 760 }}>
            <h2 style={{ textAlign: "center", marginTop: 0 }}>Tasks for {viewBatch.id}</h2>
            <p style={{ textAlign: "center", color: "#cbd5e1" }}>
              {viewBatch.strain || viewBatch.name} | Stage/Status: {viewBatch.stage || viewBatch.status}
            </p>

            <div style={{ textAlign: "center" }}>
              <button style={buttonStyle} onClick={() => setViewBatch(null)}>
                Close
              </button>
            </div>

            <div style={{ marginTop: 20 }}>
              {selectedBatchLogs.length === 0 ? (
                <p style={{ textAlign: "center" }}>No tasks logged for this batch yet.</p>
              ) : (
                selectedBatchLogs.map((log: any, index: number) => (
                  <div
                    key={index}
                    style={{
                      padding: 12,
                      background: "#1e293b",
                      borderRadius: 12,
                      marginBottom: 10,
                      border: "1px solid #334155",
                    }}
                  >
                    <div>
                      <b>{log.task}</b>
                    </div>
                    <div>People: {log.people || "—"}</div>
                    <div>Minutes: {log.minutes || "—"}</div>
                    <div>Output: {log.output || "—"}</div>
                    {log.linkedBatch && <div>Linked Batch: {log.linkedBatch}</div>}
                    <div>Time: {log.time}</div>
                    <div style={{ color: "#94a3b8", fontSize: 13 }}>
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
        <div style={{ ...modalOverlayStyle, zIndex: 10001 }}>
          <div style={{ ...modalStyle, maxWidth: 560 }}>
            <h2 style={{ textAlign: "center", marginTop: 0, marginBottom: 10 }}>
              {notificationModal.title}
            </h2>

            <p style={{ color: "#cbd5e1", marginTop: 0, lineHeight: 1.6, textAlign: "center" }}>
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
                style={notificationModal.onConfirm ? dangerButtonStyle : primaryButtonStyle}
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

      {failBatch && (
        <div style={{ ...modalOverlayStyle, zIndex: 10000 }}>
          <div
            style={{
              ...modalStyle,
              maxWidth: 500,
              border: "1px solid #ef4444",
            }}
          >
            <h2 style={{ textAlign: "center", marginTop: 0 }}>Test Failed: {failBatch.id}</h2>
            <p style={{ textAlign: "center", color: "#cbd5e1" }}>
              Enter the failure reason. This will save into the task history.
            </p>

            <textarea
              placeholder="Failure reason"
              value={failureReason}
              onChange={(e) => setFailureReason(e.target.value)}
              style={{ ...inputStyle, minHeight: 120 }}
            />

            <div style={modalButtonRowStyle}>
              <button
                style={buttonStyle}
                onClick={() => {
                  setFailBatch(null);
                  setFailureReason("");
                }}
              >
                Cancel
              </button>
              <button style={dangerButtonStyle} onClick={saveFailedTest}>
                Save Failure
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </PageAccessGate>
  );
}
