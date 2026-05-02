import crypto from "node:crypto";
import { UserRole } from "@prisma/client";
import { TenantRepository } from "./TenantRepository.js";
import { legacyUserRoleToCompanyRole } from "../lib/nexbatchRoles.js";
export class CompanyRepository extends TenantRepository {
    async getById(companyId) {
        return this.db.company.findUnique({ where: { id: companyId } });
    }
    async findUserByEmail(email) {
        return this.db.user.findUnique({ where: { email: String(email).trim().toLowerCase() } });
    }
    async findCompanyBySlug(slug) {
        return this.db.company.findUnique({ where: { slug: String(slug).trim().toLowerCase() } });
    }
    /**
     * New tenant with no users yet; owner accepts the same email invite flow as Admin → Invite.
     */
    async createCompanyAndOwnerInvite(input) {
        return this.db.$transaction(async (tx) => {
            const company = await tx.company.create({
                data: {
                    name: input.name,
                    slug: input.slug,
                    nextChainSequence: 0,
                    lifecycleStatus: "invited",
                },
            });
            await tx.companyMembership.create({
                data: {
                    userId: input.platformOperatorUserId,
                    companyId: company.id,
                    role: legacyUserRoleToCompanyRole("ADMIN"),
                },
            });
            const rawToken = crypto.randomBytes(24).toString("hex");
            const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
            const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
            const invite = await tx.inviteToken.create({
                data: {
                    companyId: company.id,
                    email: String(input.ownerEmail).trim().toLowerCase(),
                    role: "OWNER",
                    createdBy: input.createdBy,
                    expiresAt,
                    tokenHash,
                },
            });
            return { company, invite, rawToken };
        });
    }
    async createUser(companyId, input) {
        const nex = legacyUserRoleToCompanyRole(input.role);
        return this.db.user.create({
            data: {
                companyId,
                email: input.email,
                passwordHash: input.passwordHash,
                role: input.role,
                memberships: {
                    create: {
                        companyId,
                        role: nex,
                    },
                },
            },
        });
    }
    async listUsers(companyId) {
        const rows = await this.db.companyMembership.findMany({
            where: { companyId },
            include: {
                user: {
                    select: { id: true, email: true, role: true, isActive: true, createdAt: true },
                },
            },
            orderBy: { createdAt: "desc" },
        });
        return rows.map((r) => r.user);
    }
    /**
     * If this user created the OWNER invite for the company but has no membership (data skew),
     * add the same admin membership as `createCompanyAndOwnerInvite` so portal switch and API scope work.
     */
    async ensureOperatorMembershipFromOwnerInviteBootstrap(userId, companyId) {
        const has = await this.db.companyMembership.findFirst({
            where: { userId, companyId },
            select: { id: true },
        });
        if (has)
            return true;
        const invite = await this.db.inviteToken.findFirst({
            where: { createdBy: userId, companyId, role: UserRole.OWNER },
            select: { id: true },
        });
        if (!invite)
            return false;
        await this.db.companyMembership.create({
            data: {
                userId,
                companyId,
                role: legacyUserRoleToCompanyRole("ADMIN"),
            },
        });
        return true;
    }
    rowToAccessibleCompany(company) {
        return {
            id: company.id,
            name: company.name,
            slug: company.slug,
            code: company.slug.toUpperCase(),
            createdAt: company.createdAt,
            usersCount: company._count.memberships,
            lifecycleStatus: company.lifecycleStatus ?? "active",
        };
    }
    /**
     * Tenants the user may open from the NexBatch portal: memberships, plus (for platform operators)
     * any company where this user created the OWNER bootstrap invite — covers missing `CompanyMembership`
     * rows from older deploys or failed transactions without duplicating entries when both exist.
     */
    async listAccessibleCompaniesForUser(userId, opts) {
        const includeBootstrapInvites = Boolean(opts?.includeBootstrapInvites);
        const rows = await this.db.companyMembership.findMany({
            where: { userId },
            include: {
                company: {
                    select: {
                        id: true,
                        name: true,
                        slug: true,
                        lifecycleStatus: true,
                        createdAt: true,
                        _count: { select: { memberships: true } },
                    },
                },
            },
            orderBy: { createdAt: "asc" },
        });
        const map = new Map();
        for (const r of rows) {
            map.set(r.company.id, this.rowToAccessibleCompany(r.company));
        }
        if (includeBootstrapInvites) {
            const bootstrapInvites = await this.db.inviteToken.findMany({
                where: { createdBy: userId, role: UserRole.OWNER },
                include: {
                    company: {
                        select: {
                            id: true,
                            name: true,
                            slug: true,
                            lifecycleStatus: true,
                            createdAt: true,
                            _count: { select: { memberships: true } },
                        },
                    },
                },
                orderBy: { createdAt: "desc" },
            });
            const seenCompanyId = new Set();
            for (const inv of bootstrapInvites) {
                if (seenCompanyId.has(inv.companyId))
                    continue;
                seenCompanyId.add(inv.companyId);
                if (map.has(inv.company.id))
                    continue;
                map.set(inv.company.id, this.rowToAccessibleCompany(inv.company));
            }
        }
        return [...map.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    }
    async listCompanies() {
        const rows = await this.db.company.findMany({
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                name: true,
                slug: true,
                lifecycleStatus: true,
                createdAt: true,
                _count: { select: { memberships: true } },
            },
        });
        return rows.map((r) => ({
            id: r.id,
            name: r.name,
            slug: r.slug,
            code: r.slug.toUpperCase(),
            createdAt: r.createdAt,
            usersCount: r._count.memberships,
            lifecycleStatus: r.lifecycleStatus ?? "active",
        }));
    }
    async updateCompany(companyId, data) {
        await this.db.company.update({
            where: { id: companyId },
            data,
        });
        const row = await this.db.company.findUnique({
            where: { id: companyId },
            select: {
                id: true,
                name: true,
                slug: true,
                lifecycleStatus: true,
                createdAt: true,
                _count: { select: { memberships: true } },
            },
        });
        if (!row)
            throw new Error("Company missing after update");
        return {
            id: row.id,
            name: row.name,
            slug: row.slug,
            code: row.slug.toUpperCase(),
            createdAt: row.createdAt,
            usersCount: row._count.memberships,
            lifecycleStatus: row.lifecycleStatus ?? "active",
        };
    }
    async findCompanyUser(companyId, userId) {
        const m = await this.db.companyMembership.findFirst({
            where: { companyId, userId },
            include: { user: true },
        });
        return m?.user ?? null;
    }
    async setUserRole(companyId, userId, role) {
        const nex = legacyUserRoleToCompanyRole(role);
        await this.db.companyMembership.updateMany({
            where: { companyId, userId },
            data: { role: nex },
        });
        return this.db.user.updateMany({
            where: { id: userId },
            data: { role },
        });
    }
}
