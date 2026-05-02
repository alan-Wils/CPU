import { TenantRepository } from "./TenantRepository.js";
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
    async findOpenInviteByTokenHash(tokenHash) {
        return this.db.inviteToken.findFirst({
            where: {
                tokenHash,
                acceptedAt: null,
                expiresAt: { gt: new Date() }
            }
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
            return user;
        });
    }
}
