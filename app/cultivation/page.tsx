"use client";

import { useEffect, useRef, useState } from "react";
import Nav from "@/components/Nav";
import PageAccessGate from "@/components/PageAccessGate";
import { canDeleteRecords as userCanDeleteWorkflow } from "@/lib/permissions";
import { store } from "@/lib/store";
import { displayNameFromLogActor, getAuthDisplayName, getAuthUser } from "@/lib/auth";
import {
  hydrateTaskLogsFromApi,
  loadBackendStore,
  markDryFlowerBatchDeleted,
  saveBackendStore,
  snapshotDryFlowerCardFields,
} from "@/lib/backendStore";
import {
  loadCultivationBatches,
  createCultivationBatch,
  updateCultivationBatch,
  deleteCultivationBatch,
} from "@/lib/cultivationApi";
import { apiRequest } from "@/lib/api";
import { createSourceBatch } from "@/lib/sourceBatchApi";
import { createLog, deleteLog as deleteTaskLogRemote, getAllLogs } from "@/lib/logsApi";
import {
  formatLogDisplayTime,
  nowIsoForLog,
  syncCompanyTimezoneFromConfigPayload,
} from "@/lib/companyTimezone";
import {
  computeAllocatedDryCanopySqFt,
  computeDryYieldGPerSqFt,
  sumTableSquareFeetFromIds,
} from "@cpu/shared";

type ConfigStrain = {
  id?: string;
  name?: string;
  strain?: string;
  acronym?: string;
  dominance?: string;
  potency?: string;
  averageYield?: string;
};

type CultivationTableConfig = {
  id: string;
  name: string;
  squareFeet?: string;
};

type CultivationBayConfig = {
  id: string;
  name: string;
  tables: CultivationTableConfig[];
};

type CultivationFlowerRoom = {
  id: string;
  name: string;
  bays: CultivationBayConfig[];
};

type CultivationVegRoom = {
  id: string;
  name: string;
};

type CultivationRoomsConfig = {
  vegRooms: CultivationVegRoom[];
  flowerRooms: CultivationFlowerRoom[];
};

type StageModalKey = null | "Clones" | "Veg" | "Flower";

const emptyCultivationRooms: CultivationRoomsConfig = { vegRooms: [], flowerRooms: [] };

function pickCultivationRoomsFromConfigPayload(data: {
  cultivation?: { rooms?: unknown };
}): CultivationRoomsConfig {
  const rooms = data?.cultivation?.rooms;
  if (!rooms || typeof rooms !== "object" || Array.isArray(rooms)) {
    return { ...emptyCultivationRooms };
  }
  const r = rooms as Record<string, unknown>;
  const vegRooms = Array.isArray(r.vegRooms) ? (r.vegRooms as CultivationVegRoom[]) : [];
  const flowerRooms = Array.isArray(r.flowerRooms) ? (r.flowerRooms as CultivationFlowerRoom[]) : [];
  return { vegRooms, flowerRooms };
}

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
  "Testing",
  "Packaging",
];

/** Same panel as extraction — tests submitted with dry flower to the lab. */
const dryFlowerTestingOptions = [
  "Metals",
  "Microbial",
  "Residual Solvents",
  "Pesticides",
  "Potency",
  "Homogeneity",
];

function getBuckWholePlantLbs(batch: any): number {
  if (!batch) return 0;
  const w = num(batch.buckWholePlantLbs);
  if (w > 0) return w;
  return num(batch.buckedWeightLbs);
}

function getPreDeconFlowerLbs(batch: any): number {
  return num(batch?.trimmedWeightLbs) + num(batch?.popcornWeightLbs);
}

function getTrimFromTrimmingLbs(batch: any): number {
  const explicit = num(batch?.trimFromTrimmingLbs);
  if (explicit > 0) return explicit;
  const total = num(batch?.totalTrimLbs);
  const fromBuck = num(batch?.trimFromBuckLbs);
  return Math.max(total - fromBuck, 0);
}

function dryTaskPrereqMessage(task: string, batch: any): string | null {
  if (!batch) return "Select a dry flower batch.";
  const bucked = getBuckWholePlantLbs(batch) > 0;
  const trimFlowerMass = getPreDeconFlowerLbs(batch) > 0;
  const deconDone = num(batch.deconWeightLbs) > 0;
  const testPass = batch.testStatus === "Test Passed";

  if (task === "Trimming" && !bucked) {
    return "Buck first: separate whole plant (to trim) from stem waste and log both weights.";
  }
  if (task === "Decontamination" && !trimFlowerMass) {
    return "Log trimming (A-grade, popcorn, and trim) before decontamination.";
  }
  if (task === "Burping" && !trimFlowerMass) {
    return "Complete trimming before burping.";
  }
  if (task === "Testing" && !deconDone) {
    return "Complete decontamination before submitting for testing.";
  }
  if (task === "Packaging" && !testPass) {
    return "This batch must pass lab testing (with THC %) before packaging.";
  }
  return null;
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

function hasCultivationWriteAccess() {
  const user: any = getAuthUser();
  const role = String(user?.role || "").toUpperCase();

  return [
    "CULTIVATION",
    "CULTIVATION_SPECIALIST",
    "MANAGER",
    "OPERATIONS_MANAGER",
    "ADMIN",
    "OWNER",
  ].includes(role);
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

/** Last segment of batch id is `MMDDYY` per `makeDateCode` (e.g. `ACRONYM.MMDDYY` or `ACRONYM.N.MMDDYY`). */
function parseBatchIdDateCode(id: unknown): string | null {
  const s = String(id || "").trim();
  if (!s) return null;
  const parts = s.split(".");
  const last = parts[parts.length - 1] || "";
  if (/^\d{6}$/.test(last)) return last;
  return null;
}

function batchCloneSortTimeMs(batch: any): number {
  const clone = batch?.cloneDate;
  if (clone) {
    const t = Date.parse(String(clone));
    if (Number.isFinite(t)) return t;
  }
  const code = parseBatchIdDateCode(batch?.id);
  if (!code) return Number.POSITIVE_INFINITY;
  const mm = code.slice(0, 2);
  const dd = code.slice(2, 4);
  const yy = code.slice(4, 6);
  const y = 2000 + Number.parseInt(yy, 10);
  const m = Number.parseInt(mm, 10);
  const d = Number.parseInt(dd, 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return Number.POSITIVE_INFINITY;
  const dt = new Date(y, m - 1, d);
  const ms = dt.getTime();
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

function compareBatchesByCloneDateOldestFirst(a: any, b: any): number {
  const ta = batchCloneSortTimeMs(a);
  const tb = batchCloneSortTimeMs(b);
  if (ta !== tb) return ta - tb;
  return String(a?.id || "").localeCompare(String(b?.id || ""), undefined, { sensitivity: "base" });
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

/** Cumulative packaged lbs on the dry card (`final*` fields): show a number once set, otherwise an em-dash. */
function fmtDryFlowerCumulativePackedLbs(v: unknown): string {
  if (v === undefined || v === null || v === "") return "—";
  const n = num(v);
  return (+n.toFixed(4)).toString();
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

/** API merges `CompanyConfig` rows by key at top level (`strains`, …); admin UI nests under `cultivation`. */
function pickStrainsFromConfigPayload(data: {
  cultivation?: { strains?: unknown };
  strains?: unknown;
}): Array<ConfigStrain | string> {
  const nested = data?.cultivation?.strains;
  if (Array.isArray(nested)) return nested as Array<ConfigStrain | string>;
  const flat = data?.strains;
  if (Array.isArray(flat)) return flat as Array<ConfigStrain | string>;
  return [];
}

function normalizeStrainConfigList(raw: Array<ConfigStrain | string>): ConfigStrain[] {
  return raw.map((item) => {
    if (typeof item === "string") {
      const name = String(item).trim();
      const acronym = name
        .split(/\s+/)
        .map((w) => (w[0] ? w[0].toUpperCase() : ""))
        .join("")
        .slice(0, 6) || name.slice(0, 3).toUpperCase();
      return { id: name, name, strain: name, acronym };
    }
    return item;
  });
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

function findCultivationParentBatch(store: any, sourceId: string) {
  const lists = [
    ...(store.cultivationBatches || []),
    ...(store.completedCultivationBatches || []),
  ];
  return lists.find((b: any) => b.id === sourceId) || null;
}

function recomputeDryCanopyForCultivationBatch(batch: any, rooms: CultivationRoomsConfig) {
  if (!batch || typeof batch !== "object") return;
  const total = sumTableSquareFeetFromIds(
    rooms.flowerRooms,
    String(batch.flowerRoomId || ""),
    String(batch.flowerBayId || ""),
    Array.isArray(batch.flowerTableIds) ? batch.flowerTableIds : []
  );
  const plantsAtFlower = Math.max(1, num(batch.plantsAtFlower));
  const plantsDry = num(batch.plantsHarvestedDry);
  batch.totalFlowerTableSqFt = total;
  batch.dryCanopySqFt = computeAllocatedDryCanopySqFt(total, plantsAtFlower, plantsDry);
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
  const [selectedStage, setSelectedStage] = useState<StageModalKey>(null);

  const [cloneTasks, setCloneTasks] = useState(defaultCloneTasks);
  const [vegTasks, setVegTasks] = useState(defaultVegTasks);
  const [flowerTasks, setFlowerTasks] = useState(defaultFlowerTasks);

  const [newCloneTask, setNewCloneTask] = useState("");
  const [newVegTask, setNewVegTask] = useState("");
  const [newFlowerTask, setNewFlowerTask] = useState("");

  const [configStrains, setConfigStrains] = useState<ConfigStrain[]>([]);
  const [cultivationRooms, setCultivationRooms] =
    useState<CultivationRoomsConfig>(emptyCultivationRooms);
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
  /** Destination veg room (config `cultivation.rooms.vegRooms`); required when that list is non-empty. */
  const [vegRoomId, setVegRoomId] = useState("");
  /** Flower layout from config — store ids in modal, persist names on batch/log. */
  const [flowerRoomId, setFlowerRoomId] = useState("");
  const [flowerBayId, setFlowerBayId] = useState("");
  const [flowerTableIds, setFlowerTableIds] = useState<string[]>([]);

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
  /** Leaf/trim separated at bucking — added to trim-from-trimming for extraction; not part of whole-plant cap. */
  const [dryTrimFromBucking, setDryTrimFromBucking] = useState("");
  const [dryPopcornWeight, setDryPopcornWeight] = useState("");
  const [dryPackagingMode, setDryPackagingMode] = useState("Single package by weight");
  const [dryPackageCategory, setDryPackageCategory] = useState("A Grade Flower");
  const [dryPackageCount, setDryPackageCount] = useState("");
  const [dryBuckWholePlant, setDryBuckWholePlant] = useState("");
  const [dryBuckStemWaste, setDryBuckStemWaste] = useState("");
  const [dryTestingSelectedTests, setDryTestingSelectedTests] = useState<string[]>([]);
  const [dryTestingDateSubmitted, setDryTestingDateSubmitted] = useState("");
  const [isSavingTask, setIsSavingTask] = useState(false);
  const [isSavingDryTask, setIsSavingDryTask] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");

  const [failBatch, setFailBatch] = useState<any>(null);
  const [failureReason, setFailureReason] = useState("");

  /** Dry flower Test Passed → lab THC % modal; metrics are written on the parent cultivation batch. */
  const [testPassModalBatch, setTestPassModalBatch] = useState<any>(null);
  const [testPassThcPct, setTestPassThcPct] = useState("");
  const [testPassResultDate, setTestPassResultDate] = useState("");
  const [testPassPotencyNote, setTestPassPotencyNote] = useState("");

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
    setCanDeleteRecords(userCanDeleteWorkflow());
    setCanWriteRecords(hasCultivationWriteAccess());

    let mounted = true;

    async function loadCompanyCultivationConfig() {
      try {
        const data = await apiRequest<{
          cultivation?: { strains?: ConfigStrain[]; rooms?: unknown };
          strains?: ConfigStrain[] | string[];
        }>("/api/config");
        syncCompanyTimezoneFromConfigPayload(data);
        const strains = normalizeStrainConfigList(pickStrainsFromConfigPayload(data));
        const rooms = pickCultivationRoomsFromConfigPayload(data);

        if (!mounted) return;

        setConfigStrains(
          strains.filter((item: ConfigStrain) => {
            return getConfigStrainName(item) && getConfigStrainAcronym(item);
          })
        );
        setCultivationRooms(rooms);
      } catch (error) {
        console.error("Could not load company cultivation config:", error);

        if (mounted) {
          setConfigStrains([]);
          setCultivationRooms(emptyCultivationRooms);
        }
      }
    }

    async function loadSharedData() {
      try {
        /** CompanyStore JSON often lags `/api/cultivation`; applying it to cultivation lists causes stage flicker (e.g. Veg → Flower). */
        await loadBackendStore({ omitCultivation: true });
        await hydrateTaskLogsFromApi();
        await loadCompanyCultivationConfig();

        /** Company store may list FF/trim only under sourceBatches (DATABASE_ONLY skips full PUT); mirror into production panel. */
        const prodIds = new Set(
          (s.productionBatches || []).map((b: any) => String(b?.id || ""))
        );
        for (const src of s.sourceBatches || []) {
          const id = String(src?.id || "");
          if (!id || prodIds.has(id)) continue;
          const typ = String(src?.type || "");
          if (typ === "Fresh Frozen" || typ === "Dry Trim") {
            s.productionBatches.unshift({ ...src });
            prodIds.add(id);
          }
        }

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

  function withLoggedBy(log: any, dryFlowerBatchForSnapshot?: unknown) {
    const loggedBy = getLoggedBy();
    const loggedAtIso = new Date().toISOString();

    const dryFlowerCardSnapshot = dryFlowerBatchForSnapshot
      ? snapshotDryFlowerCardFields(dryFlowerBatchForSnapshot as any)
      : null;

    const finalLog = {
      ...log,
      loggedBy,
      loggedAt: loggedAtIso,
      loggedAtIso,
      time: log.time || loggedAtIso,
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
        loggedAt: loggedAtIso,
        loggedAtIso,
        ...(dryFlowerCardSnapshot ? { dryFlowerCardSnapshot } : {}),
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

  function stageBucketFromBatchStage(stage: unknown): Exclude<StageModalKey, null> {
    const value = String(stage || "").trim().toLowerCase();
    if (value === "clone" || value === "clones") return "Clones";
    if (value === "veg") return "Veg";
    return "Flower";
  }

  const stageOrder: Exclude<StageModalKey, null>[] = ["Clones", "Veg", "Flower"];
  const activeBatchesByStage = {
    Clones: activeBatches.filter((b: any) => stageBucketFromBatchStage(b?.stage) === "Clones"),
    Veg: activeBatches.filter((b: any) => stageBucketFromBatchStage(b?.stage) === "Veg"),
    Flower: activeBatches.filter((b: any) => stageBucketFromBatchStage(b?.stage) === "Flower"),
  } as const;
  const stagePlantTotals = {
    Clones: activeBatchesByStage.Clones.reduce((sum, b: any) => sum + num(b?.plants), 0),
    Veg: activeBatchesByStage.Veg.reduce((sum, b: any) => sum + num(b?.plants), 0),
    Flower: activeBatchesByStage.Flower.reduce((sum, b: any) => sum + num(b?.plants), 0),
  } as const;

  const selectedStageBatches = selectedStage ? activeBatchesByStage[selectedStage] : [];
  const selectedStageBatchesOldestFirst = [...selectedStageBatches].sort(
    compareBatchesByCloneDateOldestFirst
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

  async function saveRealCultivationBatch(batch: any): Promise<boolean> {
    if (!batch?.id || !canWriteRecords) return false;

    try {
      const updated = await updateCultivationBatch(batch.id, batch);
      if (updated && typeof updated === "object") {
        Object.assign(batch, updated);
      }
      return true;
    } catch (error) {
      console.error("Could not update real cultivation table:", error);
      return false;
    }
  }

  function createRealCultivationBatch(batch: any) {
    if (!batch?.id || !canWriteRecords) return;

    createCultivationBatch(batch).catch((error) => {
      console.error("Could not create real cultivation batch:", error);
    });
  }

  async function deleteRealCultivationBatchIfNeeded(batchId: string, wasCultivationBatch: boolean) {
    if (!batchId || !wasCultivationBatch) return true;
    try {
      await deleteCultivationBatch(batchId);
      return true;
    } catch (error) {
      console.error("Could not delete real cultivation batch:", error);
      return false;
    }
  }

  async function purgeBackendLogsForBatch(batchId: string) {
    if (!batchId) return;
    try {
      const logs = await getAllLogs();
      const rows = Array.isArray(logs) ? logs : [];
      const targets = rows.filter((log: any) => {
        if (!log || typeof log !== "object") return false;
        const data = log.data && typeof log.data === "object" ? log.data : {};
        const snap = (data as any).dryFlowerCardSnapshot;
        const snapId = String(snap?.id || "");
        return (
          log.batch === batchId ||
          log.source === batchId ||
          log.linkedBatch === batchId ||
          snapId === batchId
        );
      });
      await Promise.all(
        targets.map((log: any) => {
          const id = log?.id != null ? String(log.id).trim() : "";
          if (!id) return Promise.resolve();
          return deleteTaskLogRemote(id).catch((error) => {
            console.error("Could not delete backend log row:", error);
          });
        })
      );
    } catch (error) {
      console.error("Could not purge backend logs for deleted batch:", error);
    }
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
      updatedAt: nowIsoForLog(),
      packagingLogs: batch.packagingLogs || [],
    };

    if (existing) {
      Object.assign(existing, packagingData);
    } else {
      s.packagingBatches.unshift({
        ...packagingData,
        createdAt: nowIsoForLog(),
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
      time: nowIsoForLog(),
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

  async function runDeleteBatch(batchId: string) {
    markDryFlowerBatchDeleted(batchId);
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

    const loggedBy = getLoggedBy();
    const loggedAtIso = new Date().toISOString();
    const deleteAudit = {
      area: "Audit",
      batch: batchId,
      task: "Deleted Record",
      output: `Deleted cultivation-related record(s): ${batchId} | Records removed: ${deletedRecords.length} | Related logs removed: ${deletedLogCount}`,
      loggedBy,
      loggedAt: loggedAtIso,
      loggedAtIso,
      data: {
        deletedRecordType: "Cultivation Batch Chain",
        deletedRecordId: batchId,
        deletedRecords,
        deletedLogCount,
        deletedAtIso: new Date().toISOString(),
        loggedBy,
        loggedAt: loggedAtIso,
        loggedAtIso,
      },
      time: nowIsoForLog(),
    };
    s.logs.unshift(deleteAudit);

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

    await purgeBackendLogsForBatch(batchId);
    try {
      await createLog({
        area: deleteAudit.area,
        batch: deleteAudit.batch,
        task: deleteAudit.task,
        output: deleteAudit.output,
        data: deleteAudit.data,
      });
    } catch (error) {
      console.error("Could not save delete audit log to backend:", error);
      showNotice(
        "Delete Audit Sync Failed",
        "The batch was removed locally, but the delete audit log did not save to the backend.",
        "Please refresh and retry if deleted rows reappear."
      );
    }
    const deleteOk = await deleteRealCultivationBatchIfNeeded(batchId, wasCultivationBatch);
    if (!deleteOk) {
      showNotice(
        "Backend Delete Failed",
        "The batch was removed locally, but the backend delete failed.",
        "Please refresh and retry. This can happen if your role cannot delete this batch."
      );
    }
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
    batch.completedAt = nowIsoForLog();

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
      time: nowIsoForLog(),
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
      selectedBatch.plantsHarvestedDry = num(selectedBatch.plantsHarvestedDry) + plantsHarvested;
      recomputeDryCanopyForCultivationBatch(selectedBatch, cultivationRooms);

      const dryBatch = {
        id: `DRY-${selectedBatch.id}-${Date.now().toString().slice(-4)}`,
        name: `${selectedBatch.strain} A Grade Flower`,
        type: "A Grade Flower",
        source: selectedBatch.id,
        status: "Drying / Curing",
        testStatus: "Not Submitted",
        plantsHarvested,
        buckWholePlantLbs: "",
        buckStemWasteLbs: "",
        buckedWeightLbs: "",
        trimmedWeightLbs: "",
        totalTrimLbs: "",
        trimFromTrimmingLbs: "",
        trimFromBuckLbs: "",
        popcornWeightLbs: "",
        deconWeightLbs: "",
        packagedWeightLbs: 0,
        packagedAGradeLbs: 0,
        packagedPopcornLbs: 0,
        remainingPackableLbs: "",
        createdAt: nowIsoForLog(),
      };

      s.dryFlowerBatches.unshift(dryBatch);
      s.productionBatches.unshift(dryBatch);
      setSelectedDryFlowerBatch(dryBatch);

      s.logs.unshift(
        withLoggedBy(
          {
            area: "Cultivation",
            batch: selectedBatch.id,
            task: "Harvest - A Grade Flower",
            people,
            minutes,
            output: `${plantsHarvested} plants harvested for A Grade Flower. No weight recorded until bucking.`,
            linkedBatch: dryBatch.id,
            time: nowIsoForLog(),
          },
          dryBatch,
        ),
      )
    }

    if (harvestType === "Fresh Frozen") {
      selectedBatch.plantsHarvestedFreshFrozen =
        num(selectedBatch.plantsHarvestedFreshFrozen) + plantsHarvested;
      recomputeDryCanopyForCultivationBatch(selectedBatch, cultivationRooms);

      const gramsParsed = num(String(freshFrozenGrams ?? "").replace(/,/g, ""));
      const weightLbs = +(gramsParsed / 453.592).toFixed(4);
      const freshFrozenBatch = {
        id: `FF-${selectedBatch.id}-${Date.now().toString().slice(-4)}`,
        name: `${selectedBatch.strain} Fresh Frozen`,
        type: "Fresh Frozen",
        amount: `${freshFrozenBundles || 0} bundles / ${gramsParsed} grams`,
        bundles: Number(freshFrozenBundles || 0),
        grams: gramsParsed,
        /** Extraction availability uses weightLbs / grams; always set both for stable sync. */
        weightLbs,
        plantsHarvested,
        source: selectedBatch.id,
        status: "Available for Extraction",
        createdAt: nowIsoForLog(),
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
        time: nowIsoForLog(),
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
    await saveRealCultivationBatch(selectedBatch);
    forceRefresh();
  }

  function toggleDryFlowerTestOption(test: string) {
    setDryTestingSelectedTests((prev) =>
      prev.includes(test) ? prev.filter((t) => t !== test) : [...prev, test],
    );
  }

  function handleTestPassResultDateChange(nextValue: string) {
    const next = String(nextValue || "").trim();
    const current = String(testPassResultDate || "").trim();
    if (!next || !current || next === current) {
      setTestPassResultDate(next);
      return;
    }
    showConfirm(
      "Use different result date?",
      "Are you sure you want to use a different lab result date for this test?",
      () => setTestPassResultDate(next),
      `Current date: ${current}\nNew date: ${next}`,
    );
  }

  async function applyDryFlowerTestPassed(
    batch: any,
    labThcPct: number,
    potencyNote: string,
    resultDateYmd: string,
  ) {
    if (!canWriteRecords) {
      showReadOnlyNotice();
      return;
    }
    const LAB_THC_MAX = 50;
    if (!isPositiveNumber(labThcPct)) {
      showNotice("Lab THC % required", "Enter a positive numeric lab THC % for this batch.");
      return;
    }
    const thc = Number(labThcPct);
    if (thc > LAB_THC_MAX) {
      showNotice("Lab THC % out of range", `Enter a lab THC % no greater than ${LAB_THC_MAX} (typical flower range).`);
      return;
    }
    const resultDate = String(resultDateYmd || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(resultDate)) {
      showNotice("Lab result date required", "Enter the date this test result came back from the lab.");
      return;
    }
    // Use a UTC midday anchor so date-only values remain stable across time zones.
    const potencyAt = new Date(`${resultDate}T12:00:00.000Z`);
    if (Number.isNaN(potencyAt.getTime())) {
      showNotice("Invalid lab result date", "Enter a valid date for the lab result.");
      return;
    }

    batch.testStatus = "Test Passed";
    batch.status = "Passed / Ready for Packaging";
    batch.testFailureReason = "";
    batch.finalLabPotencyPct = thc;
    batch.finalLabPotencyAt = potencyAt.toISOString();
    const noteTrim = String(potencyNote || "").trim().slice(0, 500);
    if (noteTrim) {
      batch.finalLabPotencyNote = noteTrim;
    } else {
      delete batch.finalLabPotencyNote;
    }

    const parent = findCultivationParentBatch(s, batch.source);
    if (parent) {
      recomputeDryCanopyForCultivationBatch(parent, cultivationRooms);
      const weights = getDryFlowerFinalWeights(batch);
      /** Dry yield density: A-grade + popcorn flower mass (trim tracked separately in `totalTrimLbs`, not in this total). */
      const grams =
        weights.totalFinalPackagedGrams > 0
          ? weights.totalFinalPackagedGrams
          : weights.usableTotalLbs * 453.592;
      const canopy = num(parent.dryCanopySqFt);
      const yld = computeDryYieldGPerSqFt(grams, canopy);
      parent.finalLabPotencyPct = thc;
      parent.finalLabPotencyAt = batch.finalLabPotencyAt;
      parent.dryYieldGPerSqFt = +yld.toFixed(4);
      /** Persist per-dry yield so Analytics can plot each burping batch (parent values are overwritten by later passes). */
      batch.dryYieldGPerSqFt = +yld.toFixed(4);
      parent.strainMetricsDryFlowerBatchId = batch.id;
      if (noteTrim) {
        parent.finalLabPotencyNote = noteTrim;
      } else {
        delete parent.finalLabPotencyNote;
      }
    }

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
        createdAt: nowIsoForLog(),
      });
    }

    s.logs.unshift(
      withLoggedBy(
        {
          area: "Cultivation",
          batch: batch.id,
          task: "Test Passed",
          people: "",
          minutes: "",
          output: `Dry flower batch passed testing (lab THC ${thc}%) and is ready for packaging`,
          source: batch.source,
          time: nowIsoForLog(),
        },
        batch,
      ),
    )

    setTestPassModalBatch(null);
    setTestPassThcPct("");
    setTestPassResultDate("");
    setTestPassPotencyNote("");

    if (!parent) {
      showNotice(
        "Analytics not updated on server",
        "No parent cultivation batch was found for this dry flower row.",
        "Strain Analytics reads lab THC % and dry yield from the cultivation batch tied to dry batch `source`. Re-open cultivation data or refresh after the parent loads.",
      );
    } else {
      const synced = await saveRealCultivationBatch(parent);
      if (!synced) {
        showNotice(
          "Could not save lab metrics",
          "The cultivation batch did not persist to the server (check network / role permissions). Reload and try Pass again, or use Data Hub cultivation sync.",
          "",
        );
      }
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

    s.logs.unshift(
      withLoggedBy(
        {
          area: "Cultivation",
          batch: failBatch.id,
          task: "Test Failed",
          people: "",
          minutes: "",
          output: failureReason || "No failure reason entered",
          source: failBatch.source,
          time: nowIsoForLog(),
        },
        failBatch,
      ),
    )

    setFailBatch(null);
    setFailureReason("");
    forceRefresh();
  }

  async function saveDryFlowerTask() {
    if (isSavingDryTask) return;
    if (!canWriteRecords) {
      showReadOnlyNotice();
      return;
    }

    if (!selectedDryFlowerBatch) return;
    setIsSavingDryTask(true);

    const dryRequiredFields: { label: string; value: any; positive?: boolean; zeroOrPositive?: boolean }[] = [
      { label: "People", value: dryPeople },
      { label: "Minutes", value: dryMinutes, positive: true },
    ];

    if (selectedDryFlowerTask === "Bucking") {
      dryRequiredFields.push(
        { label: "Whole plant weight (to trim)", value: dryBuckWholePlant, positive: true },
        { label: "Stem / waste weight", value: dryBuckStemWaste, zeroOrPositive: true },
      );
    }

    try {
    if (selectedDryFlowerTask === "Trimming") {
      dryRequiredFields.push(
        { label: "Total A Grade Flower", value: dryOutput, zeroOrPositive: true },
        { label: "Total Popcorn", value: dryPopcornWeight, zeroOrPositive: true },
        { label: "Trim from trimming", value: dryTrimWeight, zeroOrPositive: true },
        { label: "Trim from bucking", value: dryTrimFromBucking, zeroOrPositive: true },
      );
    }

    if (selectedDryFlowerTask === "Decontamination") {
      dryRequiredFields.push({ label: "Decon Output Weight", value: dryOutput, positive: true });
    }

    if (selectedDryFlowerTask === "Testing") {
      const ts = selectedDryFlowerBatch.testStatus;
      if (!ts || ts === "Not Submitted") {
        dryRequiredFields.push({ label: "Lab submission date", value: dryTestingDateSubmitted });
      }
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

    const prereq = dryTaskPrereqMessage(selectedDryFlowerTask, selectedDryFlowerBatch);
    if (prereq) {
      showNotice("Complete the prior step", prereq);
      return;
    }

    if (selectedDryFlowerTask === "Testing") {
      const ts = selectedDryFlowerBatch.testStatus;
      if (ts === "Submitted to Testing" || ts === "Test Passed" || ts === "Test Failed") {
        showNotice(
          "Use Pass or Failed",
          "Results for this batch are already submitted, or testing is complete. Use the Pass / Failed actions when the lab results are back.",
        );
        return;
      }
      if (dryTestingSelectedTests.length === 0) {
        showNotice("Select tests", "Choose at least one test type that was submitted to the lab (same options as extraction).");
        return;
      }
    }

    const shouldConfirmRepeatTask =
      selectedDryFlowerTask !== "Packaging" && selectedDryFlowerTask !== "Testing";

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
      const wholePlant = num(dryBuckWholePlant);
      const stemWaste = num(dryBuckStemWaste);
      const existingTrimOutForCap =
        num(selectedDryFlowerBatch.trimmedWeightLbs) +
        num(selectedDryFlowerBatch.popcornWeightLbs) +
        getTrimFromTrimmingLbs(selectedDryFlowerBatch);
      if (existingTrimOutForCap > wholePlant + 0.02) {
        showNotice(
          "Whole plant is below trimmed output",
          `This batch already has ${existingTrimOutForCap.toFixed(2)} lbs recorded from trimming (A-grade + popcorn + trim from trimming). Whole plant at bucking cannot be set below that.`,
          "Enter a whole-plant bucking weight that is at least the trimmed output, or adjust the trimming values first.",
        );
        return;
      }
      selectedDryFlowerBatch.buckWholePlantLbs = +wholePlant.toFixed(4);
      selectedDryFlowerBatch.buckStemWasteLbs = +stemWaste.toFixed(4);
      selectedDryFlowerBatch.buckedWeightLbs = +wholePlant.toFixed(4);
      selectedDryFlowerBatch.status = "Bucked";

      s.logs.unshift(
        withLoggedBy(
          {
            area: "Cultivation",
            batch: selectedDryFlowerBatch.id,
            task: "Bucking",
            people: dryPeople,
            minutes: dryMinutes,
            output: `Whole plant (to trim): ${wholePlant} lbs | Stem / waste logged: ${stemWaste} lbs`,
            source: selectedDryFlowerBatch.source,
            time: nowIsoForLog(),
          },
          selectedDryFlowerBatch,
        ),
      )
    }

    if (selectedDryFlowerTask === "Trimming") {
      const aGradeFlowerWeight = enteredWeight;
      const popcornWeight = num(dryPopcornWeight);
      const trimFromTrimming = num(dryTrimWeight);
      const trimFromBuck = num(dryTrimFromBucking);
      const totalTrimForExtraction = trimFromTrimming + trimFromBuck;
      const cap = getBuckWholePlantLbs(selectedDryFlowerBatch);
      const totalOutForCap = aGradeFlowerWeight + popcornWeight + trimFromTrimming;
      if (cap > 0 && totalOutForCap > cap + 0.02) {
        showNotice(
          "Trim totals exceed bucked whole plant",
          `A-grade (${aGradeFlowerWeight}) + popcorn (${popcornWeight}) + trim from trimming (${trimFromTrimming}) = ${totalOutForCap.toFixed(2)} lbs, but whole plant after bucking was ${cap.toFixed(2)} lbs. Trim from bucking does not count toward this cap. Adjust your weights.`,
        );
        return;
      }
      const totalPackableFlower = aGradeFlowerWeight + popcornWeight;

      selectedDryFlowerBatch.trimmedWeightLbs = aGradeFlowerWeight;
      selectedDryFlowerBatch.popcornWeightLbs = popcornWeight;
      selectedDryFlowerBatch.trimFromTrimmingLbs = +trimFromTrimming.toFixed(4);
      selectedDryFlowerBatch.trimFromBuckLbs = +trimFromBuck.toFixed(4);
      selectedDryFlowerBatch.totalTrimLbs = +totalTrimForExtraction.toFixed(4);
      selectedDryFlowerBatch.remainingPackableLbs = totalPackableFlower;
      selectedDryFlowerBatch.status = "Trimmed";

      const trimLogExtra =
        trimFromBuck > 0
          ? ` | Trim from trimming: ${trimFromTrimming} lbs | Trim from bucking: ${trimFromBuck} lbs | Total trim to extraction: ${totalTrimForExtraction} lbs`
          : ` | Total trim to extraction: ${totalTrimForExtraction} lbs`;

      s.logs.unshift(
        withLoggedBy(
          {
            area: "Cultivation",
            batch: selectedDryFlowerBatch.id,
            task: "Trimming",
            people: dryPeople,
            minutes: dryMinutes,
            output: `Total A Grade Flower: ${aGradeFlowerWeight} lbs | Total Popcorn: ${popcornWeight} lbs${trimLogExtra}`,
            source: selectedDryFlowerBatch.source,
            time: nowIsoForLog(),
          },
          selectedDryFlowerBatch,
        ),
      )

      if (totalTrimForExtraction > 0) {
        const trimBatch = {
          id: `TRIM-${selectedDryFlowerBatch.id}-${Date.now()
            .toString()
            .slice(-4)}`,
          name: `${selectedDryFlowerBatch.name} Trim`,
          type: "Dry Trim",
          amount: `${totalTrimForExtraction} lbs`,
          weightLbs: totalTrimForExtraction,
          source: selectedDryFlowerBatch.id,
          parentCultivationBatch: selectedDryFlowerBatch.source,
          status: "Available for Extraction",
          createdAt: nowIsoForLog(),
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

        s.logs.unshift(
          withLoggedBy(
            {
              area: "Cultivation",
              batch: selectedDryFlowerBatch.id,
              task: "Trim Available for Extraction",
              people: "",
              minutes: "",
              output: `${totalTrimForExtraction} lbs dry trim is available for extraction`,
              linkedBatch: trimBatch.id,
              source: selectedDryFlowerBatch.source,
              time: nowIsoForLog(),
            },
            selectedDryFlowerBatch,
          ),
        )
      }
    }

    if (selectedDryFlowerTask === "Decontamination") {
      const preDecon = getPreDeconFlowerLbs(selectedDryFlowerBatch);
      const previousWeight =
        preDecon > 0 ? preDecon : getBuckWholePlantLbs(selectedDryFlowerBatch);
      if (preDecon > 0 && enteredWeight > preDecon + 0.02) {
        showNotice(
          "Decon weight too high",
          `Decon output cannot exceed A-grade + popcorn going in (${preDecon.toFixed(2)} lbs). Trim is tracked separately for extraction.`,
        );
        return;
      }
      const loss = Math.max(previousWeight - enteredWeight, 0);

      selectedDryFlowerBatch.deconWeightLbs = enteredWeight;
      selectedDryFlowerBatch.remainingPackableLbs = enteredWeight;
      selectedDryFlowerBatch.status = "Decontaminated";

      s.logs.unshift(
        withLoggedBy(
          {
            area: "Cultivation",
            batch: selectedDryFlowerBatch.id,
            task: "Decontamination",
            people: dryPeople,
            minutes: dryMinutes,
            output: `Decon output weight: ${enteredWeight} lbs | Loss from previous stage: ${loss} lbs`,
            source: selectedDryFlowerBatch.source,
            time: nowIsoForLog(),
          },
          selectedDryFlowerBatch,
        ),
      )
    }

    if (selectedDryFlowerTask === "Burping") {
      selectedDryFlowerBatch.status = "Burping";

      s.logs.unshift(
        withLoggedBy(
          {
            area: "Cultivation",
            batch: selectedDryFlowerBatch.id,
            task: "Burping",
            people: dryPeople,
            minutes: dryMinutes,
            output:
              dryOutput || "Burping jars / curing process ongoing",
            source: selectedDryFlowerBatch.source,
            time: nowIsoForLog(),
          },
          selectedDryFlowerBatch,
        ),
      )
    }

    if (selectedDryFlowerTask === "Testing") {
      selectedDryFlowerBatch.dryTestingTestsReceived = [...dryTestingSelectedTests];
      selectedDryFlowerBatch.dryTestingDateSubmitted = dryTestingDateSubmitted.trim();
      selectedDryFlowerBatch.testStatus = "Submitted to Testing";
      selectedDryFlowerBatch.status = "Submitted to Testing";

      s.logs.unshift(
        withLoggedBy(
          {
            area: "Cultivation",
            batch: selectedDryFlowerBatch.id,
            task: "Submitted to Testing",
            people: dryPeople,
            minutes: dryMinutes,
            output: `Dry flower submitted for testing | Tests: ${dryTestingSelectedTests.join(", ")} | Lab submission date: ${dryTestingDateSubmitted}`,
            source: selectedDryFlowerBatch.source,
            time: nowIsoForLog(),
          },
          selectedDryFlowerBatch,
        ),
      )
    }

    if (selectedDryFlowerTask === "Packaging") {
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
        time: nowIsoForLog(),
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
        selectedDryFlowerBatch.completedAt = nowIsoForLog();
      }

      upsertDryFlowerPackagingBatch(selectedDryFlowerBatch);

      s.logs.unshift(
        withLoggedBy(
          {
            area: "Cultivation",
            batch: selectedDryFlowerBatch.id,
            task: "Packaging",
            people: dryPeople,
            minutes: dryMinutes,
            output: `Flower type: ${dryPackageCategory} | Mode: ${dryPackagingMode} | Units: ${actualPackageUnits} | Packaged: ${packagedThisRound} lbs | Total packaged: ${selectedDryFlowerBatch.packagedWeightLbs} lbs | A Grade remaining: ${selectedDryFlowerBatch.remainingAGradeLbs} lbs | Popcorn remaining: ${selectedDryFlowerBatch.remainingPopcornLbs} lbs`,
            source: selectedDryFlowerBatch.source,
            time: nowIsoForLog(),
          },
          selectedDryFlowerBatch,
        ),
      )

      if (isComplete) {
        setSelectedDryFlowerBatch(null);
      }
    }


    setDryPeople("");
    setDryMinutes("");
    setDryOutput("");
    setDryBuckWholePlant("");
    setDryBuckStemWaste("");
    setDryTrimWeight("");
    setDryTrimFromBucking("");
    setDryPopcornWeight("");
    setDryPackagingMode("Single package by weight");
    setDryPackageCategory("A Grade Flower");
    setDryPackageCount("");
    setDryTestingSelectedTests([]);
    setDryTestingDateSubmitted("");
    setShowDryTaskWindow(false);
    forceRefresh();
    } finally {
      setIsSavingDryTask(false);
    }
  }

  function toggleFlowerTableId(tableId: string) {
    setFlowerTableIds((current) =>
      current.includes(tableId)
        ? current.filter((id) => id !== tableId)
        : [...current, tableId]
    );
  }

  function primeTaskModalLocationFields(rooms: CultivationRoomsConfig) {
    const veg = rooms.vegRooms || [];
    if (veg.length === 1) {
      setVegRoomId(veg[0].id);
    }
    else if (veg.length > 1) {
      setVegRoomId(veg[0].id);
    }
    else {
      setVegRoomId("");
    }

    const flowers = rooms.flowerRooms || [];
    if (flowers.length === 0) {
      setFlowerRoomId("");
      setFlowerBayId("");
      setFlowerTableIds([]);
      return;
    }
    const room = flowers[0];
    setFlowerRoomId(room.id);
    const firstBay = room.bays?.[0];
    if (firstBay) {
      setFlowerBayId(firstBay.id);
    }
    else {
      setFlowerBayId("");
    }
    setFlowerTableIds([]);
  }

  function primeTaskModalFromSelectedBatch(batch: any) {
    primeTaskModalLocationFields(cultivationRooms);
    if (batch?.flowerRoomId) {
      setFlowerRoomId(String(batch.flowerRoomId));
      if (batch.flowerBayId) setFlowerBayId(String(batch.flowerBayId));
      if (Array.isArray(batch.flowerTableIds)) setFlowerTableIds([...batch.flowerTableIds]);
    }
  }

  function openTaskWindowForBatch(batch: any) {
    if (!batch) return;
    selectBatch(batch);
    const taskList = getTasksForStage(batch.stage || "Clone");
    setSelectedTask(taskList[0] || "Maintenance");
    primeTaskModalFromSelectedBatch(batch);
    setShowTaskWindow(true);
    setSelectedStage(null);
  }

  function resolveFlowerSelectionLabels() {
    const room = cultivationRooms.flowerRooms.find((r) => r.id === flowerRoomId);
    const bay = room?.bays?.find((b) => b.id === flowerBayId);
    const tableNames =
      bay?.tables
        .filter((t) => flowerTableIds.includes(t.id))
        .map((t) => t.name) || [];
    return {
      roomName: room?.name || "",
      bayName: bay?.name || "",
      tableNames,
    };
  }

  async function save() {
    if (isSavingTask) return;
    if (!canWriteRecords) {
      showReadOnlyNotice();
      return;
    }

    if (!selectedBatch) return;
    setIsSavingTask(true);

    const taskRequiredFields: { label: string; value: any; positive?: boolean; zeroOrPositive?: boolean }[] = [
      { label: "People", value: people },
      { label: "Minutes", value: minutes, positive: true },
    ];

    if (selectedTask === "Clone → Veg") {
      taskRequiredFields.push({ label: "Plants Moved to Veg", value: output, positive: true });
      if (cultivationRooms.vegRooms.length > 0) {
        taskRequiredFields.push({ label: "Veg room", value: vegRoomId });
      }
    }

    if (selectedTask === "Move to Flower") {
      taskRequiredFields.push(
        { label: "Plants Moved to Flower", value: output, positive: true },
        { label: "Flower room (configure under Admin → Company Config if empty)", value: flowerRoomId }
      );
      const flowerRoomObj = cultivationRooms.flowerRooms.find((r) => r.id === flowerRoomId);
      if (flowerRoomObj && flowerRoomObj.bays.length > 0) {
        taskRequiredFields.push({ label: "Flower bay", value: flowerBayId });
        const bayObj = flowerRoomObj.bays.find((b) => b.id === flowerBayId);
        if (bayObj && bayObj.tables.length > 0) {
          taskRequiredFields.push({
            label: "Flower table(s)",
            value: flowerTableIds.length > 0 ? flowerTableIds.join(",") : "",
          });
        }
      }
    }

    if (!requireFieldsStyled(taskRequiredFields)) {
      setIsSavingTask(false);
      return;
    }

    if (!confirmRepeatTask(selectedBatch.id, selectedTask, save)) {
      setIsSavingTask(false);
      return;
    }

    if (selectedTask === "Harvest") {
      saveHarvest();
      setIsSavingTask(false);
      return;
    }

    let taskOutput = output;
    let logRoom: string | undefined;
    let logBay: string | undefined;
    let logTables: string[] | undefined;

    if (selectedTask === "Clone → Veg") {
      const vegLabel =
        cultivationRooms.vegRooms.find((v) => v.id === vegRoomId)?.name || "—";
      taskOutput = `${output} plants moved to Veg | Veg room: ${vegLabel}`;
    }

    if (selectedTask === "Move to Flower") {
      const fl = resolveFlowerSelectionLabels();
      taskOutput = `${output || selectedBatch.plants || 0} plants moved to Flower | Room: ${fl.roomName || "—"} | Bay: ${fl.bayName || "—"} | Tables: ${fl.tableNames.length ? fl.tableNames.join(", ") : "—"}`;
      logRoom = fl.roomName;
      logBay = fl.bayName;
      logTables = fl.tableNames.length ? [...fl.tableNames] : undefined;
    }

    s.logs.unshift(withLoggedBy({
      area: "Cultivation",
      batch: selectedBatch.id,
      task: selectedTask,
      people,
      minutes,
      output: taskOutput,
      room: logRoom,
      bay: logBay,
      tables: logTables,
      time: nowIsoForLog(),
    }))

    if (selectedTask === "Clone → Veg") {
      selectedBatch.stage = "Veg";
      selectedBatch.plants = Number(output || selectedBatch.plants || 0);
      selectedBatch.vegRoom = cultivationRooms.vegRooms.find((v) => v.id === vegRoomId)?.name || "";
      setSelectedTask("Set Irrigation Up");
    }

    if (selectedTask === "Move to Flower") {
      const fl = resolveFlowerSelectionLabels();
      selectedBatch.stage = "Flower";
      const movedPlants = Number(output || selectedBatch.plants || 0);
      selectedBatch.plants = movedPlants;
      selectedBatch.plantsAtFlower = movedPlants;
      selectedBatch.flowerRoomId = flowerRoomId;
      selectedBatch.flowerBayId = flowerBayId;
      selectedBatch.flowerTableIds = [...flowerTableIds];
      selectedBatch.flowerRoom = fl.roomName;
      selectedBatch.flowerBay = fl.bayName;
      selectedBatch.flowerTables = [...fl.tableNames];
      if (selectedBatch.plantsHarvestedDry === undefined || selectedBatch.plantsHarvestedDry === "") {
        selectedBatch.plantsHarvestedDry = 0;
      }
      if (
        selectedBatch.plantsHarvestedFreshFrozen === undefined ||
        selectedBatch.plantsHarvestedFreshFrozen === ""
      ) {
        selectedBatch.plantsHarvestedFreshFrozen = 0;
      }
      recomputeDryCanopyForCultivationBatch(selectedBatch, cultivationRooms);
      setSelectedTask("Set Irrigation Up");
    }

    setPeople("");
    setMinutes("");
    setOutput("");
    primeTaskModalLocationFields(cultivationRooms);
    setShowTaskWindow(false);
    forceRefresh();
    try {
      showSyncMessageNotice("Task saved locally. Syncing to server...");
      const synced = await saveRealCultivationBatch(selectedBatch);
      showSyncMessageNotice(synced ? "Task synced to server." : "Task saved locally — server sync failed (check connectivity).");
    } finally {
      setIsSavingTask(false);
    }
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

  const stageCardsWrapStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 12,
    marginTop: 10,
  } as const;


  return (
    <PageAccessGate permission="page.cultivation">
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

        <section style={cardStyle}>
          <h3 style={sectionTitleStyle}>Active Cultivation Batches</h3>

          {activeBatches.length === 0 ? (
            <p style={{ textAlign: "center", color: "#cbd5e1" }}>No active cultivation batches.</p>
          ) : (
            <div style={stageCardsWrapStyle}>
              {stageOrder.map((stageName) => (
                <button
                  key={stageName}
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
                    border: "1px solid #334155",
                  }}
                  onClick={() => setSelectedStage(stageName)}
                >
                  <span style={{ fontWeight: 900, fontSize: 16 }}>{stageName}</span>
                  <span style={{ color: "#cbd5e1", fontWeight: 700 }}>
                    {activeBatchesByStage[stageName].length} Batches
                  </span>
                  <span style={{ color: "#93c5fd", fontWeight: 700 }}>
                    {stagePlantTotals[stageName]} Amount of plants
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

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
                  Status: {b.status} | Test: {b.testStatus || "Not Submitted"} | Whole plant (buck):{" "}
                  {getBuckWholePlantLbs(b) || "—"} lbs | Stem waste:{" "}
                  {b.buckStemWasteLbs !== undefined && b.buckStemWasteLbs !== "" ? b.buckStemWasteLbs : "—"} lbs | A
                  Grade: {b.trimmedWeightLbs || "—"} lbs | Popcorn: {b.popcornWeightLbs || "—"} lbs | Trim (total):{" "}
                  {b.totalTrimLbs || "—"} lbs
                  {num(b.trimFromBuckLbs) > 0 ? ` (incl. ${num(b.trimFromBuckLbs)} from buck)` : ""} | Decon:{" "}
                  {b.deconWeightLbs || "—"} lbs | Packaged:{" "}
                  {b.packagedWeightLbs || 0} lbs | Remaining:{" "}
                  {b.remainingPackableLbs === "" ? "—" : b.remainingPackableLbs} lbs | A Grade Available: {getDryFlowerPackagingAvailability(b).remainingAGradeLbs} lbs | Popcorn Available: {getDryFlowerPackagingAvailability(b).remainingPopcornLbs} lbs | Final A Grade (cum. packaged):{" "}
                  {fmtDryFlowerCumulativePackedLbs(b.finalAGradeFlowerLbs)} lbs | Final Popcorn (cum. packaged): {fmtDryFlowerCumulativePackedLbs(b.finalPopcornLbs)} lbs
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

          {selectedDryFlowerBatch && selectedDryFlowerBatch.status !== "Complete" && (
            <div style={{ marginTop: 16, textAlign: "center" }}>
              <p>
                Selected Dry Batch: <b>{selectedDryFlowerBatch.id}</b>
              </p>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                {dryFlowerTasks.map((task) => (
                  <button
                    key={task}
                    onClick={() => {
                      setSelectedDryFlowerTask(task);
                      if (task === "Testing" && selectedDryFlowerBatch) {
                        const ts = selectedDryFlowerBatch.testStatus;
                        if (!ts || ts === "Not Submitted") {
                          setDryTestingDateSubmitted(new Date().toISOString().slice(0, 10));
                          setDryTestingSelectedTests([]);
                        }
                      }
                    }}
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
                    {b.vegRoom && (
                      <>
                        <br />
                        Veg room: {b.vegRoom}
                      </>
                    )}
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

      {selectedStage && (
        <div style={modalOverlayStyle}>
          <div style={modalStyle}>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
              <button style={buttonStyle} onClick={() => setSelectedStage(null)}>
                Close
              </button>
            </div>
            <h2 style={{ textAlign: "center", marginTop: 0 }}>
              {selectedStage} Batches ({selectedStageBatches.length})
            </h2>

            {selectedStageBatches.length === 0 ? (
              <p style={{ textAlign: "center", color: "#cbd5e1" }}>No batches in this stage.</p>
            ) : (
              selectedStageBatchesOldestFirst.map((b: any) => (
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
                    {b.stage === "Veg" && b.vegRoom && (
                      <>
                        <br />
                        Veg room: {b.vegRoom}
                      </>
                    )}
                    {b.stage === "Flower" && (b.flowerRoom || b.flowerBay || b.flowerTable || b.flowerTables) && (
                      <>
                        <br />
                        Room: {b.flowerRoom || "—"} | Bay: {b.flowerBay || "—"} | Tables: {formatFlowerTables(b)}
                      </>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {canWriteRecords ? (
                      <button
                        style={{
                          ...buttonStyle,
                          background: "#2563eb",
                          border: "1px solid #3b82f6",
                          color: "white",
                        }}
                        onClick={() => openTaskWindowForBatch(b)}
                      >
                        Tasks
                      </button>
                    ) : null}
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

            <div style={modalButtonRowStyle}>
              <button style={buttonStyle} onClick={() => setSelectedStage(null)}>
                Close
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
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                {currentTasks.length === 0 ? (
                  <p style={{ color: "#cbd5e1", margin: 0 }}>No tasks available for this stage.</p>
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

              {selectedTask === "Clone → Veg" && cultivationRooms.vegRooms.length > 0 && (
                <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                  Veg destination
                  <select
                    style={inputStyle}
                    value={vegRoomId}
                    onChange={(e) => setVegRoomId(e.target.value)}
                  >
                    {cultivationRooms.vegRooms.map((room) => (
                      <option key={room.id} value={room.id}>
                        {room.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {selectedTask === "Move to Flower" && (
                <>
                  {cultivationRooms.flowerRooms.length === 0 ? (
                    <p style={{ color: "#fbbf24", fontSize: 14, margin: 0, lineHeight: 1.5 }}>
                      No flower rooms are configured yet. An Admin can add them under{" "}
                      <strong style={{ color: "#fef08a" }}>Admin → Company Config → Cultivation → Flower rooms</strong>.
                    </p>
                  ) : (
                    <>
                      <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                        Flower room
                        <select
                          style={inputStyle}
                          value={flowerRoomId}
                          onChange={(e) => {
                            const id = e.target.value;
                            setFlowerRoomId(id);
                            const room = cultivationRooms.flowerRooms.find((r) => r.id === id);
                            const b0 = room?.bays?.[0];
                            setFlowerBayId(b0?.id || "");
                            setFlowerTableIds([]);
                          }}
                        >
                          {cultivationRooms.flowerRooms.map((room) => (
                            <option key={room.id} value={room.id}>
                              {room.name}
                            </option>
                          ))}
                        </select>
                      </label>

                      {(() => {
                        const flowerRoomObj = cultivationRooms.flowerRooms.find((r) => r.id === flowerRoomId);
                        const bayObj = flowerRoomObj?.bays?.find((b) => b.id === flowerBayId);
                        return (
                          <>
                            {flowerRoomObj && flowerRoomObj.bays.length > 0 ? (
                              <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                                Bay
                                <select
                                  style={inputStyle}
                                  value={flowerBayId}
                                  onChange={(e) => {
                                    setFlowerBayId(e.target.value);
                                    setFlowerTableIds([]);
                                  }}
                                >
                                  {flowerRoomObj.bays.map((bay) => (
                                    <option key={bay.id} value={bay.id}>
                                      Bay {bay.name}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            ) : (
                              <p style={{ color: "#94a3b8", fontSize: 13, margin: 0 }}>
                                This flower room has no bays yet—add bays in Company Config.
                              </p>
                            )}

                            {bayObj && bayObj.tables.length > 0 ? (
                              <div style={{ ...inputStyle, display: "grid", gap: 8 }}>
                                <b>Tables</b>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                  {bayObj.tables.map((table) => (
                                    <label
                                      key={table.id}
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 6,
                                        border: "1px solid #334155",
                                        borderRadius: 10,
                                        padding: "8px 10px",
                                        background: flowerTableIds.includes(table.id) ? "#22c55e" : "#1e293b",
                                        color: flowerTableIds.includes(table.id) ? "black" : "white",
                                        cursor: "pointer",
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={flowerTableIds.includes(table.id)}
                                        onChange={() => toggleFlowerTableId(table.id)}
                                      />
                                      Table {table.name}
                                    </label>
                                  ))}
                                </div>
                              </div>
                            ) : flowerRoomObj && flowerRoomObj.bays.length > 0 ? (
                              <p style={{ color: "#94a3b8", fontSize: 13, margin: 0 }}>
                                No tables in this bay—add tables in Company Config.
                              </p>
                            ) : null}
                          </>
                        );
                      })()}
                    </>
                  )}
                </>
              )}

              <input style={inputStyle} placeholder="People" value={people} onChange={(e) => setPeople(e.target.value)} />
              <input style={inputStyle} placeholder="Minutes" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            </div>

            <div style={modalButtonRowStyle}>
              <button style={buttonStyle} onClick={() => setShowTaskWindow(false)}>
                Cancel
              </button>
              <button style={primaryButtonStyle} onClick={save} disabled={isSavingTask}>
                {isSavingTask ? "Saving..." : "Save Task to Batch"}
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
              {dryTaskPrereqMessage(selectedDryFlowerTask, selectedDryFlowerBatch) ? (
                <p style={{ color: "#fbbf24", fontSize: 14, margin: 0, lineHeight: 1.5 }}>
                  {dryTaskPrereqMessage(selectedDryFlowerTask, selectedDryFlowerBatch)}
                </p>
              ) : null}
              <input style={inputStyle} placeholder="People" value={dryPeople} onChange={(e) => setDryPeople(e.target.value)} />
              <input style={inputStyle} placeholder="Minutes" value={dryMinutes} onChange={(e) => setDryMinutes(e.target.value)} />

              {selectedDryFlowerTask === "Bucking" ? (
                <>
                  <input
                    style={inputStyle}
                    placeholder="Whole plant weight (to trim), lbs"
                    value={dryBuckWholePlant}
                    onChange={(e) => setDryBuckWholePlant(e.target.value)}
                  />
                  <input
                    style={inputStyle}
                    placeholder="Stem / waste weight, lbs (0 if none)"
                    value={dryBuckStemWaste}
                    onChange={(e) => setDryBuckStemWaste(e.target.value)}
                  />
                  <p style={{ color: "#94a3b8", fontSize: 13, margin: 0 }}>
                    Buck: separate floral whole-plant mass (sent to trim) from stems/waste. Waste is logged with this
                    entry.
                  </p>
                </>
              ) : selectedDryFlowerTask === "Trimming" ? (
                <>
                  <div
                    style={{
                      ...inputStyle,
                      display: "grid",
                      gap: 6,
                      background: "#111827",
                    }}
                  >
                    <b>Whole plant cap (from bucking)</b>
                    <span>Whole plant to process: {getBuckWholePlantLbs(selectedDryFlowerBatch) || "—"} lbs</span>
                    <span style={{ color: "#94a3b8", fontSize: 13 }}>
                      A-grade + popcorn + <b>trim from trimming</b> cannot exceed this weight. Trim separated at bucking
                      is entered below and is <b>not</b> part of this cap; it is added to total trim for extraction.
                    </span>
                  </div>
                  <input style={inputStyle} placeholder="Total A Grade Flower in lbs" value={dryOutput} onChange={(e) => setDryOutput(e.target.value)} />
                  <input style={inputStyle} placeholder="Total Popcorn in lbs" value={dryPopcornWeight} onChange={(e) => setDryPopcornWeight(e.target.value)} />
                  <input
                    style={inputStyle}
                    placeholder="Trim from trimming (lbs)"
                    value={dryTrimWeight}
                    onChange={(e) => setDryTrimWeight(e.target.value)}
                  />
                  <div
                    style={{
                      ...inputStyle,
                      display: "grid",
                      gap: 8,
                      background: "#0f172a",
                      border: "1px solid #334155",
                    }}
                  >
                    <b style={{ color: "#93c5fd" }}>Trim from bucking</b>
                    <span style={{ color: "#94a3b8", fontSize: 13, margin: 0 }}>
                      Leaf or sugar-leaf trim removed during buck (does not count against whole-plant weight). It is
                      combined with trim from trimming for the dry-trim extraction batch.
                    </span>
                    <input
                      style={{ ...inputStyle, margin: 0 }}
                      placeholder="Trim from bucking (lbs, 0 if none)"
                      value={dryTrimFromBucking}
                      onChange={(e) => setDryTrimFromBucking(e.target.value)}
                    />
                    <span style={{ color: "#cbd5e1", fontSize: 13 }}>
                      Total trim to extraction:{" "}
                      <b>{(num(dryTrimWeight) + num(dryTrimFromBucking)).toFixed(2)} lbs</b>
                    </span>
                  </div>
                </>
              ) : selectedDryFlowerTask === "Decontamination" ? (
                <>
                  <div
                    style={{
                      ...inputStyle,
                      display: "grid",
                      gap: 8,
                      background: "#111827",
                    }}
                  >
                    <b>Available for decontamination</b>
                    <span>A-grade (pre-decon): {num(selectedDryFlowerBatch.trimmedWeightLbs).toFixed(2)} lbs</span>
                    <span>Popcorn (pre-decon): {num(selectedDryFlowerBatch.popcornWeightLbs).toFixed(2)} lbs</span>
                    <span style={{ color: "#94a3b8" }}>
                      Trim to extraction: {num(selectedDryFlowerBatch.totalTrimLbs).toFixed(2)} lbs (not sent through
                      decon)
                    </span>
                    <span>
                      <b>Total flower mass for decon (A + popcorn):</b>{" "}
                      {getPreDeconFlowerLbs(selectedDryFlowerBatch).toFixed(2)} lbs
                    </span>
                  </div>
                  <input
                    style={inputStyle}
                    placeholder="Decon output weight in lbs"
                    value={dryOutput}
                    onChange={(e) => setDryOutput(e.target.value)}
                  />
                </>
              ) : selectedDryFlowerTask === "Testing" ? (
                <>
                  {selectedDryFlowerBatch.testStatus === "Submitted to Testing" ? (
                    <>
                      <p style={{ color: "#cbd5e1", margin: 0 }}>
                        Lab results are back. Record <b>pass</b> (you will enter lab THC % next) or <b>fail</b>.
                      </p>
                      <p style={{ color: "#94a3b8", fontSize: 13, margin: 0 }}>
                        Submitted tests: {(selectedDryFlowerBatch.dryTestingTestsReceived || []).join(", ") || "—"} | Date:{" "}
                        {selectedDryFlowerBatch.dryTestingDateSubmitted || "—"}
                      </p>
                      <div
                        style={{
                          display: "flex",
                          gap: 10,
                          flexWrap: "wrap",
                          justifyContent: "center",
                          marginTop: 8,
                        }}
                      >
                        <button
                          type="button"
                          style={primaryButtonStyle}
                          onClick={() => {
                            setShowDryTaskWindow(false);
                            setTestPassModalBatch(selectedDryFlowerBatch);
                            setTestPassThcPct("");
                            setTestPassResultDate(new Date().toISOString().slice(0, 10));
                            setTestPassPotencyNote("");
                          }}
                        >
                          Passed — enter lab THC %
                        </button>
                        <button
                          type="button"
                          style={buttonStyle}
                          onClick={() => {
                            setShowDryTaskWindow(false);
                            setFailBatch(selectedDryFlowerBatch);
                          }}
                        >
                          Failed
                        </button>
                      </div>
                    </>
                  ) : selectedDryFlowerBatch.testStatus === "Test Passed" ||
                    selectedDryFlowerBatch.testStatus === "Test Failed" ? (
                    <p style={{ color: "#94a3b8", margin: 0 }}>
                      Testing is complete for this batch ({selectedDryFlowerBatch.testStatus}).
                    </p>
                  ) : (
                    <>
                      <p style={{ color: "#94a3b8", fontSize: 14, margin: 0 }}>
                        Select tests submitted to the lab (same panel as extraction). Save logs labor and sends the batch
                        to testing.
                      </p>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: 8,
                        }}
                      >
                        {dryFlowerTestingOptions.map((test) => (
                          <button
                            type="button"
                            key={test}
                            style={{
                              ...buttonStyle,
                              background: dryTestingSelectedTests.includes(test) ? "#22c55e" : "#334155",
                              color: dryTestingSelectedTests.includes(test) ? "black" : "white",
                            }}
                            onClick={() => toggleDryFlowerTestOption(test)}
                          >
                            {test}
                          </button>
                        ))}
                      </div>
                      <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                        Date submitted to lab
                        <input
                          style={inputStyle}
                          type="date"
                          value={dryTestingDateSubmitted}
                          onChange={(e) => setDryTestingDateSubmitted(e.target.value)}
                        />
                      </label>
                    </>
                  )}
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
                    selectedDryFlowerTask === "Burping" ? "Output / notes (optional)" : "Output / notes"
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
              <button
                style={primaryButtonStyle}
                onClick={saveDryFlowerTask}
                disabled={
                  isSavingDryTask ||
                  (selectedDryFlowerTask === "Testing" &&
                    (selectedDryFlowerBatch.testStatus === "Submitted to Testing" ||
                      selectedDryFlowerBatch.testStatus === "Test Passed" ||
                      selectedDryFlowerBatch.testStatus === "Test Failed"))
                }
              >
                {isSavingDryTask ? "Saving..." : "Save Dry Flower Task"}
              </button>
            </div>
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
            border: "1px solid rgba(34, 197, 94, 0.55)",
            color: "#bbf7d0",
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
                    <div>Time: {formatLogDisplayTime(log)}</div>
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

      {testPassModalBatch && (
        <div style={{ ...modalOverlayStyle, zIndex: 10000 }}>
          <div
            style={{
              ...modalStyle,
              maxWidth: 500,
              border: "1px solid #22c55e",
            }}
          >
            <h2 style={{ textAlign: "center", marginTop: 0 }}>
              Test passed — lab THC %
            </h2>
            <p style={{ textAlign: "center", color: "#cbd5e1" }}>
              Batch <b>{testPassModalBatch.id}</b>. Enter final lab THC % (numeric). This updates strain analytics and
              company config rollups.
            </p>
            <input
              type="number"
              step="0.01"
              min={0}
              max={50}
              placeholder="e.g. 24.5 (max 50)"
              value={testPassThcPct}
              onChange={(e) => setTestPassThcPct(e.target.value)}
              style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
            />
            <label style={{ display: "block", marginTop: 12, color: "#94a3b8", fontSize: 13 }}>
              Lab result date
              <input
                type="date"
                value={testPassResultDate}
                onChange={(e) => handleTestPassResultDateChange(e.target.value)}
                style={{ ...inputStyle, width: "100%", boxSizing: "border-box", marginTop: 6 }}
              />
            </label>
            <label style={{ display: "block", marginTop: 12, color: "#94a3b8", fontSize: 13 }}>
              Optional note
              <textarea
                placeholder="Lab sample id, COA reference, etc."
                value={testPassPotencyNote}
                onChange={(e) => setTestPassPotencyNote(e.target.value)}
                style={{ ...inputStyle, width: "100%", boxSizing: "border-box", minHeight: 72, marginTop: 6 }}
              />
            </label>
            <div style={modalButtonRowStyle}>
              <button
                style={buttonStyle}
                onClick={() => {
                  setTestPassModalBatch(null);
                  setTestPassThcPct("");
                  setTestPassResultDate("");
                  setTestPassPotencyNote("");
                }}
              >
                Cancel
              </button>
              <button
                style={primaryButtonStyle}
                onClick={() => {
                  void applyDryFlowerTestPassed(
                    testPassModalBatch,
                    Number(testPassThcPct),
                    testPassPotencyNote,
                    testPassResultDate,
                  );
                }}
              >
                Save and mark passed
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
