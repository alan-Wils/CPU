import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { env } from "../config/env.js";
import { AppError } from "../errors/AppError.js";
import { AuthRepository } from "../repositories/authRepository.js";

export class AuthService {
  private readonly repo = new AuthRepository();

  async login(input: {
    email: string;
    password: string;
    companyCode?: string;
    remember?: boolean;
  }): Promise<{ token: string; user: { id: string; role: string; companyId: string; companyCode: string } }> {
    const { email, password, companyCode } = input;
    const user = await this.repo.findUserByEmail(email);
    if (!user || !user.isActive) {
      throw new AppError("Invalid credentials", 401);
    }
    if (companyCode && user.company.slug !== companyCode && user.role !== "OWNER") {
      throw new AppError("Company code does not match this account", 403);
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new AppError("Invalid credentials", 401);
    }

    const token = jwt.sign(
      { userId: user.id, companyId: user.companyId, role: user.role },
      env.JWT_SECRET,
      { expiresIn: input.remember ? "7d" : (env.JWT_EXPIRES_IN as any) }
    );

    return {
      token,
      user: {
        id: user.id,
        role: user.role,
        companyId: user.companyId,
        companyCode: user.company.slug
      }
    };
  }

  async requestPasswordReset(email: string): Promise<{ ok: true }> {
    const user = await this.repo.findUserByEmail(email);
    if (!user) {
      return { ok: true };
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 1000 * 60 * 30);
    await this.repo.createPasswordResetToken(user.id, tokenHash, expiresAt);

    return { ok: true };
  }

  async acceptInvite(input: { token: string; password: string }): Promise<{ token: string; user: { id: string; role: string; companyId: string; companyCode: string } }> {
    const tokenHash = crypto.createHash("sha256").update(input.token).digest("hex");
    const invite = await this.repo.findOpenInviteByTokenHash(tokenHash);
    if (!invite) {
      throw new AppError("Invite is invalid or expired", 400);
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await this.repo.acceptInviteCreateUser(invite.id, {
      companyId: invite.companyId,
      email: invite.email,
      role: invite.role,
      passwordHash
    });

    const authToken = jwt.sign(
      { userId: user.id, companyId: user.companyId, role: user.role },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN as any }
    );

    return {
      token: authToken,
      user: {
        id: user.id,
        role: user.role,
        companyId: user.companyId,
        companyCode: user.company.slug
      }
    };
  }
}
