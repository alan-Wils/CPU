import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { adminUserStatusSchema, adminUserUpdateSchema, inviteCreateSchema } from "../../validation/schemas.js";
import { AdminService } from "../../services/adminService.js";
import { requireRole } from "../../middleware/rbac.js";
export const adminRouter = Router();
const adminService = new AdminService();
adminRouter.get("/users", requireRole(["OWNER", "ADMIN"]), asyncHandler(async (req, res) => {
    const users = await adminService.listUsers({ companyId: req.auth.companyId });
    res.json({ users });
}));
adminRouter.post("/users/:userId/status", requireRole(["OWNER", "ADMIN"]), validate({ body: adminUserStatusSchema }), asyncHandler(async (req, res) => {
    const payload = req.body;
    const result = await adminService.setUserStatus({
        companyId: req.auth.companyId,
        actorUserId: req.auth.userId,
        targetUserId: String(req.params.userId),
        isActive: payload.isActive
    });
    res.json(result);
}));
adminRouter.patch("/users/:userId", requireRole(["OWNER", "ADMIN"]), validate({ body: adminUserUpdateSchema }), asyncHandler(async (req, res) => {
    const payload = req.body;
    const updated = await adminService.updateUser({
        companyId: req.auth.companyId,
        actorUserId: req.auth.userId,
        actorRole: req.auth.role,
        targetUserId: String(req.params.userId),
        email: payload.email,
        role: payload.role,
        isActive: payload.isActive
    });
    res.json(updated);
}));
adminRouter.delete("/users/:userId", requireRole(["OWNER", "ADMIN"]), asyncHandler(async (req, res) => {
    const out = await adminService.deleteUser({
        companyId: req.auth.companyId,
        actorUserId: req.auth.userId,
        actorRole: req.auth.role,
        targetUserId: String(req.params.userId)
    });
    res.json(out);
}));
adminRouter.post("/invites", requireRole(["OWNER", "ADMIN"]), validate({ body: inviteCreateSchema }), asyncHandler(async (req, res) => {
    const payload = req.body;
    const result = await adminService.createInvite({
        companyId: req.auth.companyId,
        actorUserId: req.auth.userId,
        email: payload.email,
        role: payload.role
    });
    res.status(201).json(result);
}));
