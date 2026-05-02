import { Router } from "express";
import { getScopedCompanyId } from "../../middleware/companyScope.js";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { assignOwnerSchema, companyIdParam, createCompanySchema, createUserSchema, updateCompanySchema } from "../../validation/schemas.js";
import { CompanyService } from "../../services/companyService.js";
import { requireRole } from "../../middleware/rbac.js";
export const companiesRouter = Router();
const companyService = new CompanyService();
companiesRouter.get("/me", asyncHandler(async (req, res) => {
    const company = await companyService.getMyCompany(getScopedCompanyId(req));
    res.json({ company });
}));
companiesRouter.post("/", requireRole(["OWNER"]), validate({ body: createCompanySchema }), asyncHandler(async (req, res) => {
    const payload = req.body;
    const created = await companyService.createCompany({
        ...payload,
        actorUserId: req.auth.userId,
        actorCompanyId: req.auth.companyId
    });
    res.status(201).json(created);
}));
companiesRouter.patch("/:companyId", requireRole(["OWNER"]), validate({ params: companyIdParam, body: updateCompanySchema }), asyncHandler(async (req, res) => {
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
companiesRouter.post("/:companyId/assign-owner", requireRole(["OWNER"]), validate({ params: companyIdParam, body: assignOwnerSchema }), asyncHandler(async (req, res) => {
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
companiesRouter.get("/all", requireRole(["OWNER"]), asyncHandler(async (_req, res) => {
    const companies = await companyService.listCompanies();
    res.json({ companies });
}));
companiesRouter.get("/users", requireRole(["OWNER", "ADMIN"]), asyncHandler(async (req, res) => {
    const users = await companyService.listUsers(getScopedCompanyId(req));
    res.json({ users });
}));
