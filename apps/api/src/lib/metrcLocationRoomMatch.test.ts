import { describe, expect, it } from "vitest";
import {
  normalizeRoomNameForMatch,
  scoreMetrcLocationRoomMatch,
  suggestNexbatchRoomForMetrcLocation,
} from "./metrcLocationRoomMatch.js";
import type { NexbatchRoomOption } from "./metrcNexbatchRooms.js";

const flower1: NexbatchRoomOption = { suite: "flowerRooms", roomId: "f1", name: "Flower Room 1" };
const vegA: NexbatchRoomOption = { suite: "vegRooms", roomId: "v1", name: "Veg A" };

describe("metrcLocationRoomMatch", () => {
  it("normalizes room names for fuzzy comparison", () => {
    expect(normalizeRoomNameForMatch("Flower Room 1")).toBe("flower 1");
    expect(normalizeRoomNameForMatch("Veg Room A")).toBe("veg a");
  });

  it("scores exact and normalized matches highly", () => {
    expect(scoreMetrcLocationRoomMatch("Flower Room 1", flower1)).toBeGreaterThanOrEqual(95);
    expect(scoreMetrcLocationRoomMatch("Veg Room A", vegA)).toBeGreaterThanOrEqual(85);
  });

  it("suggests the best room above threshold", () => {
    const match = suggestNexbatchRoomForMetrcLocation("Flower Room 1", [vegA, flower1]);
    expect(match?.roomId).toBe("f1");
  });
});
