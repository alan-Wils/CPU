import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { getScopedCompanyId } from "../../middleware/companyScope.js";
import { requireCompanyService } from "../../middleware/companyServiceAccess.js";
import { requireRoleOrAppPermission } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import {
  checkUploadSchema,
  marketplaceOrderCreateSchema,
  marketplaceSellerOrderStatusSchema,
  marketplaceSellerProductCreateSchema,
  marketplaceSellerProductPatchSchema,
} from "../../validation/schemas.js";
import { requestPublicOrigin } from "../../lib/requestPublicOrigin.js";
import { MarketplaceProductService } from "../../services/marketplaceProductService.js";
import { MarketplaceProductImageUploadService } from "../../services/marketplaceProductImageUploadService.js";
import { MarketplaceOrderService } from "../../services/marketplaceOrderService.js";
import { syncLeafLinkInventoryToMarketplaceProducts } from "../../services/marketplaceLeafLinkSyncService.js";
import { CompanyServiceSettingsService } from "../../services/companyServiceSettingsService.js";
import { buildSellerDashboard } from "../../services/sellerDashboardService.js";

export const salesRouter = Router();
const productService = new MarketplaceProductService();
const orderService = new MarketplaceOrderService();
const settingsService = new CompanyServiceSettingsService();
const productImageUploadService = new MarketplaceProductImageUploadService();

const productIdParam = z.object({ productId: z.string().cuid() });
const orderIdParam = z.object({ orderId: z.string().cuid() });

const marketplaceCatalogQuerySchema = z.object({
  search: z.string().max(400).optional(),
  companyId: z.string().cuid().optional(),
  category: z.string().max(240).optional(),
  productType: z.string().max(240).optional(),
  minPrice: z.coerce.number().optional(),
  maxPrice: z.coerce.number().optional(),
});

const sellerProductsQuerySchema = z.object({
  search: z.string().max(400).optional(),
  availabilityStatus: z.enum(["AVAILABLE", "INTERNAL", "NOT_AVAILABLE"]).optional(),
});

const sellerOrdersQuerySchema = z.object({
  status: z.string().max(32).optional(),
});

const sellerDashboardQuerySchema = z.object({
  from: z.string().max(80).optional(),
  to: z.string().max(80).optional(),
});

function parseOptionalIsoDate(s: string | undefined): Date | undefined {
  if (!s || !String(s).trim()) return undefined;
  const d = new Date(String(s));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function sellerProductHandlers() {
  return [
    requireCompanyService("salesSellerEnabled"),
    requireRoleOrAppPermission(["OWNER", "ADMIN", "OPERATIONS_MANAGER"], "page.sales-seller"),
  ];
}

function buyerMarketplaceHandlers() {
  return [
    requireCompanyService("salesBuyerEnabled"),
    requireRoleOrAppPermission(["OWNER", "ADMIN", "OPERATIONS_MANAGER"], "page.sales-marketplace"),
  ];
}

salesRouter.get(
  "/seller/dashboard",
  ...sellerProductHandlers(),
  validate({ query: sellerDashboardQuerySchema }),
  asyncHandler(async (req, res) => {
    const sellerCompanyId = getScopedCompanyId(req);
    const settings = await settingsService.getRaw(sellerCompanyId);
    const q = req.query as { from?: string; to?: string };
    const from = parseOptionalIsoDate(q.from);
    const to = parseOptionalIsoDate(q.to);
    const dash = await buildSellerDashboard({
      sellerCompanyId,
      from,
      to,
      leafLinkInventorySyncEnabled: settings.leafLinkInventorySyncEnabled,
    });
    res.json(dash);
  }),
);

salesRouter.get(
  "/seller/products",
  ...sellerProductHandlers(),
  validate({ query: sellerProductsQuerySchema }),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const q = req.query as { search?: string; availabilityStatus?: string };
    const products = await productService.listForSeller(companyId, q);
    res.json({ products });
  }),
);

salesRouter.post(
  "/seller/products",
  ...sellerProductHandlers(),
  validate({ body: marketplaceSellerProductCreateSchema }),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const body = req.body as z.infer<typeof marketplaceSellerProductCreateSchema>;
    const created = await productService.createManual(companyId, body);
    const withLogo = await productService.getSellerProductWithLogo(companyId, created.id);
    res.status(201).json({ product: withLogo ?? created });
  }),
);

salesRouter.post(
  "/seller/products/:productId/image",
  ...sellerProductHandlers(),
  validate({ params: productIdParam, body: checkUploadSchema }),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const { productId } = req.params;
    const origin = requestPublicOrigin(req);
    const body = req.body as z.infer<typeof checkUploadSchema>;
    const uploaded = await productImageUploadService.uploadProductImage({
      companyId,
      productId,
      mimeType: body.mimeType,
      dataBase64: body.dataBase64,
      origin,
    });
    const product = await productService.getSellerProductWithLogo(companyId, productId);
    res.status(201).json({ ...uploaded, product });
  }),
);

salesRouter.patch(
  "/seller/products/:productId",
  ...sellerProductHandlers(),
  validate({ params: productIdParam, body: marketplaceSellerProductPatchSchema }),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const { productId } = req.params;
    const updated = await productService.updateSellerProduct(companyId, productId, req.body);
    const withLogo = await productService.getSellerProductWithLogo(companyId, updated.id);
    res.json({ product: withLogo ?? updated });
  }),
);

salesRouter.delete(
  "/seller/products/:productId",
  ...sellerProductHandlers(),
  validate({ params: productIdParam }),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const { productId } = req.params;
    await productService.deleteSellerProduct(companyId, productId);
    res.json({ ok: true });
  }),
);

salesRouter.post(
  "/seller/leaflink/sync-inventory",
  ...sellerProductHandlers(),
  asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const s = await settingsService.getRaw(companyId);
    if (!s.leafLinkInventorySyncEnabled) {
      res.status(403).json({ message: "LeafLink inventory sync is not enabled.", code: "LEAFLINK_SYNC_DISABLED" });
      return;
    }
    const out = await syncLeafLinkInventoryToMarketplaceProducts(companyId, req.auth?.userId);
    res.json(out);
  }),
);

salesRouter.get(
  "/marketplace/products",
  ...buyerMarketplaceHandlers(),
  validate({ query: marketplaceCatalogQuerySchema }),
  asyncHandler(async (req, res) => {
    const buyerCompanyId = getScopedCompanyId(req);
    const q = req.query as z.infer<typeof marketplaceCatalogQuerySchema>;
    const products = await productService.listMarketplaceCatalog({
      buyerCompanyId,
      search: q.search,
      companyId: q.companyId,
      category: q.category,
      productType: q.productType,
      minPrice: q.minPrice,
      maxPrice: q.maxPrice,
    });
    res.json({ products });
  }),
);

salesRouter.get(
  "/marketplace/sellers",
  ...buyerMarketplaceHandlers(),
  asyncHandler(async (req, res) => {
    const buyerCompanyId = getScopedCompanyId(req);
    const sellers = await productService.listMarketplaceSellers(buyerCompanyId);
    res.json({ sellers });
  }),
);

salesRouter.post(
  "/orders",
  ...buyerMarketplaceHandlers(),
  validate({ body: marketplaceOrderCreateSchema }),
  asyncHandler(async (req, res) => {
    const buyerCompanyId = getScopedCompanyId(req);
    const body = req.body as z.infer<typeof marketplaceOrderCreateSchema>;
    const order = await orderService.createOrderFromBuyer({
      buyerCompanyId,
      sellerCompanyId: body.sellerCompanyId,
      lines: body.lines,
      notes: body.notes,
      createdByUserId: req.auth?.userId,
    });
    res.status(201).json({ order });
  }),
);

salesRouter.get(
  "/buyer/orders",
  ...buyerMarketplaceHandlers(),
  asyncHandler(async (req, res) => {
    const buyerCompanyId = getScopedCompanyId(req);
    const orders = await orderService.listBuyerOrders(buyerCompanyId);
    res.json({ orders });
  }),
);

salesRouter.get(
  "/buyer/orders/:orderId/invoice",
  ...buyerMarketplaceHandlers(),
  validate({ params: orderIdParam }),
  asyncHandler(async (req, res) => {
    const buyerCompanyId = getScopedCompanyId(req);
    const { orderId } = req.params;
    const invoice = await orderService.getMarketplaceOrderInvoice({
      orderId,
      participantCompanyId: buyerCompanyId,
    });
    res.json(invoice);
  }),
);

salesRouter.get(
  "/seller/orders",
  ...sellerProductHandlers(),
  validate({ query: sellerOrdersQuerySchema }),
  asyncHandler(async (req, res) => {
    const sellerCompanyId = getScopedCompanyId(req);
    const status = typeof req.query.status === "string" ? req.query.status : "PENDING";
    const orders = await orderService.listSellerOrders(sellerCompanyId, status);
    res.json({ orders });
  }),
);

salesRouter.get(
  "/seller/orders/:orderId/invoice",
  ...sellerProductHandlers(),
  validate({ params: orderIdParam }),
  asyncHandler(async (req, res) => {
    const sellerCompanyId = getScopedCompanyId(req);
    const { orderId } = req.params;
    const invoice = await orderService.getMarketplaceOrderInvoice({
      orderId,
      participantCompanyId: sellerCompanyId,
    });
    res.json(invoice);
  }),
);

salesRouter.patch(
  "/seller/orders/:orderId/status",
  ...sellerProductHandlers(),
  validate({ params: orderIdParam, body: marketplaceSellerOrderStatusSchema }),
  asyncHandler(async (req, res) => {
    const sellerCompanyId = getScopedCompanyId(req);
    const { orderId } = req.params;
    const body = req.body as z.infer<typeof marketplaceSellerOrderStatusSchema>;
    const order = await orderService.updateSellerOrderStatus({
      sellerCompanyId,
      orderId,
      nextStatus: body.status,
    });
    res.json({ order });
  }),
);
