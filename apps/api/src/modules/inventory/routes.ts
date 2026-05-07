import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { getScopedCompanyId } from "../../middleware/companyScope.js";
import { requireRole, requireRoleOrAppPermission } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import { LeafLinkInventoryService, LeafLinkService } from "../../services/leaflinkService.js";

export const inventoryRouter = Router();
const leafLinkInventoryService = new LeafLinkInventoryService();
const leafLinkService = new LeafLinkService();

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

inventoryRouter.get(
  "/leaflink",
  requireRoleOrAppPermission(["OWNER", "ADMIN", "OPERATIONS_MANAGER"], "page.inventory"),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const out = await leafLinkInventoryService.fetchAvailableInventory(companyId);
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

inventoryRouter.use((_req, res) => {
  res.status(404).json({
    message: "Inventory API route not found",
    error: { code: "INVENTORY_ROUTE_NOT_FOUND" },
  });
});

