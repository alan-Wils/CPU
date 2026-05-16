/**
 * Company-wide mother plant inventory (stored in `CompanyConfig` key `cultivation.motherPlants`).
 */

import { generateMetrcTagSequence } from "./cultivationMetrcWorkflow";

export const MAX_MOTHER_PLANTS_PER_COMPANY = 5000;

export type MotherPlantStatus = "active" | "retired";

export type MotherPlantSourceStage = "Clones" | "Veg";

export type MotherPlant = {
  id: string;
  strain: string;
  acronym?: string;
  tag?: string;
  notes?: string;
  location?: string;
  status: MotherPlantStatus;
  sourceBatchId: string;
  sourceStage: MotherPlantSourceStage;
  promotedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type PromoteToMotherInput = {
  sourceBatch: Record<string, unknown>;
  sourceStage: MotherPlantSourceStage;
  /** Clone / untagged veg: number of plants. Ignored when `selectedTags` is non-empty. */
  plantCount?: number;
  /** Veg with METRC tags: one mom per tag. */
  selectedTags?: string[];
  /** Optional starting tag for sequential assignment (clone / count-based veg). */
  startingTag?: string;
  promotedAt: string;
  location?: string;
  notes?: string;
  nowIso?: string;
  newId?: () => string;
};

function trimOrUndef(v: unknown): string | undefined {
  const s = String(v ?? "").trim();
  return s || undefined;
}

function normalizeStatus(v: unknown): MotherPlantStatus {
  return String(v || "").toLowerCase() === "retired" ? "retired" : "active";
}

function normalizeSourceStage(v: unknown): MotherPlantSourceStage | null {
  const s = String(v || "").trim();
  if (s === "Clones" || s === "Veg") return s;
  if (s.toLowerCase() === "clone" || s.toLowerCase() === "clones") return "Clones";
  if (s.toLowerCase() === "veg") return "Veg";
  return null;
}

/** Parse and sanitize mother plant rows from company config or API. */
export function normalizeMotherPlants(raw: unknown): MotherPlant[] {
  if (!Array.isArray(raw)) return [];
  const out: MotherPlant[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const r = row as Record<string, unknown>;
    const id = String(r.id || "").trim();
    const strain = String(r.strain || "").trim();
    const sourceBatchId = String(r.sourceBatchId || "").trim();
    const sourceStage = normalizeSourceStage(r.sourceStage);
    const promotedAt = String(r.promotedAt || "").trim();
    const createdAt = String(r.createdAt || "").trim();
    const updatedAt = String(r.updatedAt || "").trim();
    if (!id || !strain || !sourceBatchId || !sourceStage || !promotedAt || !createdAt || !updatedAt) continue;
    out.push({
      id,
      strain,
      acronym: trimOrUndef(r.acronym),
      tag: trimOrUndef(r.tag),
      notes: trimOrUndef(r.notes),
      location: trimOrUndef(r.location),
      status: normalizeStatus(r.status),
      sourceBatchId,
      sourceStage,
      promotedAt,
      createdAt,
      updatedAt,
    });
  }
  return out;
}

export function filterActiveMothers(plants: MotherPlant[]): MotherPlant[] {
  return plants.filter((p) => p.status === "active");
}

export function countActiveMothers(plants: MotherPlant[]): number {
  return filterActiveMothers(plants).length;
}

/** Case-insensitive tag uniqueness across all moms (active + retired). */
export function validateUniqueMotherTags(
  plants: MotherPlant[],
  newTags: string[],
  excludeMotherId?: string,
): { ok: true } | { ok: false; error: string } {
  const existing = new Set<string>();
  for (const p of plants) {
    if (excludeMotherId && p.id === excludeMotherId) continue;
    const t = String(p.tag || "").trim();
    if (t) existing.add(t.toLowerCase());
  }
  const seenNew = new Set<string>();
  for (const tag of newTags) {
    const t = String(tag || "").trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (existing.has(key) || seenNew.has(key)) {
      return { ok: false, error: `METRC tag "${t}" is already assigned to a mother plant.` };
    }
    seenNew.add(key);
  }
  return { ok: true };
}

export function readPlantTagStrings(batch: Record<string, unknown>): string[] {
  const arr = batch.plantTagRecords;
  if (!Array.isArray(arr)) return [];
  return arr
    .map((r) => (r && typeof r === "object" && !Array.isArray(r) ? String((r as { tag?: unknown }).tag || "").trim() : ""))
    .filter(Boolean);
}

export function batchHasAssignedPlantTags(batch: Record<string, unknown>): boolean {
  return readPlantTagStrings(batch).length > 0;
}

function defaultNewId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `mom-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function strainFromBatch(batch: Record<string, unknown>): { strain: string; acronym?: string } {
  const strain = String(batch.strain || batch.Strain || "").trim();
  const acronym = trimOrUndef(batch.acronym ?? batch.Acronym);
  return { strain, acronym };
}

function resolveTagsForPromotion(input: PromoteToMotherInput): { ok: true; tags: string[] } | { ok: false; error: string } {
  const selected = (input.selectedTags || []).map((t) => String(t).trim()).filter(Boolean);
  if (selected.length > 0) {
    const available = new Set(readPlantTagStrings(input.sourceBatch));
    for (const t of selected) {
      if (!available.has(t)) {
        return { ok: false, error: `Tag "${t}" is not on this batch.` };
      }
    }
    return { ok: true, tags: selected };
  }

  const count = Number(input.plantCount);
  if (!(Number.isFinite(count) && count >= 1)) {
    return { ok: false, error: "Enter how many plants to promote (at least 1)." };
  }
  const n = Math.floor(count);
  const batchPlants = Number(input.sourceBatch.plants);
  if (Number.isFinite(batchPlants) && n > batchPlants) {
    return { ok: false, error: `Cannot promote more than ${batchPlants} plants on this batch.` };
  }

  const start = String(input.startingTag || "").trim();
  if (!start) {
    return { ok: true, tags: Array.from({ length: n }, () => "") };
  }
  const seq = generateMetrcTagSequence(start, n);
  if (!seq.ok) return seq;
  return { ok: true, tags: seq.tags };
}

/** Build new mother plant rows for a promotion (does not mutate batch). */
export function buildMotherPlantsForPromotion(
  input: PromoteToMotherInput,
): { ok: true; mothers: MotherPlant[] } | { ok: false; error: string } {
  const tagRes = resolveTagsForPromotion(input);
  if (!tagRes.ok) return tagRes;

  const { strain, acronym } = strainFromBatch(input.sourceBatch);
  if (!strain) {
    return { ok: false, error: "Source batch has no strain — set strain before promoting to mother." };
  }

  const now = input.nowIso || new Date().toISOString();
  const promotedAt = String(input.promotedAt || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(promotedAt)) {
    return { ok: false, error: "Promoted date must be YYYY-MM-DD." };
  }

  const sourceBatchId = String(input.sourceBatch.id || "").trim();
  if (!sourceBatchId) {
    return { ok: false, error: "Source batch id is missing." };
  }

  const newId = input.newId || defaultNewId;
  const location = trimOrUndef(input.location);
  const notes = trimOrUndef(input.notes);

  const mothers: MotherPlant[] = tagRes.tags.map((tag) => ({
    id: newId(),
    strain,
    acronym,
    tag: tag || undefined,
    notes,
    location,
    status: "active",
    sourceBatchId,
    sourceStage: input.sourceStage,
    promotedAt,
    createdAt: now,
    updatedAt: now,
  }));

  return { ok: true, mothers };
}

/** Apply promotion to batch: decrement plants and remove promoted tags from plantTagRecords. */
export function applyPromotionToSourceBatch(
  batch: Record<string, unknown>,
  promotedCount: number,
  promotedTags: string[],
): void {
  const current = Number(batch.plants);
  if (Number.isFinite(current)) {
    batch.plants = Math.max(0, current - promotedCount);
  }

  const tagSet = new Set(promotedTags.map((t) => String(t).trim()).filter(Boolean));
  if (tagSet.size === 0) return;

  const records = batch.plantTagRecords;
  if (!Array.isArray(records)) return;
  batch.plantTagRecords = records.filter((r) => {
    if (!r || typeof r !== "object" || Array.isArray(r)) return true;
    const tag = String((r as { tag?: unknown }).tag || "").trim();
    return !tagSet.has(tag);
  });
}

export function motherPlantsFromConfigPayload(data: unknown): MotherPlant[] {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const cult = (data as { cultivation?: unknown }).cultivation;
  if (!cult || typeof cult !== "object" || Array.isArray(cult)) return [];
  return normalizeMotherPlants((cult as { motherPlants?: unknown }).motherPlants);
}
