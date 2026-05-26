export type NexbatchRoomSuite = "vegRooms" | "flowerRooms";

export type NexbatchRoomOption = {
  suite: NexbatchRoomSuite;
  roomId: string;
  name: string;
};

export function parseNexbatchRoomOptionsFromCompanyValue(
  companyValue: Record<string, unknown>,
): NexbatchRoomOption[] {
  const cultivation = companyValue.cultivation;
  if (!cultivation || typeof cultivation !== "object" || Array.isArray(cultivation)) {
    return [];
  }
  const rooms = (cultivation as Record<string, unknown>).rooms;
  if (!rooms || typeof rooms !== "object" || Array.isArray(rooms)) {
    return [];
  }
  const r = rooms as Record<string, unknown>;
  const out: NexbatchRoomOption[] = [];
  for (const suite of ["vegRooms", "flowerRooms"] as const) {
    const list = r[suite];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const row = item as Record<string, unknown>;
      const roomId = String(row.id ?? "").trim();
      const name = String(row.name ?? "").trim();
      if (!roomId || !name) continue;
      out.push({ suite, roomId, name });
    }
  }
  return out;
}

export function formatNexbatchRoomLabel(option: NexbatchRoomOption): string {
  const prefix = option.suite === "vegRooms" ? "Veg" : "Flower";
  return `${prefix}: ${option.name}`;
}

export function findNexbatchRoomOption(
  options: NexbatchRoomOption[],
  suite: string | null | undefined,
  roomId: string | null | undefined,
): NexbatchRoomOption | null {
  const s = String(suite ?? "").trim();
  const id = String(roomId ?? "").trim();
  if (!s || !id) return null;
  return options.find((o) => o.suite === s && o.roomId === id) ?? null;
}
