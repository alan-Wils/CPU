import { z } from "zod";

/** Stored on `CompanyMembership.cashLogEodPrefs` (JSON). */
export const cashLogEodPrefsSchema = z.object({
  enabled: z.boolean(),
  /** 0 = Sunday … 6 = Saturday (same as `Date.getDay()` in JavaScript). */
  weekdays: z.array(z.number().int().min(0).max(6)).min(1),
  /** 24h clock in `timezone`, e.g. `17:00` (HTML `type="time"` may send seconds). */
  sendTime: z.preprocess((v) => {
    if (typeof v !== "string") return "17:00";
    const t = v.trim();
    const m = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(t);
    if (!m) return "17:00";
    return `${m[1]}:${m[2]}`;
  }, z.string().regex(/^\d{2}:\d{2}$/)),
  /** Rolling window of entries to include (by `createdAt`). */
  window: z.enum(["LAST_24H", "LAST_7_DAYS"]),
  /** IANA zone, e.g. `America/Los_Angeles`. */
  timezone: z.string().min(1).max(80),
});

export type CashLogEodPrefs = z.infer<typeof cashLogEodPrefsSchema>;

export const defaultCashLogEodPrefs: CashLogEodPrefs = {
  enabled: false,
  weekdays: [1, 2, 3, 4, 5],
  sendTime: "17:00",
  window: "LAST_24H",
  timezone: "America/New_York",
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
  if (typeof p.sendTime === "string" && /^\d{2}:\d{2}$/.test(p.sendTime)) base.sendTime = p.sendTime;
  if (p.window === "LAST_24H" || p.window === "LAST_7_DAYS") base.window = p.window;
  if (typeof p.timezone === "string" && p.timezone.trim()) base.timezone = p.timezone.trim().slice(0, 80);
  const validated = cashLogEodPrefsSchema.safeParse(base);
  return validated.success ? validated.data : defaultCashLogEodPrefs;
}
