import { resolvePublicWebBaseUrl } from "../config/publicWebUrl.js";
import { AppError } from "../errors/AppError.js";
import { logInfo } from "../lib/logger.js";
import { sendInviteEmail } from "../lib/mailer.js";
import { mergeCashLogEodPrefs } from "../lib/cashLogEodPrefs.js";
import { AdminRepository } from "../repositories/adminRepository.js";
import { AuditService } from "./auditService.js";
export class AdminService {
    repo = new AdminRepository();
    auditService = new AuditService();
    async setUserStatus(input) {
        if (input.targetUserId === input.actorUserId) {
            throw new AppError("Cannot disable your own account", 400);
        }
        const target = await this.repo.findUserById(input.companyId, input.targetUserId);
        if (!target) {
            throw new AppError("Target user not found", 404);
        }
        if (target.role === "OWNER") {
            throw new AppError("Owner account cannot be disabled", 403);
        }
        const changed = await this.repo.updateUserStatus(input.companyId, input.targetUserId, input.isActive);
        if (changed.count === 0) {
            throw new AppError("No user status changed", 404);
        }
        await this.auditService.logAction({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: input.isActive ? "admin.user.enable" : "admin.user.disable",
            entityType: "User",
            entityId: input.targetUserId,
            after: { isActive: input.isActive }
        });
        return { ok: true };
    }
    async createInvite(input) {
        const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
        const payload = await this.repo.createInvite({
            companyId: input.companyId,
            email: input.email,
            role: input.role,
            createdBy: input.actorUserId,
            expiresAt
        });
        const company = await this.repo.db.company.findUnique({
            where: { id: input.companyId },
            select: { name: true }
        });
        const baseUrl = resolvePublicWebBaseUrl();
        const inviteUrl = `${baseUrl}/accept-invite?token=${encodeURIComponent(payload.token)}`;
        logInfo("admin_invite_url_resolved", { webBaseUrl: baseUrl });

        await this.auditService.logAction({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: "admin.invite.create",
            entityType: "InviteToken",
            entityId: payload.invite.id,
            after: { email: input.email, role: input.role }
        });

        const mailOpts = {
            to: input.email,
            inviteUrl,
            companyName: company?.name ?? "NexBatch",
            role: String(input.role)
        };
        void sendInviteEmail(mailOpts).then(
            () => console.log(`[mail] invite sent to ${input.email}`),
            (err: unknown) => console.error("[mail] Failed to send invite email:", err)
        );

        return {
            id: payload.invite.id,
            email: payload.invite.email,
            role: payload.invite.role,
            expiresAt,
            token: payload.token,
            inviteUrl
        };
    }
    async listInvites(input) {
        const rows = await this.repo.listPendingInvites(input.companyId);
        return rows.map((r) => ({
            id: r.id,
            email: r.email,
            role: r.role,
            expiresAt: r.expiresAt.toISOString(),
            createdAt: r.createdAt.toISOString(),
        }));
    }
    async deleteInvite(input) {
        const existing = await this.repo.db.inviteToken.findFirst({
            where: {
                id: input.inviteId,
                companyId: input.companyId,
                acceptedAt: null,
            },
            select: { id: true, email: true },
        });
        if (!existing)
            throw new AppError("Pending invite not found", 404);
        const changed = await this.repo.deletePendingInvite(input.companyId, input.inviteId);
        if (changed.count === 0)
            throw new AppError("Pending invite not found", 404);
        await this.auditService.logAction({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: "admin.invite.delete",
            entityType: "InviteToken",
            entityId: input.inviteId,
            after: { email: existing.email },
        });
        return { ok: true };
    }
    async listUsers(input) {
        const rows = await this.repo.listUsers(input.companyId);
        return rows.map(({ user: u, appPermissions, cashLogEodEnabled }) => ({
            id: u.id,
            username: u.email.split("@")[0],
            email: u.email,
            role: u.role,
            active: u.isActive,
            status: u.isActive ? "ACTIVE" : "INACTIVE",
            createdAt: u.createdAt,
            appPermissions: appPermissions ?? null,
            cashLogEodEnabled: Boolean(cashLogEodEnabled),
        }));
    }
    async updateUser(input) {
        const target = await this.repo.findUserById(input.companyId, input.targetUserId);
        if (!target)
            throw new AppError("Target user not found", 404);
        if (input.targetUserId === input.actorUserId) {
            throw new AppError("Cannot edit your own user via admin endpoint", 400);
        }
        if (input.actorRole === "ADMIN" && target.role === "OWNER") {
            throw new AppError("Admins cannot edit owner users", 403);
        }
        if (input.actorRole === "ADMIN" && input.role === "OWNER") {
            throw new AppError("Admins cannot promote users to OWNER", 403);
        }
        const changed = await this.repo.updateUser(input.companyId, input.targetUserId, {
            email: input.email,
            role: input.role,
            isActive: input.isActive,
            appPermissions: input.appPermissions,
            cashLogEodEnabled: input.cashLogEodEnabled,
        });
        if (changed.count === 0)
            throw new AppError("No user changes persisted", 400);
        const next = await this.repo.findUserById(input.companyId, input.targetUserId);
        if (!next)
            throw new AppError("User not found after update", 404);
        const membership = await this.repo.db.companyMembership.findFirst({
            where: { companyId: input.companyId, userId: input.targetUserId },
            select: { appPermissions: true, cashLogEodPrefs: true },
        });
        const cashLogEodEnabled = mergeCashLogEodPrefs(membership?.cashLogEodPrefs ?? null).enabled;
        await this.auditService.logAction({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: "admin.user.update",
            entityType: "User",
            entityId: input.targetUserId,
            after: {
                email: next.email,
                role: next.role,
                isActive: next.isActive,
                appPermissions: membership?.appPermissions ?? null,
                cashLogEodEnabled,
            },
        });
        return {
            id: next.id,
            username: next.email.split("@")[0],
            email: next.email,
            role: next.role,
            active: next.isActive,
            status: next.isActive ? "ACTIVE" : "INACTIVE",
            appPermissions: membership?.appPermissions ?? null,
            cashLogEodEnabled,
        };
    }
    async deleteUser(input) {
        if (input.targetUserId === input.actorUserId) {
            throw new AppError("Cannot delete your own account", 400);
        }
        const target = await this.repo.findUserById(input.companyId, input.targetUserId);
        if (!target)
            throw new AppError("Target user not found", 404);
        if (target.role === "OWNER" && input.actorRole !== "OWNER") {
            throw new AppError("Only OWNER can delete OWNER accounts", 403);
        }
        const changed = await this.repo.deleteUser(input.companyId, input.targetUserId);
        if (changed.count === 0)
            throw new AppError("No user deleted", 404);
        await this.auditService.logAction({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: "admin.user.delete",
            entityType: "User",
            entityId: input.targetUserId
        });
        return { ok: true };
    }
}
