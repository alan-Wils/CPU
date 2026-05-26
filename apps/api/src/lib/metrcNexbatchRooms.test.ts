import { describe, expect, it } from "vitest";
import {
  formatNexbatchRoomLabel,
  parseNexbatchRoomOptionsFromCompanyValue,
  parseNexbatchRoomOptionsFromConfigRows,
  parseNexbatchRoomOptionsFromMergedConfig,
} from "./metrcNexbatchRooms.js";

describe("metrcNexbatchRooms", () => {
  const cultivationPayload = {
    rooms: {
      vegRooms: [{ id: "v1", name: "Veg A" }],
      flowerRooms: [{ id: "f1", name: "Flower Room 1" }],
    },
    storageLocations: {
      dryRooms: [{ id: "d1", name: "Dry Room 1" }],
      freezers: [{ id: "z1", name: "Freezer 1" }],
    },
  };

  it("parses veg, flower, dry, and freezer rooms from top-level cultivation config", () => {
    const rooms = parseNexbatchRoomOptionsFromConfigRows([
      { key: "company", value: { settings: {} } },
      { key: "cultivation", value: cultivationPayload },
    ]);
    expect(rooms.map((r) => r.suite)).toEqual(
      expect.arrayContaining(["vegRooms", "flowerRooms", "dryRooms", "freezers"]),
    );
    expect(rooms).toHaveLength(4);
  });

  it("parses from merged config object", () => {
    const rooms = parseNexbatchRoomOptionsFromMergedConfig({
      cultivation: cultivationPayload,
    });
    expect(rooms.find((r) => r.name === "Flower Room 1")?.roomId).toBe("f1");
  });

  it("falls back to company.cultivation when top-level key is absent", () => {
    const rooms = parseNexbatchRoomOptionsFromCompanyValue({
      cultivation: cultivationPayload,
    });
    expect(rooms).toHaveLength(4);
  });

  it("formats labels as Room Name (Type)", () => {
    expect(
      formatNexbatchRoomLabel({
        suite: "flowerRooms",
        roomId: "f1",
        name: "Flower Room 1",
      }),
    ).toBe("Flower Room 1 (Flower)");
  });

  it("accepts roomId alias on room rows", () => {
    const rooms = parseNexbatchRoomOptionsFromMergedConfig({
      cultivation: {
        rooms: {
          vegRooms: [{ roomId: "v2", name: "Veg B" }],
          flowerRooms: [],
        },
      },
    });
    expect(rooms.find((r) => r.name === "Veg B")?.roomId).toBe("v2");
  });
});
