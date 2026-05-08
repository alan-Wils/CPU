import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { getScopedCompanyId } from "../../middleware/companyScope.js";
import { requireRole, requireRoleOrAppPermission } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import { LeafLinkInventoryService, LeafLinkService } from "../../services/leaflinkService.js";
import { LeafLinkConnectionService } from "../../services/leafLinkConnectionService.js";

export const inventoryRouter = Router();
const leafLinkInventoryService = new LeafLinkInventoryService();
const leafLinkService = new LeafLinkService();
const leafLinkConnectionService = new LeafLinkConnectionService();

const leafLinkConfigWriteSchema = z.object({
  integrationEnabled: z.boolean(),
  companySlug: z.string().max(240).default(""),
  companyId: z.string().max(120).default(""),
  username: z.string().max(240).default(""),
  baseUrl: z.string().url().max(400).default("https://app.leaflink.com/api"),
  /** Write-only secret field. Empty means "keep existing". */
  apiKey: z.string().max(2048).optional(),
  clearApiKey: z.boolean().optional(),
});
const leafLinkInventoryQuerySchema = z.object({
  debug: z
    .preprocess((v) => String(v ?? "").trim().toLowerCase(), z.enum(["", "0", "1", "true", "false"]).optional())
    .optional(),
  refresh: z
    .preprocess((v) => String(v ?? "").trim().toLowerCase(), z.enum(["", "0", "1", "true", "false"]).optional())
    .optional(),
});

inventoryRouter.get(
  "/leaflink",
  requireRoleOrAppPermission(["OWNER", "ADMIN", "OPERATIONS_MANAGER"], "page.inventory"),
  validate({ query: leafLinkInventoryQuerySchema }),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const q = req.query as { debug?: string; refresh?: string };
    const debug = q?.debug === "1" || q?.debug === "true";
    const refresh = q?.refresh === "1" || q?.refresh === "true";
    const actorUserId = (req.auth as { userId?: string }).userId ?? "";
    const out = await leafLinkInventoryService.fetchAvailableInventory(companyId, {
      debug,
      refresh,
      actorUserId,
    });
    res.json(out);
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

inventoryRouter.use((_req, res) => {
  res.status(404).json({
    message: "Inventory API route not found",
    error: { code: "INVENTORY_ROUTE_NOT_FOUND" },
  });
});

