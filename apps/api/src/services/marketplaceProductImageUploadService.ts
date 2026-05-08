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
}
