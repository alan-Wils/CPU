export type NexbatchRoomSuite = "vegRooms" | "flowerRooms" | "dryRooms" | "freezers";

export type NexbatchRoomOption = {
  suite: NexbatchRoomSuite;
  roomId: string;
  name: string;
};

const CULTIVATION_ROOM_SUITES = ["vegRooms", "flowerRooms"] as const;
const STORAGE_ROOM_SUITES = ["dryRooms", "freezers"] as const;

const SUITE_SORT_ORDER: Record<NexbatchRoomSuite, number> = {
  flowerRooms: 0,
  vegRooms: 1,
  dryRooms: 2,
  freezers: 3,
};

function isNexbatchRoomSuite(value: string): value is NexbatchRoomSuite {
  return (
    value === "vegRooms" ||
    value === "flowerRooms" ||
    value === "dryRooms" ||
    value === "freezers"
  );
}

function appendRoomList(
  out: NexbatchRoomOption[],
  suite: NexbatchRoomSuite,
  list: unknown,
): void {
  if (!Array.isArray(list)) return;
  for (const item of list) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const roomId = String(row.id ?? row.roomId ?? "").trim();
    const name = String(row.name ?? row.label ?? "").trim();
    if (!roomId || !name) continue;
    out.push({ suite, roomId, name });
  }
}

/** Human label for dropdowns: `Flower Room 1 (Flower)`. */
export function nexbatchRoomTypeLabel(suite: NexbatchRoomSuite): string {
  switch (suite) {
    case "vegRooms":
      return "Veg";
    case "flowerRooms":
      return "Flower";
    case "dryRooms":
      return "Dry";
    case "freezers":
      return "Freezer";
    default:
      return suite;
  }
}

export function formatNexbatchRoomLabel(option: NexbatchRoomOption): string {
  return `${option.name} (${nexbatchRoomTypeLabel(option.suite)})`;
}

function sortNexbatchRoomOptions(options: NexbatchRoomOption[]): NexbatchRoomOption[] {
  return [...options].sort((a, b) => {
    const typeOrder = SUITE_SORT_ORDER[a.suite] - SUITE_SORT_ORDER[b.suite];
    if (typeOrder !== 0) return typeOrder;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

/**
 * Cultivation rooms live on the top-level `cultivation` CompanyConfig row.
 * `company.cultivation` is supported as a legacy fallback only.
 */
export function resolveCultivationConfigFromMerged(
  merged: Record<string, unknown>,
): Record<string, unknown> | null {
  const top = merged.cultivation;
  if (top && typeof top === "object" && !Array.isArray(top)) {
    return top as Record<string, unknown>;
  }
  const company = merged.company;
  if (company && typeof company === "object" && !Array.isArray(company)) {
    const nested = (company as Record<string, unknown>).cultivation;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      return nested as Record<string, unknown>;
    }
  }
  return null;
}

export function parseNexbatchRoomOptionsFromCultivationValue(
  cultivation: Record<string, unknown>,
): NexbatchRoomOption[] {
  const out: NexbatchRoomOption[] = [];

  const rooms = cultivation.rooms;
  if (rooms && typeof rooms === "object" && !Array.isArray(rooms)) {
    const r = rooms as Record<string, unknown>;
    for (const suite of CULTIVATION_ROOM_SUITES) {
      appendRoomList(out, suite, r[suite]);
    }
  }

  const storageLocations = cultivation.storageLocations;
  if (storageLocations && typeof storageLocations === "object" && !Array.isArray(storageLocations)) {
    const s = storageLocations as Record<string, unknown>;
    for (const suite of STORAGE_ROOM_SUITES) {
      appendRoomList(out, suite, s[suite]);
    }
  }

  return sortNexbatchRoomOptions(out);
}

export function parseNexbatchRoomOptionsFromMergedConfig(
  merged: Record<string, unknown>,
): NexbatchRoomOption[] {
  const cult = resolveCultivationConfigFromMerged(merged);
  if (!cult) return [];
  return parseNexbatchRoomOptionsFromCultivationValue(cult);
}

export function parseNexbatchRoomOptionsFromConfigRows(
  rows: Array<{ key: string; value: unknown }>,
): NexbatchRoomOption[] {
  const merged: Record<string, unknown> = {};
  for (const row of rows) {
    merged[row.key] = row.value;
  }
  return parseNexbatchRoomOptionsFromMergedConfig(merged);
}

/** @deprecated Prefer `parseNexbatchRoomOptionsFromConfigRows` — rooms are not stored on `company`. */
export function parseNexbatchRoomOptionsFromCompanyValue(
  companyValue: Record<string, unknown>,
): NexbatchRoomOption[] {
  const nested = companyValue.cultivation;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return parseNexbatchRoomOptionsFromCultivationValue(nested as Record<string, unknown>);
  }
  return [];
}

export function findNexbatchRoomOption(
  options: NexbatchRoomOption[],
  suite: string | null | undefined,
  roomId: string | null | undefined,
): NexbatchRoomOption | null {
  const s = String(suite ?? "").trim();
  const id = String(roomId ?? "").trim();
  if (!s || !id || !isNexbatchRoomSuite(s)) return null;
  return options.find((o) => o.suite === s && o.roomId === id) ?? null;
}

export function nexbatchRoomSelectValue(
  suite: string | null | undefined,
  roomId: string | null | undefined,
): string {
  const s = String(suite ?? "").trim();
  const id = String(roomId ?? "").trim();
  if (!s || !id || !isNexbatchRoomSuite(s)) return "";
  return `${s}:${id}`;
}

export function parseNexbatchRoomSelectValue(value: string): {
  suite: NexbatchRoomSuite | null;
  roomId: string | null;
} {
  if (!value) return { suite: null, roomId: null };
  const [suite, roomId] = value.split(":");
  if (!suite || !isNexbatchRoomSuite(suite)) return { suite: null, roomId: null };
  return { suite, roomId: roomId?.trim() || null };
}
