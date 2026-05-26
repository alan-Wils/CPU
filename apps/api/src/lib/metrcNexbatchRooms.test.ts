import { describe, expect, it } from "vitest";
import { parseNexbatchRoomOptionsFromCompanyValue } from "./metrcNexbatchRooms.js";

describe("metrcNexbatchRooms", () => {
  it("parses veg, flower, and dry storage rooms from cultivation config", () => {
    const rooms = parseNexbatchRoomOptionsFromCompanyValue({
      cultivation: {
        rooms: {
          vegRooms: [{ id: "v1", name: "Veg A" }],
          flowerRooms: [{ id: "f1", name: "Flower Room 1" }],
        },
        storageLocations: {
          dryRooms: [{ id: "d1", name: "Dry Room 1" }],
        },
      },
    });
    expect(rooms.map((r) => r.suite)).toEqual(
      expect.arrayContaining(["vegRooms", "flowerRooms", "dryRooms"]),
    );
  });
});
