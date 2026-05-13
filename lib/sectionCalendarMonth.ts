/**
 * Month boundaries for section calendar (YYYY-MM-DD, calendar-day semantics in UTC for range edges).
 * Must stay aligned with `apps/api/src/modules/sectionCalendar/sectionCalendarAccess.ts` `monthYmdBounds`.
 */
export function monthYmdBounds(monthYyyyMm: string): { fromYmd: string; toYmd: string } {
  const m = String(monthYyyyMm || "").trim();
  const match = /^(\d{4})-(\d{2})$/.exec(m);
  if (!match) throw new Error("Invalid month");
  const y = Number(match[1]);
  const mo = Number(match[2]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) throw new Error("Invalid month");
  const fromYmd = `${match[1]}-${match[2]}-01`;
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const toYmd = `${match[1]}-${match[2]}-${String(last).padStart(2, "0")}`;
  return { fromYmd, toYmd };
}

/** First of month as local Date (midnight local) — for grid display only. */
export function startOfMonthDate(yyyyMm: string): Date {
  const [y, mo] = yyyyMm.split("-").map((x) => Number(x));
  return new Date(y, mo - 1, 1);
}

/** YYYY-MM for `d` in local timezone. */
export function ymdInLocalTimezone(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Add `delta` months to YYYY-MM string, return YYYY-MM. */
export function shiftMonthYyyyMm(yyyyMm: string, delta: number): string {
  const d = startOfMonthDate(yyyyMm);
  d.setMonth(d.getMonth() + delta);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
