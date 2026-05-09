import { Router } from "express";
import { getScopedCompanyId } from "../../middleware/companyScope.js";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { assignOwnerSchema, companyIdParam, createCompanySchema, createUserSchema, updateCompanySchema } from "../../validation/schemas.js";
import { CompanyService } from "../../services/companyService.js";
import { CompanyServiceSettingsService } from "../../services/companyServiceSettingsService.js";
import { requireCompanyOwnerOfTargetOrPlatform, requirePlatformRoles, requireRole } from "../../middleware/rbac.js";
export const companiesRouter = Router();
const companyService = new CompanyService();
const companyServiceSettingsService = new CompanyServiceSettingsService();
companiesRouter.get("/me", asyncHandler(async (req, res) => {
    const companyId = getScopedCompanyId(req);
    const company = await companyService.getMyCompany(companyId);
    if (!company) {
        res.json({ company: null, services: null });
        return;
    }
    const services = await companyServiceSettingsService.getOrCreate(companyId);
    res.json({ company, services });
}));
companiesRouter.post("/", requirePlatformRoles(["nexbatch_admin", "owner"]), validate({ body: createCompanySchema }), asyncHandler(async (req, res) => {
    const payload = req.body as {
        name: string;
        slug: string;
        ownerEmail: string;
        workspaceServices?: {
            productionEnabled: boolean;
            salesSellerEnabled: boolean;
            salesBuyerEnabled: boolean;
            leafLinkInventorySyncEnabled: boolean;
        };
    };
    const { workspaceServices, ...companyPayload } = payload;
    const created = await companyService.createCompany({
        ...companyPayload,
        actorUserId: req.auth.userId,
        actorCompanyId: String(req.auth.companyId || "").trim() || undefined
    });
    if (workspaceServices) {
        await companyServiceSettingsService.updateForPortal(created.id, workspaceServices);
    }
    res.status(201).json(created);
}));
companiesRouter.get("/accessible", asyncHandler(async (req, res) => {
    const companies = await companyService.listAccessibleCompanies(req.auth.userId, {
        platformRole: req.auth.platformRole ?? null,
    });
    res.json({ companies });
}));
companiesRouter.get("/all", asyncHandler(async (req, res) => {
    const companies = await companyService.listAccessibleCompanies(req.auth.userId, {
        platformRole: req.auth.platformRole ?? null,
    });
    res.json({ companies });
}));
companiesRouter.delete("/:companyId", requirePlatformRoles(["nexbatch_admin", "owner"]), validate({ params: companyIdParam }), asyncHandler(async (req, res) => {
    const { companyId } = req.params;
    const out = await companyService.deleteCompanyPermanently({
        companyId,
        actorUserId: req.auth.userId,
    });
    res.json(out);
}));
companiesRouter.patch("/:companyId", requireCompanyOwnerOfTargetOrPlatform, validate({ params: companyIdParam, body: updateCompanySchema }), asyncHandler(async (req, res) => {
    const { companyId } = req.params;
    const payload = req.body;
    const updated = await companyService.updateCompany({
        actorCompanyId: req.auth.companyId,
        actorUserId: req.auth.userId,
        companyId,
        name: payload.name,
        slug: payload.slug
    });
    res.json(updated);
}));
companiesRouter.post("/:companyId/assign-owner", requireCompanyOwnerOfTargetOrPlatform, validate({ params: companyIdParam, body: assignOwnerSchema }), asyncHandler(async (req, res) => {
    const { companyId } = req.params;
    const payload = req.body;
    const out = await companyService.assignOwner({
        actorCompanyId: req.auth.companyId,
        actorUserId: req.auth.userId,
        companyId,
        targetUserId: payload.targetUserId
    });
    res.json(out);
}));
companiesRouter.post("/users", requireRole(["OWNER", "ADMIN"]), validate({ body: createUserSchema }), asyncHandler(async (req, res) => {
    const payload = req.body;
    const created = await companyService.createUser({
        companyId: getScopedCompanyId(req),
        actorUserId: req.auth.userId,
        ...payload
    });
    res.status(201).json(created);
}));
companiesRouter.get("/users", requireRole(["OWNER", "ADMIN"]), asyncHandler(async (req, res) => {
    const users = await companyService.listUsers(getScopedCompanyId(req));
    res.json({ users });
}));
