/** Company-configured meal / break windows for facility-day labor math (wall clock HH:mm, same calendar day). */

export type LaborBreakWindow = {
  id: string;
  label: string;
  /** 24h `HH:mm` */
  start: string;
  end: string;
};

const HM_RE = /^(\d{1,2}):(\d{2})$/;

export function hmToMinutes(hm: string): number | null {
  const m = String(hm || "")
    .trim()
    .match(HM_RE);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function padHm(hm: string): string {
  const n = hmToMinutes(hm);
  if (n == null) return hm.trim();
  const h = Math.floor(n / 60);
  const mm = n % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function mergeSameDayBreaksNums(segs: { a: number; b: number }[]): { a: number; b: number }[] {
  const sorted = [...segs].sort((x, y) => x.a - y.a);
  const merged: { a: number; b: number }[] = [];
  for (const seg of sorted) {
    const last = merged[merged.length - 1];
    if (!last || seg.a > last.b) merged.push({ a: seg.a, b: seg.b });
    else last.b = Math.max(last.b, seg.b);
  }
  return merged;
}

export function normalizeLaborBreaksFromConfig(raw: unknown): LaborBreakWindow[] {
  if (!Array.isArray(raw)) return [];
  const out: LaborBreakWindow[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const id = String(o.id ?? "").trim() || `break-${out.length}`;
    const label = String(o.label ?? "Break").trim() || "Break";
    const start = String(o.start ?? "").trim();
    const end = String(o.end ?? "").trim();
    const sm = hmToMinutes(start);
    const em = hmToMinutes(end);
    if (sm == null || em == null) continue;
    if (em <= sm) continue;
    out.push({ id, label, start: padHm(start), end: padHm(end) });
  }
  return out;
}

function minutesToHm(total: number): string {
  const m = ((total % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function breakSegmentsFromWindows(windows: LaborBreakWindow[]): { a: number; b: number }[] {
  const segs: { a: number; b: number }[] = [];
  for (const w of windows) {
    const s = hmToMinutes(w.start);
    const e = hmToMinutes(w.end);
    if (s == null || e == null) continue;
    if (e <= s) continue;
    segs.push({ a: s, b: e });
  }
  return mergeSameDayBreaksNums(segs);
}

/**
 * Task span on timeline: `laborDate` midnight = 0. If endHm <= startHm (same day clock), task ends next calendar day.
 */
export function computeLaborRangeDeduction(params: {
  startHm: string;
  endHm: string;
  breaks: LaborBreakWindow[];
}): { grossMinutes: number; breakDeductionMinutes: number; netMinutes: number } {
  const s0 = hmToMinutes(params.startHm);
  const s1 = hmToMinutes(params.endHm);
  if (s0 == null || s1 == null) {
    return { grossMinutes: 0, breakDeductionMinutes: 0, netMinutes: 0 };
  }

  let t0 = s0;
  let t1 = s1;
  if (t1 <= t0) t1 += 1440;

  const gross = t1 - t0;
  const breakSegs = breakSegmentsFromWindows(params.breaks);

  let ded = 0;
  for (let day = 0; day * 1440 < t1; day++) {
    const dayStart = day * 1440;
    const dayEnd = dayStart + 1440;
    const segT0 = Math.max(t0, dayStart);
    const segT1 = Math.min(t1, dayEnd);
    if (segT1 <= segT0) continue;
    for (const br of breakSegs) {
      const b0 = dayStart + br.a;
      const b1 = dayStart + br.b;
      ded += Math.max(0, Math.min(segT1, b1) - Math.max(segT0, b0));
    }
  }

  const net = Math.max(0, gross - ded);
  return { grossMinutes: gross, breakDeductionMinutes: ded, netMinutes: net };
}

export function formatLaborHmForDisplay(hm: string): string {
  return padHm(hm);
}
