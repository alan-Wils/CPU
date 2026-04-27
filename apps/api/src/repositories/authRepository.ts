import { TenantRepository } from "./TenantRepository.js";

export class AuthRepository extends TenantRepository {
  async findUserByEmail(email: string) {
    return this.db.user.findUnique({ where: { email }, include: { company: true } });
  }

  async findCompanyByCode(slug: string) {
    return this.db.company.findUnique({ where: { slug } });
  }

  async createPasswordResetToken(userId: string, tokenHash: string, expiresAt: Date) {
    return this.db.passwordResetToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt
      }
    });
  }

  async findOpenInviteByTokenHash(tokenHash: string) {
    return this.db.inviteToken.findFirst({
      where: {
        tokenHash,
        acceptedAt: null,
        expiresAt: { gt: new Date() }
      }
    });
  }

  async acceptInviteCreateUser(inviteId: string, data: { companyId: string; email: string; role: any; passwordHash: string }) {
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
