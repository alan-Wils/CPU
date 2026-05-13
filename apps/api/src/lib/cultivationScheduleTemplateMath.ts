/**
 * Calendar YMD math for cultivation schedule template sync (API-only; mirrors `lib/companyTimezone.ts`).
 */

const ISO_YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIsoYmd(ymd: string): { y: number; mo: number; d: number } | null {
  const m = String(ymd || "").trim().match(ISO_YMD_RE);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, mo, d };
}

function findUtcMidpointOnCalendarDay(ymd: string, timeZone: string): number {
  const p = parseIsoYmd(ymd);
  if (!p) return Date.now();
  const wanted = `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
  let lo = Date.UTC(p.y, p.mo - 1, p.d - 1, 22, 0, 0, 0);
  let hi = Date.UTC(p.y, p.mo - 1, p.d + 1, 10, 0, 0, 0);

  while (hi - lo > 60_000) {
    const mid = Math.floor((lo + hi) / 2);
    const cal = formatYmdInTimezone(new Date(mid), timeZone);
    if (cal < wanted) lo = mid;
    else hi = mid;
  }
  return hi;
}

export function formatYmdInTimezone(d: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);
    const y = parts.find((p) => p.type === "year")?.value;
    const mo = parts.find((p) => p.type === "month")?.value;
    const dd = parts.find((p) => p.type === "day")?.value;
    if (y && mo && dd) return `${y}-${mo}-${dd}`;
  } catch {
    /* fall through */
  }
  return d.toISOString().slice(0, 10);
}

export function utcIsoNoonOnYmdInTimezone(ymd: string, timeZone: string): string {
  const p = parseIsoYmd(ymd);
  if (!p) return new Date().toISOString();

  let t = findUtcMidpointOnCalendarDay(ymd.trim(), timeZone);

  for (let i = 0; i < 120; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(t));
    const gh = Number(parts.find((x) => x.type === "hour")?.value);
    const gmi = Number(parts.find((x) => x.type === "minute")?.value);
    if (Number.isFinite(gh) && Number.isFinite(gmi) && gh === 12 && gmi === 0) {
      return new Date(t).toISOString();
    }
    const targetMin = 12 * 60;
    const curMin = gh * 60 + gmi;
    const diff = targetMin - curMin;
    t += diff * 60_000;
  }

  return new Date(t).toISOString();
}

export function addDaysYmdApi(anchorYmd: string, days: number, timeZone: string): string {
  const trimmed = String(anchorYmd || "").trim();
  const anchorMs = Date.parse(utcIsoNoonOnYmdInTimezone(trimmed, timeZone));
  if (!Number.isFinite(anchorMs)) return trimmed;
  const out = new Date(anchorMs + Math.trunc(days) * 86400000);
  return formatYmdInTimezone(out, timeZone);
}
