import { prisma } from "../config/prisma.js";
import { ConfigService } from "./configService.js";
import { AutogrowReadingsService } from "./autogrowReadingsService.js";
import { peerNotifyPushItem, type PeerInboxItemRow } from "./peerNotificationInboxService.js";
import { logInfo, logWarn } from "../lib/logger.js";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export type CultivationClimateAlertsJobResult = {
  companiesExamined: number;
  companiesWithRules: number;
  notificationsPushed: number;
  errors: string[];
};

type ZoneRule = {
  compIndex: number;
  tempMinF: number | null;
  tempMaxF: number | null;
  rhMinPct: number | null;
  rhMaxPct: number | null;
};

function finiteNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function readingNumber(readings: Record<string, unknown> | null, keys: string[]): number | null {
  if (!readings) return null;
  for (const k of keys) {
    const n = finiteNumber(readings[k]);
    if (n != null) return n;
  }
  return null;
}

function parseZoneRules(raw: unknown): ZoneRule[] {
  if (!Array.isArray(raw)) return [];
  const out: ZoneRule[] = [];
  for (const row of raw) {
    const o = asRecord(row);
    const compIndex = Number(o.compIndex);
    if (!Number.isFinite(compIndex) || compIndex < 0) continue;
    out.push({
      compIndex: Math.floor(compIndex),
      tempMinF: finiteNumber(o.tempMinF),
      tempMaxF: finiteNumber(o.tempMaxF),
      rhMinPct: finiteNumber(o.rhMinPct),
      rhMaxPct: finiteNumber(o.rhMaxPct),
    });
  }
  return out;
}

function labelForComp(
  compIndex: number,
  labels: Array<{ compIndex: number; label: string }>,
): string {
  const hit = labels.find((x) => Number(x.compIndex) === compIndex);
  const s = String(hit?.label || "").trim();
  return s || `Zone ${compIndex}`;
}

/**
 * Cron job: evaluate Autogrow snapshot vs cultivation climate alert rules; push inbox rows to opted-in memberships.
 */
export async function runCultivationClimateAlertsJob(): Promise<CultivationClimateAlertsJobResult> {
  const errors: string[] = [];
  let companiesExamined = 0;
  let companiesWithRules = 0;
  let notificationsPushed = 0;

  const configService = new ConfigService();
  const autogrow = new AutogrowReadingsService();

  const companies = await prisma.company.findMany({ select: { id: true } });

  for (const { id: companyId } of companies) {
    companiesExamined += 1;
    try {
      const rows = await configService.list(companyId);
      const cultRow = rows.find((r) => r.key === "cultivation");
      const companyRow = rows.find((r) => r.key === "company");
      const cultivation = asRecord(cultRow?.value);
      const climateAlerts = asRecord(cultivation.climateAlerts);
      if (!climateAlerts || climateAlerts.enabled !== true) continue;

      const zones = parseZoneRules(climateAlerts.zones);
      if (!zones.length) continue;

      companiesWithRules += 1;

      const cooldownRaw = finiteNumber(climateAlerts.cooldownMinutes);
      const cooldownMin = cooldownRaw != null && cooldownRaw >= 5 ? cooldownRaw : 45;
      const bucket = Math.floor(Date.now() / (cooldownMin * 60_000));

      const company = asRecord(companyRow?.value);
      const climate = asRecord(company.climateControl);
      const ag = asRecord(climate.autogrow);
      const compLabels = Array.isArray(ag.compLabels)
        ? (ag.compLabels as unknown[]).map((e) => {
            const r = asRecord(e);
            return { compIndex: Number(r.compIndex), label: String(r.label ?? "") };
          })
        : [];

      const snap = await autogrow.getSnapshot(companyId);
      if (!snap.ok) continue;

      const compByIndex = new Map(
        snap.comps.filter((c) => c.ok && c.readings).map((c) => [c.compIndex, c.readings!]),
      );

      const recipients = await prisma.companyMembership.findMany({
        where: { companyId, cultivationAlertsEnabled: true },
        select: { userId: true },
      });
      if (!recipients.length) continue;

      for (const zone of zones) {
        const hasAnyThreshold =
          zone.tempMinF != null ||
          zone.tempMaxF != null ||
          zone.rhMinPct != null ||
          zone.rhMaxPct != null;
        if (!hasAnyThreshold) continue;

        const readings = compByIndex.get(zone.compIndex);
        const temp = readingNumber(readings ?? null, ["air_temp", "AirTemp", "temperature", "temp"]);
        const rh = readingNumber(readings ?? null, ["rh", "RH", "humidity", "relative_humidity"]);
        const zlabel = labelForComp(zone.compIndex, compLabels);

        const violations: { code: string; message: string }[] = [];
        if (temp != null) {
          if (zone.tempMinF != null && temp < zone.tempMinF) {
            violations.push({
              code: "temp_low",
              message: `${zlabel}: Air temp ${temp.toFixed(1)}°F is below minimum ${zone.tempMinF}°F`,
            });
          }
          if (zone.tempMaxF != null && temp > zone.tempMaxF) {
            violations.push({
              code: "temp_high",
              message: `${zlabel}: Air temp ${temp.toFixed(1)}°F exceeds maximum ${zone.tempMaxF}°F`,
            });
          }
        }
        if (rh != null) {
          if (zone.rhMinPct != null && rh < zone.rhMinPct) {
            violations.push({
              code: "rh_low",
              message: `${zlabel}: RH ${rh.toFixed(0)}% is below minimum ${zone.rhMinPct}%`,
            });
          }
          if (zone.rhMaxPct != null && rh > zone.rhMaxPct) {
            violations.push({
              code: "rh_high",
              message: `${zlabel}: RH ${rh.toFixed(0)}% exceeds maximum ${zone.rhMaxPct}%`,
            });
          }
        }

        for (const v of violations) {
          const id = `climate:${companyId}:${zone.compIndex}:${v.code}:${bucket}`;
          const at = new Date().toISOString();
          const item: PeerInboxItemRow = {
            id,
            kind: "climate",
            message: v.message,
            at,
            read: false,
          };
          for (const { userId } of recipients) {
            try {
              await peerNotifyPushItem({ userId, companyId, item });
              notificationsPushed += 1;
            } catch (e) {
              errors.push(
                `${companyId} user ${userId}: ${e instanceof Error ? e.message : String(e)}`,
              );
            }
          }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${companyId}: ${msg}`);
      logWarn("cultivation_climate_alert_company_failed", { companyId, error: msg });
    }
  }

  logInfo("cultivation_climate_alerts_job_done", {
    companiesExamined,
    companiesWithRules,
    notificationsPushed,
    errorCount: errors.length,
  });

  return { companiesExamined, companiesWithRules, notificationsPushed, errors };
}
