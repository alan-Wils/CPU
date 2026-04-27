import crypto from "node:crypto";
import { TenantRepository } from "./TenantRepository.js";

export class AdminRepository extends TenantRepository {
  async listUsers(companyId: string) {
    return this.db.user.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, role: true, isActive: true, createdAt: true }
    });
  }

  async updateUserStatus(companyId: string, userId: string, isActive: boolean) {
    return this.db.user.updateMany({
      where: { companyId, id: userId },
      data: { isActive }
    });
  }

  async findUserById(companyId: string, userId: string) {
    return this.db.user.findFirst({ where: { companyId, id: userId } });
  }

  async updateUser(companyId: string, userId: string, data: { email?: string; role?: any; isActive?: boolean }) {
    return this.db.user.updateMany({
      where: { companyId, id: userId },
      data
    });
  }

  async deleteUser(companyId: string, userId: string) {
    return this.db.user.deleteMany({
      where: { companyId, id: userId }
    });
  }

  async createInvite(input: {
    companyId: string;
    email: string;
    role: any;
    createdBy: string;
    expiresAt: Date;
  }) {
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
