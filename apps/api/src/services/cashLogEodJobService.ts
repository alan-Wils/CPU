import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { resolvePublicWebBaseUrl } from "../config/publicWebUrl.js";
import { parseCashLogEodPrefs, type CashLogEodPrefs } from "../lib/cashLogEodPrefs.js";
import { CashLogService } from "./cashLogService.js";
import { CheckCaptureService } from "./checkCaptureService.js";
import { findRecentLeafLinkStoredOrdersForCompany } from "./leafLinkOrdersStorePrimitives.js";
import { summarizeLeafLinkInvoiceFromStoredRows } from "./leafLinkOrdersService.js";
import {
  formatPostedLeafLinkOrderNumbers,
  mergePostedPaymentsFromCheckCapture,
} from "../lib/leaflinkPostedPayments.js";
import { sendHtmlEmail } from "../lib/mailer.js";
import { logInfo, logWarn } from "../lib/logger.js";
import { recordUsageEventSafe } from "./usageEventRecord.js";

const cashService = new CashLogService();
const checkService = new CheckCaptureService();

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function zonedCalendarParts(isoUtc: Date, timeZone: string): {
  weekday: number;
  hour: number;
  minute: number;
  dateKey: string;
} {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = dtf.formatToParts(isoUtc);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  const wd = get("weekday");
  const weekday = WEEKDAY_MAP[wd] ?? 0;
  const dateKey = `${get("year")}-${get("month")}-${get("day")}`;
  return { weekday, hour, minute, dateKey };
}

function parseSendMinutes(sendTime: string): number {
  const [h, m] = sendTime.split(":").map((x) => Number(x));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

/**
 * True if local wall time is within the slack window starting at the configured send time (inclusive end minute).
 * Inclusive upper bound so a poll on the same clock minute as `sendTime + slack` still qualifies (matches typical 5-minute schedulers).
 */
export function isWithinSendWindow(
  nowUtc: Date,
  prefs: CashLogEodPrefs,
  slackMinutes: number,
): boolean {
  const { hour, minute } = zonedCalendarParts(nowUtc, prefs.timezone);
  const current = hour * 60 + minute;
  const target = parseSendMinutes(prefs.sendTime);
  return current >= target && current <= target + slackMinutes;
}

/** True when local clock is at or after `prefs.sendTime` (same calendar day in that TZ implied by callers). Used for sporadic cron so a tick after send time still delivers. */
export function isAtOrPastConfiguredLocalSendTime(
  nowUtc: Date,
  prefs: CashLogEodPrefs,
): boolean {
  const { hour, minute } = zonedCalendarParts(nowUtc, prefs.timezone);
  const current = hour * 60 + minute;
  const target = parseSendMinutes(prefs.sendTime);
  return current >= target;
}

export type CashLogEodTrigger = "internal_scheduler" | "cron";

/** How local “in-window” eligibility is computed (`decideMembershipCashLogDigest`). */
export type CashLogEodSendWindowMode = "strict_slack" | "eod_local_day";

/**
 * Defaults **both** in-process ticks and cron to **`strict_slack`**: mail only in `[sendTime … sendTime + slack]` (inclusive minutes),
 * and at most one successful send per local day per schedule revision (see `decideMembershipCashLogDigest`).
 * Set `CASH_LOG_EOD_SEND_WINDOW_MODE=eod_local_day` (alias `eod`) for the legacy “any time from send time through end of local day” behavior with no same-day cap.
 */
export function resolveCashLogEodSendWindowMode(
  _trigger: CashLogEodTrigger,
): CashLogEodSendWindowMode {
  const raw = process.env.CASH_LOG_EOD_SEND_WINDOW_MODE?.trim().toLowerCase();
  if (raw === "eod" || raw === "eod_local_day") return "eod_local_day";
  if (raw === "strict" || raw === "strict_slack") return "strict_slack";
  return "strict_slack";
}

function zonedDateKeyForInstant(isoUtc: Date, timeZone: string): string {
  return zonedCalendarParts(isoUtc, timeZone).dateKey;
}

/**
 * Success marker `cashLogEodLastSentAt` is ONLY written after outbound mail ACK.
 * Uses the member's timezone calendar day — same rule as eligibility.
 */
export function digestAlreadySentToday(
  lastSentAt: Date | null,
  nowUtc: Date,
  timezone: string,
): boolean {
  if (!lastSentAt) return false;
  const todayKey = zonedCalendarParts(nowUtc, timezone).dateKey;
  const lastKey = zonedDateKeyForInstant(lastSentAt, timezone);
  return lastKey === todayKey;
}

/**
 * In **strict_slack** mode: suppress another send the same local day only when the last successful send was already
 * tied to the **current** `cashLogEodScheduleGeneration`.
 *
 * Saving digest settings (send time, weekdays, window, etc.) increments schedule generation and sets
 * `digestSentScheduleGeneration` to **null**, so the cap resets and one more in-window send is allowed the same day.
 */
export function duplicateDigestSuppressesSameSchedule(input: {
  lastSentAt: Date | null;
  nowUtc: Date;
  timezone: string;
  scheduleGeneration: number;
  digestSentScheduleGeneration: number | null | undefined;
}): boolean {
  if (!input.lastSentAt) return false;
  if (!digestAlreadySentToday(input.lastSentAt, input.nowUtc, input.timezone)) return false;
  const sentGen = input.digestSentScheduleGeneration;
  if (sentGen === null || sentGen === undefined) return false;
  return sentGen === input.scheduleGeneration;
}

/** Local `YYYY-MM-DD` for `cashLogEodLastSentAt` in `timezone`, or null. */
export function successMarkerLocalDateKey(
  lastSentAt: Date | null | undefined,
  timezone: string | null | undefined,
): string | null {
  if (!lastSentAt || !timezone?.trim()) return null;
  return zonedDateKeyForInstant(lastSentAt, timezone);
}

function digestMembershipEvalHint(row: CashLogEodMembershipDiag): string | undefined {
  if (row.outcome === "error") {
    return "Outbound mail threw — marker not updated on this membership; retries can occur on a later tick when eligible.";
  }
  if (row.outcome === "sent") {
    return "Digest mailed successfully; marker timestamp persisted.";
  }
  if (row.outcome !== "skipped") return undefined;
  switch (row.skipReason) {
    case "outside_send_window":
      if (row.alreadySentToday) {
        return row.sendWindowMode === "strict_slack"
          ? "Skipped because local clock is still before today's configured send time (compare localTime vs windowStart). alreadySentToday is informational. In strict mode, after one successful send today for this schedule, further in-window ticks use skipReason already_sent_today."
          : "Skipped because local clock is still before today's configured send time (compare localTime vs windowStart). alreadySentToday is informational; eod_local_day allows more sends later the same day.";
      }
      if (row.sendWindowMode === "strict_slack") {
        return "Strict mode: local time is outside the inclusive send window (windowStart through windowEnd). Next poll inside that slice may send once per day per schedule revision.";
      }
      return "Before configured local send time — no mail on this tick. eod_local_day: after send time, every eligible tick can send again the same day (no cap).";
    case "already_sent_today":
      return "Strict mode: today's digest already went out for this schedule revision. Change the send time or other schedule fields and click Save schedule—that clears the duplicate marker and allows one more send in the new window today.";
    case "digest_disabled":
      return "Digest disabled for this membership.";
    case "no_recipient":
      return "Inactive user or missing email.";
    case "prefs_invalid":
      return "cashLogEodPrefs JSON did not validate.";
    case "wrong_weekday":
      return "Today is excluded by digest weekday schedule.";
    default:
      return undefined;
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local wall clock + send-window labels for logging when prefs are valid. */
export function computeLocalSendWindowSummary(
  nowUtc: Date,
  prefs: CashLogEodPrefs,
  slackMinutes: number,
  sendWindowMode: CashLogEodSendWindowMode = "strict_slack",
): {
  timezone: string;
  sendTimeConfigured: string;
  localDate: string;
  currentLocalTime: string;
  windowStartLocal: string;
  windowEndLocal: string;
  sendWindowMode: CashLogEodSendWindowMode;
} {
  const parts = zonedCalendarParts(nowUtc, prefs.timezone);
  const currentLocalTime = `${pad2(parts.hour)}:${pad2(parts.minute)}`;
  const startM = parseSendMinutes(prefs.sendTime);
  const hs = Math.floor(startM / 60) % 24;
  const ms = startM % 60;
  const windowStartLocal = `${pad2(hs)}:${pad2(ms)}`;
  let windowEndLocal: string;
  if (sendWindowMode === "eod_local_day") {
    windowEndLocal = "23:59 (end of local day)";
  } else {
    const endM = startM + slackMinutes;
    const he = Math.floor(endM / 60);
    const me = endM % 60;
    const crossesMidnight = endM >= 24 * 60;
    windowEndLocal = crossesMidnight
      ? `${pad2(he % 24)}:${pad2(me)} (+1 local day, inclusive)`
      : `${pad2(he % 24)}:${pad2(me)} (inclusive)`;
  }
  return {
    timezone: prefs.timezone,
    sendTimeConfigured: prefs.sendTime,
    localDate: parts.dateKey,
    currentLocalTime,
    windowStartLocal,
    windowEndLocal,
    sendWindowMode,
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type CashDigestRow = Awaited<ReturnType<CashLogService["listByCreatedAtRange"]>>[number];

function cashDigestLeafLinkCell(
  r: CashDigestRow,
  storedScan: Awaited<ReturnType<typeof findRecentLeafLinkStoredOrdersForCompany>>,
): string {
  if (r.direction === "OUTGOING") return "—";
  const sync = String(r.leaflinkPaymentSyncStatus || "").trim();
  const syncErr = String(r.leaflinkPaymentSyncError || "").trim();
  if (sync === "payment_posted") {
    return "Payment posted to LeafLink";
  }
  if (sync === "matched") {
    return "Matched (open / unpaid in LeafLink from CPU view)";
  }
  if (sync === "failed") {
    return syncErr ? escapeHtml(syncErr.slice(0, 120)) : "LeafLink sync failed";
  }
  const s = summarizeLeafLinkInvoiceFromStoredRows(storedScan, {
    invoiceNumber: r.invoiceNumber,
    payerName: r.payeeCompany,
    amount: typeof r.amount === "number" ? r.amount : null,
  });
  if (!s.hasInvoiceTokens) return "—";
  if (s.matchedOrderNumber) {
    return escapeHtml(
      s.markedPaidInLeafLink
        ? `Paid in LeafLink (#${s.matchedOrderNumber})`
        : `Open in LeafLink (#${s.matchedOrderNumber}${s.paymentStatus ? `, ${s.paymentStatus}` : ""})`,
    );
  }
  return escapeHtml(s.summary || "No LeafLink match in saved cache");
}

function rowsToHtmlTable(
  rows: CashDigestRow[],
  storedScan: Awaited<ReturnType<typeof findRecentLeafLinkStoredOrdersForCompany>>,
): string {
  if (!rows.length) {
    return "<p>No cash log entries in this period.</p>";
  }
  const head =
    "<tr><th>Date (UTC)</th><th>Direction</th><th>Amount</th><th>Payee / Dept</th><th>Invoice #</th><th>Memo</th><th>LeafLink</th></tr>";
  const body = rows
    .map((r) => {
      const whenIso =
        r.entryDate != null ? r.entryDate.toISOString() : r.createdAt.toISOString();
      const extra =
        r.direction === "INCOMING"
          ? escapeHtml(String(r.payeeCompany || ""))
          : escapeHtml(String(r.department || ""));
      const leaf = cashDigestLeafLinkCell(r, storedScan);
      return `<tr><td>${escapeHtml(whenIso)}</td><td>${escapeHtml(r.direction)}</td><td>${escapeHtml(String(r.amount))}</td><td>${extra}</td><td>${escapeHtml(String(r.invoiceNumber || ""))}</td><td>${escapeHtml(String(r.memo || ""))}</td><td>${leaf}</td></tr>`;
    })
    .join("");
  return `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;">${head}${body}</table>`;
}

type CheckDigestRow = Awaited<ReturnType<CheckCaptureService["listByCreatedAtRange"]>>[number];

/** Stored URLs may be absolute (saved with origin) or root-relative (`/uploads/...`). */
function absolutePublicUrl(stored: string | null | undefined, publicWebBase: string): string {
  const u = String(stored || "").trim();
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  const base = publicWebBase.replace(/\/+$/, "");
  const path = u.startsWith("/") ? u : `/${u}`;
  return `${base}${path}`;
}

function checkImageLinksCell(r: CheckDigestRow, publicWebBase: string): string {
  const front = absolutePublicUrl(r.imageUrl, publicWebBase);
  const stub = absolutePublicUrl(r.stubImageUrl, publicWebBase);
  const parts: string[] = [];
  if (front) {
    parts.push(
      `<a href="${escapeHtml(front)}" target="_blank" rel="noopener noreferrer">check front</a>`,
    );
  }
  if (stub) {
    parts.push(
      `<a href="${escapeHtml(stub)}" target="_blank" rel="noopener noreferrer">stub</a>`,
    );
  }
  return parts.length ? parts.join(" · ") : "—";
}

function checkDigestLeafLinkCell(
  r: CheckDigestRow,
  storedScan: Awaited<ReturnType<typeof findRecentLeafLinkStoredOrdersForCompany>>,
): string {
  const payStatus = String(r.leaflinkPaymentStatus || "").toLowerCase();
  const ps = String(r.paymentSyncStatus || "").trim();
  const posted = mergePostedPaymentsFromCheckCapture(r);
  const ordersLabel = formatPostedLeafLinkOrderNumbers(posted, r.leaflinkOrderNumber);
  const paidAt = r.leaflinkPaidAt;
  if (paidAt || ps === "payment_posted" || payStatus === "paid" || posted.length > 0) {
    if (posted.length > 1) {
      return escapeHtml(`Paid in LeafLink (${posted.length}: ${ordersLabel})`);
    }
    return escapeHtml(ordersLabel ? `Paid in LeafLink (${ordersLabel})` : "Paid in LeafLink");
  }
  const s = summarizeLeafLinkInvoiceFromStoredRows(storedScan, {
    invoiceNumber: r.invoiceNumber,
    payerName: r.payerName,
    amount: typeof r.amount === "number" ? r.amount : null,
  });
  if (!s.hasInvoiceTokens) return "—";
  if (s.matchedOrderNumber) {
    return escapeHtml(
      s.markedPaidInLeafLink
        ? `Paid in LeafLink (#${s.matchedOrderNumber})`
        : `Open in LeafLink (#${s.matchedOrderNumber}${s.paymentStatus ? `, ${s.paymentStatus}` : ""})`,
    );
  }
  return escapeHtml(s.summary || "No LeafLink match in saved cache");
}

function checkRowsToHtmlTable(
  rows: CheckDigestRow[],
  publicWebBase: string,
  storedScan: Awaited<ReturnType<typeof findRecentLeafLinkStoredOrdersForCompany>>,
): string {
  if (!rows.length) {
    return "<p>No check captures in this period.</p>";
  }
  const head =
    "<tr><th>Logged (UTC)</th><th>Check date</th><th>Amount</th><th>Payee</th><th>Check #</th><th>Invoice #</th><th>Memo</th><th>LeafLink</th><th>Images</th></tr>";
  const body = rows
    .map((r) => {
      const logged = r.createdAt.toISOString();
      const checkDateIso = r.checkDate != null ? r.checkDate.toISOString() : "—";
      const imgs = checkImageLinksCell(r, publicWebBase);
      const leaf = checkDigestLeafLinkCell(r, storedScan);
      return `<tr><td>${escapeHtml(logged)}</td><td>${escapeHtml(checkDateIso)}</td><td>${escapeHtml(String(r.amount ?? ""))}</td><td>${escapeHtml(String(r.payerName || ""))}</td><td>${escapeHtml(String(r.checkNumber || ""))}</td><td>${escapeHtml(String(r.invoiceNumber || ""))}</td><td>${escapeHtml(String(r.memo || ""))}</td><td>${leaf}</td><td>${imgs}</td></tr>`;
    })
    .join("");
  return `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;">${head}${body}</table>`;
}

/** Soft skips (never persist `cashLogEodLastSentAt`). */
export type CashLogEodSkipReason =
  | "outside_send_window"
  | "already_sent_today"
  | "digest_disabled"
  | "no_recipient"
  | "prefs_invalid"
  | "wrong_weekday";

/** Aggregated counts keyed by reason (+ transport failures — not “skips”). */
export type CashLogEodDigestReasonKey = CashLogEodSkipReason | "email_send_failed";

export type CashLogEodMembershipDiag = {
  membershipId: string;
  companyId: string;
  companyName: string | null;
  timezone: string | null;
  /** Configured HH:MM in `timezone`; null when prefs did not parse. */
  sendTimeConfigured: string | null;
  /** Today's date in configured timezone (`YYYY-MM-DD`), when known. */
  localDate: string | null;
  currentLocalTime: string | null;
  windowStartLocal: string | null;
  windowEndLocal: string | null;
  /**
   * Local calendar date (`YYYY-MM-DD`) of successful digest marker (`cashLogEodLastSentAt`), when marker exists — **orthogonal** to this tick's `skipReason`
   * (e.g. `outside_send_window` describes this tick only; this field shows DB history).
   */
  lastSuccessDigestLocalDate: string | null;
  /** True iff marker's local calendar date equals `localDate` (prior state for skips; updated after successful send). */
  alreadySentToday: boolean;
  /** Rev bumped when digest prefs are saved; persisted alongside last successful send for auditing. */
  scheduleGeneration: number | null;
  digestSentScheduleGeneration: number | null;
  /** Legacy diagnostic; always **false** (same-day send cap removed). */
  suppressDuplicateSchedule: boolean;
  /** Eligibility mode (`strict_slack` default vs legacy `eod_local_day`). */
  sendWindowMode: CashLogEodSendWindowMode;
  /** Short operator-readable explanation (also in `[cash_log_eod] membership_eval` logs). */
  evalHint?: string;
  outcome: "sent" | "skipped" | "error";
  /** Single reason when skipped or mail failed (`email_send_failed`). */
  skipReason?: CashLogEodDigestReasonKey;
  error?: string;
};

export type CashLogEodJobResult = {
  trigger: CashLogEodTrigger;
  sendWindowMode: CashLogEodSendWindowMode;
  utcNow: string;
  slackMinutes: number;
  examined: number;
  sent: number;
  /** Soft skips only (eligible path exits without attempted send); excludes mail failures. */
  skipped: number;
  skipReasons: Record<CashLogEodDigestReasonKey, number>;
  errors: string[];
  memberships: CashLogEodMembershipDiag[];
};

const emptyReasonCounts = (): Record<CashLogEodDigestReasonKey, number> => ({
  outside_send_window: 0,
  already_sent_today: 0,
  digest_disabled: 0,
  no_recipient: 0,
  prefs_invalid: 0,
  wrong_weekday: 0,
  email_send_failed: 0,
});

function diagBase(m: {
  id: string;
  companyId: string;
  company: { name: string | null } | null;
}): Pick<
  CashLogEodMembershipDiag,
  "membershipId" | "companyId" | "companyName"
> {
  return {
    membershipId: m.id,
    companyId: m.companyId,
    companyName: m.company?.name ?? null,
  };
}

export type MembershipDigestDecisionResult = {
  decision: "skip" | "send";
  skipReason?: CashLogEodSkipReason;
  prefs: CashLogEodPrefs | null;
  win: ReturnType<typeof computeLocalSendWindowSummary> | null;
  alreadySentToday: boolean;
  suppressDuplicateSchedule: boolean;
  localDateKey: string | null;
  sendWindowMode: CashLogEodSendWindowMode;
};

/**
 * Eligibility: `strict_slack` (default) = narrow `[sendTime … sendTime+slack]` plus at most one successful send per local day
 * per schedule revision (`duplicateDigestSuppressesSameSchedule`). `eod_local_day` = legacy all-day window, no same-day cap.
 */
export function decideMembershipCashLogDigest(input: {
  nowUtc: Date;
  slackMinutes: number;
  sendWindowMode?: CashLogEodSendWindowMode;
  prefsRaw: unknown;
  cashLogEodLastSentAt: Date | null;
  cashLogEodScheduleGeneration: number;
  cashLogEodDigestSentScheduleGeneration: number | null;
  userActive: boolean;
  userEmail: string | null;
}): MembershipDigestDecisionResult {
  const sendWindowMode = input.sendWindowMode ?? "strict_slack";
  const prefs = parseCashLogEodPrefs(input.prefsRaw);
  if (!prefs) {
    return {
      decision: "skip",
      skipReason: "prefs_invalid",
      prefs: null,
      win: null,
      alreadySentToday: false,
      suppressDuplicateSchedule: false,
      localDateKey: null,
      sendWindowMode,
    };
  }
  const win = computeLocalSendWindowSummary(
    input.nowUtc,
    prefs,
    input.slackMinutes,
    sendWindowMode,
  );
  const { weekday, dateKey } = zonedCalendarParts(
    input.nowUtc,
    prefs.timezone,
  );
  const alreadySentToday = digestAlreadySentToday(
    input.cashLogEodLastSentAt,
    input.nowUtc,
    prefs.timezone,
  );

  if (!prefs.enabled) {
    return {
      decision: "skip",
      skipReason: "digest_disabled",
      prefs,
      win,
      alreadySentToday,
      suppressDuplicateSchedule: false,
      localDateKey: dateKey,
      sendWindowMode,
    };
  }
  if (!input.userActive || !input.userEmail) {
    return {
      decision: "skip",
      skipReason: "no_recipient",
      prefs,
      win,
      alreadySentToday,
      suppressDuplicateSchedule: false,
      localDateKey: dateKey,
      sendWindowMode,
    };
  }
  if (!prefs.weekdays.includes(weekday)) {
    return {
      decision: "skip",
      skipReason: "wrong_weekday",
      prefs,
      win,
      alreadySentToday,
      suppressDuplicateSchedule: false,
      localDateKey: dateKey,
      sendWindowMode,
    };
  }
  const inWindow =
    sendWindowMode === "eod_local_day"
      ? isAtOrPastConfiguredLocalSendTime(input.nowUtc, prefs)
      : isWithinSendWindow(input.nowUtc, prefs, input.slackMinutes);
  if (!inWindow) {
    return {
      decision: "skip",
      skipReason: "outside_send_window",
      prefs,
      win,
      alreadySentToday,
      suppressDuplicateSchedule: false,
      localDateKey: dateKey,
      sendWindowMode,
    };
  }

  const suppressDuplicateSchedule =
    sendWindowMode === "strict_slack" &&
    duplicateDigestSuppressesSameSchedule({
      lastSentAt: input.cashLogEodLastSentAt,
      nowUtc: input.nowUtc,
      timezone: prefs.timezone,
      scheduleGeneration: input.cashLogEodScheduleGeneration,
      digestSentScheduleGeneration: input.cashLogEodDigestSentScheduleGeneration,
    });

  if (suppressDuplicateSchedule) {
    return {
      decision: "skip",
      skipReason: "already_sent_today",
      prefs,
      win,
      alreadySentToday,
      suppressDuplicateSchedule: true,
      localDateKey: dateKey,
      sendWindowMode,
    };
  }

  return {
    decision: "send",
    prefs,
    win,
    alreadySentToday,
    suppressDuplicateSchedule: false,
    localDateKey: dateKey,
    sendWindowMode,
  };
}

function finalizeMembershipDiag(
  partial: Omit<CashLogEodMembershipDiag, "evalHint">,
): CashLogEodMembershipDiag {
  const base: CashLogEodMembershipDiag = { ...partial };
  base.evalHint = digestMembershipEvalHint(base);
  return base;
}

function skipPrimaryCause(row: CashLogEodMembershipDiag): string | null {
  if (row.outcome !== "skipped" || !row.skipReason) return null;
  if (row.skipReason === "outside_send_window") {
    const t = row.currentLocalTime ?? "?";
    const start = row.windowStartLocal ?? "?";
    const end = row.windowEndLocal ?? "?";
    return `Local time ${t} is outside today's send window (${start}-${end} in ${row.timezone ?? "TZ"}). alreadySentToday=${row.alreadySentToday} is not the skip reason unless skipReason is already_sent_today (see evalHint).`;
  }
  if (row.skipReason === "already_sent_today") {
    return "Strict mode: digest already sent today for this schedule revision; wait until tomorrow or save digest settings to bump schedule generation.";
  }
  return null;
}

function pushMembershipEvalLog(row: CashLogEodMembershipDiag): void {
  logInfo("[cash_log_eod] membership_eval", {
    membershipId: row.membershipId,
    companyId: row.companyId,
    timezone: row.timezone,
    sendTimeConfigured: row.sendTimeConfigured,
    localDate: row.localDate,
    localTime: row.currentLocalTime,
    windowStart: row.windowStartLocal,
    windowEnd: row.windowEndLocal,
    sendWindowMode: row.sendWindowMode,
    lastSuccessDigestLocalDate: row.lastSuccessDigestLocalDate,
    alreadySentToday: row.alreadySentToday,
    scheduleGeneration: row.scheduleGeneration,
    digestSentScheduleGeneration: row.digestSentScheduleGeneration,
    suppressDuplicateSchedule: row.suppressDuplicateSchedule,
    outcome: row.outcome,
    skipReason: row.skipReason ?? null,
    skipPrimaryCause: skipPrimaryCause(row),
    evalHint: row.evalHint ?? null,
  });
}

export async function runCashLogEodJob(options?: {
  trigger?: CashLogEodTrigger;
}): Promise<CashLogEodJobResult> {
  const trigger: CashLogEodTrigger = options?.trigger ?? "internal_scheduler";
  const sendWindowMode = resolveCashLogEodSendWindowMode(trigger);
  const now = new Date();
  const rawSlack = Number(process.env.CASH_LOG_EOD_SEND_WINDOW_MINUTES);
  const slackMinutes =
    Number.isFinite(rawSlack) && rawSlack > 0
      ? Math.min(120, Math.floor(rawSlack))
      : sendWindowMode === "strict_slack"
        ? 10
        : 25;
  const errors: string[] = [];
  const skipReasons = emptyReasonCounts();
  const membershipsOut: CashLogEodMembershipDiag[] = [];
  let examined = 0;
  let sent = 0;
  let skipped = 0;

  const idRows = await prisma.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      SELECT "id" FROM "CompanyMembership"
      WHERE "cashLogEodPrefs" IS NOT NULL
        AND COALESCE(("cashLogEodPrefs"::jsonb ->> 'enabled'), 'false') = 'true'
    `,
  );
  const ids = idRows.map((r) => r.id).filter(Boolean);
  if (!ids.length) {
    return {
      trigger,
      sendWindowMode,
      utcNow: now.toISOString(),
      slackMinutes,
      examined: 0,
      sent: 0,
      skipped: 0,
      skipReasons: emptyReasonCounts(),
      errors: [],
      memberships: [],
    };
  }

  const memberships = await prisma.companyMembership.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      userId: true,
      companyId: true,
      cashLogEodPrefs: true,
      cashLogEodLastSentAt: true,
      cashLogEodScheduleGeneration: true,
      cashLogEodDigestSentScheduleGeneration: true,
      company: { select: { name: true } },
      user: { select: { email: true, isActive: true } },
    },
  });

  for (const m of memberships) {
    examined += 1;
    const base = diagBase(m);

    const d = decideMembershipCashLogDigest({
      nowUtc: now,
      slackMinutes,
      sendWindowMode,
      prefsRaw: m.cashLogEodPrefs,
      cashLogEodLastSentAt: m.cashLogEodLastSentAt,
      cashLogEodScheduleGeneration: m.cashLogEodScheduleGeneration ?? 0,
      cashLogEodDigestSentScheduleGeneration:
        m.cashLogEodDigestSentScheduleGeneration,
      userActive: Boolean(m.user?.isActive),
      userEmail: m.user?.email ?? null,
    });

    if (d.decision === "skip") {
      const reason = d.skipReason!;
      skipped += 1;
      skipReasons[reason] += 1;
      const tzSkip = d.win?.timezone ?? null;
      const lastSuccessDigestLocalDate = successMarkerLocalDateKey(
        m.cashLogEodLastSentAt,
        tzSkip,
      );
      const row = finalizeMembershipDiag({
        ...base,
        timezone: tzSkip,
        sendTimeConfigured: d.win?.sendTimeConfigured ?? null,
        localDate: d.win?.localDate ?? null,
        currentLocalTime: d.win?.currentLocalTime ?? null,
        windowStartLocal: d.win?.windowStartLocal ?? null,
        windowEndLocal: d.win?.windowEndLocal ?? null,
        lastSuccessDigestLocalDate,
        alreadySentToday: d.alreadySentToday,
        scheduleGeneration: m.cashLogEodScheduleGeneration ?? 0,
        digestSentScheduleGeneration:
          m.cashLogEodDigestSentScheduleGeneration,
        suppressDuplicateSchedule: d.suppressDuplicateSchedule,
        sendWindowMode,
        outcome: "skipped",
        skipReason: reason,
      });
      membershipsOut.push(row);
      pushMembershipEvalLog(row);
      continue;
    }

    const prefs = d.prefs!;
    const win = d.win!;

    const to = now;
    const from =
      prefs.window === "LAST_7_DAYS"
        ? new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000)
        : new Date(to.getTime() - 24 * 60 * 60 * 1000);

    try {
      const [rows, checkRows] = await Promise.all([
        cashService.listByCreatedAtRange(m.companyId, from, to),
        checkService.listByCreatedAtRange(m.companyId, from, to),
      ]);
      const leafStored =
        rows.length || checkRows.length
          ? await findRecentLeafLinkStoredOrdersForCompany(m.companyId, 4000)
          : [];
      const publicWebBase = resolvePublicWebBaseUrl().replace(/\/+$/, "");
      const dailyFlowPeriod =
        prefs.window === "LAST_7_DAYS" ? "Last 7 days" : "Last 24 hours";
      const subject = `[${m.company?.name || "Company"}] Daily Cash Flow - ${dailyFlowPeriod}`;
      const html = `
        <div style="font-family:system-ui,sans-serif;line-height:1.5">
          <h2>Daily Cash Flow - ${escapeHtml(dailyFlowPeriod)}</h2>
          <p><strong>Company:</strong> ${escapeHtml(m.company?.name || "")}</p>
          <p><strong>Period:</strong> ${escapeHtml(from.toISOString())} to ${escapeHtml(to.toISOString())} (UTC)</p>
          <h3 style="margin-top:1.25em">Cash log</h3>
          ${rowsToHtmlTable(rows, leafStored)}
          <h3 style="margin-top:1.25em">Check log</h3>
          ${checkRowsToHtmlTable(checkRows, publicWebBase, leafStored)}
          <p style="font-size:12px;color:#666">Sent by NexBatch.</p>
        </div>`;

      await sendHtmlEmail({
        to: m.user!.email!,
        subject,
        html,
        logContext: `cash_log_eod:${m.companyId}`,
      });

      await recordUsageEventSafe({
        companyId: m.companyId,
        provider: "resend",
        feature: "cash_log_eod_digest",
        unitType: "email_sent",
        units: 1,
        estimatedCost: 0.0004,
      });

      // Marker only after transport success (Resend/SMTP resolved without throw).
      await prisma.companyMembership.update({
        where: { id: m.id },
        data: {
          cashLogEodLastSentAt: now,
          cashLogEodDigestSentScheduleGeneration: m.cashLogEodScheduleGeneration,
        },
      });

      sent += 1;
      logInfo("[cash_log_eod] sent", {
        membershipId: m.id,
        companyId: m.companyId,
        to: m.user!.email,
        timezone: win.timezone,
        sendTimeConfigured: win.sendTimeConfigured,
        localTime: win.currentLocalTime,
      });
      const sg = m.cashLogEodScheduleGeneration ?? 0;
      const row = finalizeMembershipDiag({
        ...base,
        timezone: win.timezone,
        sendTimeConfigured: win.sendTimeConfigured,
        localDate: win.localDate,
        currentLocalTime: win.currentLocalTime,
        windowStartLocal: win.windowStartLocal,
        windowEndLocal: win.windowEndLocal,
        lastSuccessDigestLocalDate: win.localDate,
        alreadySentToday: true,
        scheduleGeneration: sg,
        digestSentScheduleGeneration: sg,
        suppressDuplicateSchedule: false,
        sendWindowMode,
        outcome: "sent",
      });
      membershipsOut.push(row);
      pushMembershipEvalLog(row);
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      errors.push(`${m.id}: ${msg}`);
      skipReasons.email_send_failed += 1;
      logWarn("[cash_log_eod] failed", { membershipId: m.id, error: msg });
      const sgErr = m.cashLogEodScheduleGeneration ?? 0;
      const failedMarker = digestAlreadySentToday(
        m.cashLogEodLastSentAt,
        now,
        prefs.timezone,
      );
      const row = finalizeMembershipDiag({
        ...base,
        timezone: win.timezone,
        sendTimeConfigured: win.sendTimeConfigured,
        localDate: win.localDate,
        currentLocalTime: win.currentLocalTime,
        windowStartLocal: win.windowStartLocal,
        windowEndLocal: win.windowEndLocal,
        lastSuccessDigestLocalDate: successMarkerLocalDateKey(
          m.cashLogEodLastSentAt,
          win.timezone,
        ),
        alreadySentToday: failedMarker,
        scheduleGeneration: sgErr,
        digestSentScheduleGeneration:
          m.cashLogEodDigestSentScheduleGeneration,
        suppressDuplicateSchedule: false,
        sendWindowMode,
        outcome: "error",
        skipReason: "email_send_failed",
        error: msg,
      });
      membershipsOut.push(row);
      pushMembershipEvalLog(row);
    }
  }

  const result: CashLogEodJobResult = {
    trigger,
    sendWindowMode,
    utcNow: now.toISOString(),
    slackMinutes,
    examined,
    sent,
    skipped,
    skipReasons,
    errors,
    memberships: membershipsOut,
  };

  logInfo("[cash_log_eod] job_complete", {
    trigger: result.trigger,
    sendWindowMode: result.sendWindowMode,
    utcNow: result.utcNow,
    slackMinutes: result.slackMinutes,
    examined: result.examined,
    sent: result.sent,
    skipped: result.skipped,
    skipReasons: result.skipReasons,
    errors: result.errors,
  });

  return result;
}
