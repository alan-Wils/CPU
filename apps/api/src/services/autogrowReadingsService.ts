import { ConfigService } from "./configService.js";
import { logInfo, logWarn } from "../lib/logger.js";

const AUTOGROW_MYDATA_BASE = "https://mydata.autogrow.com/api/v3";
const BETWEEN_COMP_MS = 750;
const MAX_COMP_PROBE = 16;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Autogrow `/multigrow/:uuid/comps/:id` uses **1-based** `:id`; response `metadata.index` is often 0-based.
 * Cultivation URLs and snapshots use **0-based** `compIndex` — use this helper for history/current paths where the vendor expects 1-based ids.
 */
function autogrowCompsRestId(compIndex: number): number {
  return Math.floor(compIndex) + 1;
}

function autogrowErrorDetail(bodyJson: unknown): string | null {
  const o = asRecord(bodyJson);
  for (const k of ["message", "error", "detail", "Description"] as const) {
    const s = String(o[k] ?? "").trim();
    if (s) return s.slice(0, 400);
  }
  return null;
}

export type AutogrowCompSnapshotItem = {
  compIndex: number;
  ok: boolean;
  status: number;
  metadata: Record<string, unknown> | null;
  readings: Record<string, unknown> | null;
  message?: string;
};

export type AutogrowWeatherSnapshot = {
  ok: boolean;
  status: number;
  metadata: Record<string, unknown> | null;
  readings: Record<string, unknown> | null;
  message?: string;
};

export type AutogrowCompLabelDto = { compIndex: number; label: string };

export type AutogrowSnapshotSuccess = {
  ok: true;
  deviceUuid: string;
  /** From company config — for UI card titles. */
  compLabels: AutogrowCompLabelDto[];
  comps: AutogrowCompSnapshotItem[];
  weather: AutogrowWeatherSnapshot;
};

export type AutogrowSnapshotFailure = {
  ok: false;
  status: number;
  message: string;
};

export type AutogrowSnapshotResponse = AutogrowSnapshotSuccess | AutogrowSnapshotFailure;
export type AutogrowHistoryPoint = {
  time: string;
  [key: string]: string | number | null;
};

async function fetchAutogrowPath(
  deviceUuid: string,
  pathname: string,
  apiKey: string,
): Promise<{ status: number; bodyJson: unknown; bodyText: string }> {
  const url = `${AUTOGROW_MYDATA_BASE}/multigrow/${deviceUuid.replace(/\/+$/, "")}${pathname}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "User-Agent": "CPU-Platform/1.0",
    },
    signal: AbortSignal.timeout(25_000),
  });
  let bodyText = "";
  try {
    bodyText = await res.text();
  } catch {
    bodyText = "";
  }
  let bodyJson: unknown = null;
  try {
    bodyJson = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    bodyJson = null;
  }
  return { status: res.status, bodyJson, bodyText };
}

function readingsAndMeta(bodyJson: unknown): {
  metadata: Record<string, unknown> | null;
  readings: Record<string, unknown> | null;
} {
  const o = asRecord(bodyJson);
  const md = asRecord(o.metadata);
  const rd = o.readings;
  return {
    metadata: Object.keys(md).length ? md : null,
    readings: rd && typeof rd === "object" && !Array.isArray(rd) ? asRecord(rd) : null,
  };
}

function parseHistoryPoints(bodyJson: unknown): AutogrowHistoryPoint[] {
  const o = asRecord(bodyJson);
  const readings = Array.isArray(o.readings) ? o.readings : [];
  const out: AutogrowHistoryPoint[] = [];
  for (const row of readings) {
    const src = asRecord(row);
    const t = String(src.time ?? "").trim();
    if (!t) continue;
    const point: AutogrowHistoryPoint = { time: t };
    for (const [k, v] of Object.entries(src)) {
      if (k === "time") continue;
      if (typeof v === "number") {
        point[k] = Number.isFinite(v) ? v : null;
      } else if (typeof v === "string") {
        const n = Number(v);
        point[k] = Number.isFinite(n) ? n : v;
      } else if (typeof v === "boolean") {
        point[k] = v ? 1 : 0;
      } else {
        point[k] = null;
      }
    }
    out.push(point);
  }
  return out;
}

export class AutogrowReadingsService {
  configService = new ConfigService();

  private async loadClimateAutogrow(companyId: string): Promise<
    | { valid: true; apiKey: string; uuid: string; compLabels: AutogrowCompLabelDto[] }
    | { valid: false; status: number; message: string }
  > {
    const rows = await this.configService.list(companyId);
    const companyRow = rows.find((r) => r.key === "company");
    const company = asRecord(companyRow?.value);
    const climate = asRecord(company.climateControl);
    const ag = asRecord(climate.autogrow);
    const apiKey = String(ag.apiKey || "").trim();
    const uuid = String(ag.deviceUuid || "").trim();
    const enabled = Boolean(ag.integrationEnabled);
    const rawLabels = ag.compLabels;
    const compLabels: AutogrowCompLabelDto[] = Array.isArray(rawLabels)
      ? (rawLabels as unknown[])
          .map((entry) => {
            const row = asRecord(entry);
            return {
              compIndex: Number(row.compIndex),
              label: String(row.label ?? "").trim(),
            };
          })
          .filter((r) => Number.isFinite(r.compIndex))
      : [];

    if (!enabled) {
      return { valid: false, status: 403, message: "Autogrow integration is disabled for this company." };
    }
    if (!apiKey || !uuid) {
      return {
        valid: false,
        status: 400,
        message:
          "Autogrow API key or device UUID is missing. Add them under Admin → Company config → Climate control → Autogrow.",
      };
    }
    return { valid: true, apiKey, uuid, compLabels };
  }

  /** Current readings for all comps (until 404) plus weather/0. */
  async getSnapshot(companyId: string): Promise<AutogrowSnapshotResponse> {
    const gate = await this.loadClimateAutogrow(companyId);
    if (gate.valid === false) return { ok: false, status: gate.status, message: gate.message };

    const { apiKey, uuid } = gate;
    logInfo("[AUTOGROW] snapshot_start", { companyId, uuidLen: uuid.length });

    const weatherProbe = await fetchAutogrowPath(uuid, "/weather/0", apiKey);
    const wt = readingsAndMeta(weatherProbe.bodyJson);
    const weather: AutogrowWeatherSnapshot = weatherProbe.status === 200 && wt.readings
      ? { ok: true, status: 200, metadata: wt.metadata, readings: wt.readings }
      : {
          ok: false,
          status: weatherProbe.status,
          metadata: wt.metadata,
          readings: wt.readings,
          message:
            weatherProbe.status === 429
              ? "Autogrow rate limited. Try again in a minute."
              : `Weather request returned HTTP ${weatherProbe.status}`,
        };

    const comps: AutogrowCompSnapshotItem[] = [];
    for (let compIndex = 0; compIndex < MAX_COMP_PROBE; compIndex += 1) {
      if (compIndex > 0) await sleep(BETWEEN_COMP_MS);
      const r = await fetchAutogrowPath(uuid, `/comps/${autogrowCompsRestId(compIndex)}`, apiKey);
      logInfo("[AUTOGROW] comp_probe", {
        companyId,
        compIndex,
        status: r.status,
      });

      if (r.status === 404) break;

      const parsed = readingsAndMeta(r.bodyJson);

      if (r.status >= 200 && r.status < 300 && parsed.readings) {
        comps.push({
          compIndex,
          ok: true,
          status: r.status,
          metadata: parsed.metadata,
          readings: parsed.readings,
        });
      } else {
        comps.push({
          compIndex,
          ok: false,
          status: r.status,
          metadata: parsed.metadata,
          readings: parsed.readings,
          message:
            r.status === 429
              ? "Rate limited."
              : `HTTP ${r.status}`,
        });
        /** Stop after consecutive hard errors post-first success optional — keep scanning until 404 */
        if (r.status === 401 || r.status === 403 || r.status === 402) {
          logWarn("[AUTOGROW] comp_probe_auth_abort", { companyId, compIndex, status: r.status });
          break;
        }
      }
    }

    logInfo("[AUTOGROW] snapshot_ok", {
      companyId,
      compCount: comps.filter((c) => c.ok).length,
      weatherOk: weather.ok,
    });

    return { ok: true, deviceUuid: uuid, compLabels: gate.compLabels, comps, weather };
  }

  /** Single compartment current readings. */
  async getCompReadings(
    companyId: string,
    compIndex: number,
  ): Promise<
    | { ok: true; deviceUuid: string; compIndex: number; metadata: Record<string, unknown> | null; readings: Record<string, unknown> }
    | AutogrowSnapshotFailure
  > {
    if (!Number.isFinite(compIndex) || compIndex < 0 || compIndex > MAX_COMP_PROBE) {
      return { ok: false, status: 400, message: "Invalid compartment index." };
    }

    const gate = await this.loadClimateAutogrow(companyId);
    if (gate.valid === false) return { ok: false, status: gate.status, message: gate.message };

    const { apiKey, uuid } = gate;
    const r = await fetchAutogrowPath(uuid, `/comps/${autogrowCompsRestId(compIndex)}`, apiKey);
    const parsed = readingsAndMeta(r.bodyJson);

    if (r.status === 200 && parsed.readings) {
      return {
        ok: true,
        deviceUuid: uuid,
        compIndex,
        metadata: parsed.metadata,
        readings: parsed.readings,
      };
    }

    let message = `Autogrow returned HTTP ${r.status}`;
    if (r.status === 429) message = "Autogrow rate limited. Try again shortly.";
    else if (r.status === 402) message = "Device subscription required on Autogrow.";
    else {
      const hint = autogrowErrorDetail(r.bodyJson);
      if (hint) message = `${message}: ${hint}`;
    }
    return { ok: false, status: r.status, message };
  }

  /** Single compartment time-series readings for line graph. */
  async getCompHistory(
    companyId: string,
    compIndex: number,
    fromEpoch: number,
    toEpoch: number,
  ): Promise<
    | {
        ok: true;
        deviceUuid: string;
        compIndex: number;
        fromEpoch: number;
        toEpoch: number;
        points: AutogrowHistoryPoint[];
      }
    | AutogrowSnapshotFailure
  > {
    if (!Number.isFinite(compIndex) || compIndex < 0 || compIndex > MAX_COMP_PROBE) {
      return { ok: false, status: 400, message: "Invalid compartment index." };
    }
    if (!Number.isFinite(fromEpoch) || !Number.isFinite(toEpoch) || fromEpoch <= 0 || toEpoch <= 0) {
      return { ok: false, status: 400, message: "Invalid history range." };
    }
    if (fromEpoch >= toEpoch) {
      return { ok: false, status: 400, message: "`from` must be less than `to`." };
    }

    const gate = await this.loadClimateAutogrow(companyId);
    if (gate.valid === false) return { ok: false, status: gate.status, message: gate.message };

    const { apiKey, uuid } = gate;
    const compRestId = autogrowCompsRestId(compIndex);
    const r = await fetchAutogrowPath(
      uuid,
      `/comps/${compRestId}/history/${Math.floor(fromEpoch)}/${Math.floor(toEpoch)}`,
      apiKey,
    );
    if (r.status === 200) {
      return {
        ok: true,
        deviceUuid: uuid,
        compIndex,
        fromEpoch: Math.floor(fromEpoch),
        toEpoch: Math.floor(toEpoch),
        points: parseHistoryPoints(r.bodyJson),
      };
    }

    let message = `Autogrow returned HTTP ${r.status}`;
    if (r.status === 429) message = "Autogrow rate limited. Try again shortly.";
    else if (r.status === 402) message = "Device subscription required on Autogrow.";
    else {
      const hint = autogrowErrorDetail(r.bodyJson);
      if (hint) message = `${message}: ${hint}`;
    }
    return { ok: false, status: r.status, message };
  }
}
