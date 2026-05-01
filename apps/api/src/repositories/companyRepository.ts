import { TenantRepository } from "./TenantRepository.js";
export class CompanyRepository extends TenantRepository {
    async getById(companyId) {
        return this.db.company.findUnique({ where: { id: companyId } });
    }
    async createCompanyWithOwner(input) {
        return this.db.company.create({
            data: {
                name: input.name,
                slug: input.slug,
                users: {
                    create: {
                        email: input.ownerEmail,
                        passwordHash: input.ownerPasswordHash,
                        role: "OWNER"
                    }
                }
            },
            include: { users: true }
        });
    }
    async createUser(companyId, input) {
        return this.db.user.create({
            data: {
                companyId,
                email: input.email,
                passwordHash: input.passwordHash,
                role: input.role
            }
        });
    }
    async listUsers(companyId) {
        return this.db.user.findMany({
            where: { companyId },
            orderBy: { createdAt: "desc" },
            select: { id: true, email: true, role: true, isActive: true, createdAt: true }
        });
    }
    async listCompanies() {
        return this.db.company.findMany({
            orderBy: { createdAt: "desc" },
            select: { id: true, name: true, slug: true, createdAt: true }
        });
    }
    async updateCompany(companyId, data) {
        return this.db.company.update({
            where: { id: companyId },
            data
        });
    }
    async findCompanyUser(companyId, userId) {
        return this.db.user.findFirst({
            where: { companyId, id: userId }
        });
    }
    async setUserRole(companyId, userId, role) {
        return this.db.user.updateMany({
            where: { companyId, id: userId },
            data: { role }
        });
    }
}
