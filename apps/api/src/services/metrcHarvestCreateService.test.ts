import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../config/prisma.js", () => ({
  prisma: {
    metrcPlantBatch: { findFirst: vi.fn(), findMany: vi.fn() },
    metrcPlant: { findMany: vi.fn() },
  },
}));

vi.mock("../lib/metrcConfigLoader.js", () => ({
  loadCompanyMetrcConfig: vi.fn(),
}));

vi.mock("../repositories/metrcHarvestRepository.js", () => ({
  findMetrcHarvestByName: vi.fn(),
  upsertMetrcHarvestsForCompany: vi.fn(),
  appendMetrcHarvestRequestLog: vi.fn(),
}));

vi.mock("../repositories/metrcPlantRepository.js", () => ({
  listMetrcPlantsForPlantBatch: vi.fn(),
}));

vi.mock("./metrcHarvestsSyncService.js", () => ({
  MetrcHarvestsSyncService: class {
    syncMetrcHarvests = vi.fn();
  },
}));

vi.mock("./metrcPlantsSyncService.js", () => ({
  MetrcPlantsSyncService: class {
    syncMetrcPlants = vi.fn();
  },
}));

vi.mock("./metrcPlantBatchGrowthPhaseService.js", () => ({
  MetrcPlantBatchGrowthPhaseService: class {
    promotePlantBatchToTaggedPlants = vi.fn();
  },
}));

import { prisma } from "../config/prisma.js";
import { loadCompanyMetrcConfig } from "../lib/metrcConfigLoader.js";
import { findMetrcHarvestByName } from "../repositories/metrcHarvestRepository.js";
import { MetrcHarvestCreateService } from "./metrcHarvestCreateService.js";

describe("MetrcHarvestCreateService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findMetrcHarvestByName).mockResolvedValue(null);
    vi.mocked(loadCompanyMetrcConfig).mockResolvedValue({
      environment: "sandbox",
      userApiKey: "user",
      vendorApiKey: "vendor",
      licenseNumber: "LIC-1",
      stateCode: "CO",
      company: {},
      metrc: {},
    } as never);
  });

  it("rejects plant batch name used as plant label", async () => {
    vi.mocked(prisma.metrcPlantBatch.findMany).mockResolvedValue([
      { name: "BLDR.05.26.26" },
    ] as never);
    vi.mocked(prisma.metrcPlant.findMany).mockResolvedValue([] as never);

    const svc = new MetrcHarvestCreateService();
    const result = await svc.createTestHarvest({
      companyId: "co1",
      actorUserId: "u1",
      metrcPlantLabels: ["BLDR.05.26.26"],
      harvestName: "Test Harvest",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.message).toContain("plant batch name");
      expect(result.sourceType).toBe("plantBatch");
    }
  });
});
