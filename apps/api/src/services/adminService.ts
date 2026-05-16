import { resolvePublicWebBaseUrl } from "../config/publicWebUrl.js";
import { AppError } from "../errors/AppError.js";
import { logInfo } from "../lib/logger.js";
import { sendInviteEmail } from "../lib/mailer.js";
import { mergeCashLogEodPrefs } from "../lib/cashLogEodPrefs.js";
import { recordUsageEventSafe } from "./usageEventRecord.js";
import { AdminRepository } from "../repositories/adminRepository.js";
import { mayAdminEnableOwnerDigestEmails } from "./adminDigestPolicy.js";
import { AuditService } from "./auditService.js";
import { AuthService } from "./authService.js";
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
            select: { name: true, slug: true }
        });
        const baseUrl = resolvePublicWebBaseUrl();
        const codeQs =
            company?.slug != null && String(company.slug).trim()
                ? `&companyCode=${encodeURIComponent(String(company.slug).trim())}`
                : "";
        const inviteUrl = `${baseUrl}/accept-invite?token=${encodeURIComponent(payload.token)}${codeQs}`;
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
            async () => {
                console.log(`[mail] invite sent to ${input.email}`);
                await recordUsageEventSafe({
                    companyId: input.companyId,
                    provider: "resend",
                    feature: "admin_invite_email",
                    unitType: "email_sent",
                    units: 1,
                    estimatedCost: 0.0004,
                });
            },
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
        return rows.map(
            ({ user: u, appPermissions, cashLogEodEnabled, rewardsEnrolled, cultivationAlertsEnabled, designatedRnDSamplingEmployee }) => ({
                id: u.id,
                username: u.email.split("@")[0],
                email: u.email,
                role: u.role,
                active: u.isActive,
                status: u.isActive ? "ACTIVE" : "INACTIVE",
                createdAt: u.createdAt,
                appPermissions: appPermissions ?? null,
                cashLogEodEnabled: Boolean(cashLogEodEnabled),
                rewardsEnrolled: Boolean(rewardsEnrolled),
                cultivationAlertsEnabled: Boolean(cultivationAlertsEnabled),
                designatedRnDSamplingEmployee: Boolean(designatedRnDSamplingEmployee),
            }),
        );
    }
    async updateUser(input) {
        const target = await this.repo.findUserById(input.companyId, input.targetUserId);
        if (!target)
            throw new AppError("Target user not found", 404);
        const membershipBefore = await this.repo.db.companyMembership.findFirst({
            where: { companyId: input.companyId, userId: input.targetUserId },
            select: { appPermissions: true, cashLogEodPrefs: true, designatedRnDSamplingEmployee: true },
        });

        const actorR = String(input.actorRole || "").trim().toUpperCase();
        const targetR = String(target.role || "").trim().toUpperCase();
        const floorStaffRoles = new Set([
            "VIEW_ONLY",
            "CULTIVATION_SPECIALIST",
            "EXTRACTION_SPECIALIST",
            "PACKAGING_SPECIALIST",
            "EDIBLES",
            "EDIBLES_MANAGER",
            "FACILITY_MAINTENANCE_SPECIALIST",
            "SALES_SPECIALIST",
        ]);
        if (actorR === "OPERATIONS_MANAGER") {
            if (!floorStaffRoles.has(targetR)) {
                throw new AppError(
                    "Managers may only adjust page access for floor staff (View-only, Cultivation, Extraction, Packaging, Edibles, Facility Maintenance, Sales). Ask a company admin for other roles.",
                    403,
                );
            }
            const triedNonPermissionFields =
                input.email !== undefined ||
                input.role !== undefined ||
                input.isActive !== undefined ||
                input.cashLogEodEnabled !== undefined ||
                input.rewardsEnrolled !== undefined ||
                input.cultivationAlertsEnabled !== undefined ||
                input.designatedRnDSamplingEmployee !== undefined;
            if (triedNonPermissionFields) {
                throw new AppError(
                    "Managers may only change which pages floor staff can open. Company admins handle email, role, status, and other settings.",
                    403,
                );
            }
            if (input.appPermissions === undefined) {
                throw new AppError("No permission changes to save.", 400);
            }
        }

        if (input.actorRole === "ADMIN" && target.role === "OWNER") {
            const profileDirty =
                (input.email !== undefined &&
                    input.email.trim().toLowerCase() !== target.email.trim().toLowerCase()) ||
                    (input.role !== undefined && input.role !== target.role) ||
                    (input.isActive !== undefined && input.isActive !== target.isActive) ||
                    (input.appPermissions !== undefined &&
                        JSON.stringify(input.appPermissions ?? null) !==
                            JSON.stringify(membershipBefore?.appPermissions ?? null)) ||
                    (input.designatedRnDSamplingEmployee !== undefined &&
                        Boolean(input.designatedRnDSamplingEmployee) !==
                            Boolean(membershipBefore?.designatedRnDSamplingEmployee));
            if (profileDirty) {
                throw new AppError(
                    'Admins may only change "Receive EOD financial digest emails" for the application owner. Revert role, email, status, or permission changes—or have an owner edit those fields.',
                    403,
                    "ADMIN_OWNER_DIGEST_ONLY",
                );
            }
        }
        if (input.targetUserId === input.actorUserId) {
            const emailViolates =
                input.email !== undefined &&
                input.email.trim().toLowerCase() !== target.email.trim().toLowerCase();
            const roleViolates =
                input.role !== undefined && input.role !== target.role;
            const activeViolates =
                input.isActive !== undefined && input.isActive !== target.isActive;
            const appPermsViolates =
                input.appPermissions !== undefined &&
                JSON.stringify(input.appPermissions ?? null) !==
                    JSON.stringify(membershipBefore?.appPermissions ?? null);
            const designatedViolates =
                input.designatedRnDSamplingEmployee !== undefined &&
                Boolean(input.designatedRnDSamplingEmployee) !==
                    Boolean(membershipBefore?.designatedRnDSamplingEmployee);
            if (emailViolates || roleViolates || activeViolates || appPermsViolates || designatedViolates) {
                throw new AppError(
                    "You can only change \"Receive EOD financial digest emails\" on your own account here. Ask another OWNER/ADMIN to change your email, role, status, or app access.",
                    400,
                    "ADMIN_SELF_EDIT_LIMITED",
                );
            }
        }
        if (input.actorRole === "ADMIN" && input.role === "OWNER") {
            throw new AppError("Admins cannot promote users to OWNER", 403);
        }
        if (
            !mayAdminEnableOwnerDigestEmails({
                targetRole: target.role,
                requestedEnabled: input.cashLogEodEnabled,
            })
        ) {
            throw new AppError(
                "Cash and check digest emails cannot be enabled for the application owner.",
                403,
                "OWNER_DIGEST_SELF_ENABLE_ONLY",
            );
        }
        if (input.designatedRnDSamplingEmployee !== undefined) {
            const actorRUpper = String(input.actorRole || "").trim().toUpperCase();
            if (actorRUpper !== "OWNER" && actorRUpper !== "ADMIN") {
                throw new AppError(
                    "Only company owners or company admins can update the designated R&D sampling employee flag.",
                    403,
                );
            }
        }
        const changed = await this.repo.updateUser(input.companyId, input.targetUserId, {
            email: input.email,
            role: input.role,
            isActive: input.isActive,
            appPermissions: input.appPermissions,
            cashLogEodEnabled: input.cashLogEodEnabled,
            rewardsEnrolled: input.rewardsEnrolled,
            cultivationAlertsEnabled: input.cultivationAlertsEnabled,
            designatedRnDSamplingEmployee: input.designatedRnDSamplingEmployee,
        });
        if (changed.count === 0)
            throw new AppError("No user changes persisted", 400);
        const next = await this.repo.findUserById(input.companyId, input.targetUserId);
        if (!next)
            throw new AppError("User not found after update", 404);
        const membershipAfter = await this.repo.db.companyMembership.findFirst({
            where: { companyId: input.companyId, userId: input.targetUserId },
            select: {
                appPermissions: true,
                cashLogEodPrefs: true,
                rewardsEnrolled: true,
                cultivationAlertsEnabled: true,
                designatedRnDSamplingEmployee: true,
            },
        });
        const cashLogEodEnabled = mergeCashLogEodPrefs(membershipAfter?.cashLogEodPrefs ?? null).enabled;
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
                appPermissions: membershipAfter?.appPermissions ?? null,
                cashLogEodEnabled,
                cultivationAlertsEnabled: Boolean(membershipAfter?.cultivationAlertsEnabled),
                designatedRnDSamplingEmployee: Boolean(membershipAfter?.designatedRnDSamplingEmployee),
            },
        });
        return {
            id: next.id,
            username: next.email.split("@")[0],
            email: next.email,
            role: next.role,
            active: next.isActive,
            status: next.isActive ? "ACTIVE" : "INACTIVE",
            appPermissions: membershipAfter?.appPermissions ?? null,
            cashLogEodEnabled,
            rewardsEnrolled: Boolean(membershipAfter?.rewardsEnrolled),
            cultivationAlertsEnabled: Boolean(membershipAfter?.cultivationAlertsEnabled),
            designatedRnDSamplingEmployee: Boolean(membershipAfter?.designatedRnDSamplingEmployee),
        };
    }
    async sendUserPasswordResetEmail(input: {
        companyId: string;
        actorUserId: string;
        actorRole: string;
        targetUserId: string;
    }) {
        const target = await this.repo.findUserById(input.companyId, input.targetUserId);
        if (!target)
            throw new AppError("Target user not found", 404);
        const actorR = String(input.actorRole || "").trim().toUpperCase();
        const targetR = String(target.role || "").trim().toUpperCase();
        const floorStaffRoles = new Set([
            "VIEW_ONLY",
            "CULTIVATION_SPECIALIST",
            "EXTRACTION_SPECIALIST",
            "PACKAGING_SPECIALIST",
            "EDIBLES",
            "EDIBLES_MANAGER",
            "FACILITY_MAINTENANCE_SPECIALIST",
            "SALES_SPECIALIST",
        ]);
        if (actorR === "OPERATIONS_MANAGER" && !floorStaffRoles.has(targetR)) {
            throw new AppError(
                "Managers may only send password resets for floor staff (View-only, Cultivation, Extraction, Packaging, Edibles, Facility Maintenance, Sales).",
                403,
            );
        }
        if (target.role === "OWNER" && input.actorRole !== "OWNER") {
            throw new AppError("Only an owner can send a password reset for the owner account", 403);
        }
        const email = String(target.email || "").trim().toLowerCase();
        if (!email)
            throw new AppError("This user has no email address on file", 400);
        if (!target.isActive)
            throw new AppError("Cannot send a password reset for an inactive account", 400);
        const authService = new AuthService();
        const out = await authService.issuePasswordResetEmail(email);
        await this.auditService.logAction({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: "admin.user.password_reset_email",
            entityType: "User",
            entityId: input.targetUserId,
            after: { emailed: out.emailed },
        });
        return { ok: true, emailed: out.emailed, resetUrl: out.resetUrl };
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
