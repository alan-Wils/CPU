import { TenantRepository } from "./TenantRepository.js";
export class AuthRepository extends TenantRepository {
    async findUserByEmail(email) {
        return this.db.user.findUnique({ where: { email }, include: { company: true } });
    }
    async findCompanyByCode(slug) {
        return this.db.company.findUnique({ where: { slug } });
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
            const user = await tx.user.create({
                data: {
                    companyId: data.companyId,
                    email: data.email,
                    role: data.role,
                    passwordHash: data.passwordHash
                },
                include: { company: true }
            });
            await tx.inviteToken.update({
                where: { id: inviteId },
                data: { acceptedAt: new Date() }
            });
            return user;
        });
    }
}
