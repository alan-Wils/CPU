import { Router } from "express";
import { getScopedCompanyId } from "../../middleware/companyScope.js";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { adminUserIdParam, adminUserStatusSchema, adminUserUpdateSchema, inviteCreateSchema, inviteIdParam } from "../../validation/schemas.js";
import { AdminService } from "../../services/adminService.js";
import { requirePlatformRoles, requireRole } from "../../middleware/rbac.js";
import { UsageCostService } from "../../services/usageCostService.js";
import { VendorBillingSyncService } from "../../services/vendorBillingSyncService.js";
export const adminRouter = Router();
const adminService = new AdminService();
const usageCostService = new UsageCostService();
const vendorBillingSyncService = new VendorBillingSyncService();

adminRouter.get(
    "/companies/:companyId/usage-costs",
    requirePlatformRoles(["nexbatch_admin", "owner"]),
    asyncHandler(async (req, res) => {
        const companyId = String(req.params.companyId || "").trim();
        const out = await usageCostService.getCompanyUsageCosts(companyId);
        res.json(out);
    }),
);
adminRouter.post(
    "/usage-costs/sync",
    requirePlatformRoles(["nexbatch_admin", "owner"]),
    asyncHandler(async (_req, res) => {
        const out = await vendorBillingSyncService.syncCurrentMonthAllProviders();
        res.json(out);
    }),
);
adminRouter.get("/users", requireRole(["OWNER", "ADMIN"]), asyncHandler(async (req, res) => {
    const users = await adminService.listUsers({ companyId: getScopedCompanyId(req) });
    res.json({ users });
}));
adminRouter.post("/users/:userId/status", requireRole(["OWNER", "ADMIN"]), validate({ body: adminUserStatusSchema }), asyncHandler(async (req, res) => {
    const payload = req.body;
    const result = await adminService.setUserStatus({
        companyId: getScopedCompanyId(req),
        actorUserId: req.auth.userId,
        targetUserId: String(req.params.userId),
        isActive: payload.isActive
    });
    res.json(result);
}));
adminRouter.patch("/users/:userId", requireRole(["OWNER", "ADMIN"]), validate({ body: adminUserUpdateSchema }), asyncHandler(async (req, res) => {
    const payload = req.body;
    const updated = await adminService.updateUser({
        companyId: getScopedCompanyId(req),
        actorUserId: req.auth.userId,
        actorRole: req.auth.role,
        targetUserId: String(req.params.userId),
        email: payload.email,
        role: payload.role,
        isActive: payload.isActive,
        appPermissions: payload.appPermissions,
        cashLogEodEnabled: payload.cashLogEodEnabled,
        rewardsEnrolled: payload.rewardsEnrolled,
    });
    res.json(updated);
}));
adminRouter.delete("/users/:userId", requireRole(["OWNER", "ADMIN"]), asyncHandler(async (req, res) => {
    const out = await adminService.deleteUser({
        companyId: getScopedCompanyId(req),
        actorUserId: req.auth.userId,
        actorRole: req.auth.role,
        targetUserId: String(req.params.userId)
    });
    res.json(out);
}));
adminRouter.post("/users/:userId/password-reset-email", requireRole(["OWNER", "ADMIN"]), validate({ params: adminUserIdParam }), asyncHandler(async (req, res) => {
    const out = await adminService.sendUserPasswordResetEmail({
        companyId: getScopedCompanyId(req),
        actorUserId: req.auth.userId,
        actorRole: req.auth.role,
        targetUserId: String(req.params.userId),
    });
    res.json(out);
}));
adminRouter.get("/invites", requireRole(["OWNER", "ADMIN"]), asyncHandler(async (req, res) => {
    const invites = await adminService.listInvites({ companyId: getScopedCompanyId(req) });
    res.json({ invites });
}));
adminRouter.post("/invites", requireRole(["OWNER", "ADMIN"]), validate({ body: inviteCreateSchema }), asyncHandler(async (req, res) => {
    const payload = req.body;
    const result = await adminService.createInvite({
        companyId: getScopedCompanyId(req),
        actorUserId: req.auth.userId,
        email: payload.email,
        role: payload.role
    });
    res.status(201).json(result);
}));
adminRouter.delete("/invites/:inviteId", requireRole(["OWNER", "ADMIN"]), validate({ params: inviteIdParam }), asyncHandler(async (req, res) => {
    const out = await adminService.deleteInvite({
        companyId: getScopedCompanyId(req),
        actorUserId: req.auth.userId,
        inviteId: String(req.params.inviteId),
    });
    res.json(out);
}));
