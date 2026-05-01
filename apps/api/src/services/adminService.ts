import { AppError } from "../errors/AppError.js";
import { resolvePublicWebBaseUrl } from "../config/publicWebUrl.js";
import { sendInviteEmail } from "../lib/mailer.js";
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
            companyName: company?.name ?? "Cannabis CPU",
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
    async listUsers(input) {
        const rows = await this.repo.listUsers(input.companyId);
        return rows.map((u) => ({
            id: u.id,
            username: u.email.split("@")[0],
            email: u.email,
            role: u.role,
            active: u.isActive,
            status: u.isActive ? "ACTIVE" : "INACTIVE",
            createdAt: u.createdAt
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
            isActive: input.isActive
        });
        if (changed.count === 0)
            throw new AppError("No user changes persisted", 400);
        const next = await this.repo.findUserById(input.companyId, input.targetUserId);
        if (!next)
            throw new AppError("User not found after update", 404);
        await this.auditService.logAction({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: "admin.user.update",
            entityType: "User",
            entityId: input.targetUserId,
            after: { email: next.email, role: next.role, isActive: next.isActive }
        });
        return {
            id: next.id,
            username: next.email.split("@")[0],
            email: next.email,
            role: next.role,
            active: next.isActive,
            status: next.isActive ? "ACTIVE" : "INACTIVE"
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
