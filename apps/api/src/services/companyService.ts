import bcrypt from "bcryptjs";
import { AppError } from "../errors/AppError.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { AuditService } from "./auditService.js";
export class CompanyService {
    repo = new CompanyRepository();
    auditService = new AuditService();
    async getMyCompany(companyId) {
        return this.repo.getById(companyId);
    }
    async createCompany(input) {
        const ownerPasswordHash = await bcrypt.hash(input.ownerPassword, 12);
        const created = await this.repo.createCompanyWithOwner({
            name: input.name,
            slug: input.slug,
            ownerEmail: input.ownerEmail,
            ownerPasswordHash
        });
        await this.auditService.logAction({
            companyId: input.actorCompanyId || created.id,
            actorUserId: input.actorUserId,
            action: "company.create",
            entityType: "Company",
            entityId: created.id,
            after: { id: created.id, slug: created.slug }
        });
        return created;
    }
    async createUser(input) {
        if (input.role === "OWNER") {
            throw new AppError("Owner can only be created at application bootstrap", 403);
        }
        const passwordHash = await bcrypt.hash(input.password, 12);
        const user = await this.repo.createUser(input.companyId, {
            email: input.email,
            passwordHash,
            role: input.role
        });
        await this.auditService.logAction({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: "user.create",
            entityType: "User",
            entityId: user.id,
            after: { email: user.email, role: user.role }
        });
        return user;
    }
    async listUsers(companyId) {
        return this.repo.listUsers(companyId);
    }
    async listCompanies() {
        return this.repo.listCompanies();
    }
    async listAccessibleCompanies(userId) {
        return this.repo.listAccessibleCompaniesForUser(userId);
    }
    async updateCompany(input) {
        const updated = await this.repo.updateCompany(input.companyId, {
            name: input.name,
            slug: input.slug
        });
        await this.auditService.logAction({
            companyId: input.actorCompanyId,
            actorUserId: input.actorUserId,
            action: "company.update",
            entityType: "Company",
            entityId: updated.id,
            after: { name: updated.name, slug: updated.slug }
        });
        return updated;
    }
    async assignOwner(input) {
        const target = await this.repo.findCompanyUser(input.companyId, input.targetUserId);
        if (!target) {
            throw new AppError("Target user is not in selected company", 404);
        }
        const changed = await this.repo.setUserRole(input.companyId, input.targetUserId, "OWNER");
        if (changed.count === 0) {
            throw new AppError("Could not assign owner", 400);
        }
        await this.auditService.logAction({
            companyId: input.actorCompanyId,
            actorUserId: input.actorUserId,
            action: "company.owner.assign",
            entityType: "User",
            entityId: input.targetUserId,
            after: { role: "OWNER", companyId: input.companyId }
        });
        return { ok: true };
    }
}
