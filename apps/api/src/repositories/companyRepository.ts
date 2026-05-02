import { TenantRepository } from "./TenantRepository.js";
import { legacyUserRoleToCompanyRole } from "../lib/nexbatchRoles.js";
export class CompanyRepository extends TenantRepository {
    async getById(companyId) {
        return this.db.company.findUnique({ where: { id: companyId } });
    }
    async createCompanyWithOwner(input) {
        return this.db.$transaction(async (tx) => {
            const company = await tx.company.create({
                data: {
                    name: input.name,
                    slug: input.slug,
                    nextChainSequence: 0,
                },
            });
            const nex = legacyUserRoleToCompanyRole("OWNER");
            const user = await tx.user.create({
                data: {
                    companyId: company.id,
                    email: input.ownerEmail,
                    passwordHash: input.ownerPasswordHash,
                    role: "OWNER",
                    memberships: {
                        create: {
                            companyId: company.id,
                            role: nex,
                        },
                    },
                },
            });
            return { ...company, users: [user] };
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
    async listAccessibleCompaniesForUser(userId) {
        const rows = await this.db.companyMembership.findMany({
            where: { userId },
            include: {
                company: {
                    select: {
                        id: true,
                        name: true,
                        slug: true,
                        createdAt: true,
                        _count: { select: { memberships: true } },
                    },
                },
            },
            orderBy: { createdAt: "asc" },
        });
        return rows.map((r) => ({
            id: r.company.id,
            name: r.company.name,
            slug: r.company.slug,
            code: r.company.slug.toUpperCase(),
            createdAt: r.company.createdAt,
            usersCount: r.company._count.memberships,
        }));
    }
    async listCompanies() {
        const rows = await this.db.company.findMany({
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                name: true,
                slug: true,
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
