import crypto from "node:crypto";
import { TenantRepository } from "./TenantRepository.js";
export class AdminRepository extends TenantRepository {
    async listUsers(companyId) {
        return this.db.user.findMany({
            where: { companyId },
            orderBy: { createdAt: "desc" },
            select: { id: true, email: true, role: true, isActive: true, createdAt: true }
        });
    }
    async updateUserStatus(companyId, userId, isActive) {
        return this.db.user.updateMany({
            where: { companyId, id: userId },
            data: { isActive }
        });
    }
    async findUserById(companyId, userId) {
        return this.db.user.findFirst({ where: { companyId, id: userId } });
    }
    async updateUser(companyId, userId, data) {
        return this.db.user.updateMany({
            where: { companyId, id: userId },
            data
        });
    }
    async deleteUser(companyId, userId) {
        return this.db.user.deleteMany({
            where: { companyId, id: userId }
        });
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
}
