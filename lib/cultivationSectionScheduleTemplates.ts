import { formatYmdInTimezone, utcIsoNoonOnYmdInTimezone } from "@/lib/companyTimezone";
import { isAnyMoveToVegTask, TASK_MOVE_TO_FLOWER } from "@/lib/cultivationMetrcWorkflow";

const ISO_YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type CultivationScheduleTemplateStage = "clone" | "veg" | "flower";

export type CultivationScheduleTemplateRow = {
  id: string;
  stage: CultivationScheduleTemplateStage;
  title: string;
  daysFromStageStart: number;
  defaultNotes?: string;
};

export function normalizeCultivationScheduleTemplateRow(raw: unknown): CultivationScheduleTemplateRow | null {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  let id = String(o.id ?? "").trim();
  if (!id) id = `cult-stpl-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const title = String(o.title ?? "").trim();
  if (!title) return null;
  const st = String(o.stage ?? "clone").toLowerCase();
  const stage: CultivationScheduleTemplateStage =
    st === "veg" ? "veg" : st === "flower" ? "flower" : "clone";
  const d = Number(o.daysFromStageStart);
  const daysFromStageStart = Number.isFinite(d) ? Math.trunc(d) : 0;
  const dn = o.defaultNotes != null ? String(o.defaultNotes).trim() : "";
  return {
    id,
    stage,
    title,
    daysFromStageStart,
    ...(dn ? { defaultNotes: dn.slice(0, 2000) } : {}),
  };
}

export function normalizeCultivationScheduleTemplateList(raw: unknown): CultivationScheduleTemplateRow[] {
  if (!Array.isArray(raw)) return [];
  const out: CultivationScheduleTemplateRow[] = [];
  for (const item of raw) {
    const n = normalizeCultivationScheduleTemplateRow(item);
    if (n) out.push(n);
  }
  return out;
}

export function cultivationTemplateDedupeKey(templateId: string, batchId: string): string {
  return `cult:tpl:${String(templateId).trim()}:batch:${String(batchId).trim()}`;
}

export function parseCultivationTemplateDedupeKey(
  key: string | null | undefined,
): { templateId: string; batchId: string } | null {
  const k = String(key || "").trim();
  const prefix = "cult:tpl:";
  const mid = ":batch:";
  if (!k.startsWith(prefix) || !k.includes(mid)) return null;
  const rest = k.slice(prefix.length);
  const i = rest.indexOf(mid);
  if (i < 0) return null;
  const templateId = rest.slice(0, i).trim();
  const batchId = rest.slice(i + mid.length).trim();
  if (!templateId || !batchId) return null;
  return { templateId, batchId };
}

function normalizeStageMoveYmd(raw: unknown): string | null {
  const s = String(raw ?? "").trim().slice(0, 10);
  return ISO_YMD_RE.test(s) ? s : null;
}

export type CultivationStageAnchorsYmd = {
  clone?: string;
  veg?: string;
  flower?: string;
};

/**
 * Resolve clone / veg / flower anchor calendar dates for schedule templates.
 * Veg and flower anchors come from company store task logs (`data.stageMoveDate`).
 */
export function resolveStageAnchorsYmd(
  batchId: string,
  cloneDateRaw: unknown,
  logs: readonly unknown[],
): CultivationStageAnchorsYmd {
  const bid = String(batchId || "").trim();
  const out: CultivationStageAnchorsYmd = {};
  const cd = normalizeStageMoveYmd(cloneDateRaw);
  if (cd) out.clone = cd;

  const vegDates: string[] = [];
  const flowerDates: string[] = [];

  for (const entry of logs || []) {
    const log = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
    if (!log) continue;
    const b = String(log.batch ?? "").trim();
    if (b !== bid) continue;
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

export function anchorYmdForTemplateStage(
  stage: CultivationScheduleTemplateStage,
  anchors: CultivationStageAnchorsYmd,
): string | null {
  if (stage === "clone") return anchors.clone ?? null;
  if (stage === "veg") return anchors.veg ?? null;
  return anchors.flower ?? null;
}

/** Add whole days to a calendar YMD in a specific IANA timezone (uses noon anchor + 24h steps). */
export function addDaysYmd(anchorYmd: string, days: number, timeZone: string): string {
  const trimmed = String(anchorYmd || "").trim();
  const anchorMs = Date.parse(utcIsoNoonOnYmdInTimezone(trimmed, timeZone));
  if (!Number.isFinite(anchorMs)) return trimmed;
  const out = new Date(anchorMs + Math.trunc(days) * 86400000);
  return formatYmdInTimezone(out, timeZone);
}
