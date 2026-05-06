import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { AppError } from "../../errors/AppError.js";
import { getScopedCompanyId } from "../../middleware/companyScope.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { validate } from "../../middleware/validate.js";
import { requireRole } from "../../middleware/rbac.js";
import { extractHarvestSheetFromImageBuffer } from "../../services/harvestSheetExtractService.js";

export const harvestSheetRouter = Router();

const CULTIVATION_WRITE_ROLES = [
    "OWNER",
    "ADMIN",
    "OPERATIONS_MANAGER",
    "CULTIVATION_SPECIALIST",
] as const;

const harvestSheetUploadSchema = z.object({
    imageBase64: z.string().min(1),
    mimeType: z.string().min(3).max(80),
});

const harvestSheetExtractSchema = z
    .object({
        storedPath: z.string().min(4).optional(),
        storedPaths: z.array(z.string().min(4)).max(12).optional(),
        plantsHarvested: z.coerce.number().finite().positive().optional(),
    })
    .superRefine((val, ctx) => {
        const paths =
            val.storedPaths && val.storedPaths.length > 0
                ? val.storedPaths
                : val.storedPath
                  ? [val.storedPath]
                  : [];
        if (paths.length === 0) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "storedPath or storedPaths required",
                path: ["storedPath"],
            });
        }
    });

function uploadsRoot() {
    return path.join(process.cwd(), "uploads");
}

function safeCompanySegment(companyId: string) {
    const s = String(companyId || "").replace(/[^a-zA-Z0-9_-]/g, "");
    return s.length > 0 ? s : "unknown";
}

function extFromMime(mimeType: string) {
    const m = String(mimeType || "").toLowerCase();
    if (m === "image/png") return ".png";
    if (m === "image/webp") return ".webp";
    return ".jpg";
}

function resolveStoredHarvestSheetPath(companyId: string, storedPath: string): string | null {
    const seg = safeCompanySegment(companyId);
    const rel = String(storedPath || "").replace(/\\/g, "/").trim();
    if (!rel.startsWith(`harvest-sheets/${seg}/`)) {
        return null;
    }
    if (rel.includes("..")) {
        return null;
    }
    const root = uploadsRoot();
    const absolute = path.normalize(path.join(root, rel));
    const rootNorm = path.normalize(root + path.sep);
    if (!absolute.startsWith(rootNorm)) {
        return null;
    }
    return absolute;
}

harvestSheetRouter.post(
    "/upload",
    requireRole([...CULTIVATION_WRITE_ROLES]),
    validate({ body: harvestSheetUploadSchema }),
    asyncHandler(async (req, res) => {
        const companyId = getScopedCompanyId(req);
        let imageBase64 = req.body.imageBase64 as string;
        const mimeTypeRaw = String(req.body.mimeType || "image/jpeg").toLowerCase();

        const comma = imageBase64.indexOf(",");
        if (imageBase64.startsWith("data:") && comma > 0) {
            imageBase64 = imageBase64.slice(comma + 1);
        }

        let buffer: Buffer;
        try {
            buffer = Buffer.from(imageBase64, "base64");
        } catch {
            throw new AppError("Invalid base64 image", 400);
        }

        const maxBytes = 9 * 1024 * 1024;
        if (!buffer.length || buffer.length > maxBytes) {
            throw new AppError("Image too large or empty (max ~9MB decoded)", 400);
        }

        const allowed = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
        const mimeType = allowed.includes(mimeTypeRaw)
            ? mimeTypeRaw.replace("jpg", "jpeg")
            : "image/jpeg";

        const seg = safeCompanySegment(companyId);
        const id = crypto.randomBytes(16).toString("hex");
        const ext = extFromMime(mimeType);
        const relDir = path.join("harvest-sheets", seg);
        const dir = path.join(uploadsRoot(), relDir);
        fs.mkdirSync(dir, { recursive: true });

        const fileName = `${id}${ext}`;
        const absolute = path.join(dir, fileName);
        fs.writeFileSync(absolute, buffer);

        const storedPath = `${relDir.replace(/\\/g, "/")}/${fileName}`;

        res.status(201).json({
            imageUrl: `/uploads/${storedPath}`,
            storedPath,
            mimeType,
            bytes: buffer.length,
        });
    }),
);

harvestSheetRouter.post(
    "/extract",
    requireRole([...CULTIVATION_WRITE_ROLES]),
    validate({ body: harvestSheetExtractSchema }),
    asyncHandler(async (req, res) => {
        const companyId = getScopedCompanyId(req);
        const plantsHarvested = req.body.plantsHarvested as number | undefined;

        const paths: string[] =
            Array.isArray(req.body.storedPaths) && req.body.storedPaths.length > 0
                ? req.body.storedPaths.map((p: string) => String(p))
                : req.body.storedPath
                  ? [String(req.body.storedPath)]
                  : [];

        if (!env.OPENAI_API_KEY) {
            res.status(503).json({
                message: "OpenAI is not configured",
                error: "Set OPENAI_API_KEY on the API server to enable harvest sheet extraction.",
            });
            return;
        }

        const opts: { plantsHarvested?: number } = {};
        if (plantsHarvested != null && Number.isFinite(Number(plantsHarvested))) {
            opts.plantsHarvested = Number(plantsHarvested);
        }

        const allRows: Array<{ tag: string; weightValue: number | null; unitGuess: string }> = [];
        const warnings: string[] = [];
        let bundlesSum = 0;
        let bundlesHas = false;
        let totalGramsSum = 0;
        let totalGramsHas = false;
        const notesParts: string[] = [];

        for (let i = 0; i < paths.length; i++) {
            const sp = paths[i];
            const absolute = resolveStoredHarvestSheetPath(companyId, sp);
            if (!absolute || !fs.existsSync(absolute)) {
                throw new AppError(`Invalid or missing storedPath for this company (sheet ${i + 1})`, 400);
            }
            const buffer = fs.readFileSync(absolute);
            const ext = path.extname(absolute).toLowerCase();
            const mimeType =
                ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";

            const extracted = await extractHarvestSheetFromImageBuffer(buffer, mimeType, opts);
            allRows.push(...extracted.rows);
            if (extracted.bundles != null && Number.isFinite(extracted.bundles)) {
                bundlesSum += extracted.bundles;
                bundlesHas = true;
            }
            if (extracted.totalGrams != null && Number.isFinite(extracted.totalGrams)) {
                totalGramsSum += extracted.totalGrams;
                totalGramsHas = true;
            }
            if (extracted.notes) {
                notesParts.push(`Sheet ${i + 1}: ${extracted.notes}`);
            }
        }

        if (
            opts.plantsHarvested &&
            allRows.length > 0 &&
            Math.abs(allRows.length - opts.plantsHarvested) >
                Math.max(3, opts.plantsHarvested * 0.15)
        ) {
            warnings.push(
                `Extracted ${allRows.length} rows but harvest count was ${opts.plantsHarvested} — verify before saving.`,
            );
        }

        if (paths.length > 1) {
            warnings.push(`Merged extraction from ${paths.length} photos — confirm rows are complete and not duplicated.`);
        }

        res.json({
            rows: allRows,
            bundles: bundlesHas ? bundlesSum : null,
            totalGrams: totalGramsHas ? totalGramsSum : null,
            notes: notesParts.join(" | "),
            warnings,
            model: env.OPENAI_MODEL || "gpt-4o-mini",
        });
    }),
);
