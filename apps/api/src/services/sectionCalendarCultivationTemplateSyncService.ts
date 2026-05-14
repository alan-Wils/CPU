import { prisma } from "../config/prisma.js";
import { ConfigService } from "./configService.js";
import { StoreService } from "./storeService.js";
import { addDaysYmdApi } from "../lib/cultivationScheduleTemplateMath.js";

const TASK_MOVE_TO_VEG_ASSIGN_TAGS = "Move to Veg / Assign Plant Tags";
const TASK_MOVE_TO_VEG = "Move to Veg";
const LEGACY_TASK_CLONE_TO_VEG = "Clone → Veg";
const TASK_MOVE_TO_FLOWER = "Move to Flower";

const ISO_YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isAnyMoveToVegTask(taskName: string): boolean {
  const t = String(taskName || "").trim();
  return t === TASK_MOVE_TO_VEG_ASSIGN_TAGS || t === LEGACY_TASK_CLONE_TO_VEG || t === TASK_MOVE_TO_VEG;
}

function normalizeStageMoveYmd(raw: unknown): string | null {
  const s = String(raw ?? "").trim().slice(0, 10);
  return ISO_YMD_RE.test(s) ? s : null;
}

type StageAnchors = { clone?: string; veg?: string; flower?: string };

function resolveStageAnchorsYmd(batchId: string, cloneDateRaw: unknown, logs: readonly unknown[]): StageAnchors {
  const bid = String(batchId || "").trim();
  const out: StageAnchors = {};
  const cd = normalizeStageMoveYmd(cloneDateRaw);
  if (cd) out.clone = cd;
  const vegDates: string[] = [];
  const flowerDates: string[] = [];
  for (const entry of logs || []) {
    const log = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
    if (!log) continue;
    if (String(log.batch ?? "").trim() !== bid) continue;
    const task = String(log.task ?? "").trim();
    const data = log.data && typeof log.data === "object" ? (log.data as Record<string, unknown>) : {};
    const ymd = normalizeStageMoveYmd(data.stageMoveDate);
    if (!ymd) continue;
    if (isAnyMoveToVegTask(task)) vegDates.push(ymd);
    if (task === TASK_MOVE_TO_FLOWER) flowerDates.push(ymd);
  }
  const minYmd = (arr: string[]) => (arr.length ? [...arr].sort((a, b) => a.localeCompare(b))[0] : undefined);
  const veg = minYmd(vegDates);
  const flower = minYmd(flowerDates);
  if (veg) out.veg = veg;
  if (flower) out.flower = flower;
  return out;
}

function anchorForStage(stage: string, anchors: StageAnchors): string | null {
  if (stage === "veg") return anchors.veg ?? null;
  if (stage === "flower") return anchors.flower ?? null;
  return anchors.clone ?? null;
}

function templateDedupeKey(templateId: string, batchId: string): string {
  return `cult:tpl:${String(templateId).trim()}:batch:${String(batchId).trim()}`;
}

function parseDedupeKey(key: string): { templateId: string; batchId: string } | null {
  const prefix = "cult:tpl:";
  const mid = ":batch:";
  const k = String(key || "").trim();
  if (!k.startsWith(prefix) || !k.includes(mid)) return null;
  const rest = k.slice(prefix.length);
  const i = rest.indexOf(mid);
  if (i < 0) return null;
  const templateId = rest.slice(0, i).trim();
  const batchId = rest.slice(i + mid.length).trim();
  if (!templateId || !batchId) return null;
  return { templateId, batchId };
}

function asUiRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function normalizeTemplateRow(raw: unknown): { id: string; stage: string; title: string; daysFromStageStart: number; defaultNotes?: string } | null {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  let id = String(o.id ?? "").trim();
  if (!id) id = `cult-stpl-${Date.now()}`;
  const title = String(o.title ?? "").trim();
  if (!title) return null;
  const st = String(o.stage ?? "clone").toLowerCase();
  const stage = st === "veg" ? "veg" : st === "flower" ? "flower" : "clone";
  const d = Number(o.daysFromStageStart);
  const daysFromStageStart = Number.isFinite(d) ? Math.trunc(d) : 0;
  const dn = o.defaultNotes != null ? String(o.defaultNotes).trim() : "";
  return { id, stage, title, daysFromStageStart, ...(dn ? { defaultNotes: dn.slice(0, 2000) } : {}) };
}

function loadDisplayTimezone(merged: Record<string, unknown>): string {
  const company = merged.company && typeof merged.company === "object" ? (merged.company as Record<string, unknown>) : {};
  const settings = company.settings && typeof company.settings === "object" ? (company.settings as Record<string, unknown>) : {};
  const tz = String(settings.displayTimezone ?? "").trim();
  return tz || "UTC";
}

function batchEligible(ui: Record<string, unknown>): boolean {
  const stage = String(ui.stage ?? "").trim();
  const status = String(ui.status ?? "").trim();
  if (stage === "Complete" || status === "Complete") return false;
  return true;
}

export async function syncCultivationSectionCalendarFromTemplates(input: {
  companyId: string;
  actorUserId: string;
}): Promise<{ upserted: number; deletedOrphans: number }> {
  const { companyId, actorUserId } = input;
  const configService = new ConfigService();
  const storeService = new StoreService();

  const configRows = await configService.list(companyId);
  const merged: Record<string, unknown> = {};
  for (const r of configRows as { key: string; value: unknown }[]) {
    merged[r.key] = r.value;
  }

  const cultivation = merged.cultivation && typeof merged.cultivation === "object" ? (merged.cultivation as Record<string, unknown>) : {};
  const rawTemplates = cultivation.scheduleTemplates;
  const templates: ReturnType<typeof normalizeTemplateRow>[] = [];
  if (Array.isArray(rawTemplates)) {
    for (const t of rawTemplates) {
      const n = normalizeTemplateRow(t);
      if (n) templates.push(n);
    }
  }
  const templateIdSet = new Set(templates.map((t) => t.id));

  const tz = loadDisplayTimezone(merged);
  const snap = await storeService.load(companyId);
  const logs = Array.isArray(snap.logs) ? snap.logs : [];

  const batches = await prisma.cultivationBatch.findMany({
    where: { companyId },
    select: { id: true, cultivationUiState: true },
  });

  const batchIdSet = new Set(batches.map((b) => b.id));
  let upserted = 0;

  /** One query: avoid per-cell findFirst (was 2 round-trips × batches × templates). */
  const existingRows = await prisma.sectionCalendarEvent.findMany({
    where: {
      companyId,
      section: "cultivation",
      templateDedupeKey: { startsWith: "cult:tpl:" },
    },
    select: { templateDedupeKey: true, templateManaged: true },
  });
  const existingByDedupe = new Map<string, { templateManaged: boolean }>();
  for (const r of existingRows) {
    const k = r.templateDedupeKey;
    if (!k) continue;
    existingByDedupe.set(k, { templateManaged: r.templateManaged });
  }

  type SyncCell = {
    dedupe: string;
    batchId: string;
    dateYmd: string;
    title: string;
    notes: string | null;
    /** Operator turned off template sync for this row — do not upsert. */
    skip: boolean;
  };
  const cells: SyncCell[] = [];

  for (const row of batches) {
    const ui = asUiRecord(row.cultivationUiState);
    if (!batchEligible(ui)) continue;
    const anchors = resolveStageAnchorsYmd(row.id, ui.cloneDate, logs);
    for (const tpl of templates) {
      const anchor = anchorForStage(tpl.stage, anchors);
      if (!anchor) continue;
      const dateYmd = addDaysYmdApi(anchor, tpl.daysFromStageStart, tz);
      const dedupe = templateDedupeKey(tpl.id, row.id);
      const notes = tpl.defaultNotes ?? null;
      const existing = existingByDedupe.get(dedupe);
      const skip = existing != null && !existing.templateManaged;
      cells.push({
        dedupe,
        batchId: row.id,
        dateYmd,
        title: tpl.title.slice(0, 500),
        notes,
        skip,
      });
    }
  }

  /** Parallel upserts (distinct dedupe keys) — keep modest vs. Prisma/Neon pool defaults. */
  const CONCURRENCY = 8;
  let cellIndex = 0;
  const runOneCell = async (): Promise<void> => {
    for (;;) {
      const i = cellIndex++;
      if (i >= cells.length) return;
      const cell = cells[i]!;
      if (cell.skip) continue;
      await prisma.sectionCalendarEvent.upsert({
        where: {
          companyId_section_templateDedupeKey: {
            companyId,
            section: "cultivation",
            templateDedupeKey: cell.dedupe,
          },
        },
        create: {
          companyId,
          section: "cultivation",
          dateYmd: cell.dateYmd,
          title: cell.title,
          notes: cell.notes,
          batchRef: cell.batchId,
          createdByUserId: actorUserId,
          templateDedupeKey: cell.dedupe,
          templateManaged: true,
        },
        update: {
          dateYmd: cell.dateYmd,
          title: cell.title,
          notes: cell.notes,
          batchRef: cell.batchId,
          templateManaged: true,
        },
      });
      upserted++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, cells.length)) }, () => runOneCell()));

  let deletedOrphans = 0;
  const managed = await prisma.sectionCalendarEvent.findMany({
    where: {
      companyId,
      section: "cultivation",
      templateManaged: true,
      templateDedupeKey: { startsWith: "cult:tpl:" },
    },
    select: { id: true, templateDedupeKey: true },
  });

  for (const ev of managed) {
    const key = ev.templateDedupeKey;
    if (!key) continue;
    const parsed = parseDedupeKey(key);
    if (!parsed) continue;
    if (!templateIdSet.has(parsed.templateId) || !batchIdSet.has(parsed.batchId)) {
      await prisma.sectionCalendarEvent.delete({ where: { id: ev.id } });
      deletedOrphans++;
    }
  }

  const ineligibleBatchIds = new Set<string>();
  for (const row of batches) {
    const ui = asUiRecord(row.cultivationUiState);
    if (!batchEligible(ui)) ineligibleBatchIds.add(row.id);
  }

  const managed2 = await prisma.sectionCalendarEvent.findMany({
    where: {
      companyId,
      section: "cultivation",
      templateManaged: true,
      templateDedupeKey: { startsWith: "cult:tpl:" },
    },
    select: { id: true, templateDedupeKey: true },
  });
  for (const ev of managed2) {
    const parsed = parseDedupeKey(String(ev.templateDedupeKey || ""));
    if (!parsed) continue;
    if (ineligibleBatchIds.has(parsed.batchId)) {
      await prisma.sectionCalendarEvent.delete({ where: { id: ev.id } });
      deletedOrphans++;
    }
  }

  return { upserted, deletedOrphans };
}
