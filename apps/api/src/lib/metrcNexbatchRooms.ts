export type NexbatchRoomSuite = "vegRooms" | "flowerRooms" | "dryRooms" | "freezers";

export type NexbatchRoomOption = {
  suite: NexbatchRoomSuite;
  roomId: string;
  name: string;
};

const CULTIVATION_ROOM_SUITES = ["vegRooms", "flowerRooms"] as const;
const STORAGE_ROOM_SUITES = ["dryRooms", "freezers"] as const;

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
    const roomId = String(row.id ?? "").trim();
    const name = String(row.name ?? "").trim();
    if (!roomId || !name) continue;
    out.push({ suite, roomId, name });
  }
}

export function parseNexbatchRoomOptionsFromCompanyValue(
  companyValue: Record<string, unknown>,
): NexbatchRoomOption[] {
  const cultivation = companyValue.cultivation;
  if (!cultivation || typeof cultivation !== "object" || Array.isArray(cultivation)) {
    return [];
  }
  const cult = cultivation as Record<string, unknown>;
  const out: NexbatchRoomOption[] = [];

  const rooms = cult.rooms;
  if (rooms && typeof rooms === "object" && !Array.isArray(rooms)) {
    const r = rooms as Record<string, unknown>;
    for (const suite of CULTIVATION_ROOM_SUITES) {
      appendRoomList(out, suite, r[suite]);
    }
  }

  const storageLocations = cult.storageLocations;
  if (storageLocations && typeof storageLocations === "object" && !Array.isArray(storageLocations)) {
    const s = storageLocations as Record<string, unknown>;
    for (const suite of STORAGE_ROOM_SUITES) {
      appendRoomList(out, suite, s[suite]);
    }
  }

  return out;
}

export function formatNexbatchRoomLabel(option: NexbatchRoomOption): string {
  const prefix =
    option.suite === "vegRooms"
      ? "Veg"
      : option.suite === "flowerRooms"
        ? "Flower"
        : option.suite === "dryRooms"
          ? "Dry"
          : "Freezer";
  return `${prefix}: ${option.name}`;
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
