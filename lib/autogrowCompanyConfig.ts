/**
 * Autogrow MultiGrow v3 settings stored under `company.climateControl.autogrow`.
 * API key is used server-side only via `@cpu/api`; may appear in GET /api/config (admin pattern).
 */

/** One display label for a MultiGrow `comps/{index}` climate zone. */
export type AutogrowCompLabel = {
  compIndex: number;
  label: string;
};

export type AutogrowCompanyConfig = {
  /** my.autogrow.com → Create API Key */
  apiKey: string;
  /** Device UUID from my.autogrow.com devices */
  deviceUuid: string;
  /** When true, server may call Autogrow for this company */
  integrationEnabled: boolean;
  /** Map comp indices to names (e.g. Flower 1) for UI */
  compLabels: AutogrowCompLabel[];
  /** Internal notes; not sent to Autogrow */
  notes: string;
};

export const defaultAutogrowCompanyConfig: AutogrowCompanyConfig = {
  apiKey: "",
  deviceUuid: "",
  integrationEnabled: false,
  compLabels: [],
  notes: "",
};

/** Future systems (other climate vendors) can nest alongside `autogrow`. */
export type ClimateControlCompanyConfig = {
  autogrow: AutogrowCompanyConfig;
};

export const defaultClimateControlCompanyConfig: ClimateControlCompanyConfig = {
  autogrow: { ...defaultAutogrowCompanyConfig },
};

export function labelForAutogrowComp(
  compIndex: number,
  compLabels: AutogrowCompLabel[] | undefined | null,
): string {
  const list = Array.isArray(compLabels) ? compLabels : [];
  const hit = list.find((r) => Number(r.compIndex) === Number(compIndex));
  const s = String(hit?.label || "").trim();
  if (s) return s;
  return `Zone ${compIndex}`;
}
