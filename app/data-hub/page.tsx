"use client";

import { useEffect, useState } from "react";
import Nav from "@/components/Nav";
import PageAccessGate from "@/components/PageAccessGate";
import { store } from "@/lib/store";
import { displayNameFromLogActor, getAuthUser } from "@/lib/auth";
import { canDeleteRecords } from "@/lib/permissions";
import { loadBackendStore, saveBackendStore } from "@/lib/backendStore";
import {
  loadCultivationBatches,
  updateCultivationBatch,
  deleteCultivationBatch,
} from "@/lib/cultivationApi";
import {
  loadSourceBatches,
  updateSourceBatch,
  deleteSourceBatchRecord,
} from "@/lib/sourceBatchApi";
import {
  loadExtractionBatches,
  updateExtractionBatch,
  deleteExtractionBatchRecord,
} from "@/lib/extractionApi";
import {
  loadPackagingBatches,
  updatePackagingBatch,
  deletePackagingBatchRecord,
} from "@/lib/packagingApi";
import { deleteAllLogs, deleteLog as deleteTaskLogRemote } from "@/lib/logsApi";
import { getLogs } from "@/lib/api";
import { CPU_TENANT_CHANGED_EVENT } from "@/lib/tenantEvents";
import { formatLogDisplayTime, nowIsoForLog } from "@/lib/companyTimezone";

function show(value: any) {
  if (value === undefined || value === null || value === "") return "—";
  return String(value);
}

function formatLoggedBy(value: any) {
  if (!value) return "—";

  if (typeof value === "string") return value || "—";

  let username = displayNameFromLogActor(value);
  if (username === "Unknown User") {
    username =
      String(value.name || value.userName || value.user || "").trim() || "—";
  }
  const role = value.role ? ` (${value.role})` : "";

  return `${username}${role}`;
}

function getLoggedByFromLog(log: any) {
  return (
    log?.loggedBy ||
    log?.data?.loggedBy ||
    log?.createdByUser ||
    log?.createdBy ||
    log?.packagedByUser ||
    null
  );
}

function num(value: any) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function lbsToGrams(lbs: any) {
  return +(num(lbs) * 453.592).toFixed(2);
}

function fmtLbs(value: any) {
  const n = num(value);
  if (n <= 0) return "— lbs";
  return `${+n.toFixed(2)} lbs`;
}

function fmtGrams(value: any) {
  const n = num(value);
  if (n <= 0) return "— g";
  return `${+n.toFixed(2)} g`;
}

function money(value: any) {
  return `$${num(value).toFixed(2)}`;
}

function cleanId(value: any) {
  return String(value || "")
    .toUpperCase()
    .replaceAll(".", "")
    .replaceAll("-", "")
    .replaceAll("_", "")
    .replaceAll(" ", "");
}

function lower(value: any) {
  return String(value || "").toLowerCase();
}

function asArray(value: any) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function isCompletedSourceBatch(batch: any) {
  const status = lower(batch?.status);
  return (
    status === "complete" ||
    status === "used in extraction" ||
    status.includes("complete")
  );
}

function isCompletedPackagingBatch(batch: any) {
  const status = lower(batch?.status);
  return (
    status === "packaging complete" ||
    status === "complete" ||
    status === "fully packaged" ||
    status.includes("complete")
  );
}

function isInProgressPackagingBatch(batch: any) {
  const status = lower(batch?.status);
  return (
    status === "in progress" ||
    status.includes("in progress") ||
    Boolean(batch?.sourceArea === "Packaging" && !isCompletedPackagingBatch(batch))
  );
}

function getBatchDateKey(batch: any) {
  const id = String(batch?.id || "");
  const match = id.match(/(\d{6})/);
  if (match) return match[1];

  const date = String(batch?.cloneDate || batch?.date || batch?.completedAt || "");
  const dateMatch = date.match(/(\d{4})-(\d{2})-(\d{2})/);

  if (dateMatch) {
    return `${dateMatch[2]}${dateMatch[3]}${dateMatch[1].slice(2)}`;
  }

  return "";
}

function sameBatchFamily(cult: any, other: any) {
  const cultId = cleanId(cult?.id);
  const otherId = cleanId(other?.id);
  const otherSource = cleanId(other?.source);
  const otherSourceBatchId = cleanId(other?.sourceBatchId);
  const otherOriginalBatchId = cleanId(other?.originalBatchId);
  const otherCultivationBatchId = cleanId(other?.cultivationBatchId);
  const otherParentCultivationBatch = cleanId(other?.parentCultivationBatch);

  const acronym = cleanId(cult?.acronym);
  const dateKey = getBatchDateKey(cult);

  return (
    otherId.includes(cultId) ||
    otherSource.includes(cultId) ||
    otherSourceBatchId.includes(cultId) ||
    otherOriginalBatchId.includes(cultId) ||
    otherCultivationBatchId.includes(cultId) ||
    otherParentCultivationBatch.includes(cultId) ||
    (acronym &&
      dateKey &&
      (otherId.includes(acronym) ||
        otherSource.includes(acronym) ||
        otherSourceBatchId.includes(acronym)) &&
      (otherId.includes(dateKey) ||
        otherSource.includes(dateKey) ||
        otherSourceBatchId.includes(dateKey)))
  );
}

function dedupeById(items: any[]) {
  return Array.from(
    new Map(
      items
        .filter((item: any) => item && item.id)
        .map((item: any) => [item.id, item])
    ).values()
  );
}

function isDryTrimBatch(batch: any) {
  const text = `${lower(batch?.id)} ${lower(batch?.name)} ${lower(batch?.type)} ${lower(batch?.productType)}`;
  return text.includes("dry trim") || text.includes("trim-") || text.startsWith("trim") || lower(batch?.type) === "dry trim";
}

function isFreshFrozenBatch(batch: any) {
  const text = `${lower(batch?.id)} ${lower(batch?.name)} ${lower(batch?.type)} ${lower(batch?.productType)}`;
  return text.includes("fresh frozen") || text.startsWith("ff-") || lower(batch?.type) === "fresh frozen";
}

function isFlowerOutputBatch(batch: any) {
  const text = `${lower(batch?.id)} ${lower(batch?.name)} ${lower(batch?.type)} ${lower(batch?.productType)}`;

  if (isDryTrimBatch(batch)) return false;
  if (isFreshFrozenBatch(batch)) return false;

  return (
    text.includes("a grade flower") ||
    text.includes("dry flower") ||
    text.includes("popcorn") ||
    lower(batch?.type) === "a grade flower" ||
    lower(batch?.productType) === "a grade flower"
  );
}

function isExtractionProductBatch(batch: any) {
  const text = `${lower(batch?.id)} ${lower(batch?.name)} ${lower(batch?.type)} ${lower(batch?.productType)}`;

  if (isFlowerOutputBatch(batch)) return false;
  if (isDryTrimBatch(batch)) return false;
  if (isFreshFrozenBatch(batch)) return false;

  return (
    text.includes("live resin") ||
    text.includes("cured wax") ||
    text.includes("wax") ||
    text.includes("oil") ||
    text.startsWith("ext")
  );
}

function isSourceMaterialBatch(batch: any) {
  return isDryTrimBatch(batch) || isFreshFrozenBatch(batch);
}

function findRelatedSourceBatches(cultivationBatch: any, sourceBatches: any[]) {
  const cultId = cultivationBatch?.id;

  return sourceBatches.filter((source: any) => {
    return (
      isSourceMaterialBatch(source) &&
      (source.sourceBatchId === cultId ||
        source.originalBatchId === cultId ||
        source.cultivationBatchId === cultId ||
        source.parentCultivationBatch === cultId ||
        source.source === cultId ||
        sameBatchFamily(cultivationBatch, source))
    );
  });
}

function findRelatedFlowerOutputs(cultivationBatch: any, flowerBatches: any[]) {
  const cultId = cultivationBatch?.id;

  return flowerBatches.filter((batch: any) => {
    return (
      isFlowerOutputBatch(batch) &&
      (batch.source === cultId ||
        batch.sourceBatchId === cultId ||
        batch.originalBatchId === cultId ||
        batch.cultivationBatchId === cultId ||
        sameBatchFamily(cultivationBatch, batch))
    );
  });
}

function findRelatedExtractionBatches(cultivationBatch: any, extractionBatches: any[], sourceBatches: any[]) {
  const cultId = cultivationBatch?.id;
  const relatedSources = findRelatedSourceBatches(cultivationBatch, sourceBatches);
  const sourceIds = relatedSources.map((s: any) => s.id);

  return extractionBatches.filter((ex: any) => {
    const exSourceIds = ex.sourceBatchIds || [];
    const exSources = ex.sources || ex.sourceBatches || [];

    return (
      isExtractionProductBatch(ex) &&
      (ex.sourceBatchId === cultId ||
        ex.cultivationBatchId === cultId ||
        ex.originalBatchId === cultId ||
        exSourceIds.includes(cultId) ||
        sameBatchFamily(cultivationBatch, ex) ||
        sourceIds.includes(ex.sourceBatchId) ||
        sourceIds.includes(ex.source) ||
        exSourceIds.some((id: string) => sourceIds.includes(id)) ||
        exSources.some(
          (src: any) =>
            src.id === cultId ||
            src.batchId === cultId ||
            src.sourceId === cultId ||
            sourceIds.includes(src.id) ||
            sourceIds.includes(src.batchId) ||
            sourceIds.includes(src.sourceId) ||
            sameBatchFamily(cultivationBatch, src)
        ))
    );
  });
}

function findRelatedPackagingBatches(cultivationBatch: any, extractionBatches: any[], packagingBatches: any[]) {
  const cultId = cultivationBatch?.id;
  const extractionIds = extractionBatches.map((b: any) => b.id);

  return packagingBatches.filter((p: any) => {
    const pSourceIds = p.sourceBatchIds || [];
    const pSources = p.sources || p.sourceBatches || [];

    return (
      isExtractionProductBatch(p) &&
      (p.source === cultId ||
        p.sourceBatchId === cultId ||
        p.cultivationBatchId === cultId ||
        p.originalBatchId === cultId ||
        extractionIds.includes(p.id) ||
        extractionIds.includes(p.sourceBatchId) ||
        extractionIds.includes(p.productionBatchId) ||
        pSourceIds.includes(cultId) ||
        pSourceIds.some((id: string) => extractionIds.includes(id)) ||
        pSources.some(
          (src: any) =>
            src.id === cultId ||
            src.batchId === cultId ||
            src.sourceId === cultId ||
            extractionIds.includes(src.id) ||
            extractionIds.includes(src.batchId) ||
            extractionIds.includes(src.sourceId) ||
            sameBatchFamily(cultivationBatch, src)
        ) ||
        sameBatchFamily(cultivationBatch, p))
    );
  });
}

function getCostData(batch: any) {
  if (!batch.costData) {
    batch.costData = {};
  }

  batch.costData.hourlyRate = batch.costData.hourlyRate ?? 20;
  batch.costData.calculatedLaborCost = batch.costData.calculatedLaborCost ?? 0;
  batch.costData.hardwareCost = batch.costData.hardwareCost ?? 0;
  batch.costData.testingCost = batch.costData.testingCost ?? 0;
  batch.costData.complianceCost = batch.costData.complianceCost ?? 0;
  batch.costData.otherCost = batch.costData.otherCost ?? 0;

  return batch.costData;
}

function getTotalCost(batch: any) {
  const c = getCostData(batch);

  return (
    num(c.calculatedLaborCost) +
    num(c.hardwareCost) +
    num(c.testingCost) +
    num(c.complianceCost) +
    num(c.otherCost)
  );
}

function getBatchKeyList(batch: any) {
  return Array.from(
    new Set(
      [
        batch?.id,
        batch?.source,
        batch?.sourceBatchId,
        batch?.originalBatchId,
        batch?.cultivationBatchId,
        batch?.parentCultivationBatch,
        batch?.productionBatchId,
        ...(Array.isArray(batch?.sourceBatchIds) ? batch.sourceBatchIds : []),
        ...(Array.isArray(batch?.sources)
          ? batch.sources.flatMap((src: any) => [src?.id, src?.batchId, src?.sourceId])
          : []),
        ...(Array.isArray(batch?.sourceBatches)
          ? batch.sourceBatches.flatMap((src: any) => [src?.id, src?.batchId, src?.sourceId])
          : []),
      ]
        .map((value) => String(value || ""))
        .filter(Boolean)
    )
  );
}

function isLogRelatedToBatch(log: any, batch: any) {
  const batchKeys = getBatchKeyList(batch);
  const logKeys = [log?.batch, log?.source, log?.linkedBatch, log?.sourceBatchId, log?.originalBatchId]
    .map((value) => String(value || ""))
    .filter(Boolean);

  if (batchKeys.some((key) => logKeys.includes(key))) return true;

  return batchKeys.some((batchKey) =>
    logKeys.some((logKey) => {
      const cleanBatchKey = cleanId(batchKey);
      const cleanLogKey = cleanId(logKey);

      return (
        cleanBatchKey &&
        cleanLogKey &&
        (cleanBatchKey.includes(cleanLogKey) || cleanLogKey.includes(cleanBatchKey))
      );
    })
  );
}

function parseOutputNumber(output: any, labels: string[]) {
  const text = String(output || "");

  for (const label of labels) {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`${escapedLabel}\\s*:?\\s*(\\d+(?:\\.\\d+)?)`, "i");
    const match = text.match(regex);

    if (match) return num(match[1]);
  }

  return 0;
}

function getLogPeople(log: any) {
  return (
    num(log?.people) ||
    num(log?.personCount) ||
    num(log?.peopleCount) ||
    num(log?.howManyPeople) ||
    num(log?.techCount) ||
    num(log?.howManyTechs) ||
    parseOutputNumber(log?.output, [
      "People",
      "How Many People",
      "Techs",
      "How Many Techs",
      "techCount",
    ])
  );
}

function getLogMinutes(log: any) {
  return (
    num(log?.minutes) ||
    num(log?.timeMinutes) ||
    num(log?.timeSpentMinutes) ||
    num(log?.taskMinutes) ||
    parseOutputNumber(log?.output, [
      "Minutes",
      "Time",
      "Time Spent",
      "Time Spent in Minutes",
      "timeMinutes",
    ])
  );
}

function getLogTotalLaborMinutes(log: any) {
  const fromData = log?.data && typeof log.data === "object" ? (log.data as any).totalLaborMinutes : undefined;
  const directLaborMinutes =
    num(log?.totalLaborMinutes) ||
    num(fromData) ||
    num(log?.laborMinutes) ||
    parseOutputNumber(log?.output, [
      "Labor Time",
      "Total Labor Minutes",
      "totalLaborMinutes",
    ]);

  if (directLaborMinutes > 0) return directLaborMinutes;

  const people = getLogPeople(log);
  const minutes = getLogMinutes(log);

  if (people > 0 && minutes > 0) return people * minutes;

  return 0;
}

function normalizeLaborLog(log: any) {
  const people = getLogPeople(log);
  const minutes = getLogMinutes(log);
  const totalLaborMinutes = getLogTotalLaborMinutes(log);

  return {
    ...log,
    _laborPeople: people,
    _laborMinutes: minutes,
    _laborTotalMinutes: totalLaborMinutes,
  };
}

function getTaskLaborData(batch: any, logs: any[], hourlyRate: any) {
  const relatedLogs = (Array.isArray(logs) ? logs : []).filter((log: any) =>
    isLogRelatedToBatch(log, batch)
  );

  const laborLogs = relatedLogs
    .map((log: any) => normalizeLaborLog(log))
    .filter((log: any) => num(log?._laborTotalMinutes) > 0);

  const totalPeopleMinutes = laborLogs.reduce((sum: number, log: any) => {
    return sum + num(log._laborTotalMinutes);
  }, 0);

  const totalLaborHours = totalPeopleMinutes / 60;
  const calculatedLaborCost = totalLaborHours * num(hourlyRate);

  return {
    relatedLogs,
    laborLogs,
    totalPeopleMinutes,
    totalLaborHours,
    calculatedLaborCost,
  };
}

function getFlowerWeights(batch: any, relatedSourceBatches: any[] = []) {
  const originalAGrade =
    num(batch?.aGradeFlowerWeightLbs) ||
    num(batch?.trimmedWeightLbs) ||
    num(batch?.finalAGradeFlowerLbs);

  const originalPopcorn =
    num(batch?.popcornWeightLbs) ||
    num(batch?.finalPopcornLbs);

  const trimFromRelatedSources = relatedSourceBatches
    .filter((source: any) => isDryTrimBatch(source))
    .filter((source: any) => {
      const batchId = String(batch?.id || "");
      const sourceLink = String(source?.source || "");
      const sourceBatchId = String(source?.sourceBatchId || "");
      const originalBatchId = String(source?.originalBatchId || "");
      return (
        sourceLink === batchId ||
        sourceBatchId === batchId ||
        originalBatchId === batchId ||
        cleanId(sourceLink).includes(cleanId(batchId)) ||
        cleanId(batchId).includes(cleanId(sourceLink))
      );
    })
    .reduce((sum: number, source: any) => {
      const sourceWeight =
        num(source?.weightLbs) ||
        num(source?.totalTrimLbs) ||
        num(source?.trimWeightLbs) ||
        num(String(source?.amount || "").replace(/[^0-9.]/g, ""));

      return sum + sourceWeight;
    }, 0);

  const trim =
    num(batch?.totalTrimLbs) ||
    num(batch?.trimWeightLbs) ||
    trimFromRelatedSources;
  const totalAvailable = originalAGrade + originalPopcorn;

  let packagedAGrade = num(batch?.finalAGradeFlowerLbs);
  let packagedPopcorn = num(batch?.finalPopcornLbs);

  const directPackagedTotal = num(batch?.totalFinalPackagedLbs) || num(batch?.packagedWeightLbs);
  const loggedPackagedTotal = Array.isArray(batch?.packagingLogs)
    ? batch.packagingLogs.reduce((sum: number, log: any) => sum + num(log.packagedLbs || log.weightLbs), 0)
    : 0;

  let packagedTotal = directPackagedTotal || loggedPackagedTotal;

  if (packagedTotal <= 0 && num(batch?.packagedGrams) > 0) {
    packagedTotal = num(batch.packagedGrams) / 453.592;
  }

  if ((packagedAGrade + packagedPopcorn <= 0) && packagedTotal > 0) {
    if (totalAvailable > 0) {
      packagedAGrade = +(packagedTotal * (originalAGrade / totalAvailable)).toFixed(2);
      packagedPopcorn = +(packagedTotal * (originalPopcorn / totalAvailable)).toFixed(2);
    } else {
      packagedAGrade = packagedTotal;
      packagedPopcorn = 0;
    }
  }

  if (packagedTotal <= 0) {
    packagedTotal = packagedAGrade + packagedPopcorn;
  }

  if (packagedTotal > totalAvailable && totalAvailable > 0) {
    packagedTotal = totalAvailable;
  }

  if (packagedAGrade > originalAGrade && originalAGrade > 0) packagedAGrade = originalAGrade;
  if (packagedPopcorn > originalPopcorn && originalPopcorn > 0) packagedPopcorn = originalPopcorn;

  const remaining = Math.max(totalAvailable - packagedTotal, 0);

  return {
    originalAGrade,
    originalPopcorn,
    trim,
    totalAvailable,
    packagedAGrade,
    packagedPopcorn,
    packagedTotal,
    packagedGrams: lbsToGrams(packagedTotal),
    aGradeGrams: lbsToGrams(packagedAGrade),
    popcornGrams: lbsToGrams(packagedPopcorn),
    remaining,
  };
}

function getFlowerRatio(weights: any) {
  const aGrade = num(weights?.originalAGrade);
  const popcorn = num(weights?.originalPopcorn);
  const trim = num(weights?.trim);
  const total = aGrade + popcorn + trim;

  if (total <= 0) {
    return {
      aGradePct: "0.0",
      popcornPct: "0.0",
      trimPct: "0.0",
    };
  }

  return {
    aGradePct: ((aGrade / total) * 100).toFixed(1),
    popcornPct: ((popcorn / total) * 100).toFixed(1),
    trimPct: ((trim / total) * 100).toFixed(1),
  };
}

function getPackagedUnits(batch: any) {
  const explicitUnits = num(batch?.packagedUnits) || num(batch?.units);
  if (explicitUnits > 0) return explicitUnits;

  if (Array.isArray(batch?.packagingLogs)) {
    const units = batch.packagingLogs.reduce((sum: number, log: any) => sum + num(log.units), 0);
    if (units > 0) return units;
  }

  const weights = getFlowerWeights(batch);
  if (String(batch?.packageMode || "").includes("454")) {
    return Math.ceil(weights.packagedGrams / 454);
  }

  return weights.packagedTotal > 0 ? 1 : 0;
}

function getPackagedGrams(batch: any) {
  const weights = getFlowerWeights(batch);
  return weights.packagedGrams;
}

function getCostPerUnit(batch: any, totalCost = getTotalCost(batch)) {
  const units = getPackagedUnits(batch);
  if (units <= 0) return 0;
  return totalCost / units;
}

function getCostPerGram(batch: any, totalCost = getTotalCost(batch)) {
  const grams = getPackagedGrams(batch);
  if (grams <= 0) return 0;
  return totalCost / grams;
}

function getLaborCostPerLb(batch: any, logs: any[], hourlyRate: any, sourceBatches: any[] = []) {
  const weights = getFlowerWeights(batch, sourceBatches);
  const laborData = getTaskLaborData(batch, logs, hourlyRate);
  const lbsForCost = weights.packagedTotal > 0 ? weights.packagedTotal : weights.totalAvailable;

  if (lbsForCost <= 0) return 0;

  return laborData.calculatedLaborCost / lbsForCost;
}

function canDeleteAllLogs() {
  if (typeof window === "undefined") return false;

  const user = getAuthUser();
  const role = String(user?.role || "").toUpperCase();

  return role === "ADMIN" || role === "OWNER";
}

function canWriteDataHub() {
  if (typeof window === "undefined") return false;

  const user = getAuthUser();
  const role = String(user?.role || "").toUpperCase();

  return role !== "VIEW_ONLY" && Boolean(role);
}

function cleanPackagingLogs(logs: any[]) {
  if (!Array.isArray(logs)) return [];

  const seen = new Set<string>();

  return logs.filter((log: any) => {
    const key = `${log.time || ""}-${log.packageType || ""}-${log.packagedGrams || ""}-${log.packagedLbs || ""}-${log.units || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default function DataHub() {
  const s: any = store;

  if (!s.logs) s.logs = [];

  const [refresh, setRefresh] = useState(0);
  const [selectedChain, setSelectedChain] = useState<any>(null);
  const [tenantEpoch, setTenantEpoch] = useState(0);

  useEffect(() => {
    const bump = () => setTenantEpoch((n) => n + 1);
    window.addEventListener(CPU_TENANT_CHANGED_EVENT, bump);
    return () => window.removeEventListener(CPU_TENANT_CHANGED_EVENT, bump);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadSharedData() {
      try {
        await loadBackendStore({ omitCultivation: true });

        const [
          realCultivationBatches,
          realSourceBatches,
          realExtractionBatches,
          realPackagingBatches,
          realLogs,
        ] = await Promise.all([
          loadCultivationBatches(),
          loadSourceBatches(),
          loadExtractionBatches(),
          loadPackagingBatches(),
          getLogs(),
        ]);

        if (!mounted) return;

        const cultivationList = asArray(realCultivationBatches);
        const sourceList = asArray(realSourceBatches);
        const extractionList = asArray(realExtractionBatches);
        const packagingList = asArray(realPackagingBatches);
        const backendLogs = asArray(realLogs);
        const syncedLogs = asArray(s.logs);
        const logById = new Map<string, any>();
        for (const row of backendLogs) {
          const id = row?.id != null ? String(row.id).trim() : "";
          if (id)
            logById.set(id, row);
        }
        for (const row of syncedLogs) {
          const id = row?.id != null ? String(row.id).trim() : "";
          if (id && !logById.has(id))
            logById.set(id, row);
        }
        const logsWithIds = [...logById.values()];
        const logsNoId = [
          ...syncedLogs.filter(
            (l: any) => l?.id == null || String(l.id).trim() === ""
          ),
          ...backendLogs.filter(
            (l: any) => l?.id == null || String(l.id).trim() === ""
          ),
        ];
        const logsList = [...logsWithIds, ...logsNoId];

        s.cultivationBatches = cultivationList.filter(
          (batch: any) => batch.status !== "Complete"
        );
        s.completedCultivationBatches = cultivationList.filter(
          (batch: any) => batch.status === "Complete"
        );

        s.sourceBatches = sourceList.filter(
          (batch: any) => !isCompletedSourceBatch(batch)
        );
        s.completedSourceBatches = sourceList.filter((batch: any) =>
          isCompletedSourceBatch(batch)
        );

        s.extractionBatches = extractionList;
        s.logs = logsList;

        s.packagingBatches = packagingList.filter(
          (batch: any) =>
            !isInProgressPackagingBatch(batch) && !isCompletedPackagingBatch(batch)
        );
        s.inProgressPackagingBatches = packagingList.filter((batch: any) =>
          isInProgressPackagingBatch(batch)
        );
        s.completedPackagingBatches = packagingList.filter((batch: any) =>
          isCompletedPackagingBatch(batch)
        );

        setRefresh((n) => n + 1);
      } catch (error) {
        console.error("Could not load real Data Hub tables. Falling back to sync store:", error);

        try {
          await loadBackendStore();
          if (mounted) setRefresh((n) => n + 1);
        } catch (backupError) {
          console.error("Could not load backend store fallback:", backupError);
        }
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
  }, [tenantEpoch]);

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

  function confirmNotificationModal() {
    const action = notificationModal.onConfirm;
    closeNotificationModal();

    if (action) {
      action();
    }
  }

  function forceRefresh() {
    setRefresh((n) => n + 1);

    saveBackendStore().catch((error) => {
      console.error("Could not save backend store:", error);
    });
  }

  async function saveRealTableBatch(batch: any) {
    if (!batch?.id) return;

    try {
      if (
        (s.cultivationBatches || []).some((item: any) => item.id === batch.id) ||
        (s.completedCultivationBatches || []).some((item: any) => item.id === batch.id)
      ) {
        await updateCultivationBatch(batch.id, batch);
        return;
      }

      if (
        (s.sourceBatches || []).some((item: any) => item.id === batch.id) ||
        (s.completedSourceBatches || []).some((item: any) => item.id === batch.id)
      ) {
        await updateSourceBatch(batch.id, batch);
        return;
      }

      if ((s.extractionBatches || []).some((item: any) => item.id === batch.id)) {
        await updateExtractionBatch(batch.id, batch);
        return;
      }

      if (
        (s.packagingBatches || []).some((item: any) => item.id === batch.id) ||
        (s.inProgressPackagingBatches || []).some((item: any) => item.id === batch.id) ||
        (s.completedPackagingBatches || []).some((item: any) => item.id === batch.id)
      ) {
        await updatePackagingBatch(batch.id, batch);
      }
    } catch (error) {
      console.error("Could not save Data Hub cost data to real table:", error);
      showNotice(
        "Backend Save Warning",
        "The cost change was saved locally, but it did not save to the real table.",
        "Check the backend terminal for errors."
      );
    }
  }

  async function deleteRealTableBatch(batch: any, preferredType = "") {
    if (!batch?.id) return;

    try {
      if (preferredType === "cultivation") {
        await deleteCultivationBatch(batch.id);
        return;
      }

      if (preferredType === "source") {
        await deleteSourceBatchRecord(batch.id);
        return;
      }

      if (preferredType === "extraction") {
        await deleteExtractionBatchRecord(batch.id);
        return;
      }

      if (preferredType === "packaging") {
        await deletePackagingBatchRecord(batch.id);
      }
    } catch (error) {
      console.error("Could not delete Data Hub batch from real table:", error);
      showNotice(
        "Backend Delete Warning",
        `The batch ${batch.id} was removed locally, but the real table delete failed.`,
        "Check the backend terminal for errors."
      );
    }
  }

  function updateCost(batch: any, field: string, value: string) {
    if (!canWriteDataHub()) {
      showNotice(
        "Read Only Mode",
        "View Only users can look at Data Hub records, but cannot edit cost data."
      );
      return;
    }

    const c = getCostData(batch);
    c[field] = value;
    forceRefresh();
    saveRealTableBatch(batch);
  }

  function removeById(arrName: string, id: string) {
    if (!s[arrName]) return;
    s[arrName] = s[arrName].filter((b: any) => b.id !== id);
  }

  async function runDeleteChain(chain: any) {
    const batchId = chain?.cultivation?.id;

    removeById("batches", batchId);
    removeById("completedBatches", batchId);
    removeById("cultivationBatches", batchId);
    removeById("completedCultivationBatches", batchId);

    await deleteRealTableBatch(chain.cultivation, "cultivation");

    for (const sourceBatch of chain.source || []) {
      await deleteRealTableBatch(sourceBatch, "source");
    }

    for (const extractionBatch of chain.extraction || []) {
      await deleteRealTableBatch(extractionBatch, "extraction");
    }

    for (const packagingBatch of chain.packaging || []) {
      await deleteRealTableBatch(packagingBatch, "packaging");
    }

    [...chain.source, ...chain.flowerOutput, ...chain.extraction, ...chain.packaging].forEach((b: any) => {
      removeById("trimBatches", b.id);
      removeById("completedTrimBatches", b.id);
      removeById("sourceMaterialBatches", b.id);
      removeById("completedSourceMaterialBatches", b.id);
      removeById("availableSourceMaterial", b.id);
      removeById("availableSourceBatches", b.id);
      removeById("sourceBatches", b.id);
      removeById("completedSourceBatches", b.id);
      removeById("usedSourceBatches", b.id);
      removeById("completedUsedSourceBatches", b.id);
      removeById("extractionSourceBatches", b.id);
      removeById("availableExtractionSourceBatches", b.id);
      removeById("completedExtractionSourceBatches", b.id);
      removeById("dryFlowerBatches", b.id);
      removeById("productionBatches", b.id);
      removeById("extractionBatches", b.id);
      removeById("completedExtractionBatches", b.id);
      removeById("packagingBatches", b.id);
      removeById("completedPackagingBatches", b.id);
    });

    setSelectedChain(null);
    forceRefresh();
  }

  function deleteChain(chain: any) {
    if (!canDeleteRecords()) {
      showNotice(
        "Access Denied",
        "Only Manager, Admin, or Owner users can delete batch chains."
      );
      return;
    }

    const batchId = chain?.cultivation?.id;

    showConfirm(
      "Delete Batch Chain",
      `Delete batch chain "${batchId}" from Data Hub view?`,
      () => runDeleteChain(chain),
      "This removes the cultivation batch and all linked source material, flower output, extraction, and packaging batches from the current stored lists."
    );
  }

  async function runDeleteLog(index: number) {
    const log = s.logs[index];
    if (!log) return;

    const remoteId =
      log?.id != null && String(log.id).trim() ? String(log.id).trim() : "";

    if (remoteId) {
      try {
        await deleteTaskLogRemote(remoteId);
      } catch (error) {
        console.error("Could not delete log from backend:", error);
        showNotice(
          "Delete Log Failed",
          "This log was not removed from the database.",
          "Check the backend terminal for errors."
        );
        return;
      }
    }

    s.logs.splice(index, 1);
    forceRefresh();
  }

  function deleteLogRow(index: number) {
    if (!canDeleteAllLogs()) {
      showNotice(
        "Access Denied",
        "Only Owner or Admin users can delete logs."
      );
      return;
    }

    showConfirm(
      "Delete Log",
      "Delete this log?",
      () => {
        void runDeleteLog(index);
      },
      "This removes the selected log from the Data Hub log list and the database when it has an id."
    );
  }

  async function runDeleteAllLogs() {
    if (!canDeleteAllLogs()) {
      showNotice(
        "Access Denied",
        "Only Owner or Admin users can delete all logs."
      );
      return;
    }

    try {
      const result = await deleteAllLogs();

      s.logs = [
        {
          area: "Logs",
          batch: "ALL_LOGS",
          task: "Deleted All Logs",
          output: `All logs deleted. Count deleted: ${result?.deletedCount ?? "—"}.`,
          time: nowIsoForLog(),
          loggedBy: getAuthUser(),
        },
      ];

      forceRefresh();
    } catch (error) {
      console.error("Could not delete all logs:", error);
      showNotice(
        "Delete All Logs Failed",
        "The logs were not deleted from the backend.",
        "Check the backend terminal for errors."
      );
    }
  }

  function deleteAllLogsButton() {
    if (!canDeleteAllLogs()) {
      showNotice(
        "Access Denied",
        "Only Owner or Admin users can delete all logs."
      );
      return;
    }

    showConfirm(
      "Delete All Logs",
      "Delete every log in All Logs?",
      runDeleteAllLogs,
      "This removes all current logs and creates one new audit log showing who cleared them."
    );
  }

  const cultivationBatches = dedupeById([
    ...(s.batches || []),
    ...(s.completedBatches || []),
    ...(s.cultivationBatches || []),
    ...(s.completedCultivationBatches || []),
  ]);

  const allSourceCandidates = dedupeById([
    ...(s.trimBatches || []),
    ...(s.completedTrimBatches || []),
    ...(s.sourceMaterialBatches || []),
    ...(s.completedSourceMaterialBatches || []),
    ...(s.availableSourceMaterial || []),
    ...(s.availableSourceBatches || []),
    ...(s.sourceBatches || []),
    ...(s.completedSourceBatches || []),
    ...(s.usedSourceBatches || []),
    ...(s.completedUsedSourceBatches || []),
    ...(s.extractionSourceBatches || []),
    ...(s.availableExtractionSourceBatches || []),
    ...(s.completedExtractionSourceBatches || []),
    ...(s.productionBatches || []),
  ]).filter(isSourceMaterialBatch);

  const allFlowerOutputCandidates = dedupeById([
    ...(s.dryFlowerBatches || []),
    ...(s.productionBatches || []),
    ...(s.packagingBatches || []),
    ...(s.inProgressPackagingBatches || []),
    ...(s.completedPackagingBatches || []),
  ]).filter(isFlowerOutputBatch);

  const allExtractionCandidates = dedupeById([
    ...(s.extractionBatches || []),
    ...(s.completedExtractionBatches || []),
  ]).filter(isExtractionProductBatch);

  const allPackagingCandidates = dedupeById([
    ...(s.packagingBatches || []),
    ...(s.inProgressPackagingBatches || []),
    ...(s.completedPackagingBatches || []),
  ]).filter(isExtractionProductBatch);

  const chains = cultivationBatches.map((cult: any, index: number) => {
    const relatedSource = dedupeById(findRelatedSourceBatches(cult, allSourceCandidates));
    const relatedFlowerOutput = dedupeById(findRelatedFlowerOutputs(cult, allFlowerOutputCandidates));
    const relatedExtraction = dedupeById(findRelatedExtractionBatches(cult, allExtractionCandidates, allSourceCandidates));
    const relatedPackaging = dedupeById(findRelatedPackagingBatches(cult, relatedExtraction, allPackagingCandidates));

    return {
      id: cult.id || `batch-${index}`,
      cultivation: cult,
      source: relatedSource,
      flowerOutput: relatedFlowerOutput,
      extraction: relatedExtraction,
      packaging: relatedPackaging,
    };
  });

  const pageStyle: any = {
    minHeight: "100vh",
    background: "#020617",
    color: "white",
    padding: 20,
  };

  const shellStyle: any = {
    maxWidth: 1300,
    margin: "0 auto",
  };

  const cardStyle: any = {
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: 16,
    padding: 22,
    marginTop: 22,
  };

  const rowStyle: any = {
    background: "#111827",
    border: "1px solid #334155",
    borderRadius: 14,
    padding: 16,
    marginTop: 12,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  };

  const smallCardStyle: any = {
    background: "#020617",
    border: "1px solid #334155",
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
  };

  const metricGridStyle: any = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: 10,
    marginTop: 12,
  };

  const metricStyle: any = {
    background: "#111827",
    border: "1px solid #334155",
    borderRadius: 12,
    padding: 12,
  };

  const scrollWindowStyle: any = {
    maxHeight: 420,
    overflowY: "auto",
    paddingRight: 8,
    marginTop: 12,
  };

  const buttonStyle: any = {
    background: "#334155",
    color: "white",
    border: "1px solid #475569",
    borderRadius: 10,
    padding: "10px 14px",
    cursor: "pointer",
    fontWeight: 700,
  };

  const greenButtonStyle: any = {
    ...buttonStyle,
    background: "#22c55e",
    color: "black",
    border: "1px solid #22c55e",
  };

  const deleteButtonStyle: any = {
    ...buttonStyle,
    background: "#7f1d1d",
    border: "1px solid #ef4444",
  };

  const blueButtonStyle: any = {
    ...buttonStyle,
    background: "#2563eb",
    border: "1px solid #3b82f6",
  };

  const inputStyle: any = {
    width: "100%",
    padding: 10,
    borderRadius: 10,
    border: "1px solid #334155",
    background: "#020617",
    color: "white",
  };

  const labelStyle: any = {
    color: "#93c5fd",
    fontSize: 13,
  };

  const mutedStyle: any = {
    color: "#94a3b8",
  };

  const modalOverlayStyle: any = {
    position: "fixed",
    inset: 0,
    background: "rgba(2, 6, 23, 0.78)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 9999,
    padding: 20,
  };

  const modalStyle: any = {
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: 18,
    padding: 24,
    width: "min(1050px, 95vw)",
    maxHeight: "85vh",
    overflowY: "auto",
    boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
  };

  function Metric({ label, value }: any) {
    const isLongText =
      typeof value === "string" &&
      value.length > 28;

    return (
      <div
        style={{
          ...metricStyle,
          minHeight: isLongText ? 90 : "auto",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            ...labelStyle,
            fontSize: isLongText ? 12 : 13,
            marginBottom: 6,
          }}
        >
          {label}
        </div>

        <div
          style={{
            fontSize: isLongText ? 14 : 22,
            fontWeight: isLongText ? 700 : 800,
            lineHeight: isLongText ? 1.4 : 1.2,
            wordBreak: "break-word",
            whiteSpace: "normal",
          }}
        >
          {value}
        </div>
      </div>
    );
  }

  function SimpleDetails({ data, hiddenKeys = [] }: any) {
    const hidden = new Set([
      "packagingLogs",
      "sourceBatches",
      "sourceBatchIds",
      "completedTasks",
      "taskHistory",
      "costData",
      ...hiddenKeys,
    ]);

    return (
      <div style={{ display: "grid", gap: 4, marginTop: 10 }}>
        {Object.entries(data || {})
          .filter(([key, value]) => !hidden.has(key) && typeof value !== "object")
          .map(([key, value]) => (
            <div key={key}>
              <span style={labelStyle}>{key}: </span>
              {show(value)}
            </div>
          ))}
      </div>
    );
  }

  function CostCalculator({ batch }: any) {
    const c = getCostData(batch);
    const weights = getFlowerWeights(batch);
    const laborData = getTaskLaborData(batch, s.logs, c.hourlyRate);

    c.calculatedLaborCost = +laborData.calculatedLaborCost.toFixed(2);

    const totalCost = getTotalCost(batch);
    const userCanWrite = canWriteDataHub();

    return (
      <div style={smallCardStyle}>
        <h3 style={{ marginTop: 0 }}>Cost / CPU Calculator</h3>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 10,
          }}
        >
          <input
            style={inputStyle}
            placeholder="Hourly Rate"
            value={c.hourlyRate}
            onChange={(e) => updateCost(batch, "hourlyRate", e.target.value)}
            type="number"
            disabled={!userCanWrite}
          />

          <input
            style={inputStyle}
            value={`Labor Hours: ${laborData.totalLaborHours.toFixed(2)}`}
            readOnly
          />

          <input
            style={inputStyle}
            value={`Calculated Labor Cost: ${money(c.calculatedLaborCost)}`}
            readOnly
          />

          <input style={inputStyle} placeholder="Hardware Cost" value={c.hardwareCost} onChange={(e) => updateCost(batch, "hardwareCost", e.target.value)} disabled={!userCanWrite} />
          <input style={inputStyle} placeholder="Testing Cost" value={c.testingCost} onChange={(e) => updateCost(batch, "testingCost", e.target.value)} disabled={!userCanWrite} />
          <input style={inputStyle} placeholder="Compliance Cost" value={c.complianceCost} onChange={(e) => updateCost(batch, "complianceCost", e.target.value)} disabled={!userCanWrite} />
          <input style={inputStyle} placeholder="Other Cost" value={c.otherCost} onChange={(e) => updateCost(batch, "otherCost", e.target.value)} disabled={!userCanWrite} />
        </div>

        <div style={metricGridStyle}>
          <Metric label="Labor Logs Used" value={laborData.laborLogs.length} />
          <Metric label="Total Labor Hours" value={laborData.totalLaborHours.toFixed(2)} />
          <Metric label="Labor Cost" value={money(c.calculatedLaborCost)} />
          <Metric label="Total Cost" value={money(totalCost)} />
          <Metric label="Packaged Units" value={getPackagedUnits(batch)} />
          <Metric label="Packaged Weight" value={fmtLbs(weights.packagedTotal)} />
          <Metric label="Packaged Grams" value={fmtGrams(weights.packagedGrams)} />
          <Metric label="Cost Per Unit" value={money(getCostPerUnit(batch, totalCost))} />
          <Metric label="Cost Per Gram" value={money(getCostPerGram(batch, totalCost))} />
        </div>

        {laborData.laborLogs.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <h4 style={{ margin: "0 0 8px" }}>Labor Tasks Used</h4>
            <div style={{ ...scrollWindowStyle, maxHeight: 220 }}>
              {laborData.laborLogs.map((log: any, index: number) => (
                <div key={index} style={{ ...metricStyle, marginTop: 8 }}>
                  <div><span style={labelStyle}>Task: </span>{show(log.task)}</div>
                  <div><span style={labelStyle}>Batch: </span>{show(log.batch)}</div>
                  <div><span style={labelStyle}>People: </span>{show(log._laborPeople || log.people)}</div>
                  <div><span style={labelStyle}>Minutes: </span>{show(log._laborMinutes || log.minutes)}</div>
                  <div><span style={labelStyle}>Labor Minutes: </span>{show(log._laborTotalMinutes)}</div>
                  <div><span style={labelStyle}>Cost: </span>{money((num(log._laborTotalMinutes) / 60) * num(c.hourlyRate))}</div>
                  <div><span style={labelStyle}>Time: </span>{formatLogDisplayTime(log)}</div>
                  <div><span style={labelStyle}>Logged By: </span>{formatLoggedBy(getLoggedByFromLog(log))}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  function FlowerOutputCard({ batch, sourceBatches = [] }: any) {
    const weights = getFlowerWeights(batch, sourceBatches);
    const ratio = getFlowerRatio(weights);
    const c = getCostData(batch);
    const laborData = getTaskLaborData(batch, s.logs, c.hourlyRate);
    c.calculatedLaborCost = +laborData.calculatedLaborCost.toFixed(2);
    const laborCostPerLb = getLaborCostPerLb(batch, s.logs, c.hourlyRate, sourceBatches);

    return (
      <div style={smallCardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
          <div>
            <h3 style={{ margin: 0 }}>{show(batch.id)}</h3>
            <p style={{ ...mutedStyle, margin: "6px 0 0" }}>{show(batch.name || batch.type)}</p>
          </div>
          <div style={{ color: batch.status === "Complete" ? "#22c55e" : "#facc15", fontWeight: 800 }}>
            {show(batch.status)}
          </div>
        </div>

        <div style={metricGridStyle}>
          <Metric label="Original A Grade" value={fmtLbs(weights.originalAGrade)} />
          <Metric label="Original Popcorn" value={fmtLbs(weights.originalPopcorn)} />
          <Metric label="Trim to Extraction" value={fmtLbs(weights.trim)} />

          <div style={metricStyle}>
            <div style={labelStyle}>Bud / Popcorn / Trim Ratio</div>

            <div style={{ marginTop: 10 }}>
              <div
                style={{
                  paddingBottom: 8,
                  borderBottom: "1px solid #334155",
                }}
              >
                <div style={{ color: "#93c5fd", fontSize: 14 }}>Bud</div>
                <div style={{ fontSize: 18, fontWeight: 800 }}>
                  {ratio.aGradePct}%
                </div>
              </div>

              <div
                style={{
                  paddingTop: 10,
                  paddingBottom: 8,
                  borderBottom: "1px solid #334155",
                }}
              >
                <div style={{ color: "#93c5fd", fontSize: 14 }}>Popcorn</div>
                <div style={{ fontSize: 18, fontWeight: 800 }}>
                  {ratio.popcornPct}%
                </div>
              </div>

              <div style={{ paddingTop: 10 }}>
                <div style={{ color: "#93c5fd", fontSize: 14 }}>Trim</div>
                <div style={{ fontSize: 18, fontWeight: 800 }}>
                  {ratio.trimPct}%
                </div>
              </div>
            </div>
          </div>

          <Metric label="Flower Available" value={fmtLbs(weights.totalAvailable)} />
          <Metric label="Packaged A Grade" value={fmtLbs(weights.packagedAGrade)} />
          <Metric label="Packaged Popcorn" value={fmtLbs(weights.packagedPopcorn)} />
          <Metric label="Total Packaged" value={fmtLbs(weights.packagedTotal)} />
          <Metric label="Labor Cost Per Lb" value={money(laborCostPerLb)} />
          <Metric label="Remaining Flower" value={fmtLbs(weights.remaining)} />
        </div>

        <div style={{ marginTop: 14 }}>
          <h4 style={{ margin: "0 0 8px" }}>Labor Tasks Used For Finished A Grade Flower</h4>

          {laborData.laborLogs.length === 0 ? (
            <p style={mutedStyle}>No labor tasks found for this finished flower batch yet.</p>
          ) : (
            <div style={{ ...scrollWindowStyle, maxHeight: 260 }}>
              {laborData.laborLogs.map((log: any, index: number) => (
                <div key={index} style={{ ...metricStyle, marginTop: 8 }}>
                  <div><span style={labelStyle}>Task: </span>{show(log.task)}</div>
                  <div><span style={labelStyle}>Batch: </span>{show(log.batch)}</div>
                  <div><span style={labelStyle}>People: </span>{show(log._laborPeople || log.people)}</div>
                  <div><span style={labelStyle}>Minutes: </span>{show(log._laborMinutes || log.minutes)}</div>
                  <div><span style={labelStyle}>Labor Minutes: </span>{show(log._laborTotalMinutes)}</div>
                  <div><span style={labelStyle}>Cost: </span>{money((num(log._laborTotalMinutes) / 60) * num(c.hourlyRate))}</div>
                  <div><span style={labelStyle}>Time: </span>{formatLogDisplayTime(log)}</div>
                  <div><span style={labelStyle}>Logged By: </span>{formatLoggedBy(getLoggedByFromLog(log))}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  function SourceCard({ batch }: any) {
    return (
      <div style={smallCardStyle}>
        <h3 style={{ marginTop: 0 }}>{show(batch.id)}</h3>
        <div style={metricGridStyle}>
          <Metric label="Type" value={show(batch.type || batch.materialType)} />
          <Metric label="Status" value={show(batch.status)} />
          <Metric label="Weight" value={batch.weightLbs ? fmtLbs(batch.weightLbs) : batch.grams ? fmtGrams(batch.grams) : show(batch.amount)} />
          <Metric label="Source" value={show(batch.source || batch.parentCultivationBatch)} />
        </div>
      </div>
    );
  }

  function PackagingCard({ batch }: any) {
    const logs = cleanPackagingLogs(batch.packagingLogs || []);

    const totalFinalGrams =
      num(batch?.finalOilGrams) ||
      num(batch?.finalBulkGrams) ||
      num(batch?.packagedGrams) ||
      0;

    const totalPackagedGrams =
      num(batch?.packagedGrams) ||
      logs.reduce((sum: number, log: any) => sum + num(log.packagedGrams), 0);

    return (
      <div style={smallCardStyle}>
        <h3 style={{ marginTop: 0 }}>{show(batch.id)}</h3>

        <div style={metricGridStyle}>
          <Metric
            label="Product Type"
            value={show(batch.name || batch.type || batch.productType)}
          />
          <Metric label="Status" value={show(batch.status)} />
          <Metric label="Total Final" value={fmtGrams(totalFinalGrams)} />
          <Metric label="Total Packaged" value={fmtGrams(totalPackagedGrams)} />
        </div>

        {logs.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <h4 style={{ margin: "0 0 8px" }}>Packaging Entries</h4>

            <div style={{ ...scrollWindowStyle, maxHeight: 360 }}>
              {logs.map((log: any, index: number) => (
              <div
                key={index}
                style={{ ...metricStyle, marginTop: 8 }}
              >
                <div>
                  <span style={labelStyle}>Time: </span>
                  {formatLogDisplayTime(log)}
                </div>

                <div>
                  <span style={labelStyle}>Package Type: </span>
                  {show(log.packageType)}
                </div>

                <div>
                  <span style={labelStyle}>Units: </span>
                  {show(log.units)}
                </div>

                <div>
                  <span style={labelStyle}>Unit Size: </span>
                  {show(log.unitSizeGrams)}g
                </div>

                <div>
                  <span style={labelStyle}>Packaged: </span>
                  {fmtGrams(log.packagedGrams)}
                </div>

                <div>
                  <span style={labelStyle}>Packaged By: </span>
                  {show(log.packagedBy)}
                </div>

                <div>
                  <span style={labelStyle}>Logged By: </span>
                  {formatLoggedBy(getLoggedByFromLog(log))}
                </div>

                <div>
                  <span style={labelStyle}>Packaging Time: </span>
                  {show(log.packagingTimeMinutes)} min
                </div>

                <div>
                  <span style={labelStyle}>Notes: </span>
                  {show(log.notes)}
                </div>
              </div>
              ))}
            </div>
          </div>
        )}

        <CostCalculator batch={batch} />
      </div>
    );
  }

  return (
    <PageAccessGate permission="page.data-hub">
      <div style={pageStyle}>
      <div style={shellStyle}>
        <Nav />

        <div style={{ textAlign: "center", marginTop: 24 }}>
          <h1 style={{ margin: 0 }}>Data Hub</h1>
          <p style={{ color: "#94a3b8", marginTop: 8 }}>
            Clean batch chain view with cultivation flower output, trim, extraction, extraction packaging, and cost data separated.
          </p>
        </div>

        {!canWriteDataHub() && (
          <div
            style={{
              ...cardStyle,
              border: "1px solid #facc15",
              background: "rgba(113, 63, 18, 0.35)",
              color: "#fef3c7",
              textAlign: "center",
            }}
          >
            <b>Read Only Mode:</b> You can view Data Hub details, but cost edits and deletes are disabled.
          </div>
        )}

        <div style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Batch Chains</h2>

          {chains.length === 0 ? (
            <p style={mutedStyle}>No batch data found.</p>
          ) : (
            <div style={scrollWindowStyle}>
              {chains.map((chain: any) => (
                <div key={chain.id} style={rowStyle}>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 800 }}>
                    {show(chain.cultivation.id)} | {show(chain.cultivation.strain)}
                  </div>

                  <div style={{ color: "#94a3b8", marginTop: 6 }}>
                    Stage: {show(chain.cultivation.stage)} | Status: {show(chain.cultivation.status)} | Room: {show(chain.cultivation.flowerRoom)} | Bay: {show(chain.cultivation.flowerBay)}
                  </div>

                  <div style={{ color: "#94a3b8", marginTop: 6 }}>
                    Source Material: {chain.source.length} | Flower Output: {chain.flowerOutput.length} | Extraction: {chain.extraction.length} | Packaging: {chain.packaging.length}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <button style={greenButtonStyle} onClick={() => setSelectedChain(chain)}>View Chain</button>
                  {canDeleteRecords() && (
                    <button style={deleteButtonStyle} onClick={() => deleteChain(chain)}>Delete</button>
                  )}
                </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={cardStyle}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <h2 style={{ marginTop: 0, marginBottom: 0 }}>All Logs</h2>

            {canDeleteAllLogs() && s.logs.length > 0 && (
              <button style={deleteButtonStyle} onClick={deleteAllLogsButton}>
                Delete All Logs
              </button>
            )}
          </div>

          {s.logs.length === 0 ? (
            <p style={mutedStyle}>No logs yet.</p>
          ) : (
            <div style={{ ...scrollWindowStyle, maxHeight: 360 }}>
              {s.logs.map((l: any, i: number) => (
                <div key={i} style={rowStyle}>
                  <div>
                    <b>{show(l.area)}</b> | Batch: {show(l.batch)} | Task: {show(l.task)}
                    <div style={{ color: "#94a3b8", marginTop: 4 }}>Output: {show(l.output)} | Time: {formatLogDisplayTime(l)}</div>
                    <div style={{ color: "#94a3b8", marginTop: 4 }}>Logged By: {formatLoggedBy(getLoggedByFromLog(l))}</div>
                  </div>

                  {canDeleteAllLogs() && (
                    <button style={deleteButtonStyle} onClick={() => deleteLogRow(i)}>Delete</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {selectedChain && (
          <div style={modalOverlayStyle}>
            <div style={modalStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <div>
                  <h2 style={{ margin: 0 }}>Batch Chain Details</h2>
                  <p style={{ color: "#94a3b8", marginTop: 6 }}>
                    {show(selectedChain.cultivation.id)} | {show(selectedChain.cultivation.strain)}
                  </p>
                </div>

                <button style={buttonStyle} onClick={() => setSelectedChain(null)}>Close</button>
              </div>

              <div style={smallCardStyle}>
                <h3 style={{ marginTop: 0 }}>Cultivation</h3>
                <div style={metricGridStyle}>
                  <Metric label="Batch" value={show(selectedChain.cultivation.id)} />
                  <Metric label="Strain" value={show(selectedChain.cultivation.strain)} />
                  <Metric label="Stage" value={show(selectedChain.cultivation.stage)} />
                  <Metric label="Status" value={show(selectedChain.cultivation.status)} />
                  <Metric label="Plants" value={show(selectedChain.cultivation.plants)} />
                  <Metric label="Original Plants" value={show(selectedChain.cultivation.originalPlants)} />
                  <Metric label="Room" value={show(selectedChain.cultivation.flowerRoom)} />
                  <Metric label="Bay" value={show(selectedChain.cultivation.flowerBay)} />
                </div>
              </div>

              <div style={smallCardStyle}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <h3 style={{ marginTop: 0 }}>Source Material</h3>
                  <span style={mutedStyle}>{selectedChain.source.length} found</span>
                </div>

                {selectedChain.source.length === 0 ? (
                  <p style={mutedStyle}>No fresh frozen or dry trim source material linked.</p>
                ) : (
                  <div style={{ ...scrollWindowStyle, maxHeight: 360 }}>
                    {selectedChain.source.map((source: any, i: number) => <SourceCard key={`${source.id || i}`} batch={source} />)}
                  </div>
                )}
              </div>

              <div style={smallCardStyle}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <h3 style={{ marginTop: 0 }}>Flower Output</h3>
                  <span style={mutedStyle}>{selectedChain.flowerOutput.length} found</span>
                </div>

                {selectedChain.flowerOutput.length === 0 ? (
                  <p style={mutedStyle}>No dry flower output linked.</p>
                ) : (
                  <div style={{ ...scrollWindowStyle, maxHeight: 520 }}>
                    {selectedChain.flowerOutput.map((flower: any, i: number) => <FlowerOutputCard key={`${flower.id || i}`} batch={flower} sourceBatches={selectedChain.source} />)}
                  </div>
                )}
              </div>

              <div style={smallCardStyle}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <h3 style={{ marginTop: 0 }}>Extraction</h3>
                  <span style={mutedStyle}>{selectedChain.extraction.length} found</span>
                </div>

                {selectedChain.extraction.length === 0 ? (
                  <p style={mutedStyle}>No live resin, cured wax, or oil extraction batches linked.</p>
                ) : (
                  <div style={{ ...scrollWindowStyle, maxHeight: 420 }}>
                    {selectedChain.extraction.map((ex: any, i: number) => (
                      <div key={`${ex.id || i}`} style={smallCardStyle}>
                        <h3 style={{ marginTop: 0 }}>{show(ex.id)}</h3>
                        <SimpleDetails data={ex} />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={smallCardStyle}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <h3 style={{ marginTop: 0 }}>Packaging</h3>
                  <span style={mutedStyle}>{selectedChain.packaging.length} found</span>
                </div>

                {selectedChain.packaging.length === 0 ? (
                  <p style={mutedStyle}>No extraction packaging entries linked yet.</p>
                ) : (
                  <div style={{ ...scrollWindowStyle, maxHeight: 620 }}>
                    {selectedChain.packaging.map((p: any, i: number) => <PackagingCard key={`${p.id || i}`} batch={p} />)}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

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
