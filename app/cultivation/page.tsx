"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Nav from "@/components/Nav";
import PageAccessGate from "@/components/PageAccessGate";
import {
  canDeleteRecords as userCanDeleteWorkflow,
  canManageCultivationBatchPlacement,
  hasMinimumRole,
} from "@/lib/permissions";
import { store } from "@/lib/store";
import {
  CPU_AUTH_CHANGED_EVENT,
  CPU_AUTH_USER_STORAGE_KEY,
  displayNameFromLogActor,
  getAuthDisplayName,
  getAuthUser,
} from "@/lib/auth";
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
import { resolveAbsorbedPlantsAndStageForUncombine } from "@/lib/cultivationMergeHelpers";
import { apiRequest, API_BASE_URL } from "@/lib/api";
import { extractHarvestSheet, uploadHarvestSheetImage } from "@/lib/harvestSheetApi";
import { fileToBase64DataUrl, shrinkHarvestSheetImageFileIfLarge } from "@/lib/shrinkHarvestSheetImage";
import { createSourceBatch } from "@/lib/sourceBatchApi";
import { createLog, deleteLog as deleteTaskLogRemote, getAllLogs } from "@/lib/logsApi";
import {
  formatLogDisplayTime,
  getCompanyDisplayTimezone,
  getTodayYmdInCompanyTimezone,
  logTimeIsoForStageMoveDate,
  nowIsoForLog,
  syncCompanyTimezoneFromConfigPayload,
} from "@/lib/companyTimezone";
import {
  computeAllocatedDryCanopySqFt,
  computeDryYieldGPerSqFt,
  isElevatedManagerRole,
  sumTableSquareFeetFromIds,
} from "@cpu/shared";
import { extractRewardsFromCompanyConfig } from "@/lib/rewardsConfig";
import {
  extractCustomTasksRewardDefsFromCompanyConfig,
  mergeCultivationTasksForStage,
  resolveConfigurableTaskRewards,
  type CustomTasksRewardDefs,
} from "@/lib/customTasksConfig";
import { computeAverageNormalizedMinutes, scoreChallengeByLoggedMinutes } from "@/lib/taskChallengeMath";
import {
  type LaborBreakWindow,
  computeLaborRangeDeduction,
  normalizeLaborBreaksFromConfig,
} from "@/lib/laborBreaks";
import { sortStrainsAlphabetically } from "@/lib/sortStrainsAlphabetically";
import {
  buildMetrcVegMovePayload,
  collectExistingPlantTagsFromCultivationBatches,
  findOverlappingTags,
  generateMetrcTagSequence,
  isMoveToVegTaskName,
  sumImmatureAvailableExcluding,
  type MetrcImmatureSyncStatus,
  TASK_CREATE_IMMATURE_PLANT_BATCH,
  TASK_MOVE_TO_VEG_ASSIGN_TAGS,
} from "@/lib/cultivationMetrcWorkflow";

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

/** Same structure as flower — bays and tables from Company Config. */
type CultivationVegRoom = CultivationFlowerRoom;

type CultivationRoomsConfig = {
  vegRooms: CultivationVegRoom[];
  flowerRooms: CultivationFlowerRoom[];
};

type StageModalKey = null | "Clones" | "Veg" | "Flower";

function stageBucketFromBatchStage(stage: unknown): Exclude<StageModalKey, null> {
  const value = String(stage || "").trim().toLowerCase();
  if (value === "clone" || value === "clones") return "Clones";
  if (value === "veg") return "Veg";
  return "Flower";
}

const STAGE_MODAL_UNASSIGNED_ROOM_ID = "__unassigned_room__";
const STAGE_MODAL_UNASSIGNED_BAY_ID = "__unassigned_bay__";
const STAGE_MODAL_UNASSIGNED_TABLE_KEY = "__unassigned_table__";

function resolveVegRoomIdForBatch(batch: any, vegRooms: CultivationVegRoom[]): string {
  const id = String(batch?.vegRoomId || "").trim();
  if (id && vegRooms.some((r) => r.id === id)) return id;
  const name = String(batch?.vegRoom || "").trim();
  if (name) {
    const byName = vegRooms.find((r) => r.name === name);
    if (byName?.id) return byName.id;
  }
  return STAGE_MODAL_UNASSIGNED_ROOM_ID;
}

function resolveFlowerRoomIdForBatch(batch: any, flowerRooms: CultivationFlowerRoom[]): string {
  const id = String(batch?.flowerRoomId || "").trim();
  if (id && flowerRooms.some((r) => r.id === id)) return id;
  const name = String(batch?.flowerRoom || "").trim();
  if (name) {
    const byName = flowerRooms.find((r) => r.name === name);
    if (byName?.id) return byName.id;
  }
  return STAGE_MODAL_UNASSIGNED_ROOM_ID;
}

function resolveVegBayIdForBatch(batch: any, room: CultivationVegRoom | undefined): string {
  const id = String(batch?.vegBayId || "").trim();
  if (id && room?.bays?.some((b) => b.id === id)) return id;
  const name = String(batch?.vegBay || "").trim();
  if (name && room?.bays?.length) {
    const byName = room.bays.find((b) => b.name === name);
    if (byName?.id) return byName.id;
  }
  return STAGE_MODAL_UNASSIGNED_BAY_ID;
}

function resolveFlowerBayIdForBatch(batch: any, room: CultivationFlowerRoom | undefined): string {
  const id = String(batch?.flowerBayId || "").trim();
  if (id && room?.bays?.some((b) => b.id === id)) return id;
  const name = String(batch?.flowerBay || "").trim();
  if (name && room?.bays?.length) {
    const byName = room.bays.find((b) => b.name === name);
    if (byName?.id) return byName.id;
  }
  return STAGE_MODAL_UNASSIGNED_BAY_ID;
}

function vegTableGroupKey(batch: any): string {
  const fromIds = Array.isArray(batch?.vegTableIds)
    ? batch.vegTableIds.map((x: unknown) => String(x || "").trim()).filter(Boolean)
    : [];
  if (fromIds.length > 0) return [...fromIds].sort().join("\u0001");
  const fromArr = Array.isArray(batch?.vegTables)
    ? batch.vegTables.map((x: unknown) => String(x || "").trim()).filter(Boolean)
    : [];
  if (fromArr.length > 0) return [...fromArr].sort().join("\u0001");
  const single = String(batch?.vegTable || "").trim();
  return single ? single : STAGE_MODAL_UNASSIGNED_TABLE_KEY;
}

function flowerTableGroupKey(batch: any): string {
  const fromIds = Array.isArray(batch?.flowerTableIds)
    ? batch.flowerTableIds.map((x: unknown) => String(x || "").trim()).filter(Boolean)
    : [];
  if (fromIds.length > 0) return [...fromIds].sort().join("\u0001");
  const fromArr = Array.isArray(batch?.flowerTables)
    ? batch.flowerTables.map((x: unknown) => String(x || "").trim()).filter(Boolean)
    : [];
  if (fromArr.length > 0) return [...fromArr].sort().join("\u0001");
  const single = String(batch?.flowerTable || "").trim();
  return single ? single : STAGE_MODAL_UNASSIGNED_TABLE_KEY;
}

function tableGroupLabelFromKey(
  bay: CultivationBayConfig | undefined,
  tableKey: string,
): string {
  if (tableKey === STAGE_MODAL_UNASSIGNED_TABLE_KEY) return "Unassigned table";
  const parts = tableKey.split("\u0001");
  if (!bay?.tables?.length) return parts.join(", ");
  return parts
    .map((id) => bay.tables.find((t) => t.id === id)?.name || id)
    .join(", ");
}

type StageModalBayTableGroup = {
  bayId: string;
  bayLabel: string;
  tableKey: string;
  tableLabel: string;
  batches: any[];
};

function buildCultivationStageModalBayTableGroups(
  batches: any[],
  selectedStage: "Veg" | "Flower",
  room: CultivationFlowerRoom | undefined,
): StageModalBayTableGroup[] {
  const kind = selectedStage === "Veg" ? "veg" : "flower";
  const nested = new Map<string, Map<string, any[]>>();
  for (const b of batches) {
    const bayId =
      kind === "veg" ? resolveVegBayIdForBatch(b, room) : resolveFlowerBayIdForBatch(b, room);
    const tableKey =
      kind === "veg" ? vegTableGroupKey(b) : flowerTableGroupKey(b);
    if (!nested.has(bayId)) nested.set(bayId, new Map());
    const tm = nested.get(bayId)!;
    if (!tm.has(tableKey)) tm.set(tableKey, []);
    tm.get(tableKey)!.push(b);
  }
  const bayOrder = (room?.bays || []).map((bay) => bay.id);
  const sortedBayIds = [...nested.keys()].sort((a, b) => {
    const ua = a === STAGE_MODAL_UNASSIGNED_BAY_ID ? 1 : 0;
    const ub = b === STAGE_MODAL_UNASSIGNED_BAY_ID ? 1 : 0;
    if (ua !== ub) return ua - ub;
    const ia = bayOrder.indexOf(a);
    const ib = bayOrder.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  });
  const out: StageModalBayTableGroup[] = [];
  for (const bayId of sortedBayIds) {
    const bayObj =
      bayId === STAGE_MODAL_UNASSIGNED_BAY_ID
        ? undefined
        : room?.bays?.find((x) => x.id === bayId);
    const bayLabel =
      bayId === STAGE_MODAL_UNASSIGNED_BAY_ID ? "Unassigned bay" : bayObj?.name || bayId || "Bay";
    const tableMap = nested.get(bayId)!;
    const tableKeys = [...tableMap.keys()].sort((tkA, tkB) =>
      tableGroupLabelFromKey(bayObj, tkA).localeCompare(
        tableGroupLabelFromKey(bayObj, tkB),
        undefined,
        { sensitivity: "base" },
      ),
    );
    for (const tableKey of tableKeys) {
      out.push({
        bayId,
        bayLabel,
        tableKey,
        tableLabel: tableGroupLabelFromKey(bayObj, tableKey),
        batches: tableMap.get(tableKey) || [],
      });
    }
  }
  return out;
}

const emptyCultivationRooms: CultivationRoomsConfig = { vegRooms: [], flowerRooms: [] };

function normalizeCultivationRoomLayouts(rawRooms: unknown): CultivationFlowerRoom[] {
  if (!Array.isArray(rawRooms)) return [];
  return rawRooms.map((item: unknown) => {
    const r = item as Record<string, unknown>;
    return {
      id: String(r?.id ?? ""),
      name: String(r?.name ?? ""),
      bays: Array.isArray(r?.bays)
        ? (r.bays as unknown[]).map((bayItem: unknown) => {
            const bay = bayItem as Record<string, unknown>;
            return {
              id: String(bay?.id ?? ""),
              name: String(bay?.name ?? ""),
              tables: Array.isArray(bay?.tables)
                ? (bay.tables as unknown[]).map((tItem: unknown) => {
                    const t = tItem as Record<string, unknown>;
                    return {
                      id: String(t?.id ?? ""),
                      name: String(t?.name ?? ""),
                      squareFeet: t?.squareFeet != null ? String(t.squareFeet) : "",
                    };
                  })
                : [],
            };
          })
        : [],
    };
  });
}

function pickCultivationRoomsFromConfigPayload(data: {
  cultivation?: { rooms?: unknown };
}): CultivationRoomsConfig {
  const rooms = data?.cultivation?.rooms;
  if (!rooms || typeof rooms !== "object" || Array.isArray(rooms)) {
    return { ...emptyCultivationRooms };
  }
  const r = rooms as Record<string, unknown>;
  const vegRooms = normalizeCultivationRoomLayouts(r.vegRooms);
  const flowerRooms = normalizeCultivationRoomLayouts(r.flowerRooms);
  return { vegRooms, flowerRooms };
}

const defaultCloneTasks = [
  "Maintenance",
  "Feed",
  "Burp",
  "Fill Pots",
  "Combine Batches",
  TASK_CREATE_IMMATURE_PLANT_BATCH,
  TASK_MOVE_TO_VEG_ASSIGN_TAGS,
];

const defaultVegTasks = [
  "Set Irrigation Up",
  "Plant Work",
  "Add METRC Tags",
  "IPM",
  "Combine Batches",
  "Move to Flower",
];

const defaultFlowerTasks = [
  "Set Irrigation Up",
  "Trellis",
  "Plant Work",
  "IPM",
  "Combine Batches",
  "Print harvest sheet",
  "Harvest",
  "Finish batch",
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

function formatVegTables(batchOrTables: any) {
  const tables = Array.isArray(batchOrTables)
    ? batchOrTables
    : Array.isArray(batchOrTables?.vegTables)
      ? batchOrTables.vegTables
      : batchOrTables?.vegTable
        ? [batchOrTables.vegTable]
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

function clearVegPlacementFields(batch: any) {
  batch.vegRoomId = "";
  batch.vegBayId = "";
  batch.vegTableIds = [];
  batch.vegRoom = "";
  batch.vegBay = "";
  batch.vegTables = [];
}

function clearFlowerPlacementFields(batch: any) {
  batch.flowerRoomId = "";
  batch.flowerBayId = "";
  batch.flowerTableIds = [];
  batch.flowerRoom = "";
  batch.flowerBay = "";
  batch.flowerTables = [];
  delete batch.plantsAtFlower;
  delete batch.totalFlowerTableSqFt;
  delete batch.dryCanopySqFt;
}

function clearHarvestPlantCounters(batch: any) {
  batch.plantsHarvestedDry = 0;
  batch.plantsHarvestedFreshFrozen = 0;
}

function inferRestoreStageFromCompletedBatch(batch: any): "Clone" | "Veg" | "Flower" | "Partially Harvested" {
  if (num(batch.plantsHarvestedDry) > 0 || num(batch.plantsHarvestedFreshFrozen) > 0) {
    return "Partially Harvested";
  }
  if (batch.flowerRoomId || batch.flowerRoom) return "Flower";
  if (batch.vegRoomId || batch.vegRoom) return "Veg";
  return "Clone";
}

export type CultivationRevertInfo = { targetStage: string; summary: string };

function getCultivationRevertInfo(batch: any): CultivationRevertInfo | null {
  const st = String(batch?.stage || "").trim();
  if (st === "Clone") return null;
  if (st === "Veg") {
    return {
      targetStage: "Clone",
      summary: "Send back to Clone — veg room/bay/tables are cleared. Plant count is unchanged.",
    };
  }
  if (st === "Flower") {
    return {
      targetStage: "Veg",
      summary: "Send back to Veg — flower placement is cleared. Veg placement is kept.",
    };
  }
  if (st === "Partially Harvested" || st === "Harvested") {
    return {
      targetStage: "Flower",
      summary:
        "Send back to Flower — harvest plant counters on this batch are reset. Confirm plant counts afterward.",
    };
  }
  if (st === "Complete") {
    const ts = inferRestoreStageFromCompletedBatch(batch);
    return {
      targetStage: ts,
      summary: `Re-open as active ${ts} (removed from completed list).`,
    };
  }
  return null;
}

function applyCultivationRevertMutation(batch: any, targetStage: string, fromStage: string) {
  batch.status = "Active";
  batch.stage = targetStage;
  if (fromStage === "Complete") {
    delete batch.completedAt;
  }

  if (targetStage === "Partially Harvested") {
    return;
  }
  if (targetStage === "Clone") {
    clearVegPlacementFields(batch);
    clearFlowerPlacementFields(batch);
    clearHarvestPlantCounters(batch);
    delete batch.splitSourceBatchId;
  } else if (targetStage === "Veg") {
    clearFlowerPlacementFields(batch);
    clearHarvestPlantCounters(batch);
  } else if (targetStage === "Flower") {
    clearHarvestPlantCounters(batch);
  }
}

function promoteCompletedCultivationBatchToActive(store: any, batch: any) {
  const list = store.completedCultivationBatches || [];
  const ci = list.findIndex((b: any) => b?.id === batch?.id);
  if (ci >= 0) list.splice(ci, 1);
  if (!(store.cultivationBatches || []).some((b: any) => b?.id === batch?.id)) {
    store.cultivationBatches.unshift(batch);
  }
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
  const [rewardsCfg, setRewardsCfg] = useState<ReturnType<typeof extractRewardsFromCompanyConfig> | null>(null);
  const [customTasksRewardDefs, setCustomTasksRewardDefs] = useState<CustomTasksRewardDefs>(() =>
    extractCustomTasksRewardDefsFromCompanyConfig({}),
  );
  const [showRewardsChallengeModal, setShowRewardsChallengeModal] = useState(false);
  /** While the task modal is open, at most one Task challenge popup per batch+task (focus-triggered). */
  const rewardsChallengeShownKeyRef = useRef<string | null>(null);
  const [showDryTaskWindow, setShowDryTaskWindow] = useState(false);
  const [showAddTaskWindow, setShowAddTaskWindow] = useState(false);
  const [selectedStage, setSelectedStage] = useState<StageModalKey>(null);
  /** Veg/Flower stage modal: null = room picker when multiple rooms; otherwise selected room id or unassigned sentinel. */
  const [stageModalRoomId, setStageModalRoomId] = useState<string | null>(null);

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
  /** Cultivation task modal: `range` = start/end clock (minus company breaks); `total` = minutes per person (manager-only). */
  const [laborTimeMode, setLaborTimeMode] = useState<"range" | "total">("range");
  const [taskLaborDate, setTaskLaborDate] = useState("");
  const [taskStartTime, setTaskStartTime] = useState("");
  const [taskEndTime, setTaskEndTime] = useState("");
  const [laborBreakSchedule, setLaborBreakSchedule] = useState<LaborBreakWindow[]>([]);
  const [output, setOutput] = useState("");
  /** Cultivation batch id to merge into the currently selected batch (same stage grouping as Clones / Veg / Flower). */
  const [combinePartnerBatchId, setCombinePartnerBatchId] = useState("");
  /** Calendar date (YYYY-MM-DD) when Move to Veg / Assign Plant Tags or Move to Flower actually happened; defaults to facility “today”. */
  const [stageMoveDate, setStageMoveDate] = useState("");
  /** Destination veg layout (config `cultivation.rooms.vegRooms`); required when that list is non-empty. */
  const [vegRoomId, setVegRoomId] = useState("");
  const [vegBayId, setVegBayId] = useState("");
  const [vegTableIds, setVegTableIds] = useState<string[]>([]);
  /** Edit veg batch (placement + core fields); separate from task-modal veg pickers. */
  const [editVegModalBatch, setEditVegModalBatch] = useState<any>(null);
  const [editVegPlants, setEditVegPlants] = useState("");
  const [editVegStrain, setEditVegStrain] = useState("");
  const [editVegAcronym, setEditVegAcronym] = useState("");
  const [editVegCloneDate, setEditVegCloneDate] = useState("");
  const [editVegRoomId, setEditVegRoomId] = useState("");
  const [editVegBayId, setEditVegBayId] = useState("");
  const [editVegTableIds, setEditVegTableIds] = useState<string[]>([]);
  const [editVegBatchNotes, setEditVegBatchNotes] = useState("");
  const [isSavingEditVegModal, setIsSavingEditVegModal] = useState(false);
  /** Edit clone batches (strain, plants, dates, notes) — placement is N/A until Move to Veg / Assign Plant Tags. */
  const [editCloneModalBatch, setEditCloneModalBatch] = useState<any>(null);
  const [editClonePlants, setEditClonePlants] = useState("");
  const [editCloneStrain, setEditCloneStrain] = useState("");
  const [editCloneAcronym, setEditCloneAcronym] = useState("");
  const [editCloneDate, setEditCloneDate] = useState("");
  const [editCloneBatchNotes, setEditCloneBatchNotes] = useState("");
  const [isSavingEditCloneModal, setIsSavingEditCloneModal] = useState(false);
  const [uncombineBusyPartnerId, setUncombineBusyPartnerId] = useState<string | null>(null);
  /** Edit flower / partial-harvest batches (same fields as veg editor + canopy recompute). */
  const [editFlowerModalBatch, setEditFlowerModalBatch] = useState<any>(null);
  const [editFlowerPlants, setEditFlowerPlants] = useState("");
  const [editFlowerStrain, setEditFlowerStrain] = useState("");
  const [editFlowerAcronym, setEditFlowerAcronym] = useState("");
  const [editFlowerCloneDate, setEditFlowerCloneDate] = useState("");
  const [editFlowerRoomId, setEditFlowerRoomId] = useState("");
  const [editFlowerBayId, setEditFlowerBayId] = useState("");
  const [editFlowerTableIds, setEditFlowerTableIds] = useState<string[]>([]);
  const [editFlowerBatchNotes, setEditFlowerBatchNotes] = useState("");
  const [isSavingEditFlowerModal, setIsSavingEditFlowerModal] = useState(false);
  /** Flower layout from config — store ids in modal, persist names on batch/log. */
  const [flowerRoomId, setFlowerRoomId] = useState("");
  const [flowerBayId, setFlowerBayId] = useState("");
  const [flowerTableIds, setFlowerTableIds] = useState<string[]>([]);

  const [harvestType, setHarvestType] = useState("A Grade Flower");
  const [harvestPlants, setHarvestPlants] = useState("");
  const [freshFrozenBundles, setFreshFrozenBundles] = useState("");
  const [freshFrozenGrams, setFreshFrozenGrams] = useState("");
  /** Final live plant count when using Finish batch — must be 0 to close the batch. */
  const [finishBatchPlantCount, setFinishBatchPlantCount] = useState("0");

  /** Create Immature Plant Batch (Clone stage) */
  const [imbName, setImbName] = useState("");
  const [imbStrain, setImbStrain] = useState("");
  const [imbCount, setImbCount] = useState("");
  const [imbLocation, setImbLocation] = useState("");
  const [imbSublocation, setImbSublocation] = useState("");
  const [imbPlantDate, setImbPlantDate] = useState("");
  const [imbSourceType, setImbSourceType] = useState<string>("");
  const [imbNotes, setImbNotes] = useState("");
  const [imbMetrcBatchId, setImbMetrcBatchId] = useState("");
  const [imbMetrcSyncStatus, setImbMetrcSyncStatus] = useState<MetrcImmatureSyncStatus>("Not Synced");

  /** Move to Veg / Assign Plant Tags */
  const [vegImmatureBatchId, setVegImmatureBatchId] = useState("");
  const [vegMoveCount, setVegMoveCount] = useState("");
  const [vegFirstMetrcTag, setVegFirstMetrcTag] = useState("");
  const [vegSublocationDraft, setVegSublocationDraft] = useState("");
  const [vegMoveNotes, setVegMoveNotes] = useState("");
  const [vegTagOverlapAck, setVegTagOverlapAck] = useState(false);
  const [vegSubmitConfirmAck, setVegSubmitConfirmAck] = useState(false);

  type HarvestSheetRowEdit = { tag: string; weightValue: string; unitGuess: string };
  type HarvestSheetPhoto = { id: string; storedPath: string; imageUrl: string };
  const [harvestSheetRows, setHarvestSheetRows] = useState<HarvestSheetRowEdit[]>([]);
  const [harvestSheetPhotos, setHarvestSheetPhotos] = useState<HarvestSheetPhoto[]>([]);
  const [harvestSheetWarnings, setHarvestSheetWarnings] = useState<string[]>([]);
  const [harvestSheetModel, setHarvestSheetModel] = useState("");
  const [harvestSheetBusy, setHarvestSheetBusy] = useState(false);
  const harvestSheetFileInputRef = useRef<HTMLInputElement>(null);

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
  /** After confirm uses `save`; cleared when proceeding or closing task modal. */
  const moveDateBypassRef = useRef<{
    batchId: string;
    taskName: string;
    stageMoveDate: string;
  } | null>(null);
  const prevStageMoveTaskPickerRef = useRef<string | null>(null);

  /** Pending partial veg-tag move / Veg→Flower when merge-or-new modal may run; cleared after apply or cancel. */
  const pendingPartialSplitRef = useRef<{
    lab: {
      ok: true;
      peopleStr: string;
      minutesStr: string;
      totalLaborMinutes: number;
      laborDetail: Record<string, unknown>;
      outputSuffix: string;
    };
    sourceBatchId: string;
    movedPlants: number;
    taskKey: typeof TASK_MOVE_TO_VEG_ASSIGN_TAGS | "Move to Flower";
    stageMoveDate: string;
    vegRoomId: string;
    vegBayId: string;
    vegTableIds: string[];
    flowerRoomId: string;
    flowerBayId: string;
    flowerTableIds: string[];
    immaturePlantBatchId?: string;
    generatedTags?: string[];
    vegSublocation?: string;
    immatureBatchName?: string;
  } | null>(null);

  const [partialSplitChoiceModal, setPartialSplitChoiceModal] = useState<{
    candidates: { id: string; plants: number; strain: string }[];
    mergeTargetId: string;
  } | null>(null);

  /** Delete cultivation batch: offer revert to previous stage vs permanent delete (clone-only = delete only). */
  const [batchDeleteChoiceModal, setBatchDeleteChoiceModal] = useState<{
    batchId: string;
    batchStageLabel: string;
    revertInfo: CultivationRevertInfo | null;
  } | null>(null);

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

  const harvestLeftoverResolverRef = useRef<
    ((value: { action: "keep" | "dispose"; reason?: string } | null) => void) | null
  >(null);

  const [harvestLeftoverModal, setHarvestLeftoverModal] = useState<{ remaining: number } | null>(
    null,
  );

  const [harvestDisposeReasonDraft, setHarvestDisposeReasonDraft] = useState("");
  const [harvestDisposeReasonError, setHarvestDisposeReasonError] = useState("");

  useEffect(() => {
    setCanDeleteRecords(userCanDeleteWorkflow());
    setCanWriteRecords(hasCultivationWriteAccess());

    let mounted = true;

    async function loadCompanyCultivationConfig() {
      try {
        const data = await apiRequest<{
          cultivation?: { strains?: ConfigStrain[]; rooms?: unknown };
          strains?: ConfigStrain[] | string[];
          company?: { settings?: { laborBreaks?: unknown } };
        }>("/api/config");
        syncCompanyTimezoneFromConfigPayload(data);
        const strains = normalizeStrainConfigList(pickStrainsFromConfigPayload(data));
        const rooms = pickCultivationRoomsFromConfigPayload(data);

        if (!mounted) return;

        setLaborBreakSchedule(normalizeLaborBreaksFromConfig(data.company?.settings?.laborBreaks));
        setConfigStrains(
          sortStrainsAlphabetically(
            strains.filter((item: ConfigStrain) => {
              return getConfigStrainName(item) && getConfigStrainAcronym(item);
            }),
          )
        );
        setCultivationRooms(rooms);
        const rewards = extractRewardsFromCompanyConfig(data);
        setRewardsCfg(rewards);
        const ctDefs = extractCustomTasksRewardDefsFromCompanyConfig(data);
        setCustomTasksRewardDefs(ctDefs);
        setCloneTasks(mergeCultivationTasksForStage(defaultCloneTasks, ctDefs.cultivation, "clone"));
        setVegTasks(mergeCultivationTasksForStage(defaultVegTasks, ctDefs.cultivation, "veg"));
        setFlowerTasks(mergeCultivationTasksForStage(defaultFlowerTasks, ctDefs.cultivation, "flower"));
      } catch (error) {
        console.error("Could not load company cultivation config:", error);

        if (mounted) {
          setConfigStrains([]);
          setCultivationRooms(emptyCultivationRooms);
          setRewardsCfg(null);
          setCustomTasksRewardDefs(extractCustomTasksRewardDefsFromCompanyConfig({}));
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

  useEffect(() => {
    if (typeof window === "undefined") return;

    /** Re-render so manager-level gates (batch Edit) pick up JWT after login or tab/session sync. */
    const bump = () => {
      setCanDeleteRecords(userCanDeleteWorkflow());
      setCanWriteRecords(hasCultivationWriteAccess());
      setRefresh((n) => n + 1);
    };

    window.addEventListener(CPU_AUTH_CHANGED_EVENT, bump);
    const onStorage = (e: StorageEvent) => {
      if (
        !e.storageArea ||
        e.storageArea !== window.localStorage ||
        (e.key != null &&
          e.key !== CPU_AUTH_USER_STORAGE_KEY &&
          e.key !== "cpu_auth_token")
      ) {
        return;
      }
      bump();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CPU_AUTH_CHANGED_EVENT, bump);
      window.removeEventListener("storage", onStorage);
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

  function showManagerBatchEditNotice() {
    showNotice(
      "Manager access required",
      "Only Managers, Operations Managers, Admins, and Owners can edit batch placement and core fields from here."
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

  function promptHarvestLeftoverPlants(
    remaining: number,
  ): Promise<{ action: "keep" | "dispose"; reason?: string } | null> {
    return new Promise((resolve) => {
      harvestLeftoverResolverRef.current = resolve;
      setHarvestDisposeReasonDraft("");
      setHarvestDisposeReasonError("");
      setHarvestLeftoverModal({ remaining });
    });
  }

  function resolveHarvestLeftoverPlants(
    result: { action: "keep" | "dispose"; reason?: string } | null,
  ) {
    const fn = harvestLeftoverResolverRef.current;
    harvestLeftoverResolverRef.current = null;
    setHarvestLeftoverModal(null);
    setHarvestDisposeReasonDraft("");
    setHarvestDisposeReasonError("");
    fn?.(result);
  }

  function confirmHarvestDisposeRemaining() {
    const reason = harvestDisposeReasonDraft.trim();
    if (!reason) {
      setHarvestDisposeReasonError("Enter a reason before disposing remaining plants.");
      return;
    }
    resolveHarvestLeftoverPlants({ action: "dispose", reason });
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

  const stageOrder: Exclude<StageModalKey, null>[] = ["Clones", "Veg", "Flower"];
  const activeBatchesByStage = {
    Clones: activeBatches.filter((b: any) => stageBucketFromBatchStage(b?.stage) === "Clones"),
    Veg: activeBatches.filter((b: any) => stageBucketFromBatchStage(b?.stage) === "Veg"),
    Flower: activeBatches.filter((b: any) => stageBucketFromBatchStage(b?.stage) === "Flower"),
  } as const;
  const stagePlantTotals = {
    Clones: activeBatchesByStage.Clones.reduce((sum: number, b: any) => sum + num(b?.plants), 0),
    Veg: activeBatchesByStage.Veg.reduce((sum: number, b: any) => sum + num(b?.plants), 0),
    Flower: activeBatchesByStage.Flower.reduce((sum: number, b: any) => sum + num(b?.plants), 0),
  } as const;

  const combinePartnerOptions = selectedBatch
    ? activeBatches.filter(
        (b: any) =>
          b?.id &&
          b.id !== selectedBatch.id &&
          stageBucketFromBatchStage(b?.stage) === stageBucketFromBatchStage(selectedBatch?.stage),
      )
    : [];

  const selectedStageBatches = selectedStage ? activeBatchesByStage[selectedStage] : [];
  const selectedStageBatchesOldestFirst = [...selectedStageBatches].sort(
    compareBatchesByCloneDateOldestFirst
  );

  const stageModalRoomSignature = useMemo(() => {
    if (selectedStage !== "Veg" && selectedStage !== "Flower") return "";
    const batches = (s.cultivationBatches || []).filter(
      (b: any) => b.status !== "Complete" && stageBucketFromBatchStage(b?.stage) === selectedStage
    );
    const resolve =
      selectedStage === "Veg"
        ? (b: any) => resolveVegRoomIdForBatch(b, cultivationRooms.vegRooms)
        : (b: any) => resolveFlowerRoomIdForBatch(b, cultivationRooms.flowerRooms);
    return batches.map(resolve).sort().join("|");
    /* `refresh` bumps when store is persisted; cultivation batches are mutated in place on the store snapshot. */
  }, [selectedStage, cultivationRooms.vegRooms, cultivationRooms.flowerRooms, refresh]);

  useEffect(() => {
    if (selectedStage !== "Veg" && selectedStage !== "Flower") {
      setStageModalRoomId(null);
      return;
    }
    const batches = (s.cultivationBatches || []).filter(
      (b: any) => b.status !== "Complete" && stageBucketFromBatchStage(b?.stage) === selectedStage
    );
    const resolve =
      selectedStage === "Veg"
        ? (b: any) => resolveVegRoomIdForBatch(b, cultivationRooms.vegRooms)
        : (b: any) => resolveFlowerRoomIdForBatch(b, cultivationRooms.flowerRooms);
    const ids = Array.from(
      new Set<string>(batches.map((batch: any) => resolve(batch))),
    );
    if (ids.length <= 1) {
      setStageModalRoomId(ids[0] ?? STAGE_MODAL_UNASSIGNED_ROOM_ID);
    } else {
      setStageModalRoomId(null);
    }
  }, [selectedStage, stageModalRoomSignature]);

  const stageModalUsesRoomHierarchy = selectedStage === "Veg" || selectedStage === "Flower";

  const stageModalRoomSummaries =
    stageModalUsesRoomHierarchy && selectedStage
      ? (() => {
          const rooms =
            selectedStage === "Veg" ? cultivationRooms.vegRooms : cultivationRooms.flowerRooms;
          const counts = new Map<string, number>();
          for (const b of selectedStageBatchesOldestFirst) {
            const id =
              selectedStage === "Veg"
                ? resolveVegRoomIdForBatch(b, cultivationRooms.vegRooms)
                : resolveFlowerRoomIdForBatch(b, cultivationRooms.flowerRooms);
            counts.set(id, (counts.get(id) || 0) + 1);
          }
          return [...counts.entries()]
            .map(([id, count]) => ({
              id,
              count,
              name:
                id === STAGE_MODAL_UNASSIGNED_ROOM_ID
                  ? "Unassigned"
                  : rooms.find((r) => r.id === id)?.name || id || "Room",
            }))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
        })()
      : [];

  const showStageModalRoomPicker =
    stageModalUsesRoomHierarchy && stageModalRoomSummaries.length > 1 && stageModalRoomId === null;

  const stageModalEffectiveRoomId =
    stageModalUsesRoomHierarchy && !showStageModalRoomPicker ? stageModalRoomId : null;

  const cultivationStageModalRoomConfig =
    selectedStage === "Veg"
      ? cultivationRooms.vegRooms.find((r) => r.id === stageModalEffectiveRoomId)
      : selectedStage === "Flower"
        ? cultivationRooms.flowerRooms.find((r) => r.id === stageModalEffectiveRoomId)
        : undefined;

  const batchesForCultivationStageModal =
    stageModalUsesRoomHierarchy && stageModalEffectiveRoomId
      ? selectedStageBatchesOldestFirst.filter((b: any) =>
          selectedStage === "Veg"
            ? resolveVegRoomIdForBatch(b, cultivationRooms.vegRooms) === stageModalEffectiveRoomId
            : resolveFlowerRoomIdForBatch(b, cultivationRooms.flowerRooms) ===
              stageModalEffectiveRoomId
        )
      : selectedStageBatchesOldestFirst;

  const cultivationStageModalBayTableGroups =
    stageModalUsesRoomHierarchy &&
    (selectedStage === "Veg" || selectedStage === "Flower") &&
    !showStageModalRoomPicker
      ? buildCultivationStageModalBayTableGroups(
          batchesForCultivationStageModal,
          selectedStage,
          cultivationStageModalRoomConfig,
        )
      : [];

  const activeDryFlowerBatches = s.dryFlowerBatches.filter(
    (batch: any) => batch.status !== "Complete"
  );

  function immatureHasAvailablePlants(batch: any): boolean {
    const arr = batch?.immaturePlantBatches;
    if (!Array.isArray(arr) || arr.length === 0) return false;
    return arr.some((x: any) => num(x?.countAvailable) > 0);
  }

  function filterCloneTaskListForBatch(batch: any | null, tasks: string[]): string[] {
    if (!batch || String(batch.stage || "") !== "Clone") return tasks;
    return tasks.filter((t) => {
      if (t === TASK_MOVE_TO_VEG_ASSIGN_TAGS) return immatureHasAvailablePlants(batch);
      return true;
    });
  }

  function getTasksForStage(stage: string) {
    if (stage === "Clone") return cloneTasks;
    if (stage === "Veg") return vegTasks;
    if (stage === "Flower") return flowerTasks;
    if (stage === "Partially Harvested") return flowerTasks;
    return [];
  }

  const currentTasks = useMemo(() => {
    const stage = selectedBatch?.stage || "Clone";
    const base = getTasksForStage(stage);
    return filterCloneTaskListForBatch(selectedBatch, base);
  }, [selectedBatch, cloneTasks, vegTasks, flowerTasks]);

  useEffect(() => {
    if (!selectedBatch || !selectedTask) return;
    if (currentTasks.length > 0 && !currentTasks.includes(selectedTask)) {
      setSelectedTask(currentTasks[0]);
    }
  }, [selectedBatch, currentTasks, selectedTask]);

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

      if (taskName === TASK_MOVE_TO_VEG_ASSIGN_TAGS) {
        return logTask === TASK_MOVE_TO_VEG_ASSIGN_TAGS || logTask === "Clone → Veg";
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

    if (taskName === "Combine Batches") return true;
    if (taskName === "Print harvest sheet") return true;

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

  function confirmStageMoveDateIfNeeded(onProceed: () => void): boolean {
    if (!selectedBatch) return true;

    const taskLabel = selectedTask ?? "";
    const needsMoveDate = taskLabel === "Move to Flower" || isMoveToVegTaskName(taskLabel);
    if (!needsMoveDate) return true;

    const md = stageMoveDate.trim();
    const todayYmd = getTodayYmdInCompanyTimezone();

    const bypass = moveDateBypassRef.current;
    if (
      bypass &&
      bypass.batchId === selectedBatch.id &&
      bypass.taskName === taskLabel &&
      bypass.stageMoveDate === md
    ) {
      moveDateBypassRef.current = null;
      return true;
    }

    if (md === todayYmd) return true;

    const tzLabel = getCompanyDisplayTimezone();

    showConfirm(
      "Different move date",
      `The move date (${md}) is not today (${todayYmd}) for company timezone (${tzLabel}). Logs will stamp this transition on that calendar day.`,
      () => {
        moveDateBypassRef.current = {
          batchId: selectedBatch.id,
          taskName: taskLabel,
          stageMoveDate: md,
        };
        onProceed();
      },
      "Confirm only if you mean to back-date or fix the record.",
    );

    return false;
  }

  useEffect(() => {
    const t = selectedTask;
    if (!isMoveToVegTaskName(t) && t !== "Move to Flower") {
      prevStageMoveTaskPickerRef.current = t;
      return;
    }
    if (prevStageMoveTaskPickerRef.current !== t) {
      setStageMoveDate(getTodayYmdInCompanyTimezone());
      moveDateBypassRef.current = null;
    }
    prevStageMoveTaskPickerRef.current = t;
  }, [selectedTask]);

  function selectBatch(batch: any) {
    setSelectedBatch(batch);

    const taskList = getTasksForStage(batch.stage || "Clone");
    const filtered = filterCloneTaskListForBatch(batch, taskList);
    if (filtered.length > 0) {
      setSelectedTask(filtered[0]);
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
    if (editVegModalBatch?.id === batchId) setEditVegModalBatch(null);
    if (editCloneModalBatch?.id === batchId) setEditCloneModalBatch(null);
    if (editFlowerModalBatch?.id === batchId) setEditFlowerModalBatch(null);
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

  async function confirmCultivationBatchRevert() {
    const modal = batchDeleteChoiceModal;
    if (!modal?.revertInfo) return;

    const batchId = modal.batchId;
    const targetStage = modal.revertInfo.targetStage;
    setBatchDeleteChoiceModal(null);

    if (!canWriteRecords) {
      showReadOnlyNotice();
      return;
    }

    let batch =
      s.cultivationBatches.find((b: any) => b.id === batchId) ||
      (s.completedCultivationBatches || []).find((b: any) => b.id === batchId);

    if (!batch) {
      showNotice("Batch not found", "Refresh the page — this batch may already have been removed.");
      return;
    }

    const fromStage = String(batch.stage || "").trim();
    const wasCompleted = (s.completedCultivationBatches || []).some((b: any) => b.id === batchId);
    if (wasCompleted) {
      promoteCompletedCultivationBatchToActive(s, batch);
    }

    applyCultivationRevertMutation(batch, targetStage, fromStage);

    if (targetStage === "Flower" || targetStage === "Partially Harvested") {
      recomputeDryCanopyForCultivationBatch(batch, cultivationRooms);
    }

    s.logs.unshift(
      withLoggedBy({
        area: "Cultivation",
        batch: batchId,
        task: "Stage Reverted",
        people: "",
        minutes: "",
        output: `Reverted from ${fromStage} to ${targetStage}.`,
        time: nowIsoForLog(),
        data: { revertedFrom: fromStage, revertedTo: targetStage },
      }),
    );

    if (selectedBatch?.id === batchId) {
      selectBatch(batch);
      const taskList = getTasksForStage(batch.stage || "Clone");
      if (taskList.length) setSelectedTask(taskList[0]);
    }
    if (viewBatch?.id === batchId) setViewBatch(batch);
    if (editVegModalBatch?.id === batchId) setEditVegModalBatch(batch);
    if (editCloneModalBatch?.id === batchId) setEditCloneModalBatch(batch);
    if (editFlowerModalBatch?.id === batchId) setEditFlowerModalBatch(batch);

    forceRefresh();

    try {
      await createLog({
        area: "Cultivation",
        batch: batchId,
        task: "Stage Reverted",
        output: `Reverted from ${fromStage} to ${targetStage}.`,
        data: { revertedFrom: fromStage, revertedTo: targetStage },
      });
    } catch (error) {
      console.error("Could not persist revert log:", error);
    }

    try {
      showSyncMessageNotice("Saving revert to server…");
      const ok = await saveRealCultivationBatch(batch);
      showSyncMessageNotice(ok ? "Revert saved to server." : "Saved locally — server sync failed.");
    } catch (error) {
      console.error("Could not sync revert:", error);
      showNotice("Sync warning", "Revert applied locally but may not have saved to the server.");
    }
  }

  function confirmPermanentBatchDeleteFromModal() {
    const batchId = batchDeleteChoiceModal?.batchId;
    setBatchDeleteChoiceModal(null);
    if (!batchId) return;
    void runDeleteBatch(batchId);
  }

  function cancelBatchDeleteChoiceModal() {
    setBatchDeleteChoiceModal(null);
  }

  function deleteBatch(batchId: string) {
    if (!canDeleteRecords) {
      showNotice("Access Denied", "Only Manager, Admin, or Owner users can delete records.");
      return;
    }

    const dry = (s.dryFlowerBatches || []).find((b: any) => b.id === batchId);
    const prod = (s.productionBatches || []).find((b: any) => b.id === batchId);
    if (dry || prod) {
      showConfirm(
        "Delete Batch",
        `Permanently delete "${batchId}"?`,
        () => runDeleteBatch(batchId),
        dry
          ? "This removes the dry flower batch and related links where applicable."
          : "This removes the production batch record where applicable.",
      );
      return;
    }

    const activeCult = s.cultivationBatches.find((b: any) => b.id === batchId);
    const completedCult = (s.completedCultivationBatches || []).find((b: any) => b.id === batchId);
    const cult = activeCult || completedCult;

    if (!cult) {
      showConfirm(
        "Delete Batch",
        `Permanently delete "${batchId}"?`,
        () => runDeleteBatch(batchId),
        "This removes the batch and related records where applicable.",
      );
      return;
    }

    const revertInfo = getCultivationRevertInfo(cult);
    setBatchDeleteChoiceModal({
      batchId,
      batchStageLabel: String(cult.stage || "—"),
      revertInfo,
    });
  }

  function moveBatchToCompleted(batch: any, opts?: { skipAutoLog?: boolean }) {
    batch.status = "Complete";
    batch.stage = "Complete";
    batch.completedAt = nowIsoForLog();

    const alreadyCompleted = s.completedCultivationBatches.some(
      (b: any) => b.id === batch.id
    );

    if (!alreadyCompleted) {
      s.completedCultivationBatches.unshift(batch);
    }

    if (!opts?.skipAutoLog) {
      s.logs.unshift(withLoggedBy({
        area: "Cultivation",
        batch: batch.id,
        task: "Batch Auto-Completed",
        people: "",
        minutes: "",
        output: "All plants harvested",
        time: nowIsoForLog(),
      }));
    }

    const nextActive = s.cultivationBatches.find(
      (b: any) => b.status !== "Complete"
    );

    if (nextActive) {
      selectBatch(nextActive);
    }
  }

  async function saveFinishBatch(lab: {
    ok: true;
    peopleStr: string;
    minutesStr: string;
    totalLaborMinutes: number;
    laborDetail: Record<string, unknown>;
    outputSuffix: string;
  }) {
    if (!canWriteRecords) {
      showReadOnlyNotice();
      return;
    }
    if (!selectedBatch) return;

    const raw = finishBatchPlantCount.trim();
    const finalPlants = Number(raw);
    if (raw === "" || !Number.isFinite(finalPlants) || finalPlants < 0) {
      showNotice("Invalid plant count", "Enter the final plant count on the batch (use 0 to finish).");
      return;
    }
    if (finalPlants !== 0) {
      showNotice(
        "Cannot finish while plants remain",
        "Enter 0 as the final plant count to close this batch. Harvest or merge plants first if the count should not be zero.",
      );
      return;
    }

    const stage = String(selectedBatch.stage || "");
    if (stage !== "Flower" && stage !== "Partially Harvested") {
      showNotice("Wrong stage", "Finish batch is only available for Flower or Partially Harvested batches.");
      return;
    }

    selectedBatch.plants = 0;
    selectedBatch.plantsAtFlower = 0;
    recomputeDryCanopyForCultivationBatch(selectedBatch, cultivationRooms);

    const notes = String(output || "").trim();
    const noteSuffix = notes ? ` Notes: ${notes}` : "";

    s.logs.unshift(
      withLoggedBy({
        area: "Cultivation",
        batch: selectedBatch.id,
        task: "Finish batch",
        people: lab.peopleStr,
        minutes: lab.minutesStr,
        totalLaborMinutes: lab.totalLaborMinutes,
        output: `Batch finished — plant count set to 0 and batch completed.${noteSuffix}${lab.outputSuffix}`,
        data: {
          ...lab.laborDetail,
          totalLaborMinutes: lab.totalLaborMinutes,
          finishBatchFinalPlants: 0,
          ...(notes ? { finishBatchNotes: notes } : {}),
        },
        time: nowIsoForLog(),
      }),
    );

    moveBatchToCompleted(selectedBatch, { skipAutoLog: true });

    const synced = await saveRealCultivationBatch(selectedBatch);
    if (!synced) {
      showNotice(
        "Save failed",
        "Could not sync cultivation data after finishing the batch. Verify connectivity and try again.",
      );
      return;
    }

    setPeople("");
    setMinutes("");
    setLaborTimeMode("range");
    setTaskLaborDate(getTodayYmdInCompanyTimezone());
    setTaskStartTime("");
    setTaskEndTime("");
    setOutput("");
    setFinishBatchPlantCount("0");
    resetHarvestSheetForm();
    setShowTaskWindow(false);
    forceRefresh();
  }

  async function saveHarvest(
    lab: {
      ok: true;
      peopleStr: string;
      minutesStr: string;
      totalLaborMinutes: number;
      laborDetail: Record<string, unknown>;
      outputSuffix: string;
    },
  ) {
    if (!canWriteRecords) {
      showReadOnlyNotice();
      return;
    }

    if (!selectedBatch) return;

    const requiredHarvestFields: { label: string; value: any; positive?: boolean; zeroOrPositive?: boolean }[] = [
      { label: "Harvest Type", value: harvestType },
      { label: "Plants Harvested", value: harvestPlants, positive: true },
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
    const plantsRemainingAfterHarvest = Math.max(currentPlants - plantsHarvested, 0);

    const apiOrigin = API_BASE_URL.replace(/\/+$/, "");
    const harvestSheetSnapshot =
      harvestSheetPhotos.length > 0
        ? {
            harvestSheetPhotos: harvestSheetPhotos.map((p) => ({
              harvestSheetStoredPath: p.storedPath,
              harvestSheetImageUrl: p.imageUrl || undefined,
              harvestSheetImageAbsUrl: p.imageUrl ? `${apiOrigin}${p.imageUrl}` : undefined,
            })),
            harvestSheetStoredPath: harvestSheetPhotos[0].storedPath,
            harvestSheetImageUrl: harvestSheetPhotos[0].imageUrl || undefined,
            harvestSheetImageAbsUrl: harvestSheetPhotos[0].imageUrl
              ? `${apiOrigin}${harvestSheetPhotos[0].imageUrl}`
              : undefined,
            harvestSheetRows: harvestSheetRows.map((r) => ({
              tag: r.tag.trim(),
              weightValue:
                String(r.weightValue || "").trim() === ""
                  ? null
                  : Number(r.weightValue),
              unitGuess: (r.unitGuess || "unknown").trim(),
            })),
            harvestSheetWarnings: [...harvestSheetWarnings],
            harvestSheetModel: harvestSheetModel || undefined,
            harvestSheetExtractedAt: new Date().toISOString(),
            harvestSheetSumGramsFromRows: sumGramsFromHarvestSheetRows(harvestSheetRows),
          }
        : null;

    let effectiveRemainingPlants = plantsRemainingAfterHarvest;
    let leftoverDisposition: "keep" | "dispose" | undefined;
    let leftoverDisposeReason = "";

    if (plantsRemainingAfterHarvest > 0) {
      const choice = await promptHarvestLeftoverPlants(plantsRemainingAfterHarvest);
      if (choice === null) return;
      if (choice.action === "dispose") {
        effectiveRemainingPlants = 0;
        leftoverDisposition = "dispose";
        leftoverDisposeReason = String(choice.reason || "").trim();
      } else {
        leftoverDisposition = "keep";
      }
    }

    const leftoverLogSuffix =
      leftoverDisposition === "dispose" && leftoverDisposeReason
        ? ` | Disposed ${plantsRemainingAfterHarvest} remaining plants: ${leftoverDisposeReason}`
        : plantsRemainingAfterHarvest > 0 && leftoverDisposition === "keep"
          ? ` | ${plantsRemainingAfterHarvest} plants remain on batch after partial harvest`
          : "";

    const leftoverLogData: Record<string, unknown> =
      leftoverDisposition === "dispose"
        ? {
            leftoverPlantsDisposedCount: plantsRemainingAfterHarvest,
            leftoverDisposeReason,
          }
        : leftoverDisposition === "keep"
          ? { leftoverPlantsRetainedCount: plantsRemainingAfterHarvest }
          : {};

    selectedBatch.plants = effectiveRemainingPlants;
    selectedBatch.stage =
      effectiveRemainingPlants > 0 ? "Partially Harvested" : "Harvested";

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
        ...(harvestSheetSnapshot ? { harvestSheetSnapshot } : {}),
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
            people: lab.peopleStr,
            minutes: lab.minutesStr,
            totalLaborMinutes: lab.totalLaborMinutes,
            output: `${plantsHarvested} plants harvested for A Grade Flower. No weight recorded until bucking.${lab.outputSuffix}${leftoverLogSuffix}`,
            linkedBatch: dryBatch.id,
            data: {
              ...lab.laborDetail,
              totalLaborMinutes: lab.totalLaborMinutes,
              ...(harvestSheetSnapshot || {}),
              ...leftoverLogData,
            },
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
      const aiSumGrams =
        harvestSheetSnapshot &&
        typeof harvestSheetSnapshot.harvestSheetSumGramsFromRows === "number"
          ? harvestSheetSnapshot.harvestSheetSumGramsFromRows
          : null;
      const stemWasteGrams =
        aiSumGrams != null &&
        Number.isFinite(aiSumGrams) &&
        Number.isFinite(gramsParsed) &&
        gramsParsed >= 0
          ? Math.max(0, Math.round((Number(aiSumGrams) - gramsParsed) * 100) / 100)
          : null;
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
        ...(harvestSheetSnapshot ? { harvestSheetSnapshot } : {}),
        ...(stemWasteGrams != null ? { freshFrozenStemWasteGrams: stemWasteGrams } : {}),
        ...(aiSumGrams != null ? { harvestSheetAiTotalGrams: aiSumGrams } : {}),
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
        people: lab.peopleStr,
        minutes: lab.minutesStr,
        totalLaborMinutes: lab.totalLaborMinutes,
        output: `${plantsHarvested} plants harvested for Fresh Frozen | ${
          freshFrozenBundles || 0
        } bundles / ${freshFrozenGrams || 0} grams${lab.outputSuffix}${leftoverLogSuffix}`,
        linkedBatch: freshFrozenBatch.id,
        data: {
          ...lab.laborDetail,
          totalLaborMinutes: lab.totalLaborMinutes,
          ...(harvestSheetSnapshot || {}),
          ...leftoverLogData,
          ...(stemWasteGrams != null
            ? {
                freshFrozenStemWasteGrams: stemWasteGrams,
                harvestSheetAiTotalGrams: aiSumGrams,
              }
            : {}),
        },
        time: nowIsoForLog(),
      }))
    }

    if (effectiveRemainingPlants <= 0) {
      moveBatchToCompleted(selectedBatch);
    }

    const syncedAfterHarvest = await saveRealCultivationBatch(selectedBatch);
    if (!syncedAfterHarvest) {
      showNotice(
        "Save failed",
        "Could not sync cultivation data after harvest. Your harvest may only exist on this device until sync succeeds.",
      );
      return;
    }

    setPeople("");
    setMinutes("");
    setLaborTimeMode("range");
    setTaskLaborDate(getTodayYmdInCompanyTimezone());
    setTaskStartTime("");
    setTaskEndTime("");
    setOutput("");
    setHarvestPlants("");
    setFreshFrozenBundles("");
    setFreshFrozenGrams("");
    resetHarvestSheetForm();
    setShowTaskWindow(false);
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

  function toggleVegTableId(tableId: string) {
    setVegTableIds((current) =>
      current.includes(tableId)
        ? current.filter((id) => id !== tableId)
        : [...current, tableId]
    );
  }

  function primeTaskModalLocationFields(rooms: CultivationRoomsConfig) {
    const veg = rooms.vegRooms || [];
    if (veg.length === 0) {
      setVegRoomId("");
      setVegBayId("");
      setVegTableIds([]);
    } else {
      const vroom = veg[0];
      setVegRoomId(vroom.id);
      const firstVegBay = vroom.bays?.[0];
      setVegBayId(firstVegBay?.id || "");
      setVegTableIds([]);
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
    setCombinePartnerBatchId("");
    if (batch?.vegRoomId) {
      setVegRoomId(String(batch.vegRoomId));
      if (batch.vegBayId) setVegBayId(String(batch.vegBayId));
      if (Array.isArray(batch.vegTableIds)) setVegTableIds([...batch.vegTableIds]);
    } else if (batch?.vegRoom && typeof batch.vegRoom === "string") {
      const byName = cultivationRooms.vegRooms.find((v) => v.name === batch.vegRoom);
      if (byName) {
        setVegRoomId(byName.id);
        const b0 = byName.bays?.[0];
        setVegBayId(b0?.id || "");
        setVegTableIds([]);
      }
    }
    if (batch?.flowerRoomId) {
      setFlowerRoomId(String(batch.flowerRoomId));
      if (batch.flowerBayId) setFlowerBayId(String(batch.flowerBayId));
      if (Array.isArray(batch.flowerTableIds)) setFlowerTableIds([...batch.flowerTableIds]);
    }

    setLaborTimeMode("range");
    setTaskLaborDate(getTodayYmdInCompanyTimezone());
    setTaskStartTime("");
    setTaskEndTime("");
    setPeople("");
    setMinutes("");
    setFinishBatchPlantCount("0");
    setImbName("");
    setImbCount("");
    setImbLocation("");
    setImbSublocation("");
    setImbSourceType("");
    setImbNotes("");
    setImbMetrcBatchId("");
    setImbMetrcSyncStatus("Not Synced");
    const imbList = Array.isArray(batch?.immaturePlantBatches) ? batch.immaturePlantBatches : [];
    const firstAvail = imbList.find((x: any) => num(x?.countAvailable) > 0);
    setVegImmatureBatchId(firstAvail ? String(firstAvail.id) : imbList[0] ? String((imbList[0] as any).id) : "");
    setImbPlantDate(getTodayYmdInCompanyTimezone());
    setImbStrain(String(batch?.strain || ""));
    setVegMoveCount("");
    setVegFirstMetrcTag("");
    setVegSublocationDraft("");
    setVegMoveNotes("");
    setVegTagOverlapAck(false);
    setVegSubmitConfirmAck(false);
  }

  function resetHarvestSheetForm() {
    setHarvestSheetRows([]);
    setHarvestSheetPhotos([]);
    setHarvestSheetWarnings([]);
    setHarvestSheetModel("");
    setHarvestSheetBusy(false);
    if (harvestSheetFileInputRef.current) harvestSheetFileInputRef.current.value = "";
  }

  function closeCultivationTaskWindow() {
    setCombinePartnerBatchId("");
    moveDateBypassRef.current = null;
    setLaborTimeMode("range");
    setTaskLaborDate(getTodayYmdInCompanyTimezone());
    setTaskStartTime("");
    setTaskEndTime("");
    setPeople("");
    setMinutes("");
    setFinishBatchPlantCount("0");
    setImbName("");
    setImbStrain("");
    setImbCount("");
    setImbLocation("");
    setImbSublocation("");
    setImbPlantDate("");
    setImbSourceType("");
    setImbNotes("");
    setImbMetrcBatchId("");
    setImbMetrcSyncStatus("Not Synced");
    setVegImmatureBatchId("");
    setVegMoveCount("");
    setVegFirstMetrcTag("");
    setVegSublocationDraft("");
    setVegMoveNotes("");
    setVegTagOverlapAck(false);
    setVegSubmitConfirmAck(false);
    resetHarvestSheetForm();
    setShowTaskWindow(false);
  }

  function sumGramsFromHarvestSheetRows(rows: HarvestSheetRowEdit[]): number {
    let sum = 0;
    for (const r of rows) {
      const w = num(r.weightValue);
      if (!(w > 0)) continue;
      const u = String(r.unitGuess || "").toLowerCase();
      if (u === "lbs" || u === "lb") sum += w * 453.592;
      else if (u === "oz") sum += w * 28.3495;
      else if (u === "g" || u === "grams" || u === "gram") sum += w;
      else sum += w;
    }
    return Math.round(sum);
  }

  function openHarvestPrintSheetWindow() {
    if (!selectedBatch) return;
    const b = selectedBatch;
    const flowerRoomObj = cultivationRooms.flowerRooms.find((r: any) => r.id === b.flowerRoomId);
    const bayObj = flowerRoomObj?.bays?.find((x: any) => x.id === b.flowerBayId);
    const roomName = flowerRoomObj?.name || b.flowerRoom || "—";
    const bayName = bayObj ? String(bayObj.name) : b.flowerBay || "—";
    const tablesStr = formatFlowerTables(b);
    const strain = b.strain || "—";
    const rowCount = Math.min(500, Math.max(1, num(b.plants)));
    const rowsHtml = Array.from({ length: rowCount }, (_, i) => {
      const n = i + 1;
      return `<tr><td>${n}</td><td></td><td></td><td></td></tr>`;
    }).join("");
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Harvest sheet ${String(b.id)}</title>
<style>
  body { font-family: system-ui, sans-serif; padding: 16px; color: #111; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  .meta { font-size: 13px; margin-bottom: 14px; line-height: 1.5; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #333; padding: 6px 8px; text-align: left; }
  th { background: #eee; }
  .hint { font-size: 11px; color: #444; margin-top: 12px; }
  @media print {
    .no-print { display: none !important; }
    body { padding: 8px; }
    @page { size: portrait; margin: 12mm; }
    table { page-break-inside: auto; }
    tr { page-break-inside: avoid; }
  }
</style></head><body>
  <h1>Harvest weight log</h1>
  <div class="meta">
    <div><strong>Batch:</strong> ${String(b.id)}</div>
    <div><strong>Strain:</strong> ${String(strain)}</div>
    <div><strong>Flower room:</strong> ${String(roomName)}</div>
    <div><strong>Bay:</strong> ${String(bayName)}</div>
    <div><strong>Tables:</strong> ${String(tablesStr)}</div>
    <div><strong>Plants (expected rows):</strong> ${rowCount}</div>
  </div>
  <p class="no-print"><button type="button" onclick="window.print()">Print</button></p>
  <table>
    <thead><tr><th>#</th><th>Tag #</th><th>Weight</th><th>Unit (lbs / g)</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <p class="hint">Fill one row per plant. For Fresh Frozen / dry flower harvest, total bundles or grams can be noted on the sheet footer if your process uses totals.</p>
</body></html>`;

    /** iOS / Android often print the parent SPA when using a hidden iframe — full table never appears. */
    function prefersDedicatedPrintWindow(): boolean {
      if (typeof navigator === "undefined" || typeof window === "undefined") return false;
      const ua = navigator.userAgent || "";
      if (/Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return true;
      // iPadOS may report as Macintosh + multi-touch without "Mobile" in UA
      if (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua)) return true;
      return false;
    }

    function printViaHiddenIframe() {
      const iframe = document.createElement("iframe");
      iframe.setAttribute("title", "Harvest sheet print");
      iframe.setAttribute("sandbox", "allow-modals allow-same-origin allow-scripts");
      iframe.style.cssText =
        "position:fixed;inset:0;width:100%;height:100%;opacity:0;pointer-events:none;z-index:-1;border:none;";
      document.body.appendChild(iframe);
      const pwin = iframe.contentWindow;
      if (!pwin) {
        document.body.removeChild(iframe);
        showNotice("Print failed", "Could not prepare the printable harvest sheet.");
        return;
      }
      pwin.document.open();
      pwin.document.write(html);
      pwin.document.close();
      const cleanup = () => {
        try {
          iframe.remove();
        } catch {
          /* ignore */
        }
      };
      const runPrint = () => {
        try {
          pwin.focus();
          pwin.print();
        } finally {
          setTimeout(cleanup, 800);
        }
      };
      setTimeout(runPrint, 50);
    }

    function printViaNewWindow() {
      const w = window.open("about:blank", "_blank");
      if (!w) {
        showNotice(
          "Pop-up blocked",
          "Allow pop-ups for this site to print the full harvest sheet on mobile, or try Print again.",
        );
        printViaHiddenIframe();
        return;
      }
      try {
        w.document.open();
        w.document.write(html);
        w.document.close();
        w.focus();
        const schedulePrint = () => {
          try {
            w.print();
          } catch {
            showNotice("Print failed", "Could not open the system print dialog.");
          }
        };
        setTimeout(schedulePrint, 120);
      } catch {
        try {
          w.close();
        } catch {
          /* ignore */
        }
        printViaHiddenIframe();
      }
    }

    if (prefersDedicatedPrintWindow()) {
      printViaNewWindow();
    } else {
      printViaHiddenIframe();
    }
  }

  function tryShowRewardsChallengeFromTaskInputFocus() {
    if (selectedTask === "Print harvest sheet") return;
    const rb = resolveConfigurableTaskRewards("Cultivation", selectedTask, customTasksRewardDefs);
    if (!rb.eligible) return;
    if (!showTaskWindow || !selectedBatch || !rewardsCfg?.enabled || !rewardsCfg.taskChallenge.enabled) {
      return;
    }
    const u = getAuthUser();
    if (!u || (!u.rewardsEnrolled && !isElevatedManagerRole(String(u.role || "")))) {
      return;
    }
    const key = `${selectedBatch.id}\u0000${selectedTask}`;
    if (rewardsChallengeShownKeyRef.current === key) return;
    rewardsChallengeShownKeyRef.current = key;
    setShowRewardsChallengeModal(true);
  }

  async function onHarvestSheetFilesSelected(fileList: FileList | null) {
    if (!fileList?.length || !canWriteRecords) return;
    const files = Array.from(fileList);
    setHarvestSheetBusy(true);
    setHarvestSheetWarnings([]);
    try {
      let uploaded = 0;
      for (const file of files) {
        const shrunk = await shrinkHarvestSheetImageFileIfLarge(file, 2000);
        const dataUrl = await fileToBase64DataUrl(shrunk);
        const up = await uploadHarvestSheetImage(dataUrl, shrunk.type || "image/jpeg");
        const id =
          typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        setHarvestSheetPhotos((prev) => [
          ...prev,
          { id, storedPath: up.storedPath, imageUrl: up.imageUrl || "" },
        ]);
        uploaded += 1;
      }
      showSyncMessageNotice(
        uploaded === 1 ? "Harvest sheet photo uploaded." : `${uploaded} harvest sheet photos uploaded.`,
      );
    } catch (e) {
      console.error(e);
      showNotice("Upload failed", e instanceof Error ? e.message : "Could not upload harvest sheet image.");
    } finally {
      setHarvestSheetBusy(false);
      if (harvestSheetFileInputRef.current) harvestSheetFileInputRef.current.value = "";
    }
  }

  async function runHarvestSheetExtract() {
    const paths = harvestSheetPhotos.map((p) => p.storedPath).filter(Boolean);
    if (paths.length === 0) {
      showNotice("No photo", "Upload at least one photo of the filled harvest sheet first.");
      return;
    }
    if (!canWriteRecords) {
      showReadOnlyNotice();
      return;
    }
    setHarvestSheetBusy(true);
    setHarvestSheetWarnings([]);
    try {
      const plantsHint = num(harvestPlants);
      const ex = await extractHarvestSheet({
        storedPaths: paths,
        plantsHarvested: plantsHint > 0 ? plantsHint : undefined,
      });
      setHarvestSheetModel(ex.model || "");
      setHarvestSheetWarnings(ex.warnings || []);
      setHarvestSheetRows(
        ex.rows.map((r) => ({
          tag: r.tag || "",
          weightValue: r.weightValue != null && Number.isFinite(r.weightValue) ? String(r.weightValue) : "",
          unitGuess: r.unitGuess || "unknown",
        })),
      );
      if (harvestType === "Fresh Frozen") {
        if (ex.totalGrams != null && Number.isFinite(ex.totalGrams)) {
          setFreshFrozenGrams(String(Math.round(ex.totalGrams)));
        }
        if (ex.bundles != null && Number.isFinite(ex.bundles)) {
          setFreshFrozenBundles(String(Math.round(ex.bundles)));
        }
      }
      showSyncMessageNotice("Harvest sheet data extracted — review rows before saving.");
    } catch (e) {
      console.error(e);
      showNotice(
        "Extraction failed",
        e instanceof Error ? e.message : "OpenAI extraction failed. Check OPENAI_API_KEY on the server.",
      );
    } finally {
      setHarvestSheetBusy(false);
    }
  }

  function finalizeMergedPartnerBatch(
    absorbed: any,
    survivorId: string,
    snapshot: { plantsAbsorbed: number; stageBeforeMerge: string; statusBeforeMerge: string },
  ) {
    absorbed.mergedIntoSnapshot = {
      survivorBatchId: survivorId,
      plantsAbsorbed: snapshot.plantsAbsorbed,
      stageBeforeMerge: snapshot.stageBeforeMerge,
      statusBeforeMerge: snapshot.statusBeforeMerge,
    };
    absorbed.status = "Complete";
    absorbed.stage = "Complete";
    absorbed.completedAt = nowIsoForLog();
    absorbed.plants = 0;
    absorbed.mergedIntoBatchId = survivorId;
    const idx = s.cultivationBatches.findIndex((b: any) => b?.id === absorbed.id);
    if (idx >= 0) {
      s.cultivationBatches.splice(idx, 1);
    }
    if (!s.completedCultivationBatches.some((b: any) => b?.id === absorbed.id)) {
      s.completedCultivationBatches.unshift(absorbed);
    }
  }

  useEffect(() => {
    if (!showTaskWindow) {
      rewardsChallengeShownKeyRef.current = null;
      setShowRewardsChallengeModal(false);
    }
  }, [showTaskWindow]);

  useEffect(() => {
    if (selectedTask === "Print harvest sheet") {
      setShowRewardsChallengeModal(false);
    }
  }, [selectedTask]);

  function openTaskWindowForBatch(batch: any) {
    if (!batch) return;
    moveDateBypassRef.current = null;
    setStageMoveDate(getTodayYmdInCompanyTimezone());
    selectBatch(batch);
    const taskList = filterCloneTaskListForBatch(batch, getTasksForStage(batch.stage || "Clone"));
    setSelectedTask(taskList[0] || "Maintenance");
    primeTaskModalFromSelectedBatch(batch);
    setShowTaskWindow(true);
    setSelectedStage(null);
  }

  function resolveFlowerSelectionLabels() {
    return resolveFlowerLayoutLabels(flowerRoomId, flowerBayId, flowerTableIds);
  }

  function resolveVegSelectionLabels() {
    return resolveVegLayoutLabels(vegRoomId, vegBayId, vegTableIds);
  }

  function resolveVegLayoutLabels(roomId: string, bayId: string, tableIds: string[]) {
    const room = cultivationRooms.vegRooms.find((r) => r.id === roomId);
    const bay = room?.bays?.find((b) => b.id === bayId);
    const tableNames =
      (bay?.tables || []).filter((t) => tableIds.includes(t.id)).map((t) => t.name) || [];
    return {
      roomName: room?.name || "",
      bayName: bay?.name || "",
      tableNames,
    };
  }

  function resolveFlowerLayoutLabels(roomId: string, bayId: string, tableIds: string[]) {
    const room = cultivationRooms.flowerRooms.find((r) => r.id === roomId);
    const bay = room?.bays?.find((b) => b.id === bayId);
    const tableNames =
      (bay?.tables || [])
        .filter((t) => tableIds.includes(t.id))
        .map((t) => t.name) || [];
    return {
      roomName: room?.name || "",
      bayName: bay?.name || "",
      tableNames,
    };
  }

  function ensurePlantTagRecords(batch: any): any[] {
    if (!Array.isArray(batch.plantTagRecords)) batch.plantTagRecords = [];
    return batch.plantTagRecords;
  }

  function syncClonePlantsFromImmature(batch: any) {
    if (String(batch?.stage || "") !== "Clone") return;
    const arr = batch?.immaturePlantBatches;
    if (!Array.isArray(arr) || arr.length === 0) return;
    batch.plants = arr.reduce((acc: number, x: any) => acc + Math.max(0, num(x?.countAvailable)), 0);
  }

  function applyImmatureDecrement(batch: any, immatureId: string, by: number) {
    const arr = batch?.immaturePlantBatches;
    if (!Array.isArray(arr)) return;
    const row = arr.find((x: any) => String(x?.id || "") === immatureId);
    if (!row) return;
    row.countAvailable = Math.max(0, num(row.countAvailable) - by);
    row.updatedAt = new Date().toISOString();
  }

  function findPartialStageMergeCandidates(sourceBatchId: string, targetStage: "Veg" | "Flower") {
    return (s.cultivationBatches || []).filter((b: any) => {
      if (String(b?.status || "").toLowerCase() === "complete") return false;
      if (String(b.splitSourceBatchId || "") !== sourceBatchId) return false;
      return targetStage === "Veg" ? b.stage === "Veg" : b.stage === "Flower";
    });
  }

  async function applyPartialStageMove(mergeTargetId: string | null) {
    const pending = pendingPartialSplitRef.current;
    if (!pending) return;

    const lab = pending.lab;
    const source = s.cultivationBatches.find((b: any) => b?.id === pending.sourceBatchId);
    if (!source) {
      pendingPartialSplitRef.current = null;
      setPartialSplitChoiceModal(null);
      showNotice("Batch missing", "Source batch is no longer active — refresh and try again.");
      return;
    }

    const moved = pending.movedPlants;
    const current = num(source.plants);

    if (moved <= 0) {
      pendingPartialSplitRef.current = null;
      setPartialSplitChoiceModal(null);
      showNotice("Invalid split", "Nothing to move.");
      return;
    }

    const isTagVegMove = isMoveToVegTaskName(pending.taskKey);

    if (!isTagVegMove) {
      if (moved >= current) {
        pendingPartialSplitRef.current = null;
        setPartialSplitChoiceModal(null);
        showNotice("Invalid split", "Plant counts changed — reopen the task and try again.");
        return;
      }
    } else if (!pending.generatedTags || pending.generatedTags.length !== moved) {
      pendingPartialSplitRef.current = null;
      setPartialSplitChoiceModal(null);
      showNotice(
        "Invalid tag move",
        "METRC tag list is missing or does not match the move count — reopen Move to Veg / Assign Plant Tags.",
      );
      return;
    }

    pendingPartialSplitRef.current = null;
    setPartialSplitChoiceModal(null);

    const moveDateCanonical = pending.stageMoveDate;
    const logEventTimeIso = logTimeIsoForStageMoveDate(moveDateCanonical);
    let remainderAfter = current - moved;

    let selectAfter: any = null;

    const laborData = { ...lab.laborDetail, totalLaborMinutes: lab.totalLaborMinutes };

    try {
      if (isMoveToVegTaskName(pending.taskKey)) {
        const vl = resolveVegLayoutLabels(pending.vegRoomId, pending.vegBayId, pending.vegTableIds);
        const layoutTail = `Move date: ${moveDateCanonical} | Room: ${vl.roomName || "—"} | Bay: ${vl.bayName || "—"} | Tables: ${
          vl.tableNames.length ? vl.tableNames.join(", ") : "—"
        }`;

        const tags = pending.generatedTags || [];
        const immatureId = String(pending.immaturePlantBatchId || "");
        const imb = immatureId
          ? source.immaturePlantBatches?.find((x: any) => String(x?.id || "") === immatureId)
          : null;

        if (!imb || tags.length !== moved) {
          showNotice(
            "Cannot complete partial veg move",
            "METRC tag data or immature batch linkage is missing — cancel and run Move to Veg / Assign Plant Tags again.",
          );
          return;
        }

        applyImmatureDecrement(source, immatureId, moved);
        syncClonePlantsFromImmature(source);
        remainderAfter = num(source.plants);

        const nowIso = new Date().toISOString();
        const subloc = String(pending.vegSublocation || "").trim();

        const plantRecordsForTarget = (batchId: string) =>
          tags.map((tag: string) => ({
            id:
              typeof crypto !== "undefined" && crypto.randomUUID
                ? crypto.randomUUID()
                : `PT-${batchId}-${tag}-${nowIso}`,
            cultivationBatchId: batchId,
            immaturePlantBatchId: immatureId,
            tag,
            strain: String(imb.strain || source.strain || ""),
            stage: "Veg",
            location: vl.roomName || "",
            sublocation: subloc || undefined,
            status: "Active",
            metrcPlantId: undefined,
            createdAt: nowIso,
            updatedAt: nowIso,
          }));

        const payload = buildMetrcVegMovePayload({
          immatureBatchName: String(pending.immatureBatchName || imb.name || source.id),
          countMovingToVeg: moved,
          startingTag: tags[0] || "",
          newLocationLabel: vl.roomName || "",
          newSublocation: subloc,
          growthDateYmd: moveDateCanonical,
        });

        if (mergeTargetId) {
          const target = s.cultivationBatches.find((b: any) => b?.id === mergeTargetId);
          if (
            !target ||
            target.stage !== "Veg" ||
            String(target.splitSourceBatchId || "") !== source.id
          ) {
            showNotice("Merge target invalid", "Pick a veg batch that was split from this clone line.");
            return;
          }

          target.plants = num(target.plants) + moved;
          ensurePlantTagRecords(target).push(...plantRecordsForTarget(target.id));

          const tagSpan = `${tags[0]} → ${tags[tags.length - 1]}`;
          const srcOutput = `${moved} plants moved to Veg — merged into ${target.id} (${remainderAfter} immature plants remain on Clone batch) | Tags ${tagSpan} | ${layoutTail}`;
          s.logs.unshift(
            withLoggedBy({
              area: "Cultivation",
              batch: source.id,
              task: TASK_MOVE_TO_VEG_ASSIGN_TAGS,
              people: lab.peopleStr,
              minutes: lab.minutesStr,
              totalLaborMinutes: lab.totalLaborMinutes,
              output: srcOutput + lab.outputSuffix,
              room: vl.roomName || undefined,
              bay: vl.bayName || undefined,
              tables: vl.tableNames.length ? [...vl.tableNames] : undefined,
              linkedBatch: target.id,
              time: logEventTimeIso,
              data: {
                stageMoveDate: moveDateCanonical,
                partialStageMove: true,
                mergeIntoBatchId: target.id,
                plantsMoved: moved,
                plantsRemainingOnSource: remainderAfter,
                metrcVegMovePayload: payload,
                metrcPreparedLocalOnly: true,
                metrcPlantTags: tags,
                immaturePlantBatchId: immatureId,
                ...laborData,
              },
            }),
          );

          s.logs.unshift(
            withLoggedBy({
              area: "Cultivation",
              batch: target.id,
              task: TASK_MOVE_TO_VEG_ASSIGN_TAGS,
              people: "",
              minutes: "",
              output: `+${moved} tagged plants from Clone batch ${source.id} (partial merge). Total plants: ${num(target.plants)}.`,
              linkedBatch: source.id,
              time: logEventTimeIso,
              data: {
                stageMoveDate: moveDateCanonical,
                partialStageMove: true,
                mergeFromBatchId: source.id,
                plantsAdded: moved,
                metrcPlantTags: tags,
              },
            }),
          );

          selectAfter = remainderAfter > 0 ? source : target;
          await saveRealCultivationBatch(source);
          await saveRealCultivationBatch(target);
        } else {
          const newBatchId = makeBatchId(
            String(source.acronym || "BATCH"),
            String(source.cloneDate || moveDateCanonical),
            getAllBatchLists(),
          );
          const newBatch: Record<string, unknown> = {
            id: newBatchId,
            strain: source.strain,
            acronym: source.acronym,
            cloneDate: source.cloneDate,
            cloneCount: source.cloneCount,
            stage: "Veg",
            plants: moved,
            originalPlants: moved,
            status: "Active",
            splitSourceBatchId: source.id,
            vegRoomId: pending.vegRoomId,
            vegBayId: pending.vegBayId,
            vegTableIds: [...pending.vegTableIds],
            vegRoom: vl.roomName,
            vegBay: vl.bayName,
            vegTables: [...vl.tableNames],
            vegSublocation: subloc || undefined,
            plantTagRecords: plantRecordsForTarget(newBatchId),
          };

          s.cultivationBatches.unshift(newBatch as any);
          createRealCultivationBatch(newBatch);

          const tagSpan = `${tags[0]} → ${tags[tags.length - 1]}`;
          const srcOutput = `${moved} plants moved to Veg (partial; ${remainderAfter} immature plants remain on Clone batch) | New veg batch ${newBatch.id} | Tags ${tagSpan} | ${layoutTail}`;
          s.logs.unshift(
            withLoggedBy({
              area: "Cultivation",
              batch: source.id,
              task: TASK_MOVE_TO_VEG_ASSIGN_TAGS,
              people: lab.peopleStr,
              minutes: lab.minutesStr,
              totalLaborMinutes: lab.totalLaborMinutes,
              output: srcOutput + lab.outputSuffix,
              room: vl.roomName || undefined,
              bay: vl.bayName || undefined,
              tables: vl.tableNames.length ? [...vl.tableNames] : undefined,
              linkedBatch: String(newBatch.id),
              time: logEventTimeIso,
              data: {
                stageMoveDate: moveDateCanonical,
                partialStageMove: true,
                newBatchId: newBatch.id,
                plantsMoved: moved,
                plantsRemainingOnSource: remainderAfter,
                metrcVegMovePayload: payload,
                metrcPreparedLocalOnly: true,
                metrcPlantTags: tags,
                immaturePlantBatchId: immatureId,
                ...laborData,
              },
            }),
          );

          s.logs.unshift(
            withLoggedBy({
              area: "Cultivation",
              batch: String(newBatch.id),
              task: TASK_MOVE_TO_VEG_ASSIGN_TAGS,
              people: "",
              minutes: "",
              output: `Split from Clone batch ${source.id} — ${moved} tagged plants | ${layoutTail}`,
              linkedBatch: source.id,
              time: logEventTimeIso,
              data: {
                stageMoveDate: moveDateCanonical,
                partialStageMove: true,
                splitFromBatchId: source.id,
                plantsReceived: moved,
                metrcPlantTags: tags,
              },
            }),
          );

          selectAfter = remainderAfter > 0 ? source : (newBatch as any);
          await saveRealCultivationBatch(source);
          await saveRealCultivationBatch(newBatch);
        }
      } else {
        const fl = resolveFlowerLayoutLabels(
          pending.flowerRoomId,
          pending.flowerBayId,
          pending.flowerTableIds,
        );
        const layoutTail = `Move date: ${moveDateCanonical} | Room: ${fl.roomName || "—"} | Bay: ${fl.bayName || "—"} | Tables: ${
          fl.tableNames.length ? fl.tableNames.join(", ") : "—"
        }`;

        if (mergeTargetId) {
          const target = s.cultivationBatches.find((b: any) => b?.id === mergeTargetId);
          if (
            !target ||
            target.stage !== "Flower" ||
            String(target.splitSourceBatchId || "") !== source.id
          ) {
            showNotice("Merge target invalid", "Pick a flower batch that was split from this veg line.");
            return;
          }

          target.plants = num(target.plants) + moved;
          target.plantsAtFlower = num(target.plantsAtFlower) + moved;
          source.plants = remainderAfter;
          recomputeDryCanopyForCultivationBatch(target, cultivationRooms);

          const srcOutput = `${moved} plants moved to Flower — merged into ${target.id} (${remainderAfter} remain in Veg) | ${layoutTail}`;
          s.logs.unshift(
            withLoggedBy({
              area: "Cultivation",
              batch: source.id,
              task: "Move to Flower",
              people: lab.peopleStr,
              minutes: lab.minutesStr,
              totalLaborMinutes: lab.totalLaborMinutes,
              output: srcOutput + lab.outputSuffix,
              room: fl.roomName || undefined,
              bay: fl.bayName || undefined,
              tables: fl.tableNames.length ? [...fl.tableNames] : undefined,
              linkedBatch: target.id,
              time: logEventTimeIso,
              data: {
                stageMoveDate: moveDateCanonical,
                partialStageMove: true,
                mergeIntoBatchId: target.id,
                plantsMoved: moved,
                plantsRemainingOnSource: remainderAfter,
                ...laborData,
              },
            }),
          );

          s.logs.unshift(
            withLoggedBy({
              area: "Cultivation",
              batch: target.id,
              task: "Move to Flower",
              people: "",
              minutes: "",
              output: `+${moved} plants from Veg batch ${source.id} (partial merge). Total plants: ${num(target.plants)}.`,
              linkedBatch: source.id,
              time: logEventTimeIso,
              data: {
                stageMoveDate: moveDateCanonical,
                partialStageMove: true,
                mergeFromBatchId: source.id,
                plantsAdded: moved,
              },
            }),
          );

          selectAfter = remainderAfter > 0 ? source : target;
          await saveRealCultivationBatch(source);
          await saveRealCultivationBatch(target);
        } else {
          const newBatch: Record<string, unknown> = {
            id: makeBatchId(String(source.acronym || "BATCH"), String(source.cloneDate || moveDateCanonical), getAllBatchLists()),
            strain: source.strain,
            acronym: source.acronym,
            cloneDate: source.cloneDate,
            cloneCount: source.cloneCount,
            stage: "Flower",
            plants: moved,
            originalPlants: source.originalPlants != null ? source.originalPlants : moved,
            plantsAtFlower: moved,
            status: "Active",
            splitSourceBatchId: source.id,
            flowerRoomId: pending.flowerRoomId,
            flowerBayId: pending.flowerBayId,
            flowerTableIds: [...pending.flowerTableIds],
            flowerRoom: fl.roomName,
            flowerBay: fl.bayName,
            flowerTables: [...fl.tableNames],
            vegRoomId: source.vegRoomId,
            vegBayId: source.vegBayId,
            vegTableIds: Array.isArray(source.vegTableIds) ? [...source.vegTableIds] : [],
            vegRoom: source.vegRoom,
            vegBay: source.vegBay,
            vegTables: Array.isArray(source.vegTables) ? [...source.vegTables] : [],
            plantsHarvestedDry: 0,
            plantsHarvestedFreshFrozen: 0,
          };

          recomputeDryCanopyForCultivationBatch(newBatch, cultivationRooms);

          s.cultivationBatches.unshift(newBatch as any);
          createRealCultivationBatch(newBatch);
          source.plants = remainderAfter;

          const srcOutput = `${moved} plants moved to Flower (partial; ${remainderAfter} remain in Veg) | New flower batch ${newBatch.id} | ${layoutTail}`;
          s.logs.unshift(
            withLoggedBy({
              area: "Cultivation",
              batch: source.id,
              task: "Move to Flower",
              people: lab.peopleStr,
              minutes: lab.minutesStr,
              totalLaborMinutes: lab.totalLaborMinutes,
              output: srcOutput + lab.outputSuffix,
              room: fl.roomName || undefined,
              bay: fl.bayName || undefined,
              tables: fl.tableNames.length ? [...fl.tableNames] : undefined,
              linkedBatch: String(newBatch.id),
              time: logEventTimeIso,
              data: {
                stageMoveDate: moveDateCanonical,
                partialStageMove: true,
                newBatchId: newBatch.id,
                plantsMoved: moved,
                plantsRemainingOnSource: remainderAfter,
                ...laborData,
              },
            }),
          );

          s.logs.unshift(
            withLoggedBy({
              area: "Cultivation",
              batch: String(newBatch.id),
              task: "Move to Flower",
              people: "",
              minutes: "",
              output: `Split from Veg batch ${source.id} — ${moved} plants | ${layoutTail}`,
              linkedBatch: source.id,
              time: logEventTimeIso,
              data: {
                stageMoveDate: moveDateCanonical,
                partialStageMove: true,
                splitFromBatchId: source.id,
                plantsReceived: moved,
              },
            }),
          );

          selectAfter = remainderAfter > 0 ? source : (newBatch as any);
          await saveRealCultivationBatch(source);
          await saveRealCultivationBatch(newBatch);
        }
      }

      if (selectAfter && s.cultivationBatches.some((b: any) => b?.id === selectAfter.id)) {
        selectBatch(selectAfter);
      } else {
        const nextActive = s.cultivationBatches.find((b: any) => b?.status !== "Complete");
        if (nextActive) selectBatch(nextActive);
      }

      setPeople("");
      setMinutes("");
      setLaborTimeMode("range");
      setTaskLaborDate(getTodayYmdInCompanyTimezone());
      setTaskStartTime("");
      setTaskEndTime("");
      setOutput("");
      setCombinePartnerBatchId("");
      primeTaskModalLocationFields(cultivationRooms);
      closeCultivationTaskWindow();
      forceRefresh();

      showSyncMessageNotice("Partial stage move saved locally. Syncing to server…");
    } catch (e) {
      console.error("Partial stage move failed:", e);
      showNotice(
        "Save warning",
        "Partial move updated locally; server sync may have failed — check connectivity.",
      );
    }
  }

  function cancelPartialSplitChoice() {
    pendingPartialSplitRef.current = null;
    setPartialSplitChoiceModal(null);
    setIsSavingTask(false);
  }

  async function confirmPartialSplitMerge() {
    const m = partialSplitChoiceModal;
    if (!m?.mergeTargetId) return;
    setIsSavingTask(true);
    try {
      await applyPartialStageMove(m.mergeTargetId);
    } finally {
      setIsSavingTask(false);
    }
  }

  async function confirmPartialSplitNewBatch() {
    setIsSavingTask(true);
    try {
      await applyPartialStageMove(null);
    } finally {
      setIsSavingTask(false);
    }
  }

  function resolveEditVegSelectionLabels() {
    const room = cultivationRooms.vegRooms.find((r) => r.id === editVegRoomId);
    const bay = room?.bays?.find((b) => b.id === editVegBayId);
    const tableNames =
      bay?.tables.filter((t) => editVegTableIds.includes(t.id)).map((t) => t.name) || [];
    return {
      roomName: room?.name || "",
      bayName: bay?.name || "",
      tableNames,
    };
  }

  function toggleEditVegTableId(tableId: string) {
    setEditVegTableIds((current) =>
      current.includes(tableId) ? current.filter((id) => id !== tableId) : [...current, tableId],
    );
  }

  function openEditVegBatchModal(b: any) {
    if (!canManageCultivationBatchPlacement()) {
      showManagerBatchEditNotice();
      return;
    }
    if (!b || String(b.stage || "") !== "Veg") return;

    setEditVegModalBatch(b);
    setEditVegPlants(String(Math.max(0, num(b.plants))));
    setEditVegStrain(String(b.strain ?? "").trim());
    setEditVegAcronym(String(b.acronym ?? "").trim().toUpperCase());
    const cd = b.cloneDate ? String(b.cloneDate).slice(0, 10) : "";
    setEditVegCloneDate(cd);
    setEditVegBatchNotes(String(b.batchNotes ?? "").trim());

    const veg = cultivationRooms.vegRooms || [];
    let roomId = "";
    let bayId = "";
    let tableIds: string[] = [];

    if (b.vegRoomId && veg.some((r) => r.id === b.vegRoomId)) {
      roomId = String(b.vegRoomId);
      const r0 = veg.find((x) => x.id === roomId);
      if (b.vegBayId && r0?.bays?.some((bb) => bb.id === b.vegBayId)) {
        bayId = String(b.vegBayId);
      } else if (r0?.bays?.[0]) {
        bayId = r0.bays[0].id;
      }
      if (Array.isArray(b.vegTableIds) && b.vegTableIds.length > 0 && bayId) {
        const bayObj = r0?.bays?.find((bb) => bb.id === bayId);
        const allowed = new Set((bayObj?.tables || []).map((t) => t.id));
        tableIds = (b.vegTableIds as unknown[]).filter((id) => allowed.has(String(id))).map(String);
      }
    } else if (typeof b.vegRoom === "string" && b.vegRoom.trim()) {
      const byName = veg.find((v) => v.name === b.vegRoom.trim());
      if (byName) {
        roomId = byName.id;
        const b0 = byName.bays?.[0];
        bayId = b0?.id || "";
        tableIds = [];
      }
    }

    if (!roomId && veg.length > 0) {
      roomId = veg[0].id;
      bayId = veg[0].bays?.[0]?.id || "";
      tableIds = [];
    }

    setEditVegRoomId(roomId);
    setEditVegBayId(bayId);
    setEditVegTableIds(tableIds);
  }

  function closeEditVegModal() {
    if (isSavingEditVegModal) return;
    setEditVegModalBatch(null);
  }

  function openEditCloneBatchModal(b: any) {
    if (!canManageCultivationBatchPlacement()) {
      showManagerBatchEditNotice();
      return;
    }
    if (!b || String(b.stage || "") !== "Clone") return;

    setEditCloneModalBatch(b);
    setEditClonePlants(String(Math.max(0, num(b.plants))));
    setEditCloneStrain(String(b.strain ?? "").trim());
    setEditCloneAcronym(String(b.acronym ?? "").trim().toUpperCase());
    const cd = b.cloneDate ? String(b.cloneDate).slice(0, 10) : "";
    setEditCloneDate(cd);
    setEditCloneBatchNotes(String(b.batchNotes ?? "").trim());
  }

  function closeEditCloneModal() {
    if (isSavingEditCloneModal) return;
    setEditCloneModalBatch(null);
  }

  function promptUncombineMergedPartnerFromModal(survivor: any, partnerIdRaw: string) {
    if (!canManageCultivationBatchPlacement()) {
      showManagerBatchEditNotice();
      return;
    }
    if (uncombineBusyPartnerId) return;

    const sid = String(survivor?.id || "");
    const pid = String(partnerIdRaw || "").trim();
    if (!sid || !pid) return;

    const idList = Array.isArray(survivor.combinedFromBatchIds)
      ? survivor.combinedFromBatchIds.map((x: any) => String(x))
      : [];
    if (!idList.includes(pid)) {
      showNotice("Uncombine failed", "That batch is not listed as merged into this survivor.");
      return;
    }

    const previewIdx = s.completedCultivationBatches.findIndex((b: any) => b?.id === pid);
    const partnerPreview =
      previewIdx >= 0 ? s.completedCultivationBatches[previewIdx] : null;
    if (!partnerPreview || String(partnerPreview.mergedIntoBatchId || "") !== sid) {
      showNotice(
        "Uncombine failed",
        "The absorbed batch could not be found as a merged (completed) record. Try refreshing.",
      );
      return;
    }

    const resolved = resolveAbsorbedPlantsAndStageForUncombine(
      partnerPreview,
      s.logs,
      sid,
      pid,
    );
    if (!resolved) {
      showNotice(
        "Uncombine failed",
        "Could not resolve plant counts — merge snapshot or Combine Batches log entry is missing.",
      );
      return;
    }

    const { plants: plantsAbsorbed, stage: stageFinal } = resolved;

    showConfirm(
      "Uncombine batches?",
      `Restore ${pid} as its own batch (${plantsAbsorbed} plants, ${stageFinal}) and subtract ${plantsAbsorbed} plants from survivor ${sid}?`,
      () => {
        void (async () => {
          setUncombineBusyPartnerId(pid);
          try {
            const idxPartner = Array.isArray(survivor.combinedFromBatchIds)
              ? survivor.combinedFromBatchIds.findIndex((x: any) => String(x) === pid)
              : -1;
            if (idxPartner < 0) {
              showNotice(
                "Uncombine failed",
                "The merged-batch list changed. Close this dialog and try again.",
              );
              return;
            }

            const refreshedDoneIdx = s.completedCultivationBatches.findIndex((b: any) => b?.id === pid);
            const pRestore =
              refreshedDoneIdx >= 0 ? s.completedCultivationBatches[refreshedDoneIdx] : null;
            if (!pRestore || String(pRestore.mergedIntoBatchId || "") !== sid) {
              showNotice("Uncombine failed", "Partner batch no longer matches. Refresh and retry.");
              return;
            }

            survivor.combinedFromBatchIds.splice(idxPartner, 1);
            if (survivor.combinedFromBatchIds.length === 0) {
              delete survivor.combinedFromBatchIds;
            }

            survivor.plants = Math.max(0, num(survivor.plants) - plantsAbsorbed);
            const flowerish = String(survivor.stage || "").toLowerCase();
            if (
              flowerish === "flower" ||
              flowerish === "partially harvested" ||
              flowerish === "harvested"
            ) {
              survivor.plantsAtFlower = Math.max(
                0,
                num(survivor.plantsAtFlower ?? survivor.plants) - plantsAbsorbed,
              );
              recomputeDryCanopyForCultivationBatch(survivor, cultivationRooms);
            }

            delete pRestore.mergedIntoSnapshot;
            pRestore.mergedIntoBatchId = undefined;
            pRestore.status = "Active";
            pRestore.stage = stageFinal;
            pRestore.plants = plantsAbsorbed;
            pRestore.completedAt = undefined;

            s.completedCultivationBatches.splice(refreshedDoneIdx, 1);
            s.cultivationBatches.unshift(pRestore);

            const mergeData = {
              uncombineBatches: true,
              survivorBatchId: sid,
              restoredBatchId: pid,
              plantsRestoredToPartner: plantsAbsorbed,
              stageRestored: stageFinal,
              survivorPlantsAfter: survivor.plants,
            };

            const outSurvivor = `Uncombined ${pid} (${plantsAbsorbed} plants, ${stageFinal}). Survivor ${sid} plants now ${survivor.plants}.`;
            const outPartner = `Restored active (${plantsAbsorbed} plants, ${stageFinal}) after uncombine from ${sid}.`;

            s.logs.unshift(
              withLoggedBy({
                area: "Cultivation",
                batch: sid,
                task: "Uncombine Batches",
                output: outSurvivor,
                linkedBatch: pid,
                data: mergeData,
                time: nowIsoForLog(),
              }),
            );
            s.logs.unshift(
              withLoggedBy({
                area: "Cultivation",
                batch: pid,
                task: "Uncombine Batches",
                output: outPartner,
                linkedBatch: sid,
                data: mergeData,
                time: nowIsoForLog(),
              }),
            );

            forceRefresh();

            try {
              await createLog({
                area: "Audit",
                batch: sid,
                task: "Uncombine Batches",
                output: outSurvivor,
                data: mergeData,
              });
            } catch (e) {
              console.error("Could not persist uncombine audit log:", e);
              showNotice(
                "Log sync warning",
                "Uncombine was saved locally, but the audit line may not have reached the server.",
              );
            }

            showSyncMessageNotice("Saving uncombine to server…");
            const okS = await saveRealCultivationBatch(survivor);
            const okP = await saveRealCultivationBatch(pRestore);
            showSyncMessageNotice(
              okS && okP
                ? "Uncombine saved to server."
                : "Saved locally — server sync may have failed for one batch.",
            );
          } finally {
            setUncombineBusyPartnerId(null);
          }
        })();
      },
    );
  }

  async function saveEditVegBatchModal() {
    if (!editVegModalBatch || !canManageCultivationBatchPlacement()) return;

    const vr = cultivationRooms.vegRooms || [];
    const taskRequiredFields: { label: string; value: unknown; positive?: boolean }[] = [
      { label: "Strain", value: editVegStrain.trim() },
      { label: "Strain acronym", value: editVegAcronym.trim() },
      { label: "Plants", value: editVegPlants, positive: true },
    ];

    if (vr.length > 0) {
      taskRequiredFields.push({ label: "Veg room", value: editVegRoomId.trim() });
      const vegRoomObj = vr.find((r) => r.id === editVegRoomId);
      if (vegRoomObj && vegRoomObj.bays.length > 0) {
        taskRequiredFields.push({ label: "Veg bay", value: editVegBayId.trim() });
        const bayObj = vegRoomObj.bays.find((b) => b.id === editVegBayId);
        if (bayObj && bayObj.tables.length > 0) {
          taskRequiredFields.push({
            label: "Veg table(s)",
            value: editVegTableIds.length > 0 ? editVegTableIds.join(",") : "",
          });
        }
      }
    }

    if (!requireFieldsStyled(taskRequiredFields)) return;

    setIsSavingEditVegModal(true);
    const b = editVegModalBatch;
    const before = {
      strain: b.strain,
      acronym: b.acronym,
      cloneDate: b.cloneDate,
      plants: b.plants,
      vegRoomId: b.vegRoomId,
      vegBayId: b.vegBayId,
      vegTableIds: Array.isArray(b.vegTableIds) ? [...b.vegTableIds] : [],
      vegRoom: b.vegRoom,
      vegBay: b.vegBay,
      vegTables: Array.isArray(b.vegTables) ? [...b.vegTables] : undefined,
      batchNotes: b.batchNotes,
    };

    b.strain = editVegStrain.trim();
    b.acronym = editVegAcronym.trim().toUpperCase();
    b.cloneDate = editVegCloneDate.trim();
    b.plants = num(editVegPlants);
    b.batchNotes = editVegBatchNotes.trim();

    if (vr.length > 0 && editVegRoomId.trim()) {
      const vl = resolveEditVegSelectionLabels();
      b.vegRoomId = editVegRoomId.trim();
      b.vegBayId = editVegBayId.trim();
      b.vegTableIds = [...editVegTableIds];
      b.vegRoom = vl.roomName;
      b.vegBay = vl.bayName;
      b.vegTables = [...vl.tableNames];
    }

    const after = {
      strain: b.strain,
      acronym: b.acronym,
      cloneDate: b.cloneDate,
      plants: b.plants,
      vegRoomId: b.vegRoomId,
      vegBayId: b.vegBayId,
      vegTableIds: b.vegTableIds,
      vegRoom: b.vegRoom,
      vegBay: b.vegBay,
      vegTables: b.vegTables,
      batchNotes: b.batchNotes,
    };

    const output =
      `Updated batch details | Room: ${after.vegRoom || "—"} | Bay: ${after.vegBay || "—"} | Tables: ` +
      `${Array.isArray(after.vegTables) && after.vegTables.length ? after.vegTables.join(", ") : "—"}`;
    const loggedAtIso = new Date().toISOString();
    const auditBase = {
      area: "Audit",
      batch: b.id,
      task: "Batch Details Updated",
      output: `Edited Veg batch fields (${b.id})`,
      data: {
        stage: "Veg",
        before,
        after,
        editedAtIso: loggedAtIso,
      },
      time: nowIsoForLog(),
    };
    s.logs.unshift(withLoggedBy(auditBase));

    forceRefresh();
    try {
      await createLog({
        area: auditBase.area,
        batch: auditBase.batch,
        task: auditBase.task,
        output,
        data: auditBase.data,
      });
    } catch (e) {
      console.error("Could not persist batch edit audit log:", e);
      showNotice(
        "Log sync warning",
        "Batch was updated locally, but the audit line may not have saved to the server.",
        "Refresh and check task history if needed.",
      );
    }
    try {
      showSyncMessageNotice("Saving batch to server…");
      const ok = await saveRealCultivationBatch(b);
      showSyncMessageNotice(ok ? "Batch saved to server." : "Saved locally — server sync failed.");
    } finally {
      setEditVegModalBatch(null);
      setIsSavingEditVegModal(false);
    }
  }

  async function saveEditCloneBatchModal() {
    if (!editCloneModalBatch || !canManageCultivationBatchPlacement()) return;

    const taskRequiredFields: { label: string; value: unknown; positive?: boolean }[] = [
      { label: "Strain", value: editCloneStrain.trim() },
      { label: "Strain acronym", value: editCloneAcronym.trim() },
      { label: "Plants", value: editClonePlants, positive: true },
    ];

    if (!requireFieldsStyled(taskRequiredFields)) return;

    setIsSavingEditCloneModal(true);
    const b = editCloneModalBatch;
    const before = {
      strain: b.strain,
      acronym: b.acronym,
      cloneDate: b.cloneDate,
      plants: b.plants,
      batchNotes: b.batchNotes,
    };

    b.strain = editCloneStrain.trim();
    b.acronym = editCloneAcronym.trim().toUpperCase();
    b.cloneDate = editCloneDate.trim();
    b.plants = num(editClonePlants);
    b.batchNotes = editCloneBatchNotes.trim();

    const after = {
      strain: b.strain,
      acronym: b.acronym,
      cloneDate: b.cloneDate,
      plants: b.plants,
      batchNotes: b.batchNotes,
    };

    const output = `Edited Clone batch (${b.id}) | Plants: ${after.plants} | Strain: ${after.strain}`;
    const loggedAtIso = new Date().toISOString();
    const auditBase = {
      area: "Audit",
      batch: b.id,
      task: "Batch Details Updated",
      output: `Edited Clone batch fields (${b.id})`,
      data: {
        stage: "Clone",
        before,
        after,
        editedAtIso: loggedAtIso,
      },
      time: nowIsoForLog(),
    };
    s.logs.unshift(withLoggedBy(auditBase));

    forceRefresh();
    try {
      await createLog({
        area: auditBase.area,
        batch: auditBase.batch,
        task: auditBase.task,
        output,
        data: auditBase.data,
      });
    } catch (e) {
      console.error("Could not persist batch edit audit log:", e);
      showNotice(
        "Log sync warning",
        "Batch was updated locally, but the audit line may not have saved to the server.",
        "Refresh and check task history if needed.",
      );
    }
    try {
      showSyncMessageNotice("Saving batch to server…");
      const ok = await saveRealCultivationBatch(b);
      showSyncMessageNotice(ok ? "Batch saved to server." : "Saved locally — server sync failed.");
    } finally {
      setEditCloneModalBatch(null);
      setIsSavingEditCloneModal(false);
    }
  }

  function resolveEditFlowerSelectionLabels() {
    const room = cultivationRooms.flowerRooms.find((r) => r.id === editFlowerRoomId);
    const bay = room?.bays?.find((b) => b.id === editFlowerBayId);
    const tableNames =
      bay?.tables.filter((t) => editFlowerTableIds.includes(t.id)).map((t) => t.name) || [];
    return {
      roomName: room?.name || "",
      bayName: bay?.name || "",
      tableNames,
    };
  }

  function toggleEditFlowerTableId(tableId: string) {
    setEditFlowerTableIds((current) =>
      current.includes(tableId) ? current.filter((id) => id !== tableId) : [...current, tableId],
    );
  }

  function openEditFlowerBatchModal(b: any) {
    if (!canManageCultivationBatchPlacement()) {
      showManagerBatchEditNotice();
      return;
    }
    if (!b || stageBucketFromBatchStage(b.stage) !== "Flower") return;

    setEditFlowerModalBatch(b);
    setEditFlowerPlants(String(Math.max(0, num(b.plants))));
    setEditFlowerStrain(String(b.strain ?? "").trim());
    setEditFlowerAcronym(String(b.acronym ?? "").trim().toUpperCase());
    const cd = b.cloneDate ? String(b.cloneDate).slice(0, 10) : "";
    setEditFlowerCloneDate(cd);
    setEditFlowerBatchNotes(String(b.batchNotes ?? "").trim());

    const fr = cultivationRooms.flowerRooms || [];
    let roomId = "";
    let bayId = "";
    let tableIds: string[] = [];

    if (b.flowerRoomId && fr.some((r) => r.id === b.flowerRoomId)) {
      roomId = String(b.flowerRoomId);
      const r0 = fr.find((x) => x.id === roomId);
      if (b.flowerBayId && r0?.bays?.some((bb) => bb.id === b.flowerBayId)) {
        bayId = String(b.flowerBayId);
      } else if (r0?.bays?.[0]) {
        bayId = r0.bays[0].id;
      }
      if (Array.isArray(b.flowerTableIds) && b.flowerTableIds.length > 0 && bayId) {
        const bayObj = r0?.bays?.find((bb) => bb.id === bayId);
        const allowed = new Set((bayObj?.tables || []).map((t) => t.id));
        tableIds = (b.flowerTableIds as unknown[]).filter((id) => allowed.has(String(id))).map(String);
      }
    } else if (typeof b.flowerRoom === "string" && b.flowerRoom.trim()) {
      const byName = fr.find((r) => r.name === b.flowerRoom.trim());
      if (byName) {
        roomId = byName.id;
        const b0 = byName.bays?.[0];
        bayId = b0?.id || "";
        tableIds = [];
      }
    }

    if (!roomId && fr.length > 0) {
      roomId = fr[0].id;
      bayId = fr[0].bays?.[0]?.id || "";
      tableIds = [];
    }

    setEditFlowerRoomId(roomId);
    setEditFlowerBayId(bayId);
    setEditFlowerTableIds(tableIds);
  }

  function closeEditFlowerModal() {
    if (isSavingEditFlowerModal) return;
    setEditFlowerModalBatch(null);
  }

  async function saveEditFlowerBatchModal() {
    if (!editFlowerModalBatch || !canManageCultivationBatchPlacement()) return;

    const fr = cultivationRooms.flowerRooms || [];
    const taskRequiredFields: { label: string; value: unknown; positive?: boolean }[] = [
      { label: "Strain", value: editFlowerStrain.trim() },
      { label: "Strain acronym", value: editFlowerAcronym.trim() },
      { label: "Plants", value: editFlowerPlants, positive: true },
    ];

    if (fr.length > 0) {
      taskRequiredFields.push({ label: "Flower room", value: editFlowerRoomId.trim() });
      const flowerRoomObj = fr.find((r) => r.id === editFlowerRoomId);
      if (flowerRoomObj && flowerRoomObj.bays.length > 0) {
        taskRequiredFields.push({ label: "Flower bay", value: editFlowerBayId.trim() });
        const bayObj = flowerRoomObj.bays.find((bb) => bb.id === editFlowerBayId);
        if (bayObj && bayObj.tables.length > 0) {
          taskRequiredFields.push({
            label: "Flower table(s)",
            value: editFlowerTableIds.length > 0 ? editFlowerTableIds.join(",") : "",
          });
        }
      }
    }

    if (!requireFieldsStyled(taskRequiredFields)) return;

    setIsSavingEditFlowerModal(true);
    const b = editFlowerModalBatch;
    const before = {
      strain: b.strain,
      acronym: b.acronym,
      cloneDate: b.cloneDate,
      plants: b.plants,
      plantsAtFlower: b.plantsAtFlower,
      flowerRoomId: b.flowerRoomId,
      flowerBayId: b.flowerBayId,
      flowerTableIds: Array.isArray(b.flowerTableIds) ? [...b.flowerTableIds] : [],
      flowerRoom: b.flowerRoom,
      flowerBay: b.flowerBay,
      flowerTables: Array.isArray(b.flowerTables) ? [...b.flowerTables] : undefined,
      batchNotes: b.batchNotes,
    };

    b.strain = editFlowerStrain.trim();
    b.acronym = editFlowerAcronym.trim().toUpperCase();
    b.cloneDate = editFlowerCloneDate.trim();
    b.plants = num(editFlowerPlants);
    if (String(b.stage || "").trim() === "Flower") {
      b.plantsAtFlower = num(editFlowerPlants);
    }
    b.batchNotes = editFlowerBatchNotes.trim();

    if (fr.length > 0 && editFlowerRoomId.trim()) {
      const fl = resolveEditFlowerSelectionLabels();
      b.flowerRoomId = editFlowerRoomId.trim();
      b.flowerBayId = editFlowerBayId.trim();
      b.flowerTableIds = [...editFlowerTableIds];
      b.flowerRoom = fl.roomName;
      b.flowerBay = fl.bayName;
      b.flowerTables = [...fl.tableNames];
      recomputeDryCanopyForCultivationBatch(b, cultivationRooms);
    }

    const after = {
      strain: b.strain,
      acronym: b.acronym,
      cloneDate: b.cloneDate,
      plants: b.plants,
      plantsAtFlower: b.plantsAtFlower,
      flowerRoomId: b.flowerRoomId,
      flowerBayId: b.flowerBayId,
      flowerTableIds: b.flowerTableIds,
      flowerRoom: b.flowerRoom,
      flowerBay: b.flowerBay,
      flowerTables: b.flowerTables,
      batchNotes: b.batchNotes,
    };

    const output =
      `Updated flower batch details | Room: ${after.flowerRoom || "—"} | Bay: ${after.flowerBay || "—"} | Tables: ` +
      `${Array.isArray(after.flowerTables) && after.flowerTables.length ? after.flowerTables.join(", ") : "—"}`;
    const loggedAtIso = new Date().toISOString();
    const auditBase = {
      area: "Audit",
      batch: b.id,
      task: "Batch Details Updated",
      output: `Edited Flower batch fields (${b.id})`,
      data: {
        stageBucket: "Flower",
        batchStage: b.stage,
        before,
        after,
        editedAtIso: loggedAtIso,
      },
      time: nowIsoForLog(),
    };
    s.logs.unshift(withLoggedBy(auditBase));

    forceRefresh();
    try {
      await createLog({
        area: auditBase.area,
        batch: auditBase.batch,
        task: auditBase.task,
        output,
        data: auditBase.data,
      });
    } catch (e) {
      console.error("Could not persist batch edit audit log:", e);
      showNotice(
        "Log sync warning",
        "Batch was updated locally, but the audit line may not have saved to the server.",
        "Refresh and check task history if needed.",
      );
    }
    try {
      showSyncMessageNotice("Saving batch to server…");
      const ok = await saveRealCultivationBatch(b);
      showSyncMessageNotice(ok ? "Batch saved to server." : "Saved locally — server sync failed.");
    } finally {
      setEditFlowerModalBatch(null);
      setIsSavingEditFlowerModal(false);
    }
  }

  function computeCultivationLaborFields():
    | {
        ok: true;
        people: number;
        netMinutesPerPerson: number;
        totalLaborMinutes: number;
        laborDetail: Record<string, unknown>;
        outputSuffix: string;
        peopleStr: string;
        minutesStr: string;
      }
    | { ok: false; title: string; message: string } {
    const p = num(people);
    if (!(p > 0)) {
      return { ok: false, title: "People required", message: "Enter how many people worked on this task." };
    }

    if (laborTimeMode === "total") {
      if (!hasMinimumRole("MANAGER")) {
        return {
          ok: false,
          title: "Manager access",
          message:
            "Only Managers (and above) can enter a quick total-minute labor entry. Use start/end time, or ask a manager.",
        };
      }
      const m = num(minutes);
      if (!(m > 0)) {
        return { ok: false, title: "Minutes required", message: "Enter minutes per person for this task." };
      }
      const total = p * m;
      return {
        ok: true,
        people: p,
        netMinutesPerPerson: m,
        totalLaborMinutes: total,
        laborDetail: {
          laborTimeMode: "total",
          totalLaborMinutes: total,
        },
        outputSuffix: ` | Labor: ${p} people × ${m} min = ${total} person-min (manager quick entry)`,
        peopleStr: String(p),
        minutesStr: String(m),
      };
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(taskLaborDate.trim())) {
      return { ok: false, title: "Labor date", message: "Pick the calendar day this work occurred (facility clock day)." };
    }
    const st = taskStartTime.trim();
    const en = taskEndTime.trim();
    if (!st || !en) {
      return { ok: false, title: "Start / end time", message: "Enter task start and end clock times (24h). If end is “earlier” than start, it counts as the next morning (overnight shift)." };
    }

    const r = computeLaborRangeDeduction({
      startHm: st,
      endHm: en,
      breaks: laborBreakSchedule,
    });

    if (!(r.netMinutes > 0)) {
      return {
        ok: false,
        title: "No net labor time",
        message:
          "After subtracting configured breaks/lunch overlap, net time is zero. Adjust times or company break windows under Admin → Company Config.",
      };
    }

    const total = p * r.netMinutes;
    const bnote =
      r.breakDeductionMinutes > 0
        ? `; breaks/lunch overlap removed ${r.breakDeductionMinutes} min from span`
        : "";
    return {
      ok: true,
      people: p,
      netMinutesPerPerson: r.netMinutes,
      totalLaborMinutes: total,
      laborDetail: {
        laborTimeMode: "range",
        laborDate: taskLaborDate.trim(),
        taskStartTime: st,
        taskEndTime: en,
        grossLaborMinutes: r.grossMinutes,
        breakDeductionMinutes: r.breakDeductionMinutes,
        totalLaborMinutes: total,
      },
      outputSuffix: ` | Labor: ${p} people × ${r.netMinutes} min net (${r.grossMinutes} min span${bnote}) = ${total} person-min`,
      peopleStr: String(p),
      minutesStr: String(r.netMinutes),
    };
  }

  const cultivationLaborRangePreview = useMemo(() => {
    if (laborTimeMode !== "range") return null;
    const st = taskStartTime.trim();
    const en = taskEndTime.trim();
    if (!st || !en) return null;
    const r = computeLaborRangeDeduction({
      startHm: st,
      endHm: en,
      breaks: laborBreakSchedule,
    });
    const p = num(people);
    return {
      gross: r.grossMinutes,
      breakDeduction: r.breakDeductionMinutes,
      netPerPerson: r.netMinutes,
      totalPersonMin: p > 0 ? p * r.netMinutes : null,
    };
  }, [laborTimeMode, taskStartTime, taskEndTime, laborBreakSchedule, people]);

  const vegTagPreview = useMemo(() => {
    const raw = vegMoveCount.trim();
    const n = Number(raw);
    if (raw === "" || !Number.isFinite(n) || n < 1) {
      return { ok: null, tags: [] as string[], error: "" };
    }
    return generateMetrcTagSequence(vegFirstMetrcTag, n);
  }, [vegFirstMetrcTag, vegMoveCount]);

  async function saveCreateImmaturePlantBatch(lab: {
    ok: true;
    peopleStr: string;
    minutesStr: string;
    totalLaborMinutes: number;
    laborDetail: Record<string, unknown>;
    outputSuffix: string;
  }) {
    if (!selectedBatch) return;
    if (String(selectedBatch.stage || "") !== "Clone") {
      showNotice("Wrong stage", "Create Immature Plant Batch is only available for Clone-stage batches.");
      return;
    }
    const n = Number(imbCount.trim());
    if (!imbName.trim() || !imbStrain.trim() || !imbLocation.trim() || !imbPlantDate.trim()) {
      showNotice("Missing fields", "Batch name, strain, location, and plant date are required.");
      return;
    }
    if (!Number.isFinite(n) || n < 1) {
      showNotice("Invalid count", "Enter a clone/plant count of at least 1.");
      return;
    }
    if (!Array.isArray(selectedBatch.immaturePlantBatches)) selectedBatch.immaturePlantBatches = [];
    const now = new Date().toISOString();
    const id = `IPB-${selectedBatch.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    selectedBatch.immaturePlantBatches.push({
      id,
      cultivationBatchId: selectedBatch.id,
      name: imbName.trim(),
      strain: imbStrain.trim(),
      countOriginal: n,
      countAvailable: n,
      location: imbLocation.trim(),
      sublocation: imbSublocation.trim() || undefined,
      plantDate: imbPlantDate.trim(),
      sourceType: imbSourceType.trim() || undefined,
      notes: imbNotes.trim() || undefined,
      metrcBatchId: imbMetrcBatchId.trim() || undefined,
      metrcSyncStatus: imbMetrcSyncStatus,
      createdAt: now,
      updatedAt: now,
    });
    syncClonePlantsFromImmature(selectedBatch);
    const detailNote = [
      `Immature batch "${imbName.trim()}" (${n} plants) — ${imbLocation.trim()}`,
      imbSublocation.trim() ? `Sub: ${imbSublocation.trim()}` : "",
      imbSourceType.trim() ? `Source: ${imbSourceType.trim()}` : "",
      imbMetrcBatchId.trim() ? `METRC immature ID: ${imbMetrcBatchId.trim()}` : "",
      `METRC sync: ${imbMetrcSyncStatus}`,
    ]
      .filter(Boolean)
      .join(" | ");
    s.logs.unshift(
      withLoggedBy({
        area: "Cultivation",
        batch: selectedBatch.id,
        task: TASK_CREATE_IMMATURE_PLANT_BATCH,
        people: lab.peopleStr,
        minutes: lab.minutesStr,
        totalLaborMinutes: lab.totalLaborMinutes,
        output: `${detailNote}${lab.outputSuffix}`,
        time: nowIsoForLog(),
        data: {
          ...lab.laborDetail,
          totalLaborMinutes: lab.totalLaborMinutes,
          immaturePlantBatchId: id,
        },
      }),
    );
    setImbName("");
    setImbStrain("");
    setImbCount("");
    setImbLocation("");
    setImbSublocation("");
    setImbPlantDate("");
    setImbSourceType("");
    setImbNotes("");
    setImbMetrcBatchId("");
    setImbMetrcSyncStatus("Not Synced");
    setPeople("");
    setMinutes("");
    setLaborTimeMode("range");
    setTaskLaborDate(getTodayYmdInCompanyTimezone());
    setTaskStartTime("");
    setTaskEndTime("");
    setShowTaskWindow(false);
    forceRefresh();
    try {
      showSyncMessageNotice("Saving immature plant batch…");
      const synced = await saveRealCultivationBatch(selectedBatch);
      showSyncMessageNotice(synced ? "Saved to server." : "Saved locally — server sync failed.");
    } catch (e) {
      console.error(e);
    }
  }

  async function commitMoveToVegFlow(
    lab: {
      ok: true;
      peopleStr: string;
      minutesStr: string;
      totalLaborMinutes: number;
      laborDetail: Record<string, unknown>;
      outputSuffix: string;
    },
    tags: string[],
    imb: any,
  ) {
    if (!selectedBatch) return;
    const batch = selectedBatch;
    const moved = tags.length;
    const availBefore = num(imb.countAvailable);
    const otherAvail = sumImmatureAvailableExcluding(batch.immaturePlantBatches, String(imb.id));
    const isPartialScenario =
      moved < availBefore || (moved === availBefore && otherAvail > 0);

    const vl = resolveVegSelectionLabels();
    const moveDateCanonical = stageMoveDate.trim();
    const logEventTimeIso = logTimeIsoForStageMoveDate(moveDateCanonical);

    const payload = buildMetrcVegMovePayload({
      immatureBatchName: String(imb.name || imb.strain || batch.id),
      countMovingToVeg: moved,
      startingTag: tags[0] || "",
      newLocationLabel: vl.roomName || "",
      newSublocation: vegSublocationDraft.trim(),
      growthDateYmd: moveDateCanonical,
    });

    if (isPartialScenario) {
      pendingPartialSplitRef.current = {
        lab,
        sourceBatchId: batch.id,
        movedPlants: moved,
        taskKey: TASK_MOVE_TO_VEG_ASSIGN_TAGS,
        stageMoveDate: moveDateCanonical,
        vegRoomId,
        vegBayId,
        vegTableIds: [...vegTableIds],
        flowerRoomId,
        flowerBayId,
        flowerTableIds: [...flowerTableIds],
        immaturePlantBatchId: String(imb.id),
        generatedTags: tags,
        vegSublocation: vegSublocationDraft.trim(),
        immatureBatchName: String(imb.name || ""),
      };
      const candidates = findPartialStageMergeCandidates(batch.id, "Veg");
      if (candidates.length > 0) {
        setPartialSplitChoiceModal({
          candidates: candidates.map((b: any) => ({
            id: b.id,
            plants: num(b.plants),
            strain: String(b.strain || "—"),
          })),
          mergeTargetId: String(candidates[0]?.id || ""),
        });
        return;
      }
      await applyPartialStageMove(null);
      return;
    }

    applyImmatureDecrement(batch, String(imb.id), moved);
    syncClonePlantsFromImmature(batch);

    const now = new Date().toISOString();
    const records = tags.map((tag) => ({
      id:
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `PT-${batch.id}-${tag}-${now}`,
      cultivationBatchId: batch.id,
      immaturePlantBatchId: String(imb.id),
      tag,
      strain: String(imb.strain || batch.strain || ""),
      stage: "Veg",
      location: vl.roomName || "",
      sublocation: vegSublocationDraft.trim() || undefined,
      status: "Active",
      metrcPlantId: undefined,
      createdAt: now,
      updatedAt: now,
    }));
    ensurePlantTagRecords(batch).push(...records);

    batch.stage = "Veg";
    batch.plants = records.length;
    batch.vegRoomId = vegRoomId;
    batch.vegBayId = vegBayId;
    batch.vegTableIds = [...vegTableIds];
    batch.vegRoom = vl.roomName;
    batch.vegBay = vl.bayName;
    batch.vegTables = [...vl.tableNames];
    if (vegSublocationDraft.trim()) batch.vegSublocation = vegSublocationDraft.trim();

    const layoutTail = `Move date: ${moveDateCanonical} | Room: ${vl.roomName || "—"} | Bay: ${vl.bayName || "—"} | Tables: ${
      vl.tableNames.length ? vl.tableNames.join(", ") : "—"
    }`;

    const noteSuffix = vegMoveNotes.trim() ? ` Notes: ${vegMoveNotes.trim()}` : "";

    s.logs.unshift(
      withLoggedBy({
        area: "Cultivation",
        batch: batch.id,
        task: TASK_MOVE_TO_VEG_ASSIGN_TAGS,
        people: lab.peopleStr,
        minutes: lab.minutesStr,
        totalLaborMinutes: lab.totalLaborMinutes,
        output: `${moved} plants assigned METRC tags (${tags[0]} → ${tags[moved - 1]}) | ${layoutTail}${noteSuffix}${lab.outputSuffix}`,
        room: vl.roomName || undefined,
        bay: vl.bayName || undefined,
        tables: vl.tableNames.length ? [...vl.tableNames] : undefined,
        time: logEventTimeIso,
        data: {
          stageMoveDate: moveDateCanonical,
          ...lab.laborDetail,
          totalLaborMinutes: lab.totalLaborMinutes,
          metrcVegMovePayload: payload,
          metrcPreparedLocalOnly: true,
          immaturePlantBatchId: imb.id,
          metrcPlantTags: tags,
        },
      }),
    );

    setSelectedTask("Set Irrigation Up");
    setPeople("");
    setMinutes("");
    setLaborTimeMode("range");
    setTaskLaborDate(getTodayYmdInCompanyTimezone());
    setTaskStartTime("");
    setTaskEndTime("");
    setOutput("");
    setVegMoveCount("");
    setVegFirstMetrcTag("");
    setVegSublocationDraft("");
    setVegMoveNotes("");
    setVegTagOverlapAck(false);
    setVegSubmitConfirmAck(false);
    setCombinePartnerBatchId("");
    primeTaskModalLocationFields(cultivationRooms);
    setShowTaskWindow(false);
    forceRefresh();
    try {
      showSyncMessageNotice("Saving veg transition…");
      const synced = await saveRealCultivationBatch(batch);
      showSyncMessageNotice(synced ? "Saved to server." : "Saved locally — server sync failed.");
    } catch (e) {
      console.error(e);
    }
  }

  async function saveMoveToVegAssignTags(lab: {
    ok: true;
    peopleStr: string;
    minutesStr: string;
    totalLaborMinutes: number;
    laborDetail: Record<string, unknown>;
    outputSuffix: string;
  }) {
    if (!selectedBatch) return;

    if (String(selectedBatch.stage || "") !== "Clone") {
      showNotice("Wrong stage", "Move to Veg / Assign Plant Tags is only for Clone-stage batches.");
      return;
    }

    if (!immatureHasAvailablePlants(selectedBatch)) {
      showNotice(
        "Immature batch required",
        "Create an immature plant batch first (Create Immature Plant Batch task).",
      );
      return;
    }

    const imb = (selectedBatch.immaturePlantBatches || []).find(
      (x: any) => String(x?.id || "") === vegImmatureBatchId.trim(),
    );
    if (!imb) {
      showNotice("Select immature batch", "Choose which immature plant batch you are drawing plants from.");
      return;
    }

    const avail = num(imb.countAvailable);
    const moved = Number(vegMoveCount.trim());

    if (!(moved >= 1)) {
      showNotice("Invalid count", "Enter how many plants are moving to Veg (at least 1).");
      return;
    }
    if (moved > avail) {
      showNotice("Not enough plants", `Only ${avail} immature plants remain on this line.`);
      return;
    }

    if (!vegFirstMetrcTag.trim()) {
      showNotice(
        "Starting tag required",
        "Enter the first METRC plant tag (existing tag from METRC inventory).",
      );
      return;
    }

    const seq = generateMetrcTagSequence(vegFirstMetrcTag.trim(), moved);
    if (!seq.ok) {
      showNotice("Tag sequence", seq.error);
      return;
    }

    if (new Set(seq.tags).size !== seq.tags.length) {
      showNotice("Duplicate tags", "Generated list contains duplicates — check starting tag and count.");
      return;
    }

    const existing = collectExistingPlantTagsFromCultivationBatches(s.cultivationBatches, selectedBatch.id);
    const overlaps = findOverlappingTags(seq.tags, existing);
    if (overlaps.length > 0 && !vegTagOverlapAck) {
      showNotice(
        "Tags already recorded locally",
        `These tags exist on another batch in this workspace (showing up to 12): ${overlaps.slice(0, 12).join(", ")}${overlaps.length > 12 ? "…" : ""}. Acknowledge below or correct the starting tag.`,
      );
      return;
    }

    if (!vegSubmitConfirmAck) {
      showNotice(
        "Confirmation required",
        "Check the confirmation box after reviewing first tag, last tag, location, and growth date.",
      );
      return;
    }

    if (cultivationRooms.vegRooms.length > 0 && !vegRoomId) {
      showNotice("Veg location", "Select a veg room.");
      return;
    }

    await commitMoveToVegFlow(lab, seq.tags, imb);
  }

  async function save() {
    if (isSavingTask) return;
    if (!canWriteRecords) {
      showReadOnlyNotice();
      return;
    }

    if (!selectedBatch) return;
    setIsSavingTask(true);

    const taskRequiredFields: { label: string; value: any; positive?: boolean; zeroOrPositive?: boolean }[] = [];

    if (selectedTask === "Combine Batches") {
      taskRequiredFields.push({
        label: "Other batch in this stage (to merge into the selected batch)",
        value: combinePartnerBatchId.trim(),
      });
    }

    if (selectedTask === TASK_CREATE_IMMATURE_PLANT_BATCH) {
      taskRequiredFields.push(
        { label: "Immature batch name", value: imbName.trim() },
        { label: "Strain", value: imbStrain.trim() },
        { label: "Clone/plant count", value: imbCount.trim(), positive: true },
        { label: "Location", value: imbLocation.trim() },
        { label: "Plant date", value: imbPlantDate.trim() },
      );
    }

    if (selectedTask === TASK_MOVE_TO_VEG_ASSIGN_TAGS) {
      taskRequiredFields.push(
        { label: "Immature batch", value: vegImmatureBatchId.trim() },
        { label: "Plants moving to Veg", value: vegMoveCount.trim(), positive: true },
        { label: "Starting METRC tag", value: vegFirstMetrcTag.trim() },
      );
      if (cultivationRooms.vegRooms.length > 0) {
        taskRequiredFields.push({ label: "Veg room", value: vegRoomId });
        const vegRoomObj = cultivationRooms.vegRooms.find((r) => r.id === vegRoomId);
        if (vegRoomObj && vegRoomObj.bays.length > 0) {
          taskRequiredFields.push({ label: "Veg bay", value: vegBayId });
          const bayObj = vegRoomObj.bays.find((b) => b.id === vegBayId);
          if (bayObj && bayObj.tables.length > 0) {
            taskRequiredFields.push({
              label: "Veg table(s)",
              value: vegTableIds.length > 0 ? vegTableIds.join(",") : "",
            });
          }
        }
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

    if (selectedTask === TASK_MOVE_TO_VEG_ASSIGN_TAGS || selectedTask === "Move to Flower") {
      taskRequiredFields.push({ label: "Growth / move date", value: stageMoveDate.trim() });
    }

    if (!requireFieldsStyled(taskRequiredFields)) {
      setIsSavingTask(false);
      return;
    }

    if (
      (selectedTask === TASK_MOVE_TO_VEG_ASSIGN_TAGS || selectedTask === "Move to Flower") &&
      !/^\d{4}-\d{2}-\d{2}$/.test(stageMoveDate.trim())
    ) {
      showNotice("Move date invalid", "Pick a calendar date for when this batch actually moved.");
      setIsSavingTask(false);
      return;
    }

    if (selectedTask === "Print harvest sheet") {
      openHarvestPrintSheetWindow();
      setIsSavingTask(false);
      return;
    }

    const lab = computeCultivationLaborFields();
    if (!lab.ok) {
      showNotice(lab.title, lab.message);
      setIsSavingTask(false);
      return;
    }

    if (!confirmRepeatTask(selectedBatch.id, selectedTask, save)) {
      setIsSavingTask(false);
      return;
    }

    if (!confirmStageMoveDateIfNeeded(save)) {
      setIsSavingTask(false);
      return;
    }

    if (selectedTask === "Harvest") {
      try {
        await saveHarvest(lab);
      } finally {
        setIsSavingTask(false);
      }
      return;
    }

    if (selectedTask === "Finish batch") {
      try {
        await saveFinishBatch(lab);
      } finally {
        setIsSavingTask(false);
      }
      return;
    }

    if (selectedTask === TASK_CREATE_IMMATURE_PLANT_BATCH) {
      try {
        await saveCreateImmaturePlantBatch(lab);
      } finally {
        setIsSavingTask(false);
      }
      return;
    }

    if (selectedTask === TASK_MOVE_TO_VEG_ASSIGN_TAGS) {
      try {
        await saveMoveToVegAssignTags(lab);
      } finally {
        setIsSavingTask(false);
      }
      return;
    }

    if (selectedTask === "Combine Batches") {
      const pid = combinePartnerBatchId.trim();
      const partnerIdx = s.cultivationBatches.findIndex((b: any) => b?.id === pid);
      const partner = partnerIdx >= 0 ? s.cultivationBatches[partnerIdx] : null;

      if (!partner) {
        showNotice("Merge failed", "Partner batch not found in active cultivation batches.");
        setIsSavingTask(false);
        return;
      }
      if (partner.id === selectedBatch.id) {
        showNotice("Merge failed", "Select a different batch to merge.");
        setIsSavingTask(false);
        return;
      }
      if (partner.status === "Complete") {
        showNotice("Merge failed", "That batch is already complete.");
        setIsSavingTask(false);
        return;
      }
      const bucketA = stageBucketFromBatchStage(selectedBatch.stage);
      const bucketB = stageBucketFromBatchStage(partner.stage);
      if (bucketA !== bucketB) {
        showNotice(
          "Merge failed",
          "Both batches must be in the same stage group (Clones, Veg, or Flower / partial harvest).",
        );
        setIsSavingTask(false);
        return;
      }

      const priorSurvivor = num(selectedBatch.plants);
      const priorPartner = num(partner.plants);
      const combinedTotal = priorSurvivor + priorPartner;
      const notes = String(output || "").trim();
      const survivorId = selectedBatch.id;
      const partnerId = partner.id;

      if (!Array.isArray(selectedBatch.combinedFromBatchIds)) {
        selectedBatch.combinedFromBatchIds = [];
      }
      selectedBatch.combinedFromBatchIds.push(partnerId);
      selectedBatch.plants = combinedTotal;
      const flowerish = String(selectedBatch.stage || "").toLowerCase();
      if (
        flowerish === "flower" ||
        flowerish === "partially harvested" ||
        flowerish === "harvested"
      ) {
        selectedBatch.plantsAtFlower = combinedTotal;
        recomputeDryCanopyForCultivationBatch(selectedBatch, cultivationRooms);
      }

      const survivorOutput = `Merged ${partnerId} (${priorPartner} plants) into ${survivorId} — total plants now ${combinedTotal}${
        notes ? `. Notes: ${notes}` : ""
      } | Strains: survivor ${selectedBatch.strain || "—"} ← partner ${partner.strain || "—"}`;

      const partnerOutput = `Merged into survivor ${survivorId} (${priorSurvivor} + ${priorPartner} = ${combinedTotal} plants on survivor)${
        notes ? `. Notes: ${notes}` : ""
      }`;

      const mergeData = {
        combineBatches: true,
        survivorBatchId: survivorId,
        absorbedBatchId: partnerId,
        plantsBeforeSurvivor: priorSurvivor,
        plantsBeforePartner: priorPartner,
        plantsAfterCombine: combinedTotal,
        stageBucket: bucketA,
        notes,
      };

      s.logs.unshift(
        withLoggedBy({
          area: "Cultivation",
          batch: partnerId,
          task: "Combine Batches",
          people: lab.peopleStr,
          minutes: lab.minutesStr,
          totalLaborMinutes: lab.totalLaborMinutes,
          output: partnerOutput + lab.outputSuffix,
          linkedBatch: survivorId,
          data: { ...mergeData, ...lab.laborDetail, totalLaborMinutes: lab.totalLaborMinutes },
          time: nowIsoForLog(),
        }),
      );

      s.logs.unshift(
        withLoggedBy({
          area: "Cultivation",
          batch: survivorId,
          task: "Combine Batches",
          people: lab.peopleStr,
          minutes: lab.minutesStr,
          totalLaborMinutes: lab.totalLaborMinutes,
          output: survivorOutput + lab.outputSuffix,
          linkedBatch: partnerId,
          data: { ...mergeData, ...lab.laborDetail, totalLaborMinutes: lab.totalLaborMinutes },
          time: nowIsoForLog(),
        }),
      );

      finalizeMergedPartnerBatch(partner, survivorId, {
        plantsAbsorbed: priorPartner,
        stageBeforeMerge: String(partner.stage || "").trim() || "Clone",
        statusBeforeMerge: String(partner.status || "Active").trim() || "Active",
      });

      setPeople("");
      setMinutes("");
      setLaborTimeMode("range");
      setTaskLaborDate(getTodayYmdInCompanyTimezone());
      setTaskStartTime("");
      setTaskEndTime("");
      setOutput("");
      setCombinePartnerBatchId("");
      closeCultivationTaskWindow();

      primeTaskModalLocationFields(cultivationRooms);
      forceRefresh();

      try {
        showSyncMessageNotice("Merge saved locally. Syncing to server...");
        let ok = await saveRealCultivationBatch(selectedBatch);
        ok = (await saveRealCultivationBatch(partner)) && ok;
        showSyncMessageNotice(
          ok ? "Merge synced to server." : "Merge saved locally — server sync failed (check connectivity).",
        );
      } finally {
        setIsSavingTask(false);
      }
      return;
    }

    if (selectedTask === "Move to Flower") {
      const movedPlants = Number(output);
      const currentPlants = num(selectedBatch.plants);
      if (movedPlants > currentPlants) {
        showNotice(
          "Too many plants",
          `This batch only has ${currentPlants} plants. Enter a number between 1 and ${currentPlants}.`,
        );
        setIsSavingTask(false);
        return;
      }
      if (movedPlants > 0 && movedPlants < currentPlants) {
        const candidates = findPartialStageMergeCandidates(selectedBatch.id, "Flower");
        pendingPartialSplitRef.current = {
          lab,
          sourceBatchId: selectedBatch.id,
          movedPlants,
          taskKey: "Move to Flower",
          stageMoveDate: stageMoveDate.trim(),
          vegRoomId,
          vegBayId,
          vegTableIds: [...vegTableIds],
          flowerRoomId,
          flowerBayId,
          flowerTableIds: [...flowerTableIds],
        };
        if (candidates.length > 0) {
          setPartialSplitChoiceModal({
            candidates: candidates.map((b: any) => ({
              id: b.id,
              plants: num(b.plants),
              strain: String(b.strain || "—"),
            })),
            mergeTargetId: String(candidates[0]?.id || ""),
          });
          setIsSavingTask(false);
          return;
        }
        await applyPartialStageMove(null);
        setIsSavingTask(false);
        return;
      }
    }

    let taskOutput = output;
    let logRoom: string | undefined;
    let logBay: string | undefined;
    let logTables: string[] | undefined;

    const isStageMoveTask = selectedTask === "Move to Flower";
    const moveDateCanonical = stageMoveDate.trim();
    const logEventTimeIso = isStageMoveTask
      ? logTimeIsoForStageMoveDate(moveDateCanonical)
      : nowIsoForLog();

    if (selectedTask === "Move to Flower") {
      const fl = resolveFlowerSelectionLabels();
      taskOutput = `${output || selectedBatch.plants || 0} plants moved to Flower | Move date: ${moveDateCanonical} | Room: ${fl.roomName || "—"} | Bay: ${fl.bayName || "—"} | Tables: ${fl.tableNames.length ? fl.tableNames.join(", ") : "—"}`;
      logRoom = fl.roomName;
      logBay = fl.bayName;
      logTables = fl.tableNames.length ? [...fl.tableNames] : undefined;
    }

    let challengeExtra: Record<string, unknown> = {};
    const rewardBehavior = resolveConfigurableTaskRewards(
      "Cultivation",
      selectedTask,
      customTasksRewardDefs,
    );
    if (
      rewardBehavior.eligible &&
      rewardsCfg?.enabled &&
      rewardsCfg.taskChallenge.enabled &&
      lab.ok
    ) {
      const u = getAuthUser();
      if (u && (u.rewardsEnrolled || isElevatedManagerRole(String(u.role || "")))) {
        const { avg, sampleCount } = computeAverageNormalizedMinutes(s.logs as any[], "Cultivation", selectedTask, {
          includeAreaInTaskKey: rewardsCfg.taskChallenge.includeAreaInTaskKey,
          lookbackDays: rewardsCfg.primaryWindowDays * 3,
        });
        const minSamples = rewardsCfg.taskChallenge.minSamplesForAverage;
        const effectiveAvg = sampleCount >= minSamples ? avg : null;
        const tier = scoreChallengeByLoggedMinutes(
          effectiveAvg,
          lab.netMinutesPerPerson,
          rewardsCfg.taskChallenge.tiers,
          45,
        );
        if (tier) {
          const pts = Math.max(0, Math.round(tier.points * rewardBehavior.tierMultiplier));
          challengeExtra = {
            taskChallenge: {
              pointsEarned: pts,
              tierLabel: tier.label,
              tierIndex: tier.tierIndex,
              targetMinutes: tier.targetMinutes,
              tierPointsMultiplier: rewardBehavior.tierMultiplier,
            },
          };
        }
      }
    }

    s.logs.unshift(
      withLoggedBy({
        area: "Cultivation",
        batch: selectedBatch.id,
        task: selectedTask,
        people: lab.peopleStr,
        minutes: lab.minutesStr,
        totalLaborMinutes: lab.totalLaborMinutes,
        output: taskOutput + lab.outputSuffix,
        room: logRoom,
        bay: logBay,
        tables: logTables,
        time: logEventTimeIso,
        data: {
          ...(isStageMoveTask ? { stageMoveDate: moveDateCanonical } : {}),
          ...lab.laborDetail,
          totalLaborMinutes: lab.totalLaborMinutes,
          ...challengeExtra,
          ...(selectedTask === "Add METRC Tags" && String(output || "").trim()
            ? { metrcTagsNote: String(output).trim().slice(0, 8000) }
            : {}),
        },
      }),
    )

    if (selectedTask === "Add METRC Tags") {
      const note = String(output || "").trim();
      selectedBatch.metrcTagsLastLoggedAt = nowIsoForLog();
      if (note) selectedBatch.metrcTagsLastNote = note.slice(0, 4000);
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
    setLaborTimeMode("range");
    setTaskLaborDate(getTodayYmdInCompanyTimezone());
    setTaskStartTime("");
    setTaskEndTime("");
    setOutput("");
    setCombinePartnerBatchId("");
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

  const cultivationStageModalTitle =
    selectedStage === "Clones"
      ? `Clones Batches (${selectedStageBatches.length})`
      : showStageModalRoomPicker
        ? `${selectedStage} — Select a room (${selectedStageBatches.length} batches)`
        : `${selectedStage} — ${
            stageModalEffectiveRoomId === STAGE_MODAL_UNASSIGNED_ROOM_ID
              ? "Unassigned"
              : cultivationStageModalRoomConfig?.name || "Room"
          } (${batchesForCultivationStageModal.length} batches)`;

  function cultivationStageModalBatchCard(b: any) {
    return (
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
          {b.stage === "Veg" && (b.vegRoom || b.vegBay || b.vegTable || b.vegTables) && (
            <>
              <br />
              Room: {b.vegRoom || "—"} | Bay: {b.vegBay || "—"} | Tables: {formatVegTables(b)}
            </>
          )}
          {b.stage === "Veg" && String(b.batchNotes ?? "").trim() !== "" && (
            <>
              <br />
              <span style={{ color: selectedBatch?.id === b.id ? "#0f172a" : "#cbd5e1" }}>
                Notes: {String(b.batchNotes)}
              </span>
            </>
          )}
          {b.stage === "Veg" && b.metrcTagsLastLoggedAt && (
            <>
              <br />
              <span style={{ color: selectedBatch?.id === b.id ? "#0f172a" : "#93c5fd", fontSize: 12 }}>
                METRC tags logged
                {b.metrcTagsLastNote
                  ? `: ${String(b.metrcTagsLastNote).length > 90 ? `${String(b.metrcTagsLastNote).slice(0, 90)}…` : String(b.metrcTagsLastNote)}`
                  : ""}{" "}
                ({formatLogDisplayTime({ time: b.metrcTagsLastLoggedAt, loggedAt: b.metrcTagsLastLoggedAt })})
              </span>
            </>
          )}
          {(b.stage === "Flower" || b.stage === "Partially Harvested") &&
            (b.flowerRoom || b.flowerBay || b.flowerTable || b.flowerTables) && (
              <>
                <br />
                Room: {b.flowerRoom || "—"} | Bay: {b.flowerBay || "—"} | Tables:{" "}
                {formatFlowerTables(b)}
              </>
            )}
          {(b.stage === "Flower" || b.stage === "Partially Harvested") &&
            String(b.batchNotes ?? "").trim() !== "" && (
              <>
                <br />
                <span style={{ color: selectedBatch?.id === b.id ? "#0f172a" : "#cbd5e1" }}>
                  Notes: {String(b.batchNotes)}
                </span>
              </>
            )}
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {canWriteRecords ? (
            <button
              type="button"
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
          {canManageCultivationBatchPlacement() &&
          selectedStage === "Clones" &&
          String(b.stage || "") === "Clone" ? (
            <button
              type="button"
              style={{
                ...buttonStyle,
                background: "#0f766e",
                border: "1px solid #14b8a6",
                color: "white",
              }}
              onClick={() => openEditCloneBatchModal(b)}
            >
              Edit
            </button>
          ) : null}
          {canManageCultivationBatchPlacement() && selectedStage === "Veg" && b.stage === "Veg" ? (
            <button
              type="button"
              style={{
                ...buttonStyle,
                background: "#92400e",
                border: "1px solid #ea580c",
                color: "white",
              }}
              onClick={() => openEditVegBatchModal(b)}
            >
              Edit
            </button>
          ) : null}
          {canManageCultivationBatchPlacement() && selectedStage === "Flower" ? (
            <button
              type="button"
              style={{
                ...buttonStyle,
                background: "#5b21b6",
                border: "1px solid #a855f7",
                color: "white",
              }}
              onClick={() => openEditFlowerBatchModal(b)}
            >
              Edit
            </button>
          ) : null}
          <button type="button" style={buttonStyle} onClick={() => setViewBatch(b)}>
            View
          </button>
          {canDeleteRecords && (
            <button type="button" style={dangerButtonStyle} onClick={() => deleteBatch(b.id)}>
              Delete
            </button>
          )}
        </div>
      </div>
    );
  }

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
                    {(b.vegRoom || b.vegBay || b.vegTable || b.vegTables) && (
                      <>
                        <br />
                        Room: {b.vegRoom || "—"} | Bay: {b.vegBay || "—"} | Tables: {formatVegTables(b)}
                      </>
                    )}
                    {(b.flowerRoom || b.flowerBay || b.flowerTable || b.flowerTables) && (
                      <>
                        <br />
                        Room: {b.flowerRoom || "—"} | Bay: {b.flowerBay || "—"} | Tables: {formatFlowerTables(b)}
                      </>
                    )}
                    {String(b.batchNotes ?? "").trim() !== "" && (
                      <>
                        <br />
                        Notes: {String(b.batchNotes)}
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
          <div
            style={{
              ...modalStyle,
              maxWidth:
                selectedStage !== "Clones" && stageModalUsesRoomHierarchy ? Math.max(560, 660) : modalStyle.maxWidth,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
                marginBottom: 8,
              }}
            >
              <div style={{ flex: 1 }}>
                {stageModalUsesRoomHierarchy &&
                stageModalRoomSummaries.length > 1 &&
                stageModalRoomId !== null ? (
                  <button type="button" style={buttonStyle} onClick={() => setStageModalRoomId(null)}>
                    ← Rooms
                  </button>
                ) : null}
              </div>
              <button type="button" style={buttonStyle} onClick={() => setSelectedStage(null)}>
                Close
              </button>
            </div>
            <h2 style={{ textAlign: "center", marginTop: 0 }}>{cultivationStageModalTitle}</h2>

            {selectedStageBatches.length === 0 ? (
              <p style={{ textAlign: "center", color: "#cbd5e1" }}>No batches in this stage.</p>
            ) : selectedStage !== "Clones" && stageModalUsesRoomHierarchy && showStageModalRoomPicker ? (
              <div style={{ display: "grid", gap: 10 }}>
                {stageModalRoomSummaries.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    style={{
                      ...rowStyle,
                      cursor: "pointer",
                      textAlign: "left",
                      justifyContent: "flex-start",
                    }}
                    onClick={() => setStageModalRoomId(r.id)}
                  >
                    <div style={{ flex: 1, lineHeight: 1.5 }}>
                      <b>{r.name}</b>
                      <span style={{ color: "#cbd5e1", marginLeft: 8 }}>
                        ({r.count} batch{r.count === 1 ? "" : "es"})
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            ) : selectedStage !== "Clones" && stageModalUsesRoomHierarchy ? (
              <div>
                {cultivationStageModalBayTableGroups.map((grp, gi) => {
                  const prev = cultivationStageModalBayTableGroups[gi - 1];
                  const showBayHeading = !prev || prev.bayId !== grp.bayId;
                  return (
                    <div
                      key={`${grp.bayId}:${grp.tableKey}:${gi}`}
                      style={{
                        marginBottom: 14,
                        paddingBottom: gi === cultivationStageModalBayTableGroups.length - 1 ? 0 : 4,
                      }}
                    >
                      {showBayHeading ? (
                        <div
                          style={{
                            fontWeight: 800,
                            fontSize: 15,
                            marginBottom: 8,
                            color: "#93c5fd",
                            letterSpacing: 0.3,
                          }}
                        >
                          {grp.bayLabel}
                        </div>
                      ) : null}
                      <div
                        style={{
                          fontWeight: 600,
                          color: "#e2e8f0",
                          marginBottom: 8,
                          fontSize: 13,
                        }}
                      >
                        Tables: {grp.tableLabel}
                      </div>
                      {grp.batches.map((b: any) => cultivationStageModalBatchCard(b))}
                    </div>
                  );
                })}
              </div>
            ) : (
              selectedStageBatchesOldestFirst.map((b: any) => cultivationStageModalBatchCard(b))
            )}

            <div style={modalButtonRowStyle}>
              <button type="button" style={buttonStyle} onClick={() => setSelectedStage(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {editVegModalBatch ? (
        <div style={modalOverlayStyle}>
          <div style={{ ...modalStyle, maxWidth: 640 }}>
            <h2 style={{ textAlign: "center", marginTop: 0 }}>Edit veg batch</h2>
            <p style={{ textAlign: "center", color: "#cbd5e1", marginTop: 0 }}>
              <b>{editVegModalBatch.id}</b> — update placement, plant count, strain, clone date, and notes.
            </p>

            <div style={formStyle}>
              <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                Plants in veg
                <input
                  style={inputStyle}
                  inputMode="numeric"
                  value={editVegPlants}
                  onChange={(e) => setEditVegPlants(e.target.value)}
                />
              </label>

              <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                Quick fill strain (optional)
                <select
                  style={inputStyle}
                  value=""
                  onChange={(e) => {
                    const name = e.target.value;
                    if (!name) return;
                    const selectedCloneStrain = getCloneStrainByName(name, configStrains);
                    setEditVegStrain(getConfigStrainName(selectedCloneStrain || {}));
                    setEditVegAcronym(getConfigStrainAcronym(selectedCloneStrain || {}).toUpperCase());
                  }}
                >
                  <option value="">Pick from configured strains…</option>
                  {sortStrainsAlphabetically(configStrains).map((item) => (
                    <option key={item.id || getConfigStrainAcronym(item) || getConfigStrainName(item)} value={getConfigStrainName(item)}>
                      {getConfigStrainName(item)} ({getConfigStrainAcronym(item)})
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                Strain name
                <input style={inputStyle} value={editVegStrain} onChange={(e) => setEditVegStrain(e.target.value)} />
              </label>

              <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                Strain acronym
                <input
                  style={inputStyle}
                  value={editVegAcronym}
                  onChange={(e) => setEditVegAcronym(e.target.value.toUpperCase())}
                />
              </label>

              <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                Clone date (optional)
                <input
                  style={inputStyle}
                  type="date"
                  value={editVegCloneDate}
                  onChange={(e) => setEditVegCloneDate(e.target.value)}
                />
              </label>

              <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                Batch notes (optional — racks, labels, IPM markers, …)
                <textarea
                  style={{ ...inputStyle, minHeight: 72, resize: "vertical" as const }}
                  value={editVegBatchNotes}
                  onChange={(e) => setEditVegBatchNotes(e.target.value)}
                />
              </label>

              {Array.isArray(editVegModalBatch.combinedFromBatchIds) &&
              editVegModalBatch.combinedFromBatchIds.length > 0 ? (
                <div
                  style={{
                    border: "1px solid rgba(251, 191, 36, 0.45)",
                    borderRadius: 10,
                    padding: "12px 14px",
                    background: "rgba(30, 27, 75, 0.35)",
                  }}
                >
                  <p style={{ color: "#fbbf24", margin: "0 0 10px 0", fontSize: 14, lineHeight: 1.45 }}>
                    This batch absorbed others via <b>Combine Batches</b>. Uncombine restores a partner batch if the
                    merge was wrong.
                  </p>
                  <ul style={{ margin: 0, paddingLeft: 18, color: "#e2e8f0", listStyle: "disc" }}>
                    {editVegModalBatch.combinedFromBatchIds.map((mergedId: string) => (
                      <li key={String(mergedId)} style={{ marginBottom: 8 }}>
                        <span style={{ wordBreak: "break-all" as const }}>{String(mergedId)}</span>
                        {" — "}
                        <button
                          type="button"
                          style={{
                            ...buttonStyle,
                            background: "#9a3412",
                            border: "1px solid #ea580c",
                            color: "white",
                            marginLeft: 4,
                          }}
                          disabled={isSavingEditVegModal || uncombineBusyPartnerId !== null}
                          onClick={() =>
                            promptUncombineMergedPartnerFromModal(editVegModalBatch, String(mergedId))
                          }
                        >
                          {uncombineBusyPartnerId === String(mergedId) ? "Working…" : "Uncombine"}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <>
                {cultivationRooms.vegRooms.length === 0 ? (
                  <p style={{ color: "#fbbf24", fontSize: 14, margin: 0, lineHeight: 1.5 }}>
                    No veg rooms are configured yet. Placement fields are skipped until an Admin adds rooms under{" "}
                    <strong style={{ color: "#fef08a" }}>Admin → Company Config</strong>.
                  </p>
                ) : (
                  <>
                    <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                      Veg room
                      <select
                        style={inputStyle}
                        value={editVegRoomId}
                        onChange={(e) => {
                          const id = e.target.value;
                          setEditVegRoomId(id);
                          const room = cultivationRooms.vegRooms.find((r) => r.id === id);
                          const b0 = room?.bays?.[0];
                          setEditVegBayId(b0?.id || "");
                          setEditVegTableIds([]);
                        }}
                      >
                        {cultivationRooms.vegRooms.map((room) => (
                          <option key={room.id} value={room.id}>
                            {room.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    {(() => {
                      const vegRoomObj = cultivationRooms.vegRooms.find((r) => r.id === editVegRoomId);
                      const bayObj = vegRoomObj?.bays?.find((bay) => bay.id === editVegBayId);
                      return (
                        <>
                          {vegRoomObj && vegRoomObj.bays.length > 0 ? (
                            <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                              Bay
                              <select
                                style={inputStyle}
                                value={editVegBayId}
                                onChange={(e) => {
                                  setEditVegBayId(e.target.value);
                                  setEditVegTableIds([]);
                                }}
                              >
                                {vegRoomObj.bays.map((bay) => (
                                  <option key={bay.id} value={bay.id}>
                                    Bay {bay.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ) : (
                            <p style={{ color: "#94a3b8", fontSize: 13, margin: 0 }}>
                              This veg room has no bays yet—add bays in Company Config.
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
                                      background: editVegTableIds.includes(table.id) ? "#22c55e" : "#1e293b",
                                      color: editVegTableIds.includes(table.id) ? "black" : "white",
                                      cursor: "pointer",
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={editVegTableIds.includes(table.id)}
                                      onChange={() => toggleEditVegTableId(table.id)}
                                    />
                                    Table {table.name}
                                  </label>
                                ))}
                              </div>
                            </div>
                          ) : vegRoomObj && vegRoomObj.bays.length > 0 ? (
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
            </div>

            <div style={modalButtonRowStyle}>
              <button style={buttonStyle} type="button" onClick={closeEditVegModal} disabled={isSavingEditVegModal}>
                Cancel
              </button>
              <button
                style={primaryButtonStyle}
                type="button"
                onClick={() => void saveEditVegBatchModal()}
                disabled={isSavingEditVegModal}
              >
                {isSavingEditVegModal ? "Saving..." : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editCloneModalBatch ? (
        <div style={modalOverlayStyle}>
          <div style={{ ...modalStyle, maxWidth: 640 }}>
            <h2 style={{ textAlign: "center", marginTop: 0 }}>Edit clone batch</h2>
            <p style={{ textAlign: "center", color: "#cbd5e1", marginTop: 0 }}>
              <b>{editCloneModalBatch.id}</b> — update plant count, strain, clone date, and notes. Veg placement is set
              when you log <strong>&quot;{TASK_MOVE_TO_VEG_ASSIGN_TAGS}&quot;</strong>.
            </p>

            <div style={formStyle}>
              <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                Plants (clones remaining)
                <input
                  style={inputStyle}
                  inputMode="numeric"
                  value={editClonePlants}
                  onChange={(e) => setEditClonePlants(e.target.value)}
                />
              </label>

              <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                Quick fill strain (optional)
                <select
                  style={inputStyle}
                  value=""
                  onChange={(e) => {
                    const name = e.target.value;
                    if (!name) return;
                    const selectedCloneStrain = getCloneStrainByName(name, configStrains);
                    setEditCloneStrain(getConfigStrainName(selectedCloneStrain || {}));
                    setEditCloneAcronym(getConfigStrainAcronym(selectedCloneStrain || {}).toUpperCase());
                  }}
                >
                  <option value="">Pick from configured strains…</option>
                  {sortStrainsAlphabetically(configStrains).map((item) => (
                    <option
                      key={item.id || getConfigStrainAcronym(item) || getConfigStrainName(item)}
                      value={getConfigStrainName(item)}
                    >
                      {getConfigStrainName(item)} ({getConfigStrainAcronym(item)})
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                Strain name
                <input style={inputStyle} value={editCloneStrain} onChange={(e) => setEditCloneStrain(e.target.value)} />
              </label>

              <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                Strain acronym
                <input
                  style={inputStyle}
                  value={editCloneAcronym}
                  onChange={(e) => setEditCloneAcronym(e.target.value.toUpperCase())}
                />
              </label>

              <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                Clone date
                <input
                  style={inputStyle}
                  type="date"
                  value={editCloneDate}
                  onChange={(e) => setEditCloneDate(e.target.value)}
                />
              </label>

              <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                Batch notes (optional)
                <textarea
                  style={{ ...inputStyle, minHeight: 72, resize: "vertical" as const }}
                  value={editCloneBatchNotes}
                  onChange={(e) => setEditCloneBatchNotes(e.target.value)}
                />
              </label>

              {Array.isArray(editCloneModalBatch.combinedFromBatchIds) &&
              editCloneModalBatch.combinedFromBatchIds.length > 0 ? (
                <div
                  style={{
                    border: "1px solid rgba(251, 191, 36, 0.45)",
                    borderRadius: 10,
                    padding: "12px 14px",
                    background: "rgba(30, 27, 75, 0.35)",
                  }}
                >
                  <p style={{ color: "#fbbf24", margin: "0 0 10px 0", fontSize: 14, lineHeight: 1.45 }}>
                    This batch absorbed others via <b>Combine Batches</b>. Uncombine restores a partner batch if the merge
                    was wrong.
                  </p>
                  <ul style={{ margin: 0, paddingLeft: 18, color: "#e2e8f0", listStyle: "disc" }}>
                    {editCloneModalBatch.combinedFromBatchIds.map((mergedId: string) => (
                      <li key={String(mergedId)} style={{ marginBottom: 8 }}>
                        <span style={{ wordBreak: "break-all" as const }}>{String(mergedId)}</span>
                        {" — "}
                        <button
                          type="button"
                          style={{
                            ...buttonStyle,
                            background: "#9a3412",
                            border: "1px solid #ea580c",
                            color: "white",
                            marginLeft: 4,
                          }}
                          disabled={isSavingEditCloneModal || uncombineBusyPartnerId !== null}
                          onClick={() =>
                            promptUncombineMergedPartnerFromModal(editCloneModalBatch, String(mergedId))
                          }
                        >
                          {uncombineBusyPartnerId === String(mergedId) ? "Working…" : "Uncombine"}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>

            <div style={modalButtonRowStyle}>
              <button style={buttonStyle} type="button" onClick={closeEditCloneModal} disabled={isSavingEditCloneModal}>
                Cancel
              </button>
              <button
                style={primaryButtonStyle}
                type="button"
                onClick={() => void saveEditCloneBatchModal()}
                disabled={isSavingEditCloneModal}
              >
                {isSavingEditCloneModal ? "Saving..." : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editFlowerModalBatch ? (
        <div style={modalOverlayStyle}>
          <div style={{ ...modalStyle, maxWidth: 640 }}>
            <h2 style={{ textAlign: "center", marginTop: 0 }}>Edit flower batch</h2>
            <p style={{ textAlign: "center", color: "#cbd5e1", marginTop: 0 }}>
              <b>{editFlowerModalBatch.id}</b> — update room/bay/tables, plant count, strain, clone date, and notes.
              {cultivationRooms.flowerRooms.length > 0 ? (
                <>
                  {" "}
                  <span style={{ color: "#94a3b8" }}>
                    Dry canopy is recalculated from selected table square footage.
                  </span>
                </>
              ) : null}
            </p>

            <div style={formStyle}>
              <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                Plants remaining
                <input
                  style={inputStyle}
                  inputMode="numeric"
                  value={editFlowerPlants}
                  onChange={(e) => setEditFlowerPlants(e.target.value)}
                />
              </label>

              <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                Quick fill strain (optional)
                <select
                  style={inputStyle}
                  value=""
                  onChange={(e) => {
                    const name = e.target.value;
                    if (!name) return;
                    const selectedCloneStrain = getCloneStrainByName(name, configStrains);
                    setEditFlowerStrain(getConfigStrainName(selectedCloneStrain || {}));
                    setEditFlowerAcronym(getConfigStrainAcronym(selectedCloneStrain || {}).toUpperCase());
                  }}
                >
                  <option value="">Pick from configured strains…</option>
                  {sortStrainsAlphabetically(configStrains).map((item) => (
                    <option key={item.id || getConfigStrainAcronym(item) || getConfigStrainName(item)} value={getConfigStrainName(item)}>
                      {getConfigStrainName(item)} ({getConfigStrainAcronym(item)})
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                Strain name
                <input style={inputStyle} value={editFlowerStrain} onChange={(e) => setEditFlowerStrain(e.target.value)} />
              </label>

              <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                Strain acronym
                <input
                  style={inputStyle}
                  value={editFlowerAcronym}
                  onChange={(e) => setEditFlowerAcronym(e.target.value.toUpperCase())}
                />
              </label>

              <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                Clone date (optional)
                <input
                  style={inputStyle}
                  type="date"
                  value={editFlowerCloneDate}
                  onChange={(e) => setEditFlowerCloneDate(e.target.value)}
                />
              </label>

              <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                Batch notes (optional — racks, labels, IPM markers, …)
                <textarea
                  style={{ ...inputStyle, minHeight: 72, resize: "vertical" as const }}
                  value={editFlowerBatchNotes}
                  onChange={(e) => setEditFlowerBatchNotes(e.target.value)}
                />
              </label>

              <>
                {cultivationRooms.flowerRooms.length === 0 ? (
                  <p style={{ color: "#fbbf24", fontSize: 14, margin: 0, lineHeight: 1.5 }}>
                    No flower rooms are configured yet. Placement fields are skipped until an Admin adds rooms under{" "}
                    <strong style={{ color: "#fef08a" }}>Admin → Company Config</strong>.
                  </p>
                ) : (
                  <>
                    <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                      Flower room
                      <select
                        style={inputStyle}
                        value={editFlowerRoomId}
                        onChange={(e) => {
                          const id = e.target.value;
                          setEditFlowerRoomId(id);
                          const room = cultivationRooms.flowerRooms.find((r) => r.id === id);
                          const b0 = room?.bays?.[0];
                          setEditFlowerBayId(b0?.id || "");
                          setEditFlowerTableIds([]);
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
                      const flowerRoomObj = cultivationRooms.flowerRooms.find((r) => r.id === editFlowerRoomId);
                      const bayObj = flowerRoomObj?.bays?.find((bay) => bay.id === editFlowerBayId);
                      return (
                        <>
                          {flowerRoomObj && flowerRoomObj.bays.length > 0 ? (
                            <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                              Bay
                              <select
                                style={inputStyle}
                                value={editFlowerBayId}
                                onChange={(e) => {
                                  setEditFlowerBayId(e.target.value);
                                  setEditFlowerTableIds([]);
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
                                      background: editFlowerTableIds.includes(table.id) ? "#22c55e" : "#1e293b",
                                      color: editFlowerTableIds.includes(table.id) ? "black" : "white",
                                      cursor: "pointer",
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={editFlowerTableIds.includes(table.id)}
                                      onChange={() => toggleEditFlowerTableId(table.id)}
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
            </div>

            <div style={modalButtonRowStyle}>
              <button style={buttonStyle} type="button" onClick={closeEditFlowerModal} disabled={isSavingEditFlowerModal}>
                Cancel
              </button>
              <button
                style={primaryButtonStyle}
                type="button"
                onClick={() => void saveEditFlowerBatchModal()}
                disabled={isSavingEditFlowerModal}
              >
                {isSavingEditFlowerModal ? "Saving..." : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

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

      {showRewardsChallengeModal &&
        showTaskWindow &&
        selectedTask !== "Print harvest sheet" &&
        selectedBatch &&
        rewardsCfg?.enabled &&
        rewardsCfg.taskChallenge.enabled && (
          <div style={{ ...modalOverlayStyle, zIndex: 10000 }}>
            <div style={{ ...modalStyle, maxWidth: 480 }}>
              <h3 style={{ marginTop: 0, textAlign: "center" }}>Task challenge</h3>
              <p style={{ color: "#cbd5e1", textAlign: "center", fontSize: 14 }}>
                Task: <b>{selectedTask}</b>
              </p>
              {(() => {
                const tc = rewardsCfg.taskChallenge;
                const { avg, sampleCount } = computeAverageNormalizedMinutes(
                  s.logs as any[],
                  "Cultivation",
                  selectedTask,
                  {
                    includeAreaInTaskKey: tc.includeAreaInTaskKey,
                    lookbackDays: rewardsCfg.primaryWindowDays * 3,
                  },
                );
                const base = sampleCount >= tc.minSamplesForAverage && avg != null ? avg : null;
                const fallback = 45;
                return (
                  <>
                    <p style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.5 }}>
                      {base != null
                        ? `Facility avg (normalized min/person) for this task: ${base.toFixed(1)} min (${sampleCount} samples).`
                        : `Not enough history yet — targets use a ${fallback} min placeholder until averages stabilize.`}
                    </p>
                    <ul style={{ color: "#e2e8f0", paddingLeft: 18 }}>
                      {tc.tiers.map((tier: { label: string; multiplierVsAvg: number; points: number }, i: number) => {
                        const target = (base ?? fallback) * tier.multiplierVsAvg;
                        return (
                          <li key={i} style={{ marginBottom: 8 }}>
                            <b>{tier.label}</b>: finish within <b>{target.toFixed(1)} min</b> per person →{" "}
                            <b>{tier.points} pts</b>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                );
              })()}
              <div style={{ ...modalButtonRowStyle, justifyContent: "center" }}>
                <button
                  type="button"
                  style={primaryButtonStyle}
                  onClick={() => setShowRewardsChallengeModal(false)}
                >
                  Got it
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
              <input
                style={inputStyle}
                value={selectedBatch.id}
                readOnly
                onFocus={tryShowRewardsChallengeFromTaskInputFocus}
              />
              <input
                style={inputStyle}
                value={selectedTask}
                readOnly
                onFocus={tryShowRewardsChallengeFromTaskInputFocus}
              />
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

              {(selectedTask === TASK_MOVE_TO_VEG_ASSIGN_TAGS || selectedTask === "Move to Flower") && (
                <>
                  <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                    Move date (when plants actually moved stages)
                    <input
                      style={inputStyle}
                      type="date"
                      value={stageMoveDate}
                      onChange={(e) => setStageMoveDate(e.target.value)}
                      onFocus={tryShowRewardsChallengeFromTaskInputFocus}
                    />
                  </label>
                  <p style={{ color: "#94a3b8", fontSize: 12, margin: 0, lineHeight: 1.45 }}>
                    Facility timezone: <b style={{ color: "#cbd5e1" }}>{getCompanyDisplayTimezone()}</b> — “today”
                    compares to this calendar. Choosing another date asks for confirmation.
                  </p>
                </>
              )}

              {selectedTask === "Harvest" && (
                <>
                  <select
                    style={inputStyle}
                    value={harvestType}
                    onChange={(e) => setHarvestType(e.target.value)}
                    onFocus={tryShowRewardsChallengeFromTaskInputFocus}
                  >
                    <option>A Grade Flower</option>
                    <option>Fresh Frozen</option>
                  </select>

                  <input
                    style={inputStyle}
                    placeholder="Plants harvested"
                    value={harvestPlants}
                    onChange={(e) => setHarvestPlants(e.target.value)}
                    onFocus={tryShowRewardsChallengeFromTaskInputFocus}
                  />

                  {harvestType === "Fresh Frozen" && (
                    <>
                      <input
                        style={inputStyle}
                        placeholder="Bundles"
                        value={freshFrozenBundles}
                        onChange={(e) => setFreshFrozenBundles(e.target.value)}
                        onFocus={tryShowRewardsChallengeFromTaskInputFocus}
                      />
                      <input
                        style={inputStyle}
                        placeholder="Grams"
                        value={freshFrozenGrams}
                        onChange={(e) => setFreshFrozenGrams(e.target.value)}
                        onFocus={tryShowRewardsChallengeFromTaskInputFocus}
                      />
                    </>
                  )}

                  <div
                    style={{
                      ...inputStyle,
                      display: "grid",
                      gap: 10,
                      background: "#0f172a",
                      borderColor: "#475569",
                    }}
                  >
                    <div style={{ color: "#e2e8f0", fontWeight: 700 }}>Harvest sheet (optional)</div>
                    <p style={{ color: "#94a3b8", fontSize: 13, margin: 0, lineHeight: 1.45 }}>
                      Upload one or more photos of the handwritten sheet (camera or gallery on mobile). The API runs
                      OpenAI vision on each image and merges rows. Review sheet totals below; expand plant-by-plant
                      detail to edit tags and weights. Images are sent to OpenAI — avoid sensitive info outside plant
                      weights.
                    </p>
                    <input
                      ref={harvestSheetFileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      capture="environment"
                      multiple
                      style={{ display: "none" }}
                      onChange={(e) => void onHarvestSheetFilesSelected(e.target.files)}
                    />
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      <button
                        type="button"
                        style={buttonStyle}
                        disabled={harvestSheetBusy || !canWriteRecords}
                        onClick={() => harvestSheetFileInputRef.current?.click()}
                      >
                        {harvestSheetBusy ? "Working…" : "Add photo(s) / camera"}
                      </button>
                      <button
                        type="button"
                        style={{ ...buttonStyle, borderColor: "#38bdf8", color: "#38bdf8" }}
                        disabled={harvestSheetBusy || harvestSheetPhotos.length === 0 || !canWriteRecords}
                        onClick={() => void runHarvestSheetExtract()}
                      >
                        Extract with AI
                      </button>
                      {harvestType === "Fresh Frozen" && harvestSheetRows.length > 0 ? (
                        <button
                          type="button"
                          style={buttonStyle}
                          onClick={() =>
                            setFreshFrozenGrams(String(sumGramsFromHarvestSheetRows(harvestSheetRows)))
                          }
                        >
                          Sum rows → grams
                        </button>
                      ) : null}
                    </div>
                    {harvestSheetPhotos.length > 0 ? (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ color: "#93c5fd", fontSize: 12, marginBottom: 8 }}>
                          Uploaded ({harvestSheetPhotos.length}) — tap remove to drop a photo before extract
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                          {harvestSheetPhotos.map((p) => (
                            <div
                              key={p.id}
                              style={{
                                position: "relative",
                                width: 112,
                                flexShrink: 0,
                              }}
                            >
                              <img
                                src={`${API_BASE_URL.replace(/\/+$/, "")}${p.imageUrl}`}
                                alt=""
                                style={{
                                  width: "100%",
                                  height: 112,
                                  objectFit: "cover",
                                  borderRadius: 8,
                                  border: "1px solid #334155",
                                }}
                              />
                              <button
                                type="button"
                                disabled={harvestSheetBusy || !canWriteRecords}
                                onClick={() =>
                                  setHarvestSheetPhotos((prev) => prev.filter((x) => x.id !== p.id))
                                }
                                style={{
                                  position: "absolute",
                                  top: 4,
                                  right: 4,
                                  fontSize: 11,
                                  fontWeight: 900,
                                  padding: "4px 8px",
                                  borderRadius: 8,
                                  border: "1px solid rgba(248,113,113,0.7)",
                                  background: "rgba(127,29,29,0.92)",
                                  color: "#fecaca",
                                  cursor: harvestSheetBusy ? "not-allowed" : "pointer",
                                }}
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {harvestSheetWarnings.length > 0 ? (
                      <div style={{ color: "#fbbf24", fontSize: 13 }}>
                        {harvestSheetWarnings.map((w, i) => (
                          <div key={i}>{w}</div>
                        ))}
                      </div>
                    ) : null}
                    {harvestSheetRows.length > 0 ? (
                      <>
                        <div
                          style={{
                            marginTop: 10,
                            padding: "10px 12px",
                            borderRadius: 10,
                            border: "1px solid rgba(148,163,184,0.28)",
                            background: "rgba(15,23,42,0.65)",
                            color: "#e2e8f0",
                            fontSize: 14,
                            fontWeight: 800,
                          }}
                        >
                          Sheet totals: {harvestSheetRows.length} row{harvestSheetRows.length === 1 ? "" : "s"} ·{" "}
                          {Math.round(sumGramsFromHarvestSheetRows(harvestSheetRows)).toLocaleString()} g combined (from
                          tags below)
                        </div>
                        <details style={{ marginTop: 10 }}>
                          <summary
                            style={{
                              cursor: "pointer",
                              color: "#93c5fd",
                              fontWeight: 800,
                              fontSize: 14,
                              listStylePosition: "outside",
                            }}
                          >
                            Plant-by-plant detail — tag #, weight, unit (tap to expand)
                          </summary>
                          <div style={{ overflowX: "auto", marginTop: 10 }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                              <thead>
                                <tr style={{ color: "#93c5fd" }}>
                                  <th style={{ border: "1px solid #334155", padding: 6 }}>Tag</th>
                                  <th style={{ border: "1px solid #334155", padding: 6 }}>Weight</th>
                                  <th style={{ border: "1px solid #334155", padding: 6 }}>Unit</th>
                                </tr>
                              </thead>
                              <tbody>
                                {harvestSheetRows.map((row, idx) => (
                                  <tr key={idx}>
                                    <td style={{ border: "1px solid #334155", padding: 4 }}>
                                      <input
                                        style={{ ...inputStyle, padding: 6 }}
                                        value={row.tag}
                                        onChange={(e) => {
                                          const v = e.target.value;
                                          setHarvestSheetRows((prev) =>
                                            prev.map((r, j) => (j === idx ? { ...r, tag: v } : r)),
                                          );
                                        }}
                                      />
                                    </td>
                                    <td style={{ border: "1px solid #334155", padding: 4 }}>
                                      <input
                                        style={{ ...inputStyle, padding: 6 }}
                                        value={row.weightValue}
                                        onChange={(e) => {
                                          const v = e.target.value;
                                          setHarvestSheetRows((prev) =>
                                            prev.map((r, j) => (j === idx ? { ...r, weightValue: v } : r)),
                                          );
                                        }}
                                      />
                                    </td>
                                    <td style={{ border: "1px solid #334155", padding: 4 }}>
                                      <input
                                        style={{ ...inputStyle, padding: 6 }}
                                        value={row.unitGuess}
                                        onChange={(e) => {
                                          const v = e.target.value;
                                          setHarvestSheetRows((prev) =>
                                            prev.map((r, j) => (j === idx ? { ...r, unitGuess: v } : r)),
                                          );
                                        }}
                                      />
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </details>
                      </>
                    ) : null}
                  </div>
                </>
              )}

              {selectedTask === "Combine Batches" && (
                <>
                  <p style={{ color: "#94a3b8", fontSize: 13, margin: 0, lineHeight: 1.5 }}>
                    Plant counts add onto the batch you opened (survivor). The partner batch is completed and logged as
                    merged into this survivor. Both rows receive <b>Combine Batches</b> task entries with linkage for
                    Data Hub history.
                  </p>
                  <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                    Batch to absorb (same stage group)
                    <select
                      style={inputStyle}
                      value={combinePartnerBatchId}
                      onChange={(e) => setCombinePartnerBatchId(e.target.value)}
                      onFocus={tryShowRewardsChallengeFromTaskInputFocus}
                    >
                      <option value="">Select batch…</option>
                      {combinePartnerOptions.map((b: any) => (
                        <option key={b.id} value={b.id}>
                          {b.id} — {String(b.strain || "—")} ({num(b.plants)} plants)
                        </option>
                      ))}
                    </select>
                  </label>
                  {combinePartnerOptions.length === 0 ? (
                    <p style={{ color: "#fbbf24", fontSize: 13, margin: 0 }}>
                      No other active batches in this stage group to combine with.
                    </p>
                  ) : null}
                  <input
                    style={inputStyle}
                    placeholder="Optional merge notes (labels, racks, lineage, …)"
                    value={output}
                    onChange={(e) => setOutput(e.target.value)}
                    onFocus={tryShowRewardsChallengeFromTaskInputFocus}
                  />
                </>
              )}

              {selectedBatch?.stage === "Veg" && selectedTask === "Add METRC Tags" && (
                <>
                  <p style={{ color: "#94a3b8", fontSize: 13, margin: 0, lineHeight: 1.5 }}>
                    Log state compliance tags applied in METRC for this batch (plant tag IDs or ranges). One tag per line
                    or freeform notes — saved on the batch and in task history with labor time below.
                  </p>
                  <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                    METRC tag IDs / notes
                    <textarea
                      style={{
                        ...inputStyle,
                        minHeight: 110,
                        resize: "vertical" as const,
                        fontFamily: "inherit",
                      }}
                      placeholder={`Example:\n1A4FF01...\n1A4FF02...\n(or paste harvest checklist)`}
                      value={output}
                      onChange={(e) => setOutput(e.target.value)}
                      onFocus={tryShowRewardsChallengeFromTaskInputFocus}
                    />
                  </label>
                </>
              )}

              {selectedTask === "Finish batch" && (
                <>
                  <p style={{ color: "#94a3b8", fontSize: 13, margin: 0, lineHeight: 1.5 }}>
                    Set the <strong>final live plant count</strong> for this batch. Use <strong>0</strong> to record no
                    remaining plants and <strong>move this batch to completed</strong>. Add optional notes below.
                  </p>
                  <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                    Final plant count (enter 0 to finish)
                    <input
                      style={inputStyle}
                      inputMode="numeric"
                      value={finishBatchPlantCount}
                      onChange={(e) => setFinishBatchPlantCount(e.target.value)}
                      onFocus={tryShowRewardsChallengeFromTaskInputFocus}
                    />
                  </label>
                  <input
                    style={inputStyle}
                    placeholder="Optional notes (e.g. last plants culled, room cleared…)"
                    value={output}
                    onChange={(e) => setOutput(e.target.value)}
                    onFocus={tryShowRewardsChallengeFromTaskInputFocus}
                  />
                </>
              )}

              {selectedTask !== "Harvest" &&
                selectedTask !== "Combine Batches" &&
                selectedTask !== "Print harvest sheet" &&
                selectedTask !== "Finish batch" &&
                selectedTask !== TASK_CREATE_IMMATURE_PLANT_BATCH &&
                selectedTask !== TASK_MOVE_TO_VEG_ASSIGN_TAGS &&
                !(selectedBatch?.stage === "Veg" && selectedTask === "Add METRC Tags") && (
                <input
                  style={inputStyle}
                  placeholder={
                    selectedTask === "Move to Flower"
                      ? "# plants moving now (rest stay Veg until moved)"
                      : "Output / notes / result"
                  }
                  value={output}
                  onChange={(e) => setOutput(e.target.value)}
                  onFocus={tryShowRewardsChallengeFromTaskInputFocus}
                />
              )}

              {selectedTask === TASK_CREATE_IMMATURE_PLANT_BATCH && (
                <>
                  <p style={{ color: "#94a3b8", fontSize: 13, margin: 0, lineHeight: 1.5 }}>
                    Records a <strong>grouped</strong> immature plant batch linked to this cultivation batch. Individual
                    METRC plant tags are created only when you run <strong>{TASK_MOVE_TO_VEG_ASSIGN_TAGS}</strong>.
                  </p>
                  <input
                    style={inputStyle}
                    placeholder="Batch name"
                    value={imbName}
                    onChange={(e) => setImbName(e.target.value)}
                    onFocus={tryShowRewardsChallengeFromTaskInputFocus}
                  />
                  <input
                    style={inputStyle}
                    placeholder="Strain"
                    value={imbStrain}
                    onChange={(e) => setImbStrain(e.target.value)}
                    onFocus={tryShowRewardsChallengeFromTaskInputFocus}
                  />
                  <input
                    style={inputStyle}
                    placeholder="Clone/plant count"
                    inputMode="numeric"
                    value={imbCount}
                    onChange={(e) => setImbCount(e.target.value)}
                    onFocus={tryShowRewardsChallengeFromTaskInputFocus}
                  />
                  <input
                    style={inputStyle}
                    placeholder="Location"
                    value={imbLocation}
                    onChange={(e) => setImbLocation(e.target.value)}
                    onFocus={tryShowRewardsChallengeFromTaskInputFocus}
                  />
                  <input
                    style={inputStyle}
                    placeholder="Sublocation (optional)"
                    value={imbSublocation}
                    onChange={(e) => setImbSublocation(e.target.value)}
                    onFocus={tryShowRewardsChallengeFromTaskInputFocus}
                  />
                  <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                    Plant date
                    <input
                      style={inputStyle}
                      type="date"
                      value={imbPlantDate}
                      onChange={(e) => setImbPlantDate(e.target.value)}
                      onFocus={tryShowRewardsChallengeFromTaskInputFocus}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                    Source type (optional)
                    <select
                      style={inputStyle}
                      value={imbSourceType}
                      onChange={(e) => setImbSourceType(e.target.value)}
                      onFocus={tryShowRewardsChallengeFromTaskInputFocus}
                    >
                      <option value="">—</option>
                      <option value="clone">clone</option>
                      <option value="seed">seed</option>
                      <option value="mother">mother</option>
                      <option value="other">other</option>
                    </select>
                  </label>
                  <textarea
                    style={{ ...inputStyle, minHeight: 72, resize: "vertical" as const }}
                    placeholder="Notes (optional)"
                    value={imbNotes}
                    onChange={(e) => setImbNotes(e.target.value)}
                    onFocus={tryShowRewardsChallengeFromTaskInputFocus}
                  />
                  <input
                    style={inputStyle}
                    placeholder="METRC immature batch ID (optional)"
                    value={imbMetrcBatchId}
                    onChange={(e) => setImbMetrcBatchId(e.target.value)}
                    onFocus={tryShowRewardsChallengeFromTaskInputFocus}
                  />
                  <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                    METRC sync status
                    <select
                      style={inputStyle}
                      value={imbMetrcSyncStatus}
                      onChange={(e) => setImbMetrcSyncStatus(e.target.value as MetrcImmatureSyncStatus)}
                      onFocus={tryShowRewardsChallengeFromTaskInputFocus}
                    >
                      <option value="Not Synced">Not Synced</option>
                      <option value="Ready to Sync">Ready to Sync</option>
                      <option value="Synced">Synced</option>
                      <option value="Failed">Failed</option>
                    </select>
                  </label>
                  <p style={{ color: "#64748b", fontSize: 11, margin: 0, lineHeight: 1.45 }}>
                    {/* TODO: Fetch Available METRC Plant Tags from compliance API — user-entered IDs only for now. */}
                  </p>
                </>
              )}

              {selectedTask === TASK_MOVE_TO_VEG_ASSIGN_TAGS && (
                <>
                  <p style={{ color: "#94a3b8", fontSize: 13, margin: 0, lineHeight: 1.5 }}>
                    Assign sequential <strong>existing</strong> METRC plant tags (you supply the first tag; the app
                    previews the range). Growth phase is <strong>Vegetative</strong>.{" "}
                    {/* TODO: Fetch Available METRC Plant Tags from METRC / compliance service instead of manual entry. */}
                  </p>
                  <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                    Immature plant batch
                    <select
                      style={inputStyle}
                      value={vegImmatureBatchId}
                      onChange={(e) => setVegImmatureBatchId(e.target.value)}
                      onFocus={tryShowRewardsChallengeFromTaskInputFocus}
                    >
                      <option value="">Select…</option>
                      {(selectedBatch?.immaturePlantBatches || [])
                        .filter((row: any) => num(row?.countAvailable) > 0)
                        .map((row: any) => (
                          <option key={row.id} value={row.id}>
                            {row.name || row.id} — {num(row.countAvailable)} avail · {String(row.strain || "—")}
                          </option>
                        ))}
                    </select>
                  </label>
                  <input
                    style={{ ...inputStyle, opacity: 0.85 }}
                    readOnly
                    value={`Strain (read-only): ${(() => {
                      const row = (selectedBatch?.immaturePlantBatches || []).find(
                        (x: any) => String(x?.id || "") === vegImmatureBatchId,
                      );
                      return row ? String(row.strain || "—") : "—";
                    })()}`}
                  />
                  <input
                    style={{ ...inputStyle, opacity: 0.85 }}
                    readOnly
                    value={`Available immature plants (read-only): ${(() => {
                      const row = (selectedBatch?.immaturePlantBatches || []).find(
                        (x: any) => String(x?.id || "") === vegImmatureBatchId,
                      );
                      return row ? String(num(row.countAvailable)) : "—";
                    })()}`}
                  />
                  <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                    Number of plants moving to Veg
                    <input
                      style={inputStyle}
                      inputMode="numeric"
                      value={vegMoveCount}
                      onChange={(e) => setVegMoveCount(e.target.value)}
                      onFocus={tryShowRewardsChallengeFromTaskInputFocus}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                    Starting METRC plant tag
                    <input
                      style={inputStyle}
                      value={vegFirstMetrcTag}
                      onChange={(e) => setVegFirstMetrcTag(e.target.value)}
                      onFocus={tryShowRewardsChallengeFromTaskInputFocus}
                    />
                  </label>
                  <input
                    style={{ ...inputStyle, opacity: 0.85 }}
                    readOnly
                    value="Growth phase: Vegetative (locked)"
                  />
                  {vegTagPreview.ok === false ? (
                    <p style={{ color: "#f97316", fontSize: 13, margin: 0 }}>{vegTagPreview.error}</p>
                  ) : vegTagPreview.ok === true && vegTagPreview.tags.length > 0 ? (
                    <div
                      style={{
                        ...inputStyle,
                        maxHeight: 160,
                        overflowY: "auto",
                        fontSize: 12,
                        fontFamily: "ui-monospace, monospace",
                      }}
                    >
                      <div style={{ color: "#93c5fd", marginBottom: 8 }}>Tag preview ({vegTagPreview.tags.length})</div>
                      {vegTagPreview.tags.map((t, i) => (
                        <div key={`${t}-${i}`}>{t}</div>
                      ))}
                    </div>
                  ) : null}
                  <input
                    style={inputStyle}
                    placeholder="New veg sublocation (optional)"
                    value={vegSublocationDraft}
                    onChange={(e) => setVegSublocationDraft(e.target.value)}
                    onFocus={tryShowRewardsChallengeFromTaskInputFocus}
                  />
                  <textarea
                    style={{ ...inputStyle, minHeight: 64, resize: "vertical" as const }}
                    placeholder="Notes (optional)"
                    value={vegMoveNotes}
                    onChange={(e) => setVegMoveNotes(e.target.value)}
                    onFocus={tryShowRewardsChallengeFromTaskInputFocus}
                  />
                  {(() => {
                    const vl = resolveVegSelectionLabels();
                    const first =
                      vegTagPreview.ok === true && vegTagPreview.tags.length > 0 ? vegTagPreview.tags[0] : "—";
                    const last =
                      vegTagPreview.ok === true && vegTagPreview.tags.length > 0
                        ? vegTagPreview.tags[vegTagPreview.tags.length - 1]
                        : "—";
                    return (
                      <div
                        style={{
                          ...inputStyle,
                          background: "#0f172a",
                          borderColor: "#334155",
                          fontSize: 13,
                          lineHeight: 1.6,
                        }}
                      >
                        <div style={{ color: "#93c5fd", fontWeight: 700, marginBottom: 8 }}>Submit summary</div>
                        <div>
                          <strong>Batch:</strong> {selectedBatch?.id}
                        </div>
                        <div>
                          <strong>Count:</strong> {vegMoveCount.trim() || "—"}
                        </div>
                        <div>
                          <strong>First tag:</strong> {first}
                        </div>
                        <div>
                          <strong>Last tag:</strong> {last}
                        </div>
                        <div>
                          <strong>Location:</strong> {vl.roomName || "—"} / {vl.bayName || "—"}
                        </div>
                        <div>
                          <strong>Growth date:</strong> {stageMoveDate || "—"}
                        </div>
                      </div>
                    );
                  })()}
                  <label style={{ display: "flex", alignItems: "center", gap: 10, color: "#e2e8f0", fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={vegTagOverlapAck}
                      onChange={(e) => setVegTagOverlapAck(e.target.checked)}
                    />
                    I acknowledge if warned that tags overlap existing local records (correct tags in METRC before
                    submitting).
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 10, color: "#e2e8f0", fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={vegSubmitConfirmAck}
                      onChange={(e) => setVegSubmitConfirmAck(e.target.checked)}
                    />
                    I confirm first tag, last tag, veg placement, and growth date before submitting.
                  </label>
                  {cultivationRooms.vegRooms.length === 0 ? (
                    <p style={{ color: "#fbbf24", fontSize: 14, margin: 0, lineHeight: 1.5 }}>
                      No veg rooms are configured yet. An Admin can add them under{" "}
                      <strong style={{ color: "#fef08a" }}>Admin → Company Config → Cultivation → Veg rooms</strong>.
                    </p>
                  ) : (
                    <>
                      <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                        New veg room
                        <select
                          style={inputStyle}
                          value={vegRoomId}
                          onChange={(e) => {
                            const id = e.target.value;
                            setVegRoomId(id);
                            const room = cultivationRooms.vegRooms.find((r) => r.id === id);
                            const b0 = room?.bays?.[0];
                            setVegBayId(b0?.id || "");
                            setVegTableIds([]);
                          }}
                        >
                          {cultivationRooms.vegRooms.map((room) => (
                            <option key={room.id} value={room.id}>
                              {room.name}
                            </option>
                          ))}
                        </select>
                      </label>

                      {(() => {
                        const vegRoomObj = cultivationRooms.vegRooms.find((r) => r.id === vegRoomId);
                        const bayObj = vegRoomObj?.bays?.find((b) => b.id === vegBayId);
                        return (
                          <>
                            {vegRoomObj && vegRoomObj.bays.length > 0 ? (
                              <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                                Bay
                                <select
                                  style={inputStyle}
                                  value={vegBayId}
                                  onChange={(e) => {
                                    setVegBayId(e.target.value);
                                    setVegTableIds([]);
                                  }}
                                >
                                  {vegRoomObj.bays.map((bay) => (
                                    <option key={bay.id} value={bay.id}>
                                      Bay {bay.name}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            ) : (
                              <p style={{ color: "#94a3b8", fontSize: 13, margin: 0 }}>
                                This veg room has no bays yet—add bays in Company Config.
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
                                        background: vegTableIds.includes(table.id) ? "#22c55e" : "#1e293b",
                                        color: vegTableIds.includes(table.id) ? "black" : "white",
                                        cursor: "pointer",
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={vegTableIds.includes(table.id)}
                                        onChange={() => toggleVegTableId(table.id)}
                                      />
                                      Table {table.name}
                                    </label>
                                  ))}
                                </div>
                              </div>
                            ) : vegRoomObj && vegRoomObj.bays.length > 0 ? (
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

              {selectedTask !== "Print harvest sheet" ? (
              <div
                style={{
                  display: "grid",
                  gap: 10,
                  padding: "12px 0 4px",
                  borderTop: "1px solid #334155",
                  marginTop: 4,
                }}
              >
                <p style={{ color: "#94a3b8", fontSize: 13, margin: 0, lineHeight: 1.45 }}>
                  Labor (person-minutes): use clock start and end to subtract configured breaks and lunch, or — if you are
                  a manager — enter total minutes per person. Break windows are set in{" "}
                  <strong style={{ color: "#e2e8f0" }}>Admin → Company Config → Labor — breaks &amp; lunch</strong>.
                </p>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  <span style={{ color: "#e2e8f0", fontSize: 14 }}>Labor entry</span>
                  <button
                    type="button"
                    style={{
                      ...buttonStyle,
                      border:
                        laborTimeMode === "range" ? "1px solid #22d3ee" : "1px solid #475569",
                      background: laborTimeMode === "range" ? "#22d3ee" : "#1e293b",
                      color: laborTimeMode === "range" ? "#0f172a" : "white",
                      fontWeight: laborTimeMode === "range" ? 700 : 400,
                    }}
                    onClick={() => setLaborTimeMode("range")}
                  >
                    Start &amp; end time
                  </button>
                  {hasMinimumRole("MANAGER") ? (
                    <button
                      type="button"
                      style={{
                        ...buttonStyle,
                        border:
                          laborTimeMode === "total" ? "1px solid #22d3ee" : "1px solid #475569",
                        background: laborTimeMode === "total" ? "#22d3ee" : "#1e293b",
                        color: laborTimeMode === "total" ? "#0f172a" : "white",
                        fontWeight: laborTimeMode === "total" ? 700 : 400,
                      }}
                      onClick={() => setLaborTimeMode("total")}
                    >
                      Quick minutes (manager)
                    </button>
                  ) : null}
                </div>

                <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                  People on this task
                  <input
                    style={inputStyle}
                    placeholder="How many people"
                    value={people}
                    onChange={(e) => setPeople(e.target.value)}
                  />
                </label>

                {laborTimeMode === "total" ? (
                  <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                    Minutes per person (manager quick entry)
                    <input
                      style={inputStyle}
                      placeholder="Minutes per person"
                      type="number"
                      min={1}
                      step={1}
                      value={minutes}
                      onChange={(e) => setMinutes(e.target.value)}
                    />
                  </label>
                ) : (
                  <>
                    <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                      Work date (facility calendar day)
                      <input
                        style={inputStyle}
                        type="date"
                        value={taskLaborDate}
                        onChange={(e) => setTaskLaborDate(e.target.value)}
                      />
                    </label>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                        gap: 10,
                      }}
                    >
                      <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                        Task on / start
                        <input
                          style={inputStyle}
                          type="time"
                          step={60}
                          value={taskStartTime}
                          onChange={(e) => setTaskStartTime(e.target.value)}
                        />
                      </label>
                      <label style={{ display: "grid", gap: 6, color: "#e2e8f0", fontSize: 14 }}>
                        Task off / end
                        <input
                          style={inputStyle}
                          type="time"
                          step={60}
                          value={taskEndTime}
                          onChange={(e) => setTaskEndTime(e.target.value)}
                        />
                      </label>
                    </div>
                    <p style={{ color: "#94a3b8", fontSize: 12, margin: 0 }}>
                      If end clock time is before start on the same calendar row, the span continues into the next morning
                      (overnight / long shift).
                    </p>
                    {laborBreakSchedule.length === 0 ? (
                      <p style={{ color: "#94a3b8", fontSize: 13, margin: 0 }}>
                        No break windows configured yet — net time equals clock span. Admins can add lunch and breaks in
                        Company Config.
                      </p>
                    ) : null}
                    {cultivationLaborRangePreview ? (
                      <p
                        style={{
                          color:
                            cultivationLaborRangePreview.netPerPerson <= 0 ? "#fbbf24" : "#a5f3fc",
                          fontSize: 13,
                          margin: 0,
                          lineHeight: 1.5,
                        }}
                      >
                        <strong>Preview (per person):</strong> {cultivationLaborRangePreview.gross} min clock span
                        {cultivationLaborRangePreview.breakDeduction > 0
                          ? ` − ${cultivationLaborRangePreview.breakDeduction} min overlapping breaks/lunch`
                          : ""}{" "}
                        = <strong>{cultivationLaborRangePreview.netPerPerson} min</strong> net.
                        {cultivationLaborRangePreview.totalPersonMin != null ? (
                          <>
                            {" "}
                            Total: <strong>{cultivationLaborRangePreview.totalPersonMin} person-min</strong>.
                          </>
                        ) : (
                          " Enter people above for a total."
                        )}
                        {cultivationLaborRangePreview.netPerPerson <= 0
                          ? " Net time is zero — adjust times or break config."
                          : ""}
                      </p>
                    ) : null}
                  </>
                )}
              </div>
              ) : (
                <p style={{ color: "#94a3b8", fontSize: 13, marginTop: 10 }}>
                  Open a printable harvest sheet (blank tag/weight table). No labor entry needed for this action.
                </p>
              )}
            </div>

            <div style={modalButtonRowStyle}>
              <button style={buttonStyle} onClick={closeCultivationTaskWindow}>
                Cancel
              </button>
              {selectedTask === "Print harvest sheet" ? (
                <button
                  type="button"
                  style={primaryButtonStyle}
                  onClick={() => {
                    openHarvestPrintSheetWindow();
                  }}
                >
                  Open printable sheet
                </button>
              ) : (
                <button style={primaryButtonStyle} onClick={save} disabled={isSavingTask}>
                  {isSavingTask ? "Saving..." : "Save Task to Batch"}
                </button>
              )}
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

            <div
              style={{
                textAlign: "center",
                display: "flex",
                gap: 10,
                justifyContent: "center",
                flexWrap: "wrap",
              }}
            >
              <button type="button" style={buttonStyle} onClick={() => setViewBatch(null)}>
                Close
              </button>
              {canManageCultivationBatchPlacement() && String(viewBatch.stage || "") === "Clone" ? (
                <button
                  type="button"
                  style={{
                    ...buttonStyle,
                    background: "#0f766e",
                    border: "1px solid #14b8a6",
                    color: "white",
                  }}
                  onClick={() => {
                    openEditCloneBatchModal(viewBatch);
                    setViewBatch(null);
                  }}
                >
                  Edit batch
                </button>
              ) : null}
              {canManageCultivationBatchPlacement() && String(viewBatch.stage || "") === "Veg" ? (
                <button
                  type="button"
                  style={{
                    ...buttonStyle,
                    background: "#92400e",
                    border: "1px solid #ea580c",
                    color: "white",
                  }}
                  onClick={() => {
                    openEditVegBatchModal(viewBatch);
                    setViewBatch(null);
                  }}
                >
                  Edit batch
                </button>
              ) : null}
              {canManageCultivationBatchPlacement() &&
              (viewBatch.stage === "Flower" || viewBatch.stage === "Partially Harvested") ? (
                <button
                  type="button"
                  style={{
                    ...buttonStyle,
                    background: "#5b21b6",
                    border: "1px solid #a855f7",
                    color: "white",
                  }}
                  onClick={() => {
                    openEditFlowerBatchModal(viewBatch);
                    setViewBatch(null);
                  }}
                >
                  Edit batch
                </button>
              ) : null}
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

      {batchDeleteChoiceModal && (
        <div style={{ ...modalOverlayStyle, zIndex: 10003 }}>
          <div style={{ ...modalStyle, maxWidth: 540 }}>
            <h2 style={{ textAlign: "center", marginTop: 0, marginBottom: 10 }}>Remove cultivation batch?</h2>
            <p style={{ color: "#cbd5e1", marginTop: 0, lineHeight: 1.55, textAlign: "center" }}>
              <strong style={{ color: "#e2e8f0" }}>{batchDeleteChoiceModal.batchId}</strong>
              <br />
              Current stage:{" "}
              <strong style={{ color: "#fef08a" }}>{batchDeleteChoiceModal.batchStageLabel}</strong>
            </p>
            {batchDeleteChoiceModal.revertInfo ? (
              <p style={{ color: "#94a3b8", fontSize: 14, lineHeight: 1.55, marginTop: 12 }}>
                {batchDeleteChoiceModal.revertInfo.summary}
              </p>
            ) : (
              <p style={{ color: "#94a3b8", fontSize: 14, lineHeight: 1.55, marginTop: 12 }}>
                This batch is still in <strong style={{ color: "#e2e8f0" }}>Clone</strong> — there is no earlier
                cultivation stage to revert to. You can delete permanently or cancel.
              </p>
            )}
            <p style={{ color: "#f87171", fontSize: 13, marginTop: 14, marginBottom: 0, lineHeight: 1.45 }}>
              Delete permanently removes this batch from cultivation lists and strips related task logs (same as
              before). Revert keeps the batch and moves it back one stage with fields adjusted as described above.
            </p>
            <div
              style={{
                display: "flex",
                gap: 10,
                justifyContent: "center",
                flexWrap: "wrap",
                marginTop: 22,
              }}
            >
              <button type="button" style={buttonStyle} onClick={cancelBatchDeleteChoiceModal}>
                Cancel
              </button>
              <button type="button" style={dangerButtonStyle} onClick={confirmPermanentBatchDeleteFromModal}>
                Delete permanently
              </button>
              {batchDeleteChoiceModal.revertInfo ? (
                <button
                  type="button"
                  style={{
                    ...primaryButtonStyle,
                    background: "#38bdf8",
                    borderColor: "#38bdf8",
                    color: "#0f172a",
                  }}
                  onClick={() => void confirmCultivationBatchRevert()}
                  disabled={!canWriteRecords}
                  title={
                    !canWriteRecords
                      ? "Your role cannot edit cultivation batches — revert is disabled."
                      : undefined
                  }
                >
                  Revert to {batchDeleteChoiceModal.revertInfo.targetStage}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {partialSplitChoiceModal && (
        <div style={{ ...modalOverlayStyle, zIndex: 10002 }}>
          <div style={{ ...modalStyle, maxWidth: 520 }}>
            <h2 style={{ textAlign: "center", marginTop: 0, marginBottom: 10 }}>
              Partial stage move — merge or new batch?
            </h2>
            <p style={{ color: "#cbd5e1", marginTop: 0, lineHeight: 1.55, textAlign: "center" }}>
              You already moved plants from this batch into another{" "}
              {selectedTask === TASK_MOVE_TO_VEG_ASSIGN_TAGS ? (
                <strong style={{ color: "#e2e8f0" }}>Veg</strong>
              ) : (
                <strong style={{ color: "#e2e8f0" }}>Flower</strong>
              )}{" "}
              batch split from the same line. Add these plants to that batch, or create a separate batch.
            </p>
            <label style={{ display: "grid", gap: 8, color: "#e2e8f0", fontSize: 14, marginTop: 14 }}>
              Existing batch to add plants to
              <select
                style={inputStyle}
                value={partialSplitChoiceModal.mergeTargetId}
                onChange={(e) =>
                  setPartialSplitChoiceModal((prev) =>
                    prev ? { ...prev, mergeTargetId: e.target.value } : prev,
                  )
                }
              >
                {partialSplitChoiceModal.candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id} — {c.strain} ({c.plants} plants)
                  </option>
                ))}
              </select>
            </label>
            <div
              style={{
                display: "flex",
                gap: 10,
                justifyContent: "center",
                flexWrap: "wrap",
                marginTop: 22,
              }}
            >
              <button type="button" style={buttonStyle} onClick={cancelPartialSplitChoice}>
                Cancel
              </button>
              <button
                type="button"
                style={{ ...primaryButtonStyle, background: "#38bdf8", borderColor: "#38bdf8", color: "#0f172a" }}
                onClick={() => void confirmPartialSplitNewBatch()}
                disabled={isSavingTask}
              >
                {isSavingTask ? "Saving…" : "Create new batch"}
              </button>
              <button
                type="button"
                style={primaryButtonStyle}
                onClick={() => void confirmPartialSplitMerge()}
                disabled={isSavingTask}
              >
                {isSavingTask ? "Saving…" : "Add to selected batch"}
              </button>
            </div>
          </div>
        </div>
      )}

      {harvestLeftoverModal ? (
        <div style={{ ...modalOverlayStyle, zIndex: 10002 }}>
          <div style={{ ...modalStyle, maxWidth: 520 }}>
            <h2 style={{ textAlign: "center", marginTop: 0, marginBottom: 12 }}>
              Plants remaining after harvest
            </h2>
            <p style={{ color: "#cbd5e1", marginTop: 0, lineHeight: 1.55, textAlign: "center" }}>
              After removing <strong>{harvestLeftoverModal.remaining}</strong> plants in this entry,{" "}
              <strong>{harvestLeftoverModal.remaining}</strong> plants would still be on this batch. Keep tracking them
              for another harvest, or dispose them now with a documented reason.
            </p>
            <label style={{ display: "grid", gap: 8, marginTop: 14, color: "#e2e8f0", fontSize: 14 }}>
              Reason (required only if disposing remaining plants)
              <textarea
                value={harvestDisposeReasonDraft}
                onChange={(e) => {
                  setHarvestDisposeReasonDraft(e.target.value);
                  setHarvestDisposeReasonError("");
                }}
                rows={3}
                placeholder="e.g. pests, mold check, policy cull, counted error…"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  borderRadius: 12,
                  border: "1px solid #475569",
                  background: "#020617",
                  color: "#f8fafc",
                  padding: 12,
                  fontSize: 14,
                  resize: "vertical",
                }}
              />
            </label>
            {harvestDisposeReasonError ? (
              <p style={{ color: "#fca5a5", fontSize: 13, marginTop: 10, marginBottom: 0, textAlign: "center" }}>
                {harvestDisposeReasonError}
              </p>
            ) : null}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
                justifyContent: "center",
                marginTop: 20,
              }}
            >
              <button type="button" style={buttonStyle} onClick={() => resolveHarvestLeftoverPlants(null)}>
                Cancel harvest
              </button>
              <button
                type="button"
                style={{ ...buttonStyle, borderColor: "#22c55e", color: "#bbf7d0" }}
                onClick={() => resolveHarvestLeftoverPlants({ action: "keep" })}
              >
                Keep remaining plants on batch
              </button>
              <button type="button" style={primaryButtonStyle} onClick={() => confirmHarvestDisposeRemaining()}>
                Dispose remaining plants…
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
