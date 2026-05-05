import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { requireRoleOrAppPermission } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import { suggestExtractionProductNames } from "../../services/extractionNameSuggestService.js";
import { AppError } from "../../errors/AppError.js";

const extractionWriteRoles = [
    "EXTRACTION",
    "EXTRACTION_SPECIALIST",
    "MANAGER",
    "OPERATIONS_MANAGER",
    "ADMIN",
    "OWNER",
];

const strainString = z
    .string()
    .trim()
    .min(1, "strain cannot be empty")
    .max(120, "strain too long");

const suggestBodySchema = z.object({
    strains: z.array(strainString).min(1, "at least one strain required").max(20, "too many strains"),
});

export const extractionAssistRouter = Router();

extractionAssistRouter.post(
    "/suggest-product-names",
    requireRoleOrAppPermission(extractionWriteRoles, "page.extraction"),
    validate({ body: suggestBodySchema }),
    asyncHandler(async (req, res) => {
        const strains = req.body.strains as string[];
        try {
            const suggestions = await suggestExtractionProductNames(strains);
            res.json({ suggestions });
        }
        catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            if (msg.includes("OPENAI_API_KEY")) {
                throw new AppError("AI name suggestions are not configured (missing OPENAI_API_KEY).", 503, "OPENAI_NOT_CONFIGURED");
            }
            if (msg.includes("Prompt template missing")) {
                throw new AppError("Server prompt template is missing.", 500, "PROMPT_MISSING");
            }
            throw new AppError(msg || "Could not generate suggestions", 502, "OPENAI_UPSTREAM");
        }
    }),
);
