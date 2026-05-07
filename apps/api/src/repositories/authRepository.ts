import type { NexBatchPlatformRole } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { TenantRepository } from "./TenantRepository.js";

function parseCompanyIdsJson(value: unknown): string[] {
    if (!Array.isArray(value))
        return [];
    return value.filter((x): x is string => typeof x === "string" && x.length > 0);
}
export class AuthRepository extends TenantRepository {
    async findUserByIdWithCompany(userId) {
        return this.db.user.findFirst({
            where: { id: userId },
            include: {
                company: true,
                memberships: { include: { company: true } },
            },
        });
    }
    async findUserByEmail(email) {
        const e = email.trim().toLowerCase();
        return this.db.user.findFirst({
            where: { email: { equals: e, mode: "insensitive" } },
            include: {
                company: true,
                memberships: { include: { company: true } },
            },
        });
    }
    /** Login with short handle (`Alan.w`) when company slug matches (case-insensitive). */
    async findUsersByCompanySlugAndEmailLocalPart(slugInput, localPart) {
        const slug = slugInput.trim().toLowerCase();
        const lp = localPart.trim();
        const company = await this.db.company.findFirst({
            where: { slug: { equals: slug, mode: "insensitive" } },
        });
        if (!company)
            return [];
        const prefix = `${lp}@`;
        return this.db.user.findMany({
            where: {
                isActive: true,
                memberships: { some: { companyId: company.id } },
                email: { startsWith: prefix, mode: "insensitive" },
            },
            include: {
                company: true,
                memberships: { include: { company: true } },
            },
        });
    }
    async findCompanyByCode(slug) {
        return this.db.company.findUnique({ where: { slug } });
    }
    async findMembership(userId, companyId) {
        return this.db.companyMembership.findFirst({
            where: { userId, companyId },
            include: { company: true },
        });
    }
    async listMembershipsWithCompanies(userId) {
        return this.db.companyMembership.findMany({
            where: { userId },
            include: { company: true },
            orderBy: { createdAt: "asc" },
        });
    }
    async createPasswordResetToken(userId, tokenHash, expiresAt) {
        return this.db.passwordResetToken.create({
            data: {
                userId,
                tokenHash,
                expiresAt
            }
        });
    }
    async deleteUnusedPasswordResetsForUser(userId) {
        return this.db.passwordResetToken.deleteMany({
            where: { userId, usedAt: null },
        });
    }
    async findOpenPasswordResetByTokenHash(tokenHash) {
        return this.db.passwordResetToken.findFirst({
            where: {
                tokenHash,
                usedAt: null,
                expiresAt: { gt: new Date() },
            },
            include: { user: true },
        });
    }
    async findOpenInviteByTokenHash(tokenHash) {
        return this.db.inviteToken.findFirst({
            where: {
                tokenHash,
                acceptedAt: null,
                expiresAt: { gt: new Date() }
            }
        });
    }
    async findOpenPlatformStaffInviteByTokenHash(tokenHash) {
        return this.db.platformStaffInvite.findFirst({
            where: {
                tokenHash,
                acceptedAt: null,
                expiresAt: { gt: new Date() },
            },
        });
    }
    async findPendingPlatformStaffInviteByEmail(email) {
        const e = String(email).trim().toLowerCase();
        return this.db.platformStaffInvite.findFirst({
            where: {
                email: e,
                acceptedAt: null,
                expiresAt: { gt: new Date() },
            },
        });
    }
    async createPlatformStaffInvite(data) {
        return this.db.platformStaffInvite.create({
            data: {
                email: data.email,
                platformRole: data.platformRole,
                companyIds: data.companyIds as unknown as Prisma.InputJsonValue,
                tokenHash: data.tokenHash,
                expiresAt: data.expiresAt,
                createdBy: data.createdBy,
            },
        });
    }
    /** Open invites (`acceptedAt` null); includes expired rows until revoked or accepted. */
    async listOpenPlatformStaffInvites() {
        return this.db.platformStaffInvite.findMany({
            where: { acceptedAt: null },
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                email: true,
                platformRole: true,
                companyIds: true,
                expiresAt: true,
                createdAt: true,
            },
        });
    }
    async acceptInviteCreateUser(inviteId, data) {
        return this.db.$transaction(async (tx) => {
            const nexRole = data.nexCompanyRole;
            const user = await tx.user.create({
                data: {
                    companyId: data.companyId,
                    email: data.email,
                    role: data.role,
                    passwordHash: data.passwordHash,
                    memberships: {
                        create: {
                            companyId: data.companyId,
                            role: nexRole,
                        },
                    },
                },
                include: { company: true, memberships: { include: { company: true } } }
            });
            await tx.inviteToken.update({
                where: { id: inviteId },
                data: { acceptedAt: new Date() }
            });
            if (data.role === "OWNER") {
                await tx.company.update({
                    where: { id: data.companyId },
                    data: { lifecycleStatus: "active" }
                });
            }
            return user;
        });
    }
    /**
     * Completes a NexBatch portal staff invite: creates platform user + memberships, marks invite accepted.
     */
    async acceptPlatformStaffInviteAcceptUser(input: { inviteId: string; passwordHash: string }) {
        return this.db.$transaction(async (tx) => {
            const inv = await tx.platformStaffInvite.findFirst({
                where: {
                    id: input.inviteId,
                    acceptedAt: null,
                    expiresAt: { gt: new Date() },
                },
            });
            if (!inv) {
                throw new Error("PLATFORM_STAFF_INVITE_INVALID");
            }
            const companyIds = parseCompanyIdsJson(inv.companyIds);
            if (!companyIds.length) {
                throw new Error("PLATFORM_STAFF_INVITE_EMPTY");
            }
            const user = await tx.user.create({
                data: {
                    email: inv.email.trim().toLowerCase(),
                    passwordHash: input.passwordHash,
                    role: "OWNER",
                    companyId: null,
                    platformRole: inv.platformRole as NexBatchPlatformRole,
                    isActive: true,
                    memberships: {
                        create: companyIds.map((companyId) => ({
                            companyId,
                            role: "owner",
                        })),
                    },
                },
                include: { company: true, memberships: { include: { company: true } } },
            });
            await tx.platformStaffInvite.update({
                where: { id: inv.id },
                data: { acceptedAt: new Date() },
            });
            return user;
        });
    }
}
