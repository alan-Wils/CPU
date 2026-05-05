import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { parseCashLogEodPrefs, type CashLogEodPrefs } from "../lib/cashLogEodPrefs.js";
import { CashLogService } from "./cashLogService.js";
import { sendHtmlEmail } from "../lib/mailer.js";
import { logInfo, logWarn } from "../lib/logger.js";

const cashService = new CashLogService();

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

/** True if local wall time is within the cron slack window starting at the configured send time. */
export function isWithinSendWindow(
  nowUtc: Date,
  prefs: CashLogEodPrefs,
  slackMinutes: number,
): boolean {
  const { hour, minute } = zonedCalendarParts(nowUtc, prefs.timezone);
  const current = hour * 60 + minute;
  const target = parseSendMinutes(prefs.sendTime);
  return current >= target && current < target + slackMinutes;
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

/** Default: internal scheduler stays strict; sporadic cron can hit after the slack window closes. Override with `CASH_LOG_EOD_SEND_WINDOW_MODE=strict|eod_local_day`. */
export function resolveCashLogEodSendWindowMode(
  trigger: CashLogEodTrigger,
): CashLogEodSendWindowMode {
  const raw = process.env.CASH_LOG_EOD_SEND_WINDOW_MODE?.trim().toLowerCase();
  if (raw === "strict" || raw === "strict_slack") return "strict_slack";
  if (raw === "eod" || raw === "eod_local_day") return "eod_local_day";
  return trigger === "cron" ? "eod_local_day" : "strict_slack";
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
 * Historical helper describing the old same-day duplicate rule (generation match).
 * **Eligibility does not use this** — digest sends on every eligible tick even if already sent today.
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
        return "Outside send window on this tick (no mail attempted). If lastSuccessDigestLocalDate matches localDate, an earlier send succeeded today; the next tick inside the window will send again (no daily cap).";
      }
      return "Before configured local send time — no mail on this tick. Next tick inside the window can send again (no daily cap). Eligibility uses eod_local_day (at/after send time through end of day) vs strict slack (narrow slice after send time).";
    case "already_sent_today":
      return "Reserved skip reason — same-day duplicate cap is disabled; you should not see this.";
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
      ? `${pad2(he % 24)}:${pad2(me)} (+1 local day)`
      : `${pad2(he % 24)}:${pad2(me)}`;
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

function rowsToHtmlTable(rows: CashDigestRow[]): string {
  if (!rows.length) {
    return "<p>No cash log entries in this period.</p>";
  }
  const head =
    "<tr><th>When (UTC)</th><th>Dir</th><th>Amount</th><th>Payee / Dept</th><th>Memo</th></tr>";
  const body = rows
    .map((r) => {
      const when = r.createdAt.toISOString();
      const extra =
        r.direction === "INCOMING"
          ? escapeHtml(String(r.payeeCompany || ""))
          : escapeHtml(String(r.department || ""));
      return `<tr><td>${escapeHtml(when)}</td><td>${escapeHtml(r.direction)}</td><td>${escapeHtml(String(r.amount))}</td><td>${extra}</td><td>${escapeHtml(String(r.memo || ""))}</td></tr>`;
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
  /** Eligibility mode for this job run (`strict_slack` vs remainder of local day for cron). */
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
 * Pure eligibility after local send-window rules (`strict_slack` vs `eod_local_day`).
 * No same-day duplicate cap — every eligible tick attempts a send; `cashLogEodLastSentAt` still tracks last success.
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
    evalHint: row.evalHint ?? null,
  });
}

export async function runCashLogEodJob(options?: {
  trigger?: CashLogEodTrigger;
}): Promise<CashLogEodJobResult> {
  const trigger: CashLogEodTrigger = options?.trigger ?? "internal_scheduler";
  const sendWindowMode = resolveCashLogEodSendWindowMode(trigger);
  const now = new Date();
  const slackMinutes =
    Number(process.env.CASH_LOG_EOD_SEND_WINDOW_MINUTES) || 25;
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
      const rows = await cashService.listByCreatedAtRange(m.companyId, from, to);
      const windowLabel =
        prefs.window === "LAST_7_DAYS" ? "last 7 days" : "last 24 hours";
      const subject = `[${m.company?.name || "Company"}] Cash log digest (${windowLabel})`;
      const html = `
        <div style="font-family:system-ui,sans-serif;line-height:1.5">
          <h2>Financial cash log — ${escapeHtml(windowLabel)}</h2>
          <p><strong>Company:</strong> ${escapeHtml(m.company?.name || "")}</p>
          <p><strong>Window (logged UTC):</strong> ${escapeHtml(from.toISOString())} → ${escapeHtml(to.toISOString())}</p>
          ${rowsToHtmlTable(rows)}
          <p style="font-size:12px;color:#666">Sent by NexBatch CPU · adjust schedule in Admin → Financial logs.</p>
        </div>`;

      await sendHtmlEmail({
        to: m.user!.email!,
        subject,
        html,
        logContext: `cash_log_eod:${m.companyId}`,
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
