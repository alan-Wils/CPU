import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../errors/AppError.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { getScopedCompanyId } from "../../middleware/companyScope.js";
import { requireRoleOrAppPermission } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import { LeafLinkOrdersService } from "../../services/leafLinkOrdersService.js";

export const ordersRouter = Router();

const ordersService = new LeafLinkOrdersService();

const elevatedRoles = ["OWNER", "ADMIN", "OPERATIONS_MANAGER"] as const;
const ordersPermissionGuard = requireRoleOrAppPermission(
  [...elevatedRoles],
  "page.orders",
);

const refreshQuery = z
  .preprocess((v) => String(v ?? "").trim().toLowerCase(), z.enum(["", "0", "1", "true", "false"]).optional())
  .optional();

const ordersListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(500).optional(),
  status: z.string().max(80).optional(),
  ordering: z.string().max(120).optional(),
  /** UX alias; maps to LeafLink ordering on `created_on`. */
  sort: z.enum(["newest", "oldest"]).optional(),
  search: z.string().max(200).optional(),
  refresh: refreshQuery,
});

const orderIdParamsSchema = z.object({
  orderId: z.string().min(1).max(200),
});

function resolveOrdering(q: z.infer<typeof ordersListQuerySchema>): string | undefined {
  const raw = typeof q.ordering === "string" ? q.ordering.trim() : "";
  if (raw) return raw;
  if (q.sort === "oldest") return "created_on";
  if (q.sort === "newest") return "-created_on";
  return undefined;
}

ordersRouter.get(
  "/",
  ordersPermissionGuard,
  validate({ query: ordersListQuerySchema }),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const q = req.query as z.infer<typeof ordersListQuerySchema>;
    const refresh = q?.refresh === "1" || q?.refresh === "true";
    const page = typeof q.page === "number" && Number.isFinite(q.page) ? q.page : 1;
    const pageSize =
      typeof q.page_size === "number" && Number.isFinite(q.page_size)
        ? q.page_size
        : 24;
    const out = await ordersService.listOrders(companyId, {
      page,
      pageSize,
      status: typeof q.status === "string" ? q.status : undefined,
      ordering: resolveOrdering(q),
      refresh,
      search: typeof q.search === "string" ? q.search : undefined,
    });
    res.json(out);
  }),
);

ordersRouter.post("/sync", ordersPermissionGuard, asyncHandler(async (req, res) => {
  const companyId = getScopedCompanyId(req);
  const out = await ordersService.syncOrdersWarm(companyId);
  res.json(out);
}));

const analyticsQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

ordersRouter.get(
  "/analytics",
  ordersPermissionGuard,
  validate({ query: analyticsQuerySchema }),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const q = req.query as z.infer<typeof analyticsQuerySchema>;
    const out = await ordersService.getOrdersAnalytics(companyId, {
      dateFrom: q.from,
      dateTo: q.to,
    });
    res.json(out);
  }),
);

ordersRouter.get(
  "/:orderId",
  ordersPermissionGuard,
  validate({ params: orderIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const { orderId } = req.params as z.infer<typeof orderIdParamsSchema>;
    const detail = await ordersService.getOrder(companyId, orderId);
    if (!detail)
      throw new AppError("Order not found.", 404, "ORDERS_NOT_FOUND");
    res.json({ order: detail });
  }),
);
