/**
 * Stored under `cultivation.climateAlerts` in company config JSON.
 * Evaluated by `@cpu/api` cron against Autogrow snapshot (`air_temp`, `rh`).
 */
export type CultivationClimateAlertZone = {
  compIndex: number;
  tempMinF: number | null;
  tempMaxF: number | null;
  rhMinPct: number | null;
  rhMaxPct: number | null;
};

export type CultivationClimateAlertsConfig = {
  enabled: boolean;
  /** Minimum minutes between repeat notifications per zone + violation type (default 45). */
  cooldownMinutes: number;
  zones: CultivationClimateAlertZone[];
};

/**
 * Sensible indoor-canopy starter thresholds (°F / % RH). Editable in Admin → Company config → Cultivation.
 * Two Autogrow zone rows (indices 0 and 1); remove or change comp indices to match your facility.
 */
export const stockCultivationClimateAlertZones: CultivationClimateAlertZone[] = [
  {
    compIndex: 0,
    tempMinF: 65,
    tempMaxF: 82,
    rhMinPct: 40,
    rhMaxPct: 70,
  },
  {
    compIndex: 1,
    tempMinF: 65,
    tempMaxF: 82,
    rhMinPct: 40,
    rhMaxPct: 70,
  },
];

export const defaultCultivationClimateAlerts: CultivationClimateAlertsConfig = {
  enabled: false,
  cooldownMinutes: 45,
  zones: stockCultivationClimateAlertZones.map((z) => ({ ...z })),
};

function finiteOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function cloneZones(z: CultivationClimateAlertZone[]): CultivationClimateAlertZone[] {
  return z.map((row) => ({ ...row }));
}

export function mergeCultivationClimateAlerts(raw: unknown): CultivationClimateAlertsConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ...defaultCultivationClimateAlerts,
      zones: cloneZones(defaultCultivationClimateAlerts.zones),
    };
  }
  const o = raw as Record<string, unknown>;
  const hasZonesKey = Object.prototype.hasOwnProperty.call(o, "zones");
  const zonesRaw = hasZonesKey && Array.isArray(o.zones) ? o.zones : null;

  const zones: CultivationClimateAlertZone[] = [];
  if (zonesRaw === null) {
    for (const row of stockCultivationClimateAlertZones) {
      zones.push({ ...row });
    }
  } else {
    for (const row of zonesRaw) {
      if (!row || typeof row !== "object") continue;
      const z = row as Record<string, unknown>;
      const compIndex = Number(z.compIndex);
      if (!Number.isFinite(compIndex) || compIndex < 0) continue;
      zones.push({
        compIndex: Math.floor(compIndex),
        tempMinF: finiteOrNull(z.tempMinF),
        tempMaxF: finiteOrNull(z.tempMaxF),
        rhMinPct: finiteOrNull(z.rhMinPct),
        rhMaxPct: finiteOrNull(z.rhMaxPct),
      });
    }
  }

  const cd = finiteOrNull(o.cooldownMinutes);
  return {
    enabled: o.enabled === true,
    cooldownMinutes: cd != null && cd >= 5 ? Math.round(cd) : defaultCultivationClimateAlerts.cooldownMinutes,
    zones,
  };
}
