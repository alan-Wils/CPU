import crypto from "node:crypto";
import { TenantRepository } from "./TenantRepository.js";
import { legacyUserRoleToCompanyRole } from "../lib/nexbatchRoles.js";
export class AdminRepository extends TenantRepository {
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
    async updateUserStatus(companyId, userId, isActive) {
        const u = await this.findUserById(companyId, userId);
        if (!u)
            return { count: 0 };
        return this.db.user.updateMany({
            where: { id: userId },
            data: { isActive },
        });
    }
    async findUserById(companyId, userId) {
        const m = await this.db.companyMembership.findFirst({
            where: { companyId, userId },
            include: { user: true },
        });
        return m?.user ?? null;
    }
    async updateUser(companyId, userId, data) {
        const m = await this.db.companyMembership.findFirst({
            where: { companyId, userId },
        });
        if (!m)
            return { count: 0 };
        if (data.role) {
            const nex = legacyUserRoleToCompanyRole(data.role);
            await this.db.companyMembership.update({
                where: { id: m.id },
                data: { role: nex },
            });
        }
        return this.db.user.updateMany({
            where: { id: userId },
            data,
        });
    }
    async deleteUser(companyId, userId) {
        const before = await this.db.companyMembership.findFirst({
            where: { companyId, userId },
        });
        if (!before)
            return { count: 0 };
        await this.db.companyMembership.deleteMany({
            where: { companyId, userId },
        });
        const remaining = await this.db.companyMembership.count({ where: { userId } });
        if (remaining === 0) {
            return this.db.user.deleteMany({ where: { id: userId } });
        }
        return { count: 1 };
    }
    async createInvite(input) {
        const rawToken = crypto.randomBytes(24).toString("hex");
        const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
        const invite = await this.db.inviteToken.create({
            data: {
                companyId: input.companyId,
                email: input.email,
                role: input.role,
                createdBy: input.createdBy,
                expiresAt: input.expiresAt,
                tokenHash
            }
        });
        return { invite, token: rawToken };
    }
    async listPendingInvites(companyId) {
        return this.db.inviteToken.findMany({
            where: {
                companyId,
                acceptedAt: null,
                expiresAt: { gt: new Date() },
            },
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                email: true,
                role: true,
                expiresAt: true,
                createdAt: true,
            },
        });
    }
    async deletePendingInvite(companyId, inviteId) {
        return this.db.inviteToken.deleteMany({
            where: {
                companyId,
                id: inviteId,
                acceptedAt: null,
            },
        });
    }
}
