import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../repositories/storeRepository.js", () => ({
  StoreRepository: vi.fn().mockImplementation(() => ({
    getCompanyStore: vi.fn(),
    upsertCompanyStore: vi.fn(),
    getAnalyticsStoreSliceArrays: vi.fn(),
  })),
}));

vi.mock("./auditService.js", () => ({
  AuditService: vi.fn().mockImplementation(() => ({
    logAction: vi.fn(),
  })),
}));

import { StoreRepository } from "../repositories/storeRepository.js";
import { StoreService } from "./storeService.js";

describe("StoreService.load", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("omits logs from default GET payload", async () => {
    const bigLogs = Array.from({ length: 50 }, (_, i) => ({ id: `log-${i}`, task: "x" }));
    vi.mocked(StoreRepository).mockImplementation(
      () =>
        ({
          getCompanyStore: vi.fn().mockResolvedValue({
            valueJson: JSON.stringify({
              cultivationBatches: [{ id: "c1" }],
              logs: bigLogs,
            }),
            updatedAt: new Date(),
          }),
        }) as never,
    );

    const svc = new StoreService();
    const out = await svc.load("co1");
    expect(out.logs).toEqual([]);
    expect((out._meta as { logsOmitted?: boolean }).logsOmitted).toBe(true);
    expect(out.cultivationBatches).toHaveLength(1);
  });

  it("includes logs when includeLogs is true", async () => {
    vi.mocked(StoreRepository).mockImplementation(
      () =>
        ({
          getCompanyStore: vi.fn().mockResolvedValue({
            valueJson: JSON.stringify({ logs: [{ id: "l1" }] }),
            updatedAt: new Date(),
          }),
        }) as never,
    );

    const svc = new StoreService();
    const out = await svc.load("co1", { includeLogs: true });
    expect(out.logs).toHaveLength(1);
  });
});
