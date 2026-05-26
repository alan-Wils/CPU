import { beforeEach, describe, expect, it, vi } from "vitest";

const { listLocationsMock, configListMock } = vi.hoisted(() => ({
  listLocationsMock: vi.fn(),
  configListMock: vi.fn(),
}));

vi.mock("../repositories/metrcLocationRepository.js", () => ({
  listMetrcLocationsForCompany: listLocationsMock,
}));

vi.mock("./configService.js", () => ({
  ConfigService: class {
    list = configListMock;
  },
}));

import { MetrcLocationMappingService } from "./metrcLocationMappingService.js";

describe("MetrcLocationMappingService", () => {
  beforeEach(() => {
    listLocationsMock.mockReset();
    configListMock.mockReset();
    configListMock.mockResolvedValue([
      {
        key: "company",
        value: {
          cultivation: {
            rooms: {
              vegRooms: [{ id: "v1", name: "Veg A" }],
              flowerRooms: [{ id: "f1", name: "Flower Room 1" }],
            },
          },
        },
      },
    ]);
    listLocationsMock.mockResolvedValue([
      {
        metrcLocationId: "1",
        licenseNumber: "LIC",
        name: "Flower Room 1",
        locationTypeName: "Default",
        forPlants: true,
        forHarvests: false,
        forPackages: false,
        nexbatchRoomSuite: "flowerRooms",
        nexbatchRoomId: "f1",
        nexbatchMappingManual: true,
      },
    ]);
  });

  it("lists persisted location room mappings for downstream workflows", async () => {
    const svc = new MetrcLocationMappingService();
    const mappings = await svc.listLocationRoomMappings("c1");
    expect(mappings[0]?.metrcLocationId).toBe("1");
    expect(mappings[0]?.nexbatchRoomLabel).toContain("Flower Room 1");
    expect(mappings[0]?.mappingSource).toBe("manual");
  });
});
