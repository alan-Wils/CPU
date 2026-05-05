import { z } from "zod";

/** Stored on `CompanyMembership.cashLogEodPrefs` (JSON). Product default wall-clock context. */
export const CASH_LOG_EOD_DEFAULT_TIMEZONE = "America/Denver";
export const CASH_LOG_EOD_DEFAULT_SEND_TIME = "11:16";

/** Reject invalid identifiers (e.g. `Not/AZone`) so persisted prefs always resolve in `Intl`. */
export function isValidIanaTimeZone(tz: string): boolean {
  const t = tz.trim();
  if (!t) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: t });
    return true;
  } catch {
    return false;
  }
}

export const ianaTimeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine(isValidIanaTimeZone, { message: "Invalid IANA timezone" });

/** Stored on `CompanyMembership.cashLogEodPrefs` (JSON). */
export const cashLogEodPrefsSchema = z.object({
  enabled: z.boolean(),
  /** 0 = Sunday … 6 = Saturday (same as `Date.getDay()` in JavaScript). */
  weekdays: z.array(z.number().int().min(0).max(6)).min(1),
  /** 24h clock in `timezone` (HTML `type="time"` may send seconds). */
  sendTime: z.preprocess((v) => {
    if (typeof v !== "string") return CASH_LOG_EOD_DEFAULT_SEND_TIME;
    const t = v.trim();
    const m = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(t);
    if (!m) return CASH_LOG_EOD_DEFAULT_SEND_TIME;
    return `${m[1]}:${m[2]}`;
  }, z.string().regex(/^\d{2}:\d{2}$/, "Send time must be HH:MM")),
  /** Rolling window of entries to include (by `createdAt`). */
  window: z.enum(["LAST_24H", "LAST_7_DAYS"]),
  /** IANA zone interpreted for local send window and markers. */
  timezone: ianaTimeZoneSchema,
});

export type CashLogEodPrefs = z.infer<typeof cashLogEodPrefsSchema>;

export const defaultCashLogEodPrefs: CashLogEodPrefs = {
  enabled: false,
  weekdays: [1, 2, 3, 4, 5],
  sendTime: CASH_LOG_EOD_DEFAULT_SEND_TIME,
  window: "LAST_24H",
  timezone: CASH_LOG_EOD_DEFAULT_TIMEZONE,
};

export function parseCashLogEodPrefs(raw: unknown): CashLogEodPrefs | null {
  const r = cashLogEodPrefsSchema.safeParse(raw);
  return r.success ? r.data : null;
}

export function mergeCashLogEodPrefs(partial: unknown): CashLogEodPrefs {
  const base = { ...defaultCashLogEodPrefs };
  if (!partial || typeof partial !== "object") return base;
  const p = partial as Record<string, unknown>;
  if (typeof p.enabled === "boolean") base.enabled = p.enabled;
  if (Array.isArray(p.weekdays)) {
    const w = p.weekdays.filter((x) => typeof x === "number" && x >= 0 && x <= 6) as number[];
    if (w.length) base.weekdays = w;
  }
  if (typeof p.sendTime === "string") {
    const t = p.sendTime.trim();
    const m = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(t);
    if (m) base.sendTime = `${m[1]}:${m[2]}`;
  }
  if (p.window === "LAST_24H" || p.window === "LAST_7_DAYS") base.window = p.window;
  if (typeof p.timezone === "string" && p.timezone.trim())
    base.timezone = p.timezone.trim().slice(0, 80);

  if (!isValidIanaTimeZone(base.timezone)) {
    base.timezone = CASH_LOG_EOD_DEFAULT_TIMEZONE;
  }

  const validated = cashLogEodPrefsSchema.safeParse(base);
  return validated.success ? validated.data : defaultCashLogEodPrefs;
}
