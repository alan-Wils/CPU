import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import crypto from "node:crypto";
import type { Company, User } from "@prisma/client";
import { env } from "../config/env.js";
import { AppError } from "../errors/AppError.js";
import { AuthRepository } from "../repositories/authRepository.js";
import {
    companyRoleToLegacyRbac,
    isPlatformOperator,
    legacyUserRoleToCompanyRole,
    platformRoleToLegacyRbac,
} from "../lib/nexbatchRoles.js";

type UserWithRelations = User & {
    company: Company | null;
    memberships: Array<{ companyId: string; role: string; company: Company }>;
};

export type JwtSession = {
    userId: string;
    companyId: string;
    role: string;
    sessionKind: "company" | "portal";
    platformRole: string | null;
};

export class AuthService {
    repo = new AuthRepository();
    companyPayload(company: Company) {
        const c = company as Company & { lifecycleStatus?: string };
        return {
            id: company.id,
            name: company.name,
            code: company.slug.toUpperCase(),
            lifecycleStatus: c.lifecycleStatus ?? "active",
        };
    }
    issueToken(payload: JwtSession, remember?: boolean) {
        const signOpts = { expiresIn: remember ? "7d" : env.JWT_EXPIRES_IN } as SignOptions;
        return jwt.sign(payload, env.JWT_SECRET, signOpts);
    }
    /** SPA `CpuUser` expects `username` + `email`; DB only stores `email`. */
    sessionUserFields(user: UserWithRelations, effectiveRole: string, activeCompany: Company | null) {
        const email = String(user.email ?? "").trim().toLowerCase();
        const username = email.includes("@")
            ? email.slice(0, email.indexOf("@"))
            : (email || "user");
        const platformRole = user.platformRole ?? null;
        return {
            id: user.id,
            role: effectiveRole,
            companyId: activeCompany?.id ?? user.companyId ?? "",
            companyCode: activeCompany?.slug ?? user.company?.slug ?? "",
            email: email || null,
            username,
            sessionKind: isPlatformOperator(platformRole) ? "portal" : "company",
            platformRole,
        };
    }
    private resolveActiveCompany(user: UserWithRelations, activeCompanyId: string | null | undefined): Company | null {
        const id = String(activeCompanyId ?? "").trim();
        if (id) {
            const m = user.memberships?.find((x) => x.companyId === id);
            if (m?.company)
                return m.company;
            return null;
        }
        if (user.company)
            return user.company;
        return null;
    }
    async getSession(userId: string, jwtCompanyId: string, jwtSessionKind?: string) {
        const user = await this.repo.findUserByIdWithCompany(userId) as UserWithRelations | null;
        if (!user || !user.isActive) {
            throw new AppError("Unauthorized", 401);
        }
        const activeCo = this.resolveActiveCompany(user, jwtCompanyId);
        const scopedId = String(jwtCompanyId ?? "").trim();
        let effectiveRole = String(user.role);
        if (scopedId) {
            const m = user.memberships?.find((x) => x.companyId === scopedId);
            if (m) {
                effectiveRole = companyRoleToLegacyRbac(m.role as never);
                if (isPlatformOperator(user.platformRole))
                    effectiveRole = platformRoleToLegacyRbac(user.platformRole);
            }
        }
        else if (isPlatformOperator(user.platformRole)) {
            effectiveRole = platformRoleToLegacyRbac(user.platformRole);
        }
        return {
            user: this.sessionUserFields(user, effectiveRole, activeCo),
            company: activeCo ? this.companyPayload(activeCo) : null,
            companies: (user.memberships ?? []).map((m) => this.companyPayload(m.company)),
            sessionKind: (jwtSessionKind === "portal" || isPlatformOperator(user.platformRole)) ? "portal" : "company",
        };
    }
    async login(input: { email: string; password: string; companyCode?: string; remember?: boolean }) {
        const identifier = String(input.email ?? "").trim();
        const password = input.password;
        const companyCode =
            typeof input.companyCode === "string" ? input.companyCode.trim().toLowerCase() : undefined;

        if (!companyCode && !identifier.includes("@")) {
            throw new AppError("NexBatch portal sign-in requires your full email address.", 400);
        }

        let user: UserWithRelations | null = null;
        if (identifier.includes("@")) {
            user = await this.repo.findUserByEmail(identifier) as UserWithRelations | null;
        }
        else if (companyCode) {
            const matches = await this.repo.findUsersByCompanySlugAndEmailLocalPart(companyCode, identifier);
            if (matches.length === 1)
                user = matches[0] as UserWithRelations;
            else if (matches.length > 1)
                throw new AppError("Multiple accounts match; sign in with your full email address.", 400);
        }
        else {
            throw new AppError("Enter company code for company sign-in, or full email for NexBatch portal.", 400);
        }

        if (!user || !user.isActive) {
            throw new AppError("Invalid credentials", 401);
        }
        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) {
            throw new AppError("Invalid credentials", 401);
        }

        const remember = Boolean(input.remember);

        if (companyCode) {
            const company = await this.repo.findCompanyByCode(companyCode);
            if (!company) {
                throw new AppError("Unknown company code", 404);
            }
            const membership = await this.repo.findMembership(user.id, company.id);
            if (!membership) {
                throw new AppError("No access to this company for this account", 403);
            }
            const legacyRole = companyRoleToLegacyRbac(membership.role as never);
            const jwtPayload: JwtSession = {
                userId: user.id,
                companyId: company.id,
                role: legacyRole,
                sessionKind: "company",
                platformRole: user.platformRole ?? null,
            };
            const token = this.issueToken(jwtPayload, remember);
            return {
                token,
                user: this.sessionUserFields(user, legacyRole, company),
                company: this.companyPayload(company),
            };
        }

        if (!isPlatformOperator(user.platformRole)) {
            throw new AppError("Company code is required for this account", 403);
        }

        const memberships = await this.repo.listMembershipsWithCompanies(user.id);
        if (!memberships.length) {
            throw new AppError("No company access configured for this platform account", 403);
        }

        let selected = memberships[0];
        if (memberships.length > 1) {
            selected = memberships[0];
            const jwtPayloadNoCompany: JwtSession = {
                userId: user.id,
                companyId: "",
                role: platformRoleToLegacyRbac(user.platformRole),
                sessionKind: "portal",
                platformRole: user.platformRole,
            };
            const token = this.issueToken(jwtPayloadNoCompany, remember);
            return {
                token,
                user: this.sessionUserFields(user, platformRoleToLegacyRbac(user.platformRole), null),
                company: null,
                needsCompanySelection: true,
                companies: memberships.map((m) => this.companyPayload(m.company)),
            };
        }

        const co = selected.company;
        const legacyRole = companyRoleToLegacyRbac(selected.role as never);
        const mergedRole = platformRoleToLegacyRbac(user.platformRole);
        const jwtPayload: JwtSession = {
            userId: user.id,
            companyId: co.id,
            role: mergedRole,
            sessionKind: "portal",
            platformRole: user.platformRole,
        };
        const token = this.issueToken(jwtPayload, remember);
        return {
            token,
            user: this.sessionUserFields(user, mergedRole, co),
            company: this.companyPayload(co),
            needsCompanySelection: false,
        };
    }

    async selectCompany(userId: string, companyId: string, platformRole: string | null | undefined) {
        if (!isPlatformOperator(platformRole as never)) {
            throw new AppError("Company switching is only for NexBatch portal accounts", 403);
        }
        const membership = await this.repo.findMembership(userId, companyId);
        if (!membership?.company) {
            throw new AppError("No access to this company", 403);
        }
        const user = await this.repo.findUserByIdWithCompany(userId) as UserWithRelations | null;
        if (!user?.isActive) {
            throw new AppError("Unauthorized", 401);
        }
        const jwtPayload: JwtSession = {
            userId: user.id,
            companyId: membership.companyId,
            role: platformRoleToLegacyRbac(user.platformRole),
            sessionKind: "portal",
            platformRole: user.platformRole ?? null,
        };
        return {
            token: this.issueToken(jwtPayload, true),
            user: this.sessionUserFields(user, jwtPayload.role, membership.company),
            company: this.companyPayload(membership.company),
        };
    }

    async requestPasswordReset(email: string) {
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
    async acceptInvite(input: { token: string; password: string }) {
        const tokenHash = crypto.createHash("sha256").update(input.token).digest("hex");
        const invite = await this.repo.findOpenInviteByTokenHash(tokenHash);
        if (!invite) {
            throw new AppError("Invite is invalid or expired", 400);
        }
        const passwordHash = await bcrypt.hash(input.password, 12);
        const nexRole = legacyUserRoleToCompanyRole(invite.role);
        const user = await this.repo.acceptInviteCreateUser(invite.id, {
            companyId: invite.companyId,
            email: invite.email,
            role: invite.role,
            nexCompanyRole: nexRole,
            passwordHash
        });
        const inviteSignOpts = { expiresIn: env.JWT_EXPIRES_IN } as SignOptions;
        const u = user as UserWithRelations;
        const co = u.company ?? u.memberships?.[0]?.company;
        if (!co) {
            throw new AppError("Invite setup incomplete", 500);
        }
        const legacyRole = companyRoleToLegacyRbac(nexRole);
        const jwtPayload: JwtSession = {
            userId: user.id,
            companyId: co.id,
            role: legacyRole,
            sessionKind: "company",
            platformRole: u.platformRole ?? null,
        };
        const authToken = jwt.sign({ ...jwtPayload }, env.JWT_SECRET, inviteSignOpts);
        return {
            token: authToken,
            user: this.sessionUserFields(u, legacyRole, co),
            company: this.companyPayload(co)
        };
    }
}
