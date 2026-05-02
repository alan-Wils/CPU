import bcrypt from "bcryptjs";
import { resolvePublicWebBaseUrl } from "../config/publicWebUrl.js";
import { AppError } from "../errors/AppError.js";
import { isPlatformOperator } from "../lib/nexbatchRoles.js";
import { logInfo } from "../lib/logger.js";
import { sendInviteEmail } from "../lib/mailer.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { AuditService } from "./auditService.js";
export class CompanyService {
    repo = new CompanyRepository();
    auditService = new AuditService();
    async getMyCompany(companyId) {
        return this.repo.getById(companyId);
    }
    async createCompany(input) {
        const slug = String(input.slug).trim().toLowerCase();
        const email = String(input.ownerEmail).trim().toLowerCase();
        if (await this.repo.findUserByEmail(email)) {
            throw new AppError("That email is already registered. Use a different address for the owner invite.", 409);
        }
        if (await this.repo.findCompanyBySlug(slug)) {
            throw new AppError("That company code (slug) is already taken.", 409);
        }
        const { company, invite, rawToken } = await this.repo.createCompanyAndOwnerInvite({
            name: input.name,
            slug,
            ownerEmail: email,
            createdBy: input.actorUserId,
            platformOperatorUserId: input.actorUserId
        });
        await this.auditService.logAction({
            companyId: input.actorCompanyId || company.id,
            actorUserId: input.actorUserId,
            action: "company.create",
            entityType: "Company",
            entityId: company.id,
            after: { id: company.id, slug: company.slug, ownerInviteId: invite.id }
        });
        const baseUrl = resolvePublicWebBaseUrl();
        const inviteUrl = `${baseUrl}/accept-invite?token=${encodeURIComponent(rawToken)}`;
        logInfo("company_create_owner_invite", { companyId: company.id, inviteId: invite.id, webBaseUrl: baseUrl });
        void sendInviteEmail({
            to: email,
            inviteUrl,
            companyName: company.name,
            role: "Application Owner"
        }).then(() => logInfo("company_owner_invite_email_sent", { to: email }), (err) => {
            console.error("[mail] Failed to send company owner invite email:", err);
        });
        return {
            id: company.id,
            name: company.name,
            slug: company.slug,
            code: company.slug.toUpperCase(),
            createdAt: company.createdAt,
            lifecycleStatus: company.lifecycleStatus ?? "invited",
            usersCount: 1,
            ownerInvite: {
                id: invite.id,
                email: invite.email,
                role: invite.role,
                expiresAt: invite.expiresAt.toISOString()
            },
            inviteSent: true
        };
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
    async listAccessibleCompanies(userId, opts) {
        return this.repo.listAccessibleCompaniesForUser(userId, {
            includeBootstrapInvites: isPlatformOperator(opts?.platformRole),
        });
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
