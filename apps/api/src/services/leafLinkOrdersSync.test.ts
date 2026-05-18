import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../config/prisma.js", () => ({
  prisma: {
    integrationSyncState: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
    leafLinkStoredOrder: {
      count: vi.fn(),
      findMany: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
    },
    company: { findMany: vi.fn() },
  },
}));

vi.mock("./leaflinkService.js", () => ({
  LeafLinkService: vi.fn().mockImplementation(() => ({
    resolveRuntimeCredentials: vi.fn().mockResolvedValue({
      integrationEnabled: true,
      apiKey: "k",
      companyId: "co1",
      companySlug: "",
      baseUrl: "https://app.leaflink.com/api",
      source: "db",
    }),
  })),
  buildLeafLinkAuthCandidates: () => ["token"],
  buildLeafLinkHeaders: () => ({}),
  fetchJsonWithRetry: vi.fn(),
  leafLinkAuthMode: () => "Token",
  pickListSource: (body: unknown) => ({ list: Array.isArray((body as { results?: unknown[] })?.results) ? (body as { results: unknown[] }).results : [] }),
}));

import { prisma } from "../config/prisma.js";
import { fetchJsonWithRetry } from "./leaflinkService.js";
import {
  acquireLeafLinkOrdersSyncLock,
  releaseLeafLinkOrdersSyncLock,
} from "./leafLinkOrdersSyncStateService.js";
import { LeafLinkOrdersService } from "./leafLinkOrdersService.js";

describe("LeafLink orders sync safeguards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LEAFLINK_ORDER_SYNC_MAX_PAGES = "25";
    process.env.LEAFLINK_ORDER_SYNC_MAX_ROWS = "2500";
    process.env.LEAFLINK_ORDER_SYNC_LOOKBACK_DAYS = "90";
    process.env.LEAFLINK_ORDERS_FULL_SYNC_MAX_PAGES = "5000";
  });

  it("getOrdersAnalytics does not call LeafLink HTTP", async () => {
    vi.mocked(prisma.leafLinkStoredOrder.count).mockResolvedValue(0);
    vi.mocked(prisma.leafLinkStoredOrder.findMany).mockResolvedValue([]);

    const svc = new LeafLinkOrdersService();
    const out = await svc.getOrdersAnalytics("co1", {
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
    });

    expect(fetchJsonWithRetry).not.toHaveBeenCalled();
    expect(out.readFromDatabase).toBe(true);
    expect(out.leafLinkRefreshRan).toBe(false);
    expect(out.noCachedMessage).toContain("No cached LeafLink orders");
  });

  it("syncOrdersWarm respects incremental page cap", async () => {
    vi.mocked(prisma.integrationSyncState.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.integrationSyncState.upsert).mockResolvedValue({} as never);
    vi.mocked(prisma.integrationSyncState.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.leafLinkStoredOrder.findMany).mockResolvedValue([]);
    vi.mocked(prisma.leafLinkStoredOrder.createMany).mockResolvedValue({ count: 0 });

    const pageBody = (page: number) => ({
      results: [{ id: `o-${page}`, created_on: new Date().toISOString(), status: "submitted" }],
      next: page < 30 ? `https://example.com?page=${page + 1}` : null,
      count: 5000,
    });

    vi.mocked(fetchJsonWithRetry).mockImplementation(async (url: string) => {
      const m = url.match(/page=(\d+)/);
      const page = m ? Number(m[1]) : 1;
      return pageBody(page);
    });

    const svc = new LeafLinkOrdersService();
    const out = await svc.syncOrdersWarm("co1", "test");

    expect(out.mode).toBe("incremental");
    expect(out.pagesPulled).toBeLessThanOrEqual(25);
    expect(fetchJsonWithRetry).toHaveBeenCalled();
    expect(out.pagesPulled).toBe(25);
  });

  it("concurrent sync skips when lock is held", async () => {
    vi.mocked(prisma.integrationSyncState.findUnique).mockResolvedValue({
      id: "s1",
      companyId: "co1",
      provider: "leaflink",
      resource: "orders",
      lockStartedAt: new Date(),
      lockOwner: "other",
      lastSuccessAt: null,
      cursorJson: null,
      lastMode: null,
      lastPagesPulled: null,
      lastRowsPersisted: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const lock = await acquireLeafLinkOrdersSyncLock("co1", "second");
    expect(lock.acquired).toBe(false);
    if (!lock.acquired) {
      expect(lock.reason).toBe("sync_already_running");
    }
  });

  it("listOrders does not call LeafLink HTTP", async () => {
    vi.mocked(prisma.leafLinkStoredOrder.count).mockResolvedValue(1);
    vi.mocked(prisma.leafLinkStoredOrder.findMany).mockResolvedValue([
      {
        id: "r1",
        leafLinkKey: "k1",
        totalUsd: 10,
        payload: {
          id: "k1",
          number: "100",
          status: "submitted",
          created_on: "2026-01-15T12:00:00Z",
          customer: { name: "Buyer" },
        },
        createdOn: new Date("2026-01-15T12:00:00Z"),
        updatedAt: new Date(),
      },
    ] as never);

    const svc = new LeafLinkOrdersService();
    await svc.listOrders("co1", { page: 1, pageSize: 24, refresh: true });

    expect(fetchJsonWithRetry).not.toHaveBeenCalled();
  });
});

describe("releaseLeafLinkOrdersSyncLock", () => {
  it("clears lock fields", async () => {
    vi.mocked(prisma.integrationSyncState.updateMany).mockResolvedValue({ count: 1 });
    await releaseLeafLinkOrdersSyncLock("co1");
    expect(prisma.integrationSyncState.updateMany).toHaveBeenCalled();
  });
});
