import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { authMiddleware } from "../../middleware/auth.js";
import { acceptInviteSchema, loginSchema, passwordResetConfirmSchema, resetRequestSchema, selectCompanySchema } from "../../validation/schemas.js";
import { AuthService } from "../../services/authService.js";
export const authRouter = Router();
const authService = new AuthService();
authRouter.post("/login", validate({ body: loginSchema }), asyncHandler(async (req, res) => {
    const payload = req.body;
    const result = await authService.login(payload);
    res.json(result);
}));
authRouter.get("/me", authMiddleware, asyncHandler(async (req, res) => {
    const a = req.auth as {
        userId: string;
        companyId?: string;
        sessionKind?: string;
        role?: string;
        platformRole?: string | null;
    };
    const session = await authService.getSession(a.userId, String(a.companyId ?? ""), a.sessionKind);
    const refreshed = authService.issueRefreshedTokenIfNeeded(req.header("Authorization"), session.user as { permissions?: string[] }, {
        userId: a.userId,
        companyId: String(a.companyId ?? ""),
        role: String(a.role ?? ""),
        sessionKind: (a.sessionKind === "portal" ? "portal" : "company"),
        platformRole: (a.platformRole as string | null) ?? null,
    });
    res.json({ ...session, ...(refreshed ? { token: refreshed } : {}) });
}));
authRouter.post("/select-company", authMiddleware, validate({ body: selectCompanySchema }), asyncHandler(async (req, res) => {
    const a = req.auth as { userId: string; platformRole?: string | null };
    const out = await authService.selectCompany(a.userId, req.body.companyId, a.platformRole);
    res.json(out);
}));
authRouter.post("/accept-invite", validate({ body: acceptInviteSchema }), asyncHandler(async (req, res) => {
    const payload = req.body;
    const result = await authService.acceptInvite(payload);
    res.json(result);
}));
authRouter.post("/accept-nexbatch-invite", validate({ body: acceptInviteSchema }), asyncHandler(async (req, res) => {
    const payload = req.body;
    const result = await authService.acceptNexBatchStaffInvite(payload);
    res.json(result);
}));
authRouter.post("/password-reset/request", validate({ body: resetRequestSchema }), asyncHandler(async (req, res) => {
    const payload = req.body;
    const result = await authService.requestPasswordReset(payload.email);
    res.status(202).json(result);
}));
authRouter.post("/password-reset/confirm", validate({ body: passwordResetConfirmSchema }), asyncHandler(async (req, res) => {
    const payload = req.body;
    const result = await authService.confirmPasswordReset(payload.token, payload.password);
    res.json(result);
}));
