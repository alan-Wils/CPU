import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { env } from "../config/env.js";
import { AppError } from "../errors/AppError.js";
import {
    objectKeyFromParts,
    putUploadObject,
    requirePersistentUploadsInProduction,
    uploadsUseS3,
} from "../lib/uploadStorage.js";
import { recordUsageEventSafe } from "./usageEventRecord.js";

function extForMime(mimeType: string): string {
    if (mimeType === "image/png") return "png";
    if (mimeType === "image/webp") return "webp";
    return "jpg";
}

export class CompanyLogoUploadService {
    async uploadLogo(input: {
        companyId: string;
        mimeType: string;
        dataBase64: string;
        origin: string;
    }): Promise<{ imageUrl: string; bytes: number }> {
        const base64 = String(input.dataBase64 || "").replace(/^data:[^;]+;base64,/, "");
        const buffer = Buffer.from(base64, "base64");
        if (!buffer.length) {
            throw new AppError("Invalid image data", 400, "COMPANY_LOGO_INVALID");
        }
        if (buffer.length > env.CHECK_UPLOAD_MAX_BYTES) {
            throw new AppError(`Image exceeds ${env.CHECK_UPLOAD_MAX_BYTES} byte limit`, 413, "COMPANY_LOGO_TOO_LARGE");
        }
        requirePersistentUploadsInProduction();
        const ext = extForMime(input.mimeType);
        const safeName = `${Date.now()}-${randomUUID().slice(0, 12)}.${ext}`;
        if (uploadsUseS3()) {
            const key = objectKeyFromParts("company-logos", input.companyId, safeName);
            const mime =
                input.mimeType === "image/png"
                    ? "image/png"
                    : input.mimeType === "image/webp"
                      ? "image/webp"
                      : "image/jpeg";
            await putUploadObject(key, buffer, mime);
            void recordUsageEventSafe({
                companyId: input.companyId,
                provider: "cloudflare_r2",
                feature: "company_logo_upload",
                unitType: "upload_bytes",
                units: buffer.length,
                estimatedCost: Math.max(0.0005, (buffer.length / (1024 * 1024)) * 0.02),
            });
            return {
                imageUrl: `${input.origin}/uploads/company-logos/${input.companyId}/${safeName}`,
                bytes: buffer.length,
            };
        }
        const directory = path.join(process.cwd(), "uploads", "company-logos", input.companyId);
        await mkdir(directory, { recursive: true });
        await writeFile(path.join(directory, safeName), buffer);
        return {
            imageUrl: `${input.origin}/uploads/company-logos/${input.companyId}/${safeName}`,
            bytes: buffer.length,
        };
    }
}
