import crypto from "node:crypto";
import type { NexBatchPlatformRole } from "@prisma/client";
import { AppError } from "../errors/AppError.js";
import { resolvePublicWebBaseUrl } from "../config/publicWebUrl.js";
import { logInfo } from "../lib/logger.js";
import { sendInviteEmail } from "../lib/mailer.js";
import {
    canManageNexBatchPortalStaff,
    canSeeAllCompaniesAsPlatform,
    companyMembershipRoleForPlatformOperator,
    nexBatchInviteTierToPlatformRole,
    nexBatchPlatformRoleInviteLabel,
    nexbatchPortalInviteTierViolatesPolicy,
    platformRoleToNexBatchInviteUiTier,
    type NexBatchInviteUiTier,
} from "../lib/nexbatchRoles.js";
import { AuthRepository } from "../repositories/authRepository.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { recordNexbatchPlatformUsageSplitAcrossCompaniesSafe } from "./nexbatchCompanyUsageLogRecord.js";

function parseInviteCompanyIds(value: unknown): number {
    if (!Array.isArray(value))
        return 0;
    return value.filter((x): x is string => typeof x === "string" && x.length > 0).length;
}

export class NexBatchStaffService {
    private authRepo = new AuthRepository();
    private companyRepo = new CompanyRepository();

    private async actorAssignableScope(actorUserId: string, actorPlatformRole: string | null | undefined) {
        const actorPr = String(actorPlatformRole ?? "").trim();
        const assignable = await this.companyRepo.listAccessibleCompaniesForUser(actorUserId, {
            platformRole: actorPr || null,
            includeBootstrapInvites: true,
        });
        const assignableIds = new Set(assignable.map((c) => c.id));
        return { actorPr, assignable, assignableIds };
    }

    async inviteStaff(input: {
        actorUserId: string;
        actorPlatformRole: string | null | undefined;
        email: string;
        tier: NexBatchInviteUiTier;
        companyIds?: string[] | undefined;
    }) {
        if (!canManageNexBatchPortalStaff(input.actorPlatformRole)) {
            throw new AppError("Forbidden", 403);
        }
        const { actorPr, assignable, assignableIds } = await this.actorAssignableScope(
            input.actorUserId,
            input.actorPlatformRole,
        );

        const tierDeny = nexbatchPortalInviteTierViolatesPolicy(actorPr, input.tier);
        if (tierDeny) {
            throw new AppError(tierDeny, 403);
        }

        const platformRole = nexBatchInviteTierToPlatformRole(input.tier);

        const email = String(input.email).trim().toLowerCase();
        if (await this.authRepo.findUserByEmail(email)) {
            throw new AppError("That email is already registered.", 409);
        }
        if (await this.authRepo.findPendingPlatformStaffInviteByEmail(email)) {
            throw new AppError("An invite is already pending for that email.", 409);
        }

        let companyIds: string[];
        if (input.companyIds?.length) {
            companyIds = [];
            for (const id of input.companyIds) {
                if (!assignableIds.has(id)) {
                    throw new AppError("One or more companies are not in your assignable scope.", 403);
                }
                if (!companyIds.includes(id))
                    companyIds.push(id);
            }
        }
        else {
            companyIds = assignable.map((c) => c.id);
        }
        if (!companyIds.length) {
            throw new AppError(
                "Select at least one workspace to attach, or ensure your account has company access.",
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
                    usageLog: "Attributed per NexbatchCompanyUsageLog (fractional split across attached companies)",
                });
                await recordNexbatchPlatformUsageSplitAcrossCompaniesSafe({
                    companyIds,
                    feature: "nexbatch_staff_invite_email",
                    unitType: "email_sent",
                    totalUnits: 1,
                    totalEstimatedCost: 0.0004,
                    provider: "resend",
                    actorUserId: input.actorUserId,
                    metadata: {
                        scope: "platform_staff_invite",
                        inviteeEmail: email,
                        platformRole,
                        splitAcrossCompanies: companyIds.length,
                    },
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
        if (!canManageNexBatchPortalStaff(input.actorPlatformRole)) {
            throw new AppError("Forbidden", 403);
        }
        const { actorPr, assignableIds } = await this.actorAssignableScope(
            input.actorUserId,
            input.actorPlatformRole,
        );
        const companyIds = [...assignableIds];

        const whereStaff = canSeeAllCompaniesAsPlatform(actorPr)
            ? { platformRole: { not: null } as const }
            : {
                platformRole: { not: null } as const,
                memberships: { some: { companyId: { in: companyIds } } },
            };

        const users = await this.authRepo.db.user.findMany({
            where: whereStaff,
            orderBy: { createdAt: "asc" },
            select: {
                id: true,
                email: true,
                platformRole: true,
                isActive: true,
                createdAt: true,
                memberships: { select: { companyId: true } },
                _count: { select: { memberships: true } },
            },
        });
        const now = new Date();
        const openInvites = await this.authRepo.listOpenPlatformStaffInvites();
        const pendingInvites = openInvites.map((inv) => {
            const pr = String(inv.platformRole || "admin");
            return {
                id: inv.id,
                email: inv.email,
                platformRole: pr,
                tier: platformRoleToNexBatchInviteUiTier(pr),
                roleLabel: nexBatchPlatformRoleInviteLabel(pr),
                companiesGranted: parseInviteCompanyIds(inv.companyIds),
                expiresAt: inv.expiresAt.toISOString(),
                invitedAt: inv.createdAt.toISOString(),
                status: inv.expiresAt > now ? ("pending" as const) : ("expired" as const),
            };
        });

        return {
            staff: users.map((u) => ({
                id: u.id,
                email: u.email,
                platformRole: String(u.platformRole || "admin"),
                tier: platformRoleToNexBatchInviteUiTier(String(u.platformRole || "admin")),
                roleLabel: nexBatchPlatformRoleInviteLabel(String(u.platformRole || "admin")),
                active: Boolean(u.isActive),
                companiesGranted: u._count.memberships,
                workspaceCompanyIds: u.memberships.map((m) => m.companyId),
                createdAt: u.createdAt.toISOString(),
            })),
            pendingInvites,
        };
    }

    async revokePendingStaffInvite(input: {
        actorUserId: string;
        actorPlatformRole: string | null | undefined;
        inviteId: string;
    }) {
        if (!canManageNexBatchPortalStaff(input.actorPlatformRole)) {
            throw new AppError("Forbidden", 403);
        }
        const actorPr = String(input.actorPlatformRole || "").trim();
        const inviteId = String(input.inviteId || "").trim();
        if (!inviteId) {
            throw new AppError("Missing invite id", 400);
        }
        const inv = await this.authRepo.db.platformStaffInvite.findFirst({
            where: { id: inviteId, acceptedAt: null },
            select: { id: true, platformRole: true },
        });
        if (!inv) {
            throw new AppError("Pending invite not found", 404);
        }
        const invRole = (inv.platformRole || "admin") as NexBatchPlatformRole;
        if (invRole === "owner" && actorPr !== "owner") {
            throw new AppError("Only a NexBatch owner can revoke an Owner (full platform) invite.", 403);
        }
        await this.authRepo.db.platformStaffInvite.delete({ where: { id: inv.id } });
        return { ok: true };
    }

    async updateStaff(input: {
        actorUserId: string;
        actorPlatformRole: string | null | undefined;
        userId: string;
        tier?: NexBatchInviteUiTier;
        active?: boolean;
    }) {
        if (!canManageNexBatchPortalStaff(input.actorPlatformRole)) {
            throw new AppError("Forbidden", 403);
        }
        const actorPr = String(input.actorPlatformRole || "").trim();
        const { assignableIds } = await this.actorAssignableScope(input.actorUserId, input.actorPlatformRole);
        const companyIds = [...assignableIds];

        const scopedWhere = canSeeAllCompaniesAsPlatform(actorPr)
            ? { platformRole: { not: null } as const }
            : {
                platformRole: { not: null } as const,
                memberships: { some: { companyId: { in: companyIds } } },
            };

        const target = await this.authRepo.db.user.findFirst({
            where: { id: input.userId, ...scopedWhere },
            select: {
                id: true,
                email: true,
                platformRole: true,
            },
        });
        if (!target) {
            throw new AppError("Staff user not found.", 404);
        }
        const currentRole = (target.platformRole || "admin") as NexBatchPlatformRole;
        if (actorPr !== "owner" && currentRole === "owner") {
            throw new AppError("Only a NexBatch owner can edit an Owner (full platform) account.", 403);
        }
        if (input.tier) {
            const tierDeny = nexbatchPortalInviteTierViolatesPolicy(actorPr, input.tier);
            if (tierDeny) {
                throw new AppError(tierDeny, 403);
            }
        }
        const nextRole: NexBatchPlatformRole = input.tier
            ? nexBatchInviteTierToPlatformRole(input.tier)
            : currentRole;
        if (nextRole === "owner" && actorPr !== "owner") {
            throw new AppError("Only a NexBatch owner can assign Owner (full platform).", 403);
        }

        await this.authRepo.db.user.update({
            where: { id: input.userId },
            data: {
                platformRole: nextRole,
                ...(typeof input.active === "boolean" ? { isActive: input.active } : {}),
            },
        });
        const updated = await this.authRepo.db.user.findUnique({
            where: { id: input.userId },
            select: {
                id: true,
                email: true,
                platformRole: true,
                isActive: true,
                createdAt: true,
                _count: { select: { memberships: true } },
            },
        });
        if (!updated)
            throw new AppError("Staff user not found after update.", 500);

        return {
            id: updated.id,
            email: updated.email,
            platformRole: String(updated.platformRole || "admin"),
            tier: platformRoleToNexBatchInviteUiTier(String(updated.platformRole || "admin")),
            roleLabel: nexBatchPlatformRoleInviteLabel(String(updated.platformRole || "admin")),
            active: Boolean(updated.isActive),
            companiesGranted: updated._count.memberships,
            createdAt: updated.createdAt.toISOString(),
        };
    }

    async updatePortalStaffCompanyAccess(input: {
        actorUserId: string;
        actorPlatformRole: string | null | undefined;
        targetUserId: string;
        add?: string[];
        remove?: string[];
    }) {
        if (!canManageNexBatchPortalStaff(input.actorPlatformRole)) {
            throw new AppError("Forbidden", 403);
        }
        const actorPr = String(input.actorPlatformRole || "").trim();
        const { assignableIds } = await this.actorAssignableScope(input.actorUserId, input.actorPlatformRole);

        const addIds = [...new Set(input.add ?? [])];
        const removeIds = [...new Set(input.remove ?? [])];
        for (const id of [...addIds, ...removeIds]) {
            if (!assignableIds.has(id)) {
                throw new AppError("One or more companies are not in your assignable scope.", 403);
            }
        }

        const scopedWhere = canSeeAllCompaniesAsPlatform(actorPr)
            ? { platformRole: { not: null } as const }
            : {
                platformRole: { not: null } as const,
                memberships: { some: { companyId: { in: [...assignableIds] } } },
            };

        const target = await this.authRepo.db.user.findFirst({
            where: { id: input.targetUserId, ...scopedWhere },
            select: { id: true, platformRole: true },
        });
        if (!target) {
            throw new AppError("Portal staff user not found.", 404);
        }

        const memRole = companyMembershipRoleForPlatformOperator();

        await this.authRepo.db.$transaction(async (tx) => {
            for (const companyId of removeIds) {
                await tx.companyMembership.deleteMany({
                    where: { userId: target.id, companyId },
                });
            }
            for (const companyId of addIds) {
                const existing = await tx.companyMembership.findFirst({
                    where: { userId: target.id, companyId },
                    select: { id: true },
                });
                if (!existing) {
                    await tx.companyMembership.create({
                        data: {
                            userId: target.id,
                            companyId,
                            role: memRole,
                        },
                    });
                }
            }
            const cnt = await tx.companyMembership.count({ where: { userId: target.id } });
            if (cnt < 1) {
                throw new AppError(
                    "Refusing to remove the last workspace: portal staff must keep access to at least one company.",
                    400,
                );
            }
        });

        const count = await this.authRepo.db.companyMembership.count({
            where: { userId: target.id },
        });
        logInfo("nexbatch_staff_company_access_updated", {
            actorUserId: input.actorUserId,
            targetUserId: target.id,
            added: addIds.length,
            removed: removeIds.length,
            totalMemberships: count,
        });
        return { ok: true as const, memberships: count };
    }
}
