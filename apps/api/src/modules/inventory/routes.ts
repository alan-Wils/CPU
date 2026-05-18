import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { getScopedCompanyId } from "../../middleware/companyScope.js";
import { requireRole, requireRoleOrAppPermission } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import {
  leafLinkInventoryToUltraCompactResponse,
  LEAFLINK_INVENTORY_COMPACT_FIELD_COUNT,
} from "../../lib/leafLinkInventoryListDto.js";
import { logSlowRequestIfNeeded } from "../../lib/slowRequestLog.js";
import { invalidateLeafLinkInventoryResponseCache } from "../../lib/leaflinkCredentialsCache.js";
import { memoizedReadWithMeta, invalidateMemoPrefix } from "../../lib/requestMemoCache.js";
import {
  LeafLinkInventoryService,
  LeafLinkService,
  type LeafLinkInventoryResponse,
} from "../../services/leaflinkService.js";
import { LeafLinkConnectionService } from "../../services/leafLinkConnectionService.js";

export const inventoryRouter = Router();
const leafLinkInventoryService = new LeafLinkInventoryService();
const leafLinkService = new LeafLinkService();
const leafLinkConnectionService = new LeafLinkConnectionService();

const LEAFLINK_INVENTORY_LIST_TTL_MS = 120_000;

const leafLinkConfigWriteSchema = z.object({
  integrationEnabled: z.boolean(),
  companySlug: z.string().max(240).default(""),
  companyId: z.string().max(120).default(""),
  username: z.string().max(240).default(""),
  baseUrl: z.string().url().max(400).default("https://app.leaflink.com/api"),
  /** Write-only secret field. Empty means "keep existing". */
  apiKey: z.string().max(2048).optional(),
  clearApiKey: z.boolean().optional(),
  /** LeafLink `company-staff` id for `recorded_by` on check/cash payment posts. Omit to keep previous; null clears. */
  recordedByStaffId: z.union([z.number().int().positive(), z.null()]).optional(),
});
const leafLinkInventoryQuerySchema = z.object({
  debug: z
    .preprocess((v) => String(v ?? "").trim().toLowerCase(), z.enum(["", "0", "1", "true", "false"]).optional())
    .optional(),
  refresh: z
    .preprocess((v) => String(v ?? "").trim().toLowerCase(), z.enum(["", "0", "1", "true", "false"]).optional())
    .optional(),
  detail: z
    .preprocess((v) => String(v ?? "").trim().toLowerCase(), z.enum(["", "0", "1", "true", "false"]).optional())
    .optional(),
});

function leafLinkInventoryCacheKey(companyId: string): string {
  return `leaflink:inventory:full:${companyId}`;
}

async function loadLeafLinkInventoryCached(
  companyId: string,
  opts: { debug: boolean; refresh: boolean; actorUserId: string },
): Promise<{ full: LeafLinkInventoryResponse; cacheHit: boolean; inflightJoined: boolean }> {
  if (opts.refresh) {
    invalidateMemoPrefix(`leaflink:inventory:${companyId}:`);
    const full = await leafLinkInventoryService.fetchAvailableInventory(companyId, {
      debug: opts.debug,
      refresh: true,
      actorUserId: opts.actorUserId,
    });
    return { full, cacheHit: false, inflightJoined: false };
  }

  const key = leafLinkInventoryCacheKey(companyId);
  const { value: full, cacheHit, inflightJoined } = await memoizedReadWithMeta(
    key,
    LEAFLINK_INVENTORY_LIST_TTL_MS,
    () =>
      leafLinkInventoryService.fetchAvailableInventory(companyId, {
        debug: opts.debug,
        refresh: false,
        actorUserId: opts.actorUserId,
      }),
  );
  return { full, cacheHit, inflightJoined };
}

inventoryRouter.get(
  "/leaflink",
  requireRoleOrAppPermission(["OWNER", "ADMIN", "OPERATIONS_MANAGER"], "page.inventory"),
  validate({ query: leafLinkInventoryQuerySchema }),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const q = req.query as { debug?: string; refresh?: string; detail?: string };
    const debug = q?.debug === "1" || q?.debug === "true";
    const refresh = q?.refresh === "1" || q?.refresh === "true";
    const detail = q?.detail === "1" || q?.detail === "true";
    const actorUserId = (req.auth as { userId?: string }).userId ?? "";

    const { full, cacheHit, inflightJoined } = await loadLeafLinkInventoryCached(companyId, {
      debug,
      refresh,
      actorUserId,
    });

    const payload = detail ? full : leafLinkInventoryToUltraCompactResponse(full);
    const body = JSON.stringify(payload);
    const rowCount = detail
      ? Array.isArray((payload as { items?: unknown[] }).items)
        ? (payload as { items: unknown[] }).items.length
        : 0
      : Array.isArray((payload as { r?: unknown[] }).r)
        ? (payload as { r: unknown[] }).r.length
        : 0;

    logSlowRequestIfNeeded({
      label: "GET /api/inventory/leaflink",
      companyId,
      payloadBytes: Buffer.byteLength(body, "utf8"),
      rowCount,
      cacheHit,
      inflightJoined,
      extra: {
        detail,
        compactFieldCount: detail ? undefined : LEAFLINK_INVENTORY_COMPACT_FIELD_COUNT,
      },
    });

    res.setHeader("Cache-Control", refresh ? "private, no-store" : "private, max-age=60");
    res.type("json").send(body);
  }),
);

inventoryRouter.get(
  "/leaflink/config",
  requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER"]),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const out = await leafLinkService.getSafeConfig(companyId);
    res.json(out);
  }),
);

inventoryRouter.put(
  "/leaflink/config",
  requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER"]),
  validate({ body: leafLinkConfigWriteSchema }),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const body = req.body as z.infer<typeof leafLinkConfigWriteSchema>;
    const out = await leafLinkService.upsertConfig(companyId, req.auth.userId, body);
    invalidateLeafLinkInventoryResponseCache(companyId);
    res.json(out);
  }),
);

inventoryRouter.get(
  "/leaflink/test-connection",
  requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER"]),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const out = await leafLinkConnectionService.runTestConnection({
      companyId,
      actorUserId: req.auth.userId,
    });
    res.status(200).json(out);
  }),
);

inventoryRouter.get(
  "/leaflink/:productId",
  requireRoleOrAppPermission(["OWNER", "ADMIN", "OPERATIONS_MANAGER"], "page.inventory"),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const productId = String(req.params.productId || "").trim();
    if (!productId) {
      res.status(400).json({ message: "productId is required" });
      return;
    }

    const { full, cacheHit, inflightJoined } = await loadLeafLinkInventoryCached(companyId, {
      debug: false,
      refresh: false,
      actorUserId: (req.auth as { userId?: string }).userId ?? "",
    });

    let item = full.items.find((x) => x.id === productId) ?? null;
    if (!item) {
      item = await leafLinkInventoryService.findPersistedInventoryItem(companyId, productId);
    }
    if (!item) {
      res.status(404).json({ message: "Inventory product not found", error: { code: "LEAFLINK_PRODUCT_NOT_FOUND" } });
      return;
    }

    const body = JSON.stringify({ item });
    logSlowRequestIfNeeded({
      label: "GET /api/inventory/leaflink/:productId",
      companyId,
      payloadBytes: Buffer.byteLength(body, "utf8"),
      rowCount: 1,
      cacheHit,
      inflightJoined,
    });
    res.setHeader("Cache-Control", "private, max-age=120");
    res.type("json").send(body);
  }),
);

inventoryRouter.use((_req, res) => {
  res.status(404).json({
    message: "Inventory API route not found",
    error: { code: "INVENTORY_ROUTE_NOT_FOUND" },
  });
});
