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
