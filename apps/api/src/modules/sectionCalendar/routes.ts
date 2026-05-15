import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { getScopedCompanyId } from "../../middleware/companyScope.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { validate } from "../../middleware/validate.js";
import { AppError } from "../../errors/AppError.js";
import {
    canReadSectionCalendar,
    canWriteSectionCalendar,
    monthYmdBounds,
    parseSectionCalendarSection,
    type SectionCalendarSection,
} from "./sectionCalendarAccess.js";
import { syncCultivationSectionCalendarFromTemplates } from "../../services/sectionCalendarCultivationTemplateSyncService.js";

export const sectionCalendarRouter = Router();

const sectionEnum = z.enum(["cultivation", "extraction", "packaging", "edibles"]);

const listQuerySchema = z.object({
    section: sectionEnum,
    month: z.string().regex(/^\d{4}-\d{2}$/),
});

const createBodySchema = z.object({
    section: sectionEnum,
    dateYmd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    title: z.string().trim().min(1).max(500),
    notes: z.string().trim().max(2000).optional().nullable(),
    batchRef: z.string().trim().max(200).optional().nullable(),
    templateDedupeKey: z.string().trim().min(1).max(260).optional().nullable(),
    templateManaged: z.boolean().optional(),
});

const patchBodySchema = z
    .object({
        dateYmd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        title: z.string().trim().min(1).max(500).optional(),
        notes: z.string().trim().max(2000).optional().nullable(),
        batchRef: z.string().trim().max(200).optional().nullable(),
        templateDedupeKey: z.union([z.string().trim().min(1).max(260), z.null()]).optional(),
        templateManaged: z.boolean().optional(),
    })
    .refine((b) => Object.keys(b).length > 0, { message: "At least one field required" });

const idParamSchema = z.object({
    id: z.string().trim().min(1),
});

function authPayload(req: { auth?: { userId?: string; role?: string; permissions?: string[] } }) {
    const auth = req.auth;
    if (!auth?.userId)
        throw new AppError("Invalid authentication context", 401, "AUTH_INVALID");
    return {
        userId: String(auth.userId),
        role: String(auth.role ?? ""),
        permissions: Array.isArray(auth.permissions) ? auth.permissions : undefined,
    };
}

function assertRead(section: SectionCalendarSection, role: string, permissions: string[] | undefined) {
    if (!canReadSectionCalendar({ role, permissions, section })) {
        throw new AppError("You do not have access to this section calendar.", 403, "SECTION_CALENDAR_FORBIDDEN", {
            reason: "missing_section_access",
        });
    }
}

function assertWrite(section: SectionCalendarSection, role: string, permissions: string[] | undefined) {
    if (!canWriteSectionCalendar({ role, permissions, section })) {
        throw new AppError("You cannot edit this section calendar.", 403, "SECTION_CALENDAR_WRITE_FORBIDDEN", {
            reason: "missing_write_access",
        });
    }
}

sectionCalendarRouter.get(
    "/events",
    validate({ query: listQuerySchema }),
    asyncHandler(async (req, res) => {
        const companyId = getScopedCompanyId(req);
        if (!companyId)
            throw new AppError("Invalid authentication context", 401, "AUTH_INVALID");
        const { userId: _userId, role, permissions } = authPayload(req);
        const section = req.query.section as SectionCalendarSection;
        const month = String(req.query.month);
        assertRead(section, role, permissions);
        const { fromYmd, toYmd } = monthYmdBounds(month);
        const rows = await prisma.sectionCalendarEvent.findMany({
            where: {
                companyId,
                section,
                dateYmd: { gte: fromYmd, lte: toYmd },
            },
            orderBy: [{ dateYmd: "asc" }, { id: "asc" }],
        });
        res.json({ events: rows, fromYmd, toYmd });
    }),
);

sectionCalendarRouter.post(
    "/events",
    validate({ body: createBodySchema }),
    asyncHandler(async (req, res) => {
        const companyId = getScopedCompanyId(req);
        if (!companyId)
            throw new AppError("Invalid authentication context", 401, "AUTH_INVALID");
        const { userId, role, permissions } = authPayload(req);
        const body = req.body as z.infer<typeof createBodySchema>;
        assertWrite(body.section, role, permissions);
        const row = await prisma.sectionCalendarEvent.create({
            data: {
                companyId,
                section: body.section,
                dateYmd: body.dateYmd,
                title: body.title,
                notes: body.notes ?? null,
                batchRef: body.batchRef ?? null,
                createdByUserId: userId,
                templateDedupeKey: body.templateDedupeKey ?? null,
                templateManaged: body.templateManaged === true,
            },
        });
        res.status(201).json(row);
    }),
);

sectionCalendarRouter.patch(
    "/events/:id",
    validate({ params: idParamSchema, body: patchBodySchema }),
    asyncHandler(async (req, res) => {
        const companyId = getScopedCompanyId(req);
        if (!companyId)
            throw new AppError("Invalid authentication context", 401, "AUTH_INVALID");
        const { role, permissions } = authPayload(req);
        const id = req.params.id;
        const existing = await prisma.sectionCalendarEvent.findFirst({
            where: { id, companyId },
        });
        if (!existing)
            throw new AppError("Event not found", 404, "NOT_FOUND");
        const sec = parseSectionCalendarSection(existing.section);
        if (!sec)
            throw new AppError("Invalid stored section", 500, "INVALID_STATE");
        assertWrite(sec, role, permissions);
        const body = req.body as z.infer<typeof patchBodySchema>;
        const updated = await prisma.sectionCalendarEvent.update({
            where: { id },
            data: {
                ...(body.dateYmd !== undefined ? { dateYmd: body.dateYmd } : {}),
                ...(body.title !== undefined ? { title: body.title } : {}),
                ...(body.notes !== undefined ? { notes: body.notes } : {}),
                ...(body.batchRef !== undefined ? { batchRef: body.batchRef } : {}),
                ...(body.templateDedupeKey !== undefined ? { templateDedupeKey: body.templateDedupeKey } : {}),
                ...(body.templateManaged !== undefined ? { templateManaged: body.templateManaged } : {}),
            },
        });
        res.json(updated);
    }),
);

sectionCalendarRouter.delete(
    "/events/:id",
    validate({ params: idParamSchema }),
    asyncHandler(async (req, res) => {
        const companyId = getScopedCompanyId(req);
        if (!companyId)
            throw new AppError("Invalid authentication context", 401, "AUTH_INVALID");
        const { userId: _userId, role, permissions } = authPayload(req);
        const id = req.params.id;
        const existing = await prisma.sectionCalendarEvent.findFirst({
            where: { id, companyId },
        });
        if (!existing)
            throw new AppError("Event not found", 404, "NOT_FOUND");
        const sec = parseSectionCalendarSection(existing.section);
        if (!sec)
            throw new AppError("Invalid stored section", 500, "INVALID_STATE");
        assertWrite(sec, role, permissions);
        await prisma.sectionCalendarEvent.delete({ where: { id } });
        res.json({ ok: true });
    }),
);

sectionCalendarRouter.post(
    "/cultivation/sync-templates",
    asyncHandler(async (req, res) => {
        const companyId = getScopedCompanyId(req);
        if (!companyId)
            throw new AppError("Invalid authentication context", 401, "AUTH_INVALID");
        const { userId, role, permissions } = authPayload(req);
        assertWrite("cultivation", role, permissions);
        const out = await syncCultivationSectionCalendarFromTemplates({
            companyId,
            actorUserId: userId,
        });
        res.json(out);
    }),
);
