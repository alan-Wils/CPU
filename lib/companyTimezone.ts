/**
 * Company display timezone (IANA) cached from GET /api/config `company.settings.displayTimezone`.
 * Used to format all log/batch timestamps consistently for the facility.
 */

const STORAGE_KEY = "cpu_company_display_timezone";

export function getCompanyDisplayTimezone(): string {
  if (typeof window === "undefined") return "UTC";
  const cached = window.localStorage.getItem(STORAGE_KEY)?.trim();
  if (cached) return cached;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

export function setCompanyDisplayTimezone(tz: string | undefined | null) {
  if (typeof window === "undefined") return;
  const t = String(tz ?? "").trim();
  if (!t) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, t);
}

/** Call after loading merged config from `/api/config`. */
export function syncCompanyTimezoneFromConfigPayload(data: unknown) {
  if (!data || typeof data !== "object") return;
  const company = (data as { company?: { settings?: { displayTimezone?: string } } }).company;
  const tz = company?.settings?.displayTimezone?.trim();
  setCompanyDisplayTimezone(tz || "");
}

/** Canonical instant for log/batch JSON (UTC ISO string). */
export function nowIsoForLog(): string {
  return new Date().toISOString();
}

const ISO_YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Calendar YYYY-MM-DD for an instant when interpreted in a specific IANA zone. */
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

/** Today’s date (YYYY-MM-DD) in company display timezone — used for stage-move confirmations. */
export function getTodayYmdInCompanyTimezone(now: Date = new Date()): string {
  return formatYmdInTimezone(now, getCompanyDisplayTimezone());
}

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

/** Find a UTC instant that falls on the given calendar date in `timeZone` (for anchoring timestamps). */
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

/**
 * Canonical UTC ISO for noon (12:00) on calendar `ymd` in `timeZone`, for stage-move audit rows.
 */
export function utcIsoNoonOnYmdInTimezone(ymd: string, timeZone: string): string {
  const p = parseIsoYmd(ymd);
  if (!p) return nowIsoForLog();

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

/** Log `time` for a manually chosen cultivation stage move date (company TZ noon). */
export function logTimeIsoForStageMoveDate(ymd: string): string {
  return utcIsoNoonOnYmdInTimezone(ymd.trim(), getCompanyDisplayTimezone());
}

export function formatInCompanyTimezone(input: string | number | Date): string {
  const d =
    typeof input === "string" || typeof input === "number"
      ? new Date(input)
      : input;
  if (Number.isNaN(d.getTime())) return String(input);
  const tz = getCompanyDisplayTimezone();
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      dateStyle: "short",
      timeStyle: "medium",
    }).format(d);
  } catch {
    return d.toLocaleString();
  }
}

/**
 * Format a task/log row for UI: prefers ISO fields from API; falls back to legacy locale strings.
 */
export function formatLogDisplayTime(log: {
  time?: unknown;
  loggedAt?: unknown;
  loggedAtIso?: unknown;
  data?: { loggedAtIso?: unknown; loggedAt?: unknown };
}): string {
  const isoRaw =
    log?.loggedAtIso ??
    log?.data?.loggedAtIso ??
    (typeof log?.time === "string" && /^\d{4}-\d{2}-\d{2}T/.test(log.time) ? log.time : null);
  if (typeof isoRaw === "string" && isoRaw.length >= 10) {
    const d = new Date(isoRaw);
    if (!Number.isNaN(d.getTime())) return formatInCompanyTimezone(d);
  }
  const raw = log?.time ?? log?.loggedAt ?? log?.data?.loggedAt;
  if (raw == null || raw === "") return "—";
  const parsed = Date.parse(String(raw));
  if (!Number.isNaN(parsed)) return formatInCompanyTimezone(parsed);
  return String(raw);
}

/** Format any stored instant (ISO string or Date) for lists/cards. */
export function formatCompanyTimestamp(value: unknown): string {
  if (value == null || value === "") return "—";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return formatInCompanyTimezone(d);
}
