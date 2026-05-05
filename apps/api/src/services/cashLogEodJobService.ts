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

function zonedDateKeyForInstant(isoUtc: Date, timeZone: string): string {
  return zonedCalendarParts(isoUtc, timeZone).dateKey;
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

export async function runCashLogEodJob(): Promise<{
  examined: number;
  sent: number;
  skipped: number;
  errors: string[];
}> {
  const now = new Date();
  const slack = Number(process.env.CASH_LOG_EOD_SEND_WINDOW_MINUTES) || 25;
  const errors: string[] = [];
  let examined = 0;
  let sent = 0;
  let skipped = 0;

  const idRows = await prisma.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "CompanyMembership" WHERE "cashLogEodPrefs" IS NOT NULL`,
  );
  const ids = idRows.map((r) => r.id).filter(Boolean);
  if (!ids.length) {
    return { examined: 0, sent: 0, skipped: 0, errors: [] };
  }

  const memberships = await prisma.companyMembership.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      userId: true,
      companyId: true,
      cashLogEodPrefs: true,
      cashLogEodLastSentAt: true,
      company: { select: { name: true } },
      user: { select: { email: true, isActive: true } },
    },
  });

  for (const m of memberships) {
    examined += 1;
    const prefs = parseCashLogEodPrefs(m.cashLogEodPrefs);
    if (!prefs || !prefs.enabled) {
      skipped += 1;
      continue;
    }
    if (!m.user?.isActive || !m.user.email) {
      skipped += 1;
      continue;
    }

    const { weekday, dateKey } = zonedCalendarParts(now, prefs.timezone);
    if (!prefs.weekdays.includes(weekday)) {
      skipped += 1;
      continue;
    }

    if (!isWithinSendWindow(now, prefs, slack)) {
      skipped += 1;
      continue;
    }

    if (m.cashLogEodLastSentAt) {
      const lastKey = zonedDateKeyForInstant(m.cashLogEodLastSentAt, prefs.timezone);
      if (lastKey === dateKey) {
        skipped += 1;
        continue;
      }
    }

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
        to: m.user.email,
        subject,
        html,
        logContext: `cash_log_eod:${m.companyId}`,
      });

      await prisma.companyMembership.update({
        where: { id: m.id },
        data: { cashLogEodLastSentAt: now },
      });

      sent += 1;
      logInfo("[cash_log_eod] sent", {
        membershipId: m.id,
        companyId: m.companyId,
        to: m.user.email,
      });
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      errors.push(`${m.id}: ${msg}`);
      logWarn("[cash_log_eod] failed", { membershipId: m.id, error: msg });
    }
  }

  return { examined, sent, skipped, errors };
}
