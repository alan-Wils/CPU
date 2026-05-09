import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { AppError } from "../errors/AppError.js";
import {
  parseUploadsPath,
  putUploadObject,
  removeStoredUpload,
  requirePersistentUploadsInProduction,
  uploadsUseS3,
  objectKeyFromParts,
} from "../lib/uploadStorage.js";
import { recordUsageEventSafe } from "./usageEventRecord.js";

function extForMime(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

/** Hard cap: most modern marketplaces (Shopify, etc.) sit around 6–10. We pick 8 so the carousel stays digestible. */
export const MARKETPLACE_PRODUCT_EXTRA_IMAGE_MAX = 8;

export class MarketplaceProductImageUploadService {
  async uploadProductImage(input: {
    companyId: string;
    productId: string;
    mimeType: string;
    dataBase64: string;
    origin: string;
  }): Promise<{ imageUrl: string; bytes: number }> {
    const companyId = String(input.companyId || "").trim();
    const productId = String(input.productId || "").trim();
    if (!companyId || !productId) throw new AppError("Company and product required", 400, "BAD_REQUEST");

    const product = await prisma.marketplaceProduct.findFirst({
      where: { id: productId, companyId },
      select: { id: true, imageUrl: true },
    });
    if (!product) throw new AppError("Product not found", 404, "PRODUCT_NOT_FOUND");

    const base64 = String(input.dataBase64 || "").replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(base64, "base64");
    if (!buffer.length) throw new AppError("Invalid image data", 400, "PRODUCT_IMAGE_INVALID");
    if (buffer.length > env.CHECK_UPLOAD_MAX_BYTES) {
      throw new AppError(`Image exceeds ${env.CHECK_UPLOAD_MAX_BYTES} byte limit`, 413, "PRODUCT_IMAGE_TOO_LARGE");
    }
    requirePersistentUploadsInProduction();

    const ext = extForMime(input.mimeType);
    const safeName = `${productId.slice(0, 8)}-${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
    const mime =
      input.mimeType === "image/png"
        ? "image/png"
        : input.mimeType === "image/webp"
          ? "image/webp"
          : "image/jpeg";

    let imageUrl: string;
    if (uploadsUseS3()) {
      const key = objectKeyFromParts("marketplace-products", companyId, safeName);
      await putUploadObject(key, buffer, mime);
      void recordUsageEventSafe({
        companyId,
        provider: "cloudflare_r2",
        feature: "marketplace_product_image_upload",
        unitType: "upload_bytes",
        units: buffer.length,
        estimatedCost: Math.max(0.0005, (buffer.length / (1024 * 1024)) * 0.02),
      });
      imageUrl = `${input.origin}/uploads/marketplace-products/${companyId}/${safeName}`;
    } else {
      const directory = path.join(process.cwd(), "uploads", "marketplace-products", companyId);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, safeName), buffer);
      imageUrl = `${input.origin}/uploads/marketplace-products/${companyId}/${safeName}`;
    }

    const prev = product.imageUrl;
    if (prev && /^https?:\/\//i.test(prev)) {
      try {
        const parsed = parseUploadsPath(new URL(prev).pathname);
        if (parsed?.kind === "marketplace-products" && parsed.companyId === companyId) {
          await removeStoredUpload(prev);
        }
      } catch {
        /* ignore invalid prev URL */
      }
    }

    await prisma.marketplaceProduct.update({
      where: { id: product.id },
      data: { imageUrl },
    });

    return { imageUrl, bytes: buffer.length };
  }

  /**
   * Append an additional gallery photo. The product's primary `imageUrl` is left untouched. New rows
   * receive `position = max(existing) + 1` so display order is stable. Cascade delete (Prisma) cleans
   * the rows when a product is deleted; storage cleanup happens explicitly via `deleteExtraImage`.
   */
  async uploadExtraImage(input: {
    companyId: string;
    productId: string;
    mimeType: string;
    dataBase64: string;
    origin: string;
  }): Promise<{
    image: { id: string; imageUrl: string; position: number };
    bytes: number;
    extraImages: { id: string; imageUrl: string; position: number }[];
  }> {
    const companyId = String(input.companyId || "").trim();
    const productId = String(input.productId || "").trim();
    if (!companyId || !productId) throw new AppError("Company and product required", 400, "BAD_REQUEST");

    const product = await prisma.marketplaceProduct.findFirst({
      where: { id: productId, companyId },
      select: { id: true },
    });
    if (!product) throw new AppError("Product not found", 404, "PRODUCT_NOT_FOUND");

    const existingCount = await prisma.marketplaceProductImage.count({ where: { productId: product.id } });
    if (existingCount >= MARKETPLACE_PRODUCT_EXTRA_IMAGE_MAX) {
      throw new AppError(
        `At most ${MARKETPLACE_PRODUCT_EXTRA_IMAGE_MAX} additional photos per product.`,
        400,
        "PRODUCT_EXTRA_IMAGE_LIMIT",
      );
    }

    const base64 = String(input.dataBase64 || "").replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(base64, "base64");
    if (!buffer.length) throw new AppError("Invalid image data", 400, "PRODUCT_IMAGE_INVALID");
    if (buffer.length > env.CHECK_UPLOAD_MAX_BYTES) {
      throw new AppError(`Image exceeds ${env.CHECK_UPLOAD_MAX_BYTES} byte limit`, 413, "PRODUCT_IMAGE_TOO_LARGE");
    }
    requirePersistentUploadsInProduction();

    const ext = extForMime(input.mimeType);
    const safeName = `${productId.slice(0, 8)}-extra-${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
    const mime =
      input.mimeType === "image/png"
        ? "image/png"
        : input.mimeType === "image/webp"
          ? "image/webp"
          : "image/jpeg";

    let imageUrl: string;
    if (uploadsUseS3()) {
      const key = objectKeyFromParts("marketplace-products", companyId, safeName);
      await putUploadObject(key, buffer, mime);
      void recordUsageEventSafe({
        companyId,
        provider: "cloudflare_r2",
        feature: "marketplace_product_image_upload",
        unitType: "upload_bytes",
        units: buffer.length,
        estimatedCost: Math.max(0.0005, (buffer.length / (1024 * 1024)) * 0.02),
      });
      imageUrl = `${input.origin}/uploads/marketplace-products/${companyId}/${safeName}`;
    } else {
      const directory = path.join(process.cwd(), "uploads", "marketplace-products", companyId);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, safeName), buffer);
      imageUrl = `${input.origin}/uploads/marketplace-products/${companyId}/${safeName}`;
    }

    const last = await prisma.marketplaceProductImage.findFirst({
      where: { productId: product.id },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const nextPosition = (last?.position ?? -1) + 1;

    const created = await prisma.marketplaceProductImage.create({
      data: {
        productId: product.id,
        imageUrl,
        position: nextPosition,
      },
      select: { id: true, imageUrl: true, position: true },
    });

    const extraImages = await prisma.marketplaceProductImage.findMany({
      where: { productId: product.id },
      orderBy: { position: "asc" },
      select: { id: true, imageUrl: true, position: true },
    });

    return { image: created, bytes: buffer.length, extraImages };
  }

  /**
   * Remove a single gallery photo. Does NOT renumber remaining `position` values; the unique
   * `(productId, position)` constraint keeps freed slots open for future inserts to fill.
   */
  async deleteExtraImage(input: {
    companyId: string;
    productId: string;
    imageId: string;
  }): Promise<{ extraImages: { id: string; imageUrl: string; position: number }[] }> {
    const companyId = String(input.companyId || "").trim();
    const productId = String(input.productId || "").trim();
    const imageId = String(input.imageId || "").trim();
    if (!companyId || !productId || !imageId) throw new AppError("Bad request", 400, "BAD_REQUEST");

    const product = await prisma.marketplaceProduct.findFirst({
      where: { id: productId, companyId },
      select: { id: true },
    });
    if (!product) throw new AppError("Product not found", 404, "PRODUCT_NOT_FOUND");

    const image = await prisma.marketplaceProductImage.findFirst({
      where: { id: imageId, productId: product.id },
      select: { id: true, imageUrl: true },
    });
    if (!image) throw new AppError("Image not found", 404, "PRODUCT_IMAGE_NOT_FOUND");

    if (image.imageUrl && /^https?:\/\//i.test(image.imageUrl)) {
      try {
        const parsed = parseUploadsPath(new URL(image.imageUrl).pathname);
        if (parsed?.kind === "marketplace-products" && parsed.companyId === companyId) {
          await removeStoredUpload(image.imageUrl);
        }
      } catch {
        /* ignore invalid URL during cleanup */
      }
    }

    await prisma.marketplaceProductImage.delete({ where: { id: image.id } });

    const extraImages = await prisma.marketplaceProductImage.findMany({
      where: { productId: product.id },
      orderBy: { position: "asc" },
      select: { id: true, imageUrl: true, position: true },
    });

    return { extraImages };
  }
}
