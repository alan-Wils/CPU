export type NexbatchCultivationStrain = {
  id: string;
  name: string;
  acronym: string;
  dominance: string;
  potency: string;
  averageYield: string;
  metrcStrainId?: string;
  metrcLinked?: boolean;
  [key: string]: unknown;
};

export function parseNexbatchStrainsFromCultivationValue(
  cultivation: Record<string, unknown>,
): NexbatchCultivationStrain[] {
  const strains = cultivation.strains;
  if (!Array.isArray(strains)) return [];
  const out: NexbatchCultivationStrain[] = [];
  for (const item of strains) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const id = String(row.id ?? "").trim();
    const name = String(row.name ?? "").trim();
    if (!id || !name) continue;
    out.push({
      id,
      name,
      acronym: String(row.acronym ?? "").trim(),
      dominance: String(row.dominance ?? "").trim(),
      potency: String(row.potency ?? "").trim(),
      averageYield: String(row.averageYield ?? "").trim(),
      metrcStrainId: String(row.metrcStrainId ?? "").trim() || undefined,
      metrcLinked: Boolean(row.metrcLinked),
      ...row,
    });
  }
  return out;
}

export function findNexbatchStrainByExactName(
  strains: NexbatchCultivationStrain[],
  metrcName: string,
): NexbatchCultivationStrain | null {
  const target = metrcName.trim();
  if (!target) return null;
  return strains.find((s) => s.name.trim() === target) ?? null;
}

function acronymBaseFromName(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "MS";
  if (words.length === 1) {
    const w = words[0]!.replace(/[^a-zA-Z0-9]/g, "");
    return (w.slice(0, 3) || "MS").toUpperCase();
  }
  return words
    .map((w) => w.replace(/[^a-zA-Z0-9]/g, "").charAt(0))
    .join("")
    .slice(0, 6)
    .toUpperCase();
}

export function deriveUniqueStrainAcronym(name: string, existing: Set<string>): string {
  const base = acronymBaseFromName(name);
  if (!existing.has(base)) return base;
  for (let i = 2; i < 100; i += 1) {
    const candidate = `${base}${i}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${base}${Date.now().toString(36).slice(-4).toUpperCase()}`;
}

export type ReconcileMetrcStrainsResult = {
  cultivation: Record<string, unknown>;
  links: Map<string, string>;
  nexbatchStrainsCreated: number;
  changed: boolean;
};

export function reconcileMetrcStrainsWithNexbatch(input: {
  cultivation: Record<string, unknown>;
  metrcStrains: { metrcStrainId: string; name: string }[];
}): ReconcileMetrcStrainsResult {
  const strains = [...parseNexbatchStrainsFromCultivationValue(input.cultivation)];
  const links = new Map<string, string>();
  const acronymSet = new Set(strains.map((s) => s.acronym.trim().toUpperCase()).filter(Boolean));
  let nexbatchStrainsCreated = 0;
  let changed = false;

  for (const metrc of input.metrcStrains) {
    const metrcName = metrc.name.trim();
    if (!metrcName) continue;

    const existing = findNexbatchStrainByExactName(strains, metrcName);
    if (existing) {
      links.set(metrc.metrcStrainId, existing.id);
      if (existing.metrcStrainId !== metrc.metrcStrainId) {
        existing.metrcStrainId = metrc.metrcStrainId;
        changed = true;
      }
      continue;
    }

    const acronym = deriveUniqueStrainAcronym(metrcName, acronymSet);
    acronymSet.add(acronym.toUpperCase());
    const id = `strain-metrc-${metrc.metrcStrainId}`;
    const created: NexbatchCultivationStrain = {
      id,
      name: metrcName,
      acronym,
      dominance: "",
      potency: "",
      averageYield: "",
      metrcStrainId: metrc.metrcStrainId,
      metrcLinked: true,
    };
    strains.push(created);
    links.set(metrc.metrcStrainId, id);
    nexbatchStrainsCreated += 1;
    changed = true;
  }

  if (!changed) {
    return { cultivation: input.cultivation, links, nexbatchStrainsCreated, changed: false };
  }

  return {
    cultivation: { ...input.cultivation, strains },
    links,
    nexbatchStrainsCreated,
    changed: true,
  };
}

export function findNexbatchStrainLabel(
  strains: NexbatchCultivationStrain[],
  nexbatchStrainId: string | null | undefined,
): string | null {
  const id = String(nexbatchStrainId ?? "").trim();
  if (!id) return null;
  const match = strains.find((s) => s.id === id);
  if (!match) return null;
  const acronym = match.acronym.trim();
  return acronym ? `${match.name} (${acronym})` : match.name;
}
