import type { MarketplaceOrderStatus, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { AppError } from "../errors/AppError.js";
import { CompanyServiceSettingsService } from "./companyServiceSettingsService.js";

const settingsService = new CompanyServiceSettingsService();

export type CreateOrderLine = { productId: string; quantity: number };

export class MarketplaceOrderService {
  async createOrderFromBuyer(input: {
    buyerCompanyId: string;
    sellerCompanyId: string;
    lines: CreateOrderLine[];
    notes?: string | null;
    createdByUserId?: string | null;
  }) {
    const buyerCompanyId = String(input.buyerCompanyId || "").trim();
    const sellerCompanyId = String(input.sellerCompanyId || "").trim();
    if (!buyerCompanyId || !sellerCompanyId)
      throw new AppError("Buyer and seller companies are required.", 400, "ORDER_BAD_COMPANY");
    if (buyerCompanyId === sellerCompanyId) throw new AppError("Cannot order from your own company.", 400, "ORDER_SELF_BUY");
    const buyerSettings = await settingsService.getOrCreate(buyerCompanyId);
    if (!buyerSettings.salesBuyerEnabled) throw new AppError("Buyer marketplace is not enabled.", 403, "BUYER_DISABLED");
    const sellerSettings = await settingsService.getOrCreate(sellerCompanyId);
    if (!sellerSettings.salesSellerEnabled) throw new AppError("Seller is not available on the marketplace.", 400, "SELLER_DISABLED");
    if (!input.lines?.length) throw new AppError("Order must include at least one line.", 400, "ORDER_EMPTY");

    const created = await prisma.$transaction(async (tx) => {
      const snapshots: { product: Prisma.MarketplaceProductGetPayload<Record<string, never>>; quantity: number }[] = [];
      let sellerCheck: string | null = null;
      for (const line of input.lines) {
        const qty = Number(line.quantity);
        if (!Number.isFinite(qty) || qty <= 0)
          throw new AppError("Each line must have quantity greater than zero.", 400, "ORDER_BAD_QTY");
        const product = await tx.marketplaceProduct.findFirst({
          where: {
            id: line.productId,
            companyId: sellerCompanyId,
            availabilityStatus: "AVAILABLE",
          },
        });
        if (!product) throw new AppError("One or more products are not available.", 400, "PRODUCT_NOT_AVAILABLE");
        if (product.quantityAvailable < qty)
          throw new AppError(`Insufficient stock for ${product.name}.`, 400, "INSUFFICIENT_STOCK");
        if (sellerCheck === null) sellerCheck = product.companyId;
        else if (sellerCheck !== product.companyId)
          throw new AppError("All products must belong to the same seller.", 400, "ORDER_MIXED_SELLER");
        snapshots.push({ product, quantity: qty });
      }
      let subtotal = 0;
      const itemCreates: Prisma.MarketplaceOrderItemCreateWithoutOrderInput[] = [];
      for (const { product, quantity } of snapshots) {
        const lineTotal = product.price * quantity;
        subtotal += lineTotal;
        itemCreates.push({
          product: { connect: { id: product.id } },
          productNameSnapshot: product.name,
          skuSnapshot: product.sku,
          unitSizeSnapshot: product.unitSize,
          priceSnapshot: product.price,
          quantity,
          lineTotal,
          imageUrlSnapshot: product.imageUrl,
        });
        await tx.marketplaceProduct.update({
          where: { id: product.id },
          data: { quantityAvailable: { decrement: quantity } },
        });
      }
      return tx.marketplaceOrder.create({
        data: {
          buyerCompanyId,
          sellerCompanyId,
          status: "PENDING",
          subtotal,
          total: subtotal,
          notes: input.notes?.trim() || null,
          createdByUserId: input.createdByUserId || null,
          items: { create: itemCreates },
        },
      });
    });

    return prisma.marketplaceOrder.findUniqueOrThrow({
      where: { id: created.id },
      include: { items: true },
    });
  }

  async listBuyerOrders(buyerCompanyId: string) {
    return prisma.marketplaceOrder.findMany({
      where: { buyerCompanyId },
      include: {
        sellerCompany: { select: { id: true, name: true, slug: true } },
        items: true,
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  async listSellerOrders(
    sellerCompanyId: string,
    status: string | undefined,
  ) {
    const where: Prisma.MarketplaceOrderWhereInput = { sellerCompanyId };
    const st = String(status || "PENDING").trim().toUpperCase();
    if (st !== "ALL" && st !== "") {
      if (st === "PENDING" || st === "ACCEPTED" || st === "REJECTED" || st === "FULFILLED" || st === "CANCELLED") {
        where.status = st as MarketplaceOrderStatus;
      }
    }
    return prisma.marketplaceOrder.findMany({
      where,
      include: {
        buyerCompany: { select: { id: true, name: true, slug: true } },
        items: true,
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  async updateSellerOrderStatus(input: {
    sellerCompanyId: string;
    orderId: string;
    nextStatus: "ACCEPTED" | "REJECTED" | "FULFILLED" | "CANCELLED";
  }) {
    const order = await prisma.marketplaceOrder.findFirst({
      where: { id: input.orderId, sellerCompanyId: input.sellerCompanyId },
      include: { items: true },
    });
    if (!order) throw new AppError("Order not found", 404, "ORDER_NOT_FOUND");
    const next = input.nextStatus;
    if (order.status === "PENDING") {
      if (next === "FULFILLED")
        throw new AppError("Accept the order before marking fulfilled.", 400, "ORDER_ACCEPT_FIRST");
      if (next !== "ACCEPTED" && next !== "REJECTED" && next !== "CANCELLED")
        throw new AppError("Invalid status transition.", 400, "ORDER_BAD_STATUS");
    } else if (order.status === "ACCEPTED") {
      if (next !== "FULFILLED" && next !== "CANCELLED") throw new AppError("Invalid status transition.", 400, "ORDER_BAD_STATUS");
    } else {
      throw new AppError("This order can no longer be updated.", 409, "ORDER_LOCKED");
    }
    const shouldRestoreInventory = next === "REJECTED" || next === "CANCELLED";
    const updated = await prisma.$transaction(async (tx) => {
      if (shouldRestoreInventory) {
        for (const it of order.items) {
          if (it.productId) {
            await tx.marketplaceProduct.update({
              where: { id: it.productId },
              data: { quantityAvailable: { increment: it.quantity } },
            });
          }
        }
      }
      return tx.marketplaceOrder.update({
        where: { id: order.id },
        data: { status: next },
        include: { items: true, buyerCompany: { select: { id: true, name: true, slug: true } } },
      });
    });
    return updated;
  }
}
