import crypto from "node:crypto";
import type { NexBatchPlatformRole } from "@prisma/client";
import { AppError } from "../errors/AppError.js";
import { resolvePublicWebBaseUrl } from "../config/publicWebUrl.js";
import { logInfo } from "../lib/logger.js";
import { sendInviteEmail } from "../lib/mailer.js";
import {
    canCreateCompanyAsPlatform,
    nexBatchInviteTierToPlatformRole,
    nexBatchPlatformRoleInviteLabel,
    platformRoleToNexBatchInviteUiTier,
    type NexBatchInviteUiTier,
} from "../lib/nexbatchRoles.js";
import { AuthRepository } from "../repositories/authRepository.js";
import { CompanyRepository } from "../repositories/companyRepository.js";

export class NexBatchStaffService {
    private authRepo = new AuthRepository();
    private companyRepo = new CompanyRepository();

    async inviteStaff(input: {
        actorUserId: string;
        actorPlatformRole: string | null | undefined;
        email: string;
        tier: NexBatchInviteUiTier;
    }) {
        if (!canCreateCompanyAsPlatform(input.actorPlatformRole)) {
            throw new AppError("Forbidden", 403);
        }
        const actorPr = String(input.actorPlatformRole || "").trim();
        const platformRole = nexBatchInviteTierToPlatformRole(input.tier);
        if (platformRole === "owner" && actorPr !== "owner") {
            throw new AppError("Only a NexBatch owner account can invite someone as Owner (full platform).", 403);
        }

        const email = String(input.email).trim().toLowerCase();
        if (await this.authRepo.findUserByEmail(email)) {
            throw new AppError("That email is already registered.", 409);
        }
        if (await this.authRepo.findPendingPlatformStaffInviteByEmail(email)) {
            throw new AppError("An invite is already pending for that email.", 409);
        }

        const accessible = await this.companyRepo.listAccessibleCompaniesForUser(input.actorUserId, {
            includeBootstrapInvites: true,
        });
        const companyIds = accessible.map((c) => c.id);
        if (!companyIds.length) {
            throw new AppError(
                "You have no company workspaces to attach. Open a tenant from the list above first, or create a company.",
                400,
            );
        }

        const rawToken = crypto.randomBytes(24).toString("hex");
        const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
        const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);

        await this.authRepo.createPlatformStaffInvite({
            email,
            platformRole,
            companyIds,
            tokenHash,
            expiresAt,
            createdBy: input.actorUserId,
        });

        const baseUrl = resolvePublicWebBaseUrl().replace(/\/+$/, "");
        const inviteUrl = `${baseUrl}/accept-nexbatch-invite?token=${encodeURIComponent(rawToken)}`;
        const roleLabel = nexBatchPlatformRoleInviteLabel(platformRole);

        void sendInviteEmail({
            to: email,
            inviteUrl,
            companyName: "NexBatch portal",
            role: roleLabel,
        }).then(
            async () => {
                logInfo("nexbatch_staff_invite_email_sent", {
                    to: email,
                    companiesAttached: companyIds.length,
                    note: "Resend usage not written to UsageEvent — platform invites are not attributable to a tenant (avoids charging the wrong company).",
                });
            },
            (err) => {
                console.error("[mail] Failed to send NexBatch staff invite email:", err);
            },
        );

        logInfo("nexbatch_staff_invite_created", {
            actorUserId: input.actorUserId,
            email,
            platformRole,
            companiesGranted: companyIds.length,
        });

        return {
            email,
            platformRole,
            tier: platformRoleToNexBatchInviteUiTier(platformRole),
            roleLabel,
            companiesGranted: companyIds.length,
            expiresAt: expiresAt.toISOString(),
        };
    }

    async listStaff(input: {
        actorUserId: string;
        actorPlatformRole: string | null | undefined;
    }) {
        if (!canCreateCompanyAsPlatform(input.actorPlatformRole)) {
            throw new AppError("Forbidden", 403);
        }
        const accessible = await this.companyRepo.listAccessibleCompaniesForUser(input.actorUserId, {
            includeBootstrapInvites: true,
        });
        const companyIds = accessible.map((c) => c.id);
        const users = await this.authRepo.db.user.findMany({
            where: {
                platformRole: { not: null },
                memberships: companyIds.length
                    ? { some: { companyId: { in: companyIds } } }
                    : undefined,
            },
            orderBy: { createdAt: "asc" },
            select: {
                id: true,
                email: true,
                platformRole: true,
                isActive: true,
                createdAt: true,
                memberships: {
                    where: companyIds.length ? { companyId: { in: companyIds } } : undefined,
                    select: { companyId: true },
                },
            },
        });
        return {
            staff: users.map((u) => ({
                id: u.id,
                email: u.email,
                platformRole: String(u.platformRole || "admin"),
                tier: platformRoleToNexBatchInviteUiTier(String(u.platformRole || "admin")),
                roleLabel: nexBatchPlatformRoleInviteLabel(String(u.platformRole || "admin")),
                active: Boolean(u.isActive),
                companiesGranted: u.memberships.length,
                createdAt: u.createdAt.toISOString(),
            })),
        };
    }

    async updateStaff(input: {
        actorUserId: string;
        actorPlatformRole: string | null | undefined;
        userId: string;
        tier?: NexBatchInviteUiTier;
        active?: boolean;
    }) {
        if (!canCreateCompanyAsPlatform(input.actorPlatformRole)) {
            throw new AppError("Forbidden", 403);
        }
        const actorPr = String(input.actorPlatformRole || "").trim();
        const accessible = await this.companyRepo.listAccessibleCompaniesForUser(input.actorUserId, {
            includeBootstrapInvites: true,
        });
        const companyIds = accessible.map((c) => c.id);
        const target = await this.authRepo.db.user.findFirst({
            where: { id: input.userId, platformRole: { not: null } },
            select: {
                id: true,
                email: true,
                platformRole: true,
                memberships: {
                    where: companyIds.length ? { companyId: { in: companyIds } } : undefined,
                    select: { companyId: true },
                },
            },
        });
        if (!target) {
            throw new AppError("Staff user not found.", 404);
        }
        if (companyIds.length && target.memberships.length === 0) {
            throw new AppError("Forbidden", 403);
        }
        const currentRole = (target.platformRole || "admin") as NexBatchPlatformRole;
        if (actorPr !== "owner" && currentRole === "owner") {
            throw new AppError("Only a NexBatch owner can edit an Owner (full platform) account.", 403);
        }
        const nextRole: NexBatchPlatformRole = input.tier
            ? nexBatchInviteTierToPlatformRole(input.tier)
            : currentRole;
        if (nextRole === "owner" && actorPr !== "owner") {
            throw new AppError("Only a NexBatch owner can assign Owner (full platform).", 403);
        }
        const updated = await this.authRepo.db.user.update({
            where: { id: input.userId },
            data: {
                platformRole: nextRole,
                ...(typeof input.active === "boolean" ? { isActive: input.active } : {}),
            },
            select: {
                id: true,
                email: true,
                platformRole: true,
                isActive: true,
                createdAt: true,
            },
        });
        const memberships = await this.authRepo.db.companyMembership.findMany({
            where: {
                userId: updated.id,
                ...(companyIds.length ? { companyId: { in: companyIds } } : {}),
            },
            select: { companyId: true },
        });
        return {
            id: updated.id,
            email: updated.email,
            platformRole: String(updated.platformRole || "admin"),
            tier: platformRoleToNexBatchInviteUiTier(String(updated.platformRole || "admin")),
            roleLabel: nexBatchPlatformRoleInviteLabel(String(updated.platformRole || "admin")),
            active: Boolean(updated.isActive),
            companiesGranted: memberships.length,
            createdAt: updated.createdAt.toISOString(),
        };
    }
}
