export type CultivationStorageLocation = {
    id: string;
    name: string;
};

export type CultivationStorageLocationsConfig = {
    freezers: CultivationStorageLocation[];
    dryRooms: CultivationStorageLocation[];
};

export const DEFAULT_CULTIVATION_STORAGE_LOCATIONS: CultivationStorageLocationsConfig = {
    freezers: [{ id: "freezer-1", name: "Freezer 1" }],
    dryRooms: [{ id: "dry-room-1", name: "Dry Room 1" }],
};

function normalizeLocationList(raw: unknown, prefix: "freezer" | "dry-room"): CultivationStorageLocation[] {
    if (!Array.isArray(raw))
        return [];
    const out: CultivationStorageLocation[] = [];
    const seen = new Set<string>();
    raw.forEach((row, index) => {
        if (!row || typeof row !== "object")
            return;
        const r = row as Record<string, unknown>;
        const name = String(r.name ?? "").trim();
        if (!name)
            return;
        let id = String(r.id ?? "").trim();
        if (!id)
            id = `${prefix}-${index + 1}`;
        if (seen.has(id))
            return;
        seen.add(id);
        out.push({ id, name });
    });
    return out;
}

export function normalizeCultivationStorageLocationsConfig(
    raw: unknown,
): CultivationStorageLocationsConfig {
    const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const freezers = normalizeLocationList(o.freezers, "freezer");
    const dryRooms = normalizeLocationList(o.dryRooms, "dry-room");
    return {
        freezers: freezers.length > 0 ? freezers : [...DEFAULT_CULTIVATION_STORAGE_LOCATIONS.freezers],
        dryRooms: dryRooms.length > 0 ? dryRooms : [...DEFAULT_CULTIVATION_STORAGE_LOCATIONS.dryRooms],
    };
}

export function storageTypeForMaterialType(
    materialType: "FRESH_FROZEN" | "TRIM",
): "FREEZER" | "DRY_ROOM" {
    return materialType === "FRESH_FROZEN" ? "FREEZER" : "DRY_ROOM";
}
