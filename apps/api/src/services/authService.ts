import { appPermissionSetsEqual, computeEffectiveAppPermissions } from "../lib/appPermissions.js";
import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import type { Company, User } from "@prisma/client";
import { env } from "../config/env.js";
import { resolvePublicWebBaseUrl } from "../config/publicWebUrl.js";
import { sendPasswordResetEmail } from "../lib/mailer.js";
import { AppError } from "../errors/AppError.js";
import { AuthRepository } from "../repositories/authRepository.js";
import {
    canCreateCompanyAsPlatform,
    companyRoleToLegacyRbac,
    isPlatformOperator,
    legacyUserRoleToCompanyRole,
    platformRoleToLegacyRbac,
} from "../lib/nexbatchRoles.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { CompanyService } from "./companyService.js";
import { userDisplayName } from "../lib/userDisplayName.js";

type UserWithRelations = User & {
    company: Company | null;
    memberships: Array<{
        companyId: string;
        role: string;
        company: Company;
        appPermissions?: unknown;
        rewardsEnrolled?: boolean;
    }>;
};

export type JwtSession = {
    userId: string;
    companyId: string;
    role: string;
    sessionKind: "company" | "portal";
    platformRole: string | null;
    permissions: string[];
};

export class AuthService {
    repo = new AuthRepository();
    companyRepo = new CompanyRepository();
    companyService = new CompanyService();
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

    jwtPermissionsForCompany(user: UserWithRelations, effectiveRole: string, companyIdForMembership: string): string[] {
        const cid = String(companyIdForMembership || "").trim();
        if (!cid)
            return computeEffectiveAppPermissions(effectiveRole, null);
        const m = user.memberships?.find((x) => x.companyId === cid);
        return computeEffectiveAppPermissions(effectiveRole, m?.appPermissions ?? null);
    }

    /** Re-sign JWT when DB-backed `permissions` drift from the bearer token (e.g. admin updated grants). */
    issueRefreshedTokenIfNeeded(
        authHeader: string | undefined,
        sessionUser: { permissions?: string[] },
        stable: Pick<JwtSession, "userId" | "companyId" | "role" | "sessionKind" | "platformRole">,
    ): string | undefined {
        if (!authHeader?.startsWith("Bearer "))
            return undefined;
        const raw = authHeader.slice("Bearer ".length);
        let decoded: jwt.JwtPayload & Partial<JwtSession>;
        try {
            decoded = jwt.verify(raw, env.JWT_SECRET) as jwt.JwtPayload & Partial<JwtSession>;
        }
        catch {
            return undefined;
        }
        const nextPerms = sessionUser.permissions ?? [];
        const oldPerms = Array.isArray(decoded.permissions) ? decoded.permissions : [];
        if (appPermissionSetsEqual(oldPerms, nextPerms))
            return undefined;
        const now = Math.floor(Date.now() / 1000);
        const expSec = typeof decoded.exp === "number" ? decoded.exp : 0;
        const ttl = Math.max(120, expSec - now);
        const payload: JwtSession = {
            userId: stable.userId,
            companyId: stable.companyId,
            role: stable.role,
            sessionKind: stable.sessionKind,
            platformRole: stable.platformRole,
            permissions: nextPerms,
        };
        return jwt.sign(payload, env.JWT_SECRET, { expiresIn: ttl } as SignOptions);
    }

    /** SPA `CpuUser` expects `username` + `email`; `username` is the stored display name when set. */
    sessionUserFields(
        user: UserWithRelations,
        effectiveRole: string,
        activeCompany: Company | null,
        permissions: string[],
        rewardsEnrolled = false,
        companyMembershipRole: string | null = null,
    ) {
        const email = String(user.email ?? "").trim().toLowerCase();
        const username = userDisplayName({
            displayName: (user as User & { displayName?: string | null }).displayName,
            email,
        });
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
            permissions,
            rewardsEnrolled,
            companyMembershipRole,
        };
    }

    rewardsEnrolledForScopedCompany(user: UserWithRelations, companyId: string): boolean {
        const cid = String(companyId || "").trim();
        if (!cid)
            return false;
        const m = user.memberships?.find((x) => x.companyId === cid);
        return Boolean(m?.rewardsEnrolled);
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
        let companyMembershipRole: string | null = null;
        if (scopedId) {
            const m = user.memberships?.find((x) => x.companyId === scopedId);
            if (m) {
                companyMembershipRole = String(m.role);
                effectiveRole = companyRoleToLegacyRbac(m.role as never);
                if (isPlatformOperator(user.platformRole))
                    effectiveRole = platformRoleToLegacyRbac(user.platformRole);
            }
        }
        else if (isPlatformOperator(user.platformRole)) {
            effectiveRole = platformRoleToLegacyRbac(user.platformRole);
        }
        const companyKey = scopedId || activeCo?.id || "";
        const permissions = this.jwtPermissionsForCompany(user, effectiveRole, companyKey);
        const rewardsEnrolled = this.rewardsEnrolledForScopedCompany(user, companyKey);
        return {
            user: this.sessionUserFields(user, effectiveRole, activeCo, permissions, rewardsEnrolled, companyMembershipRole),
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
            const permissions = this.jwtPermissionsForCompany(user, legacyRole, company.id);
            const jwtPayload: JwtSession = {
                userId: user.id,
                companyId: company.id,
                role: legacyRole,
                sessionKind: "company",
                platformRole: user.platformRole ?? null,
                permissions,
            };
            const token = this.issueToken(jwtPayload, remember);
            const rewardsEnrolled = Boolean(membership.rewardsEnrolled);
            return {
                token,
                user: this.sessionUserFields(
                    user,
                    legacyRole,
                    company,
                    permissions,
                    rewardsEnrolled,
                    String(membership.role),
                ),
                company: this.companyPayload(company),
            };
        }

        if (!isPlatformOperator(user.platformRole)) {
            throw new AppError("Company code is required for this account", 403);
        }

        const accessible = await this.companyService.listAccessibleCompanies(user.id, {
            platformRole: user.platformRole ?? null,
        });
        if (!accessible.length) {
            throw new AppError("No company access configured for this platform account", 403);
        }

        if (accessible.length > 1) {
            const portalRole = platformRoleToLegacyRbac(user.platformRole);
            const permissions = this.jwtPermissionsForCompany(user, portalRole, "");
            const jwtPayloadNoCompany: JwtSession = {
                userId: user.id,
                companyId: "",
                role: portalRole,
                sessionKind: "portal",
                platformRole: user.platformRole,
                permissions,
            };
            const token = this.issueToken(jwtPayloadNoCompany, remember);
            return {
                token,
                user: this.sessionUserFields(user, portalRole, null, permissions, false, null),
                company: null,
                needsCompanySelection: true,
                companies: accessible.map((c) =>
                    this.companyPayload({
                        id: c.id,
                        name: c.name,
                        slug: c.slug,
                        lifecycleStatus: c.lifecycleStatus,
                    } as Company),
                ),
            };
        }

        const row0 = accessible[0];
        const co = {
            id: row0.id,
            name: row0.name,
            slug: row0.slug,
        } as Company;
        const mergedRole = platformRoleToLegacyRbac(user.platformRole);
        const permissions = this.jwtPermissionsForCompany(user, mergedRole, co.id);
        const jwtPayload: JwtSession = {
            userId: user.id,
            companyId: co.id,
            role: mergedRole,
            sessionKind: "portal",
            platformRole: user.platformRole,
            permissions,
        };
        const token = this.issueToken(jwtPayload, remember);
        const portalRe = this.rewardsEnrolledForScopedCompany(user, co.id);
        const mem0 = user.memberships?.find((x) => x.companyId === co.id);
        return {
            token,
            user: this.sessionUserFields(
                user,
                mergedRole,
                co,
                permissions,
                portalRe,
                mem0 ? String(mem0.role) : null,
            ),
            company: this.companyPayload(co),
            needsCompanySelection: false,
        };
    }

    async selectCompany(userId: string, companyId: string, platformRole: string | null | undefined) {
        if (!isPlatformOperator(platformRole as never)) {
            throw new AppError("Company switching is only for NexBatch portal accounts", 403);
        }
        let membership = await this.repo.findMembership(userId, companyId);
        if (!membership?.company && canCreateCompanyAsPlatform(platformRole)) {
            const repaired = await this.companyRepo.ensureOperatorMembershipFromOwnerInviteBootstrap(userId, companyId);
            if (repaired) {
                membership = await this.repo.findMembership(userId, companyId);
            }
        }
        if (!membership?.company) {
            throw new AppError("No access to this company", 403);
        }
        const user = await this.repo.findUserByIdWithCompany(userId) as UserWithRelations | null;
        if (!user?.isActive) {
            throw new AppError("Unauthorized", 401);
        }
        const portalRole = platformRoleToLegacyRbac(user.platformRole);
        const permissions = this.jwtPermissionsForCompany(user, portalRole, membership.companyId);
        const jwtPayload: JwtSession = {
            userId: user.id,
            companyId: membership.companyId,
            role: portalRole,
            sessionKind: "portal",
            platformRole: user.platformRole ?? null,
            permissions,
        };
        return {
            token: this.issueToken(jwtPayload, true),
            user: this.sessionUserFields(
                user,
                jwtPayload.role,
                membership.company,
                permissions,
                Boolean(membership.rewardsEnrolled),
                String(membership.role),
            ),
            company: this.companyPayload(membership.company),
        };
    }

    /**
     * Public “forgot password” — always returns `{ ok: true }` when email is syntactically valid (privacy).
     */
    async requestPasswordReset(email: string) {
        const clean = String(email || "").trim().toLowerCase();
        if (!clean) return { ok: true };
        await this.issuePasswordResetEmail(clean, { omitIfMissing: true });
        return { ok: true };
    }

    /**
     * Sends reset email when user exists and is active. Used by admin and may return `resetUrl` if mail transport fails (operator fallback).
     */
    async issuePasswordResetEmail(
        email: string,
        opts: { omitIfMissing?: boolean } = {},
    ): Promise<{ emailed: boolean; resetUrl?: string }> {
        const user = await this.repo.findUserByEmail(email);
        if (!user) {
            if (opts.omitIfMissing) return { emailed: false };
            throw new AppError("No account found for that email", 404);
        }
        if (!user.isActive) {
            if (opts.omitIfMissing) return { emailed: false };
            throw new AppError("This account is inactive", 400);
        }
        await this.repo.deleteUnusedPasswordResetsForUser(user.id);
        const rawToken = crypto.randomBytes(32).toString("hex");
        const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
        const expiresAt = new Date(Date.now() + 1000 * 60 * 60);
        await this.repo.createPasswordResetToken(user.id, tokenHash, expiresAt);
        const baseUrl = resolvePublicWebBaseUrl();
        const resetUrl = `${baseUrl}/password-reset?token=${encodeURIComponent(rawToken)}`;
        try {
            await sendPasswordResetEmail({ to: user.email, resetUrl });
            return { emailed: true, resetUrl };
        } catch (err) {
            console.error("[auth] Password reset email failed:", err);
            return { emailed: false, resetUrl };
        }
    }

    async confirmPasswordReset(token: string, password: string) {
        const t = String(token || "").trim();
        if (t.length < 16) {
            throw new AppError("Invalid reset link", 400);
        }
        if (String(password || "").length < 8) {
            throw new AppError("Password must be at least 8 characters", 400);
        }
        const tokenHash = crypto.createHash("sha256").update(t).digest("hex");
        const row = await this.repo.findOpenPasswordResetByTokenHash(tokenHash);
        if (!row?.user) {
            throw new AppError("This reset link is invalid or has expired", 400);
        }
        const passwordHash = await bcrypt.hash(password, 12);
        await this.repo.db.$transaction(async (tx) => {
            await tx.user.update({
                where: { id: row.userId },
                data: { passwordHash },
            });
            await tx.passwordResetToken.update({
                where: { id: row.id },
                data: { usedAt: new Date() },
            });
        });
        return { ok: true };
    }
    /**
     * Public: returns company slug for a valid open invite token (same privacy bar as accepting the invite).
     * Used by the accept-invite page when the email link has no `companyCode` query param (older links).
     */
    async getInvitePreview(token: string) {
        const t = String(token || "").trim();
        if (t.length < 16) {
            throw new AppError("Invite is invalid or expired", 400);
        }
        const tokenHash = crypto.createHash("sha256").update(t).digest("hex");
        const invite = await this.repo.findOpenInviteByTokenHashForPreview(tokenHash);
        const slug = invite?.company?.slug?.trim();
        if (!invite || !slug) {
            throw new AppError("Invite is invalid or expired", 400);
        }
        return { companyCode: slug };
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
        const permissions = this.jwtPermissionsForCompany(u, legacyRole, co.id);
        const jwtPayload: JwtSession = {
            userId: user.id,
            companyId: co.id,
            role: legacyRole,
            sessionKind: "company",
            platformRole: u.platformRole ?? null,
            permissions,
        };
        const authToken = jwt.sign({ ...jwtPayload }, env.JWT_SECRET, inviteSignOpts);
        const inviteRe = this.rewardsEnrolledForScopedCompany(u, co.id);
        return {
            token: authToken,
            user: this.sessionUserFields(u, legacyRole, co, permissions, inviteRe, String(nexRole)),
            company: this.companyPayload(co)
        };
    }

    /**
     * Accept NexBatch portal staff email invite (sets password, returns portal session like portal login).
     */
    async acceptNexBatchStaffInvite(input: { token: string; password: string }) {
        const tokenHash = crypto.createHash("sha256").update(input.token).digest("hex");
        const invite = await this.repo.findOpenPlatformStaffInviteByTokenHash(tokenHash);
        if (!invite) {
            throw new AppError("Invite is invalid or expired", 400);
        }
        const email = invite.email.trim().toLowerCase();
        if (await this.repo.findUserByEmail(email)) {
            throw new AppError("That email is already registered.", 409);
        }
        const passwordHash = await bcrypt.hash(input.password, 12);
        let created;
        try {
            created = await this.repo.acceptPlatformStaffInviteAcceptUser({
                inviteId: invite.id,
                passwordHash,
            });
        }
        catch (err: unknown) {
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
                throw new AppError("That email is already registered.", 409);
            }
            const msg = err instanceof Error ? err.message : String(err);
            if (msg === "PLATFORM_STAFF_INVITE_INVALID" || msg === "PLATFORM_STAFF_INVITE_EMPTY") {
                throw new AppError("Invite is invalid or expired", 400);
            }
            throw err;
        }
        const u = created as UserWithRelations;
        if (!u?.isActive) {
            throw new AppError("Invite setup incomplete", 500);
        }
        const accessible = await this.companyService.listAccessibleCompanies(u.id, {
            platformRole: u.platformRole ?? null,
        });
        if (!accessible.length) {
            throw new AppError("No company access configured for this platform account", 403);
        }
        const remember = false;
        if (accessible.length > 1) {
            const portalRole = platformRoleToLegacyRbac(u.platformRole);
            const permissions = this.jwtPermissionsForCompany(u, portalRole, "");
            const jwtPayloadNoCompany: JwtSession = {
                userId: u.id,
                companyId: "",
                role: portalRole,
                sessionKind: "portal",
                platformRole: u.platformRole,
                permissions,
            };
            const token = this.issueToken(jwtPayloadNoCompany, remember);
            return {
                token,
                user: this.sessionUserFields(u, portalRole, null, permissions, false, null),
                company: null,
                needsCompanySelection: true,
                companies: accessible.map((c) =>
                    this.companyPayload({
                        id: c.id,
                        name: c.name,
                        slug: c.slug,
                        lifecycleStatus: c.lifecycleStatus,
                    } as Company),
                ),
            };
        }
        const row0 = accessible[0];
        const co = {
            id: row0.id,
            name: row0.name,
            slug: row0.slug,
        } as Company;
        const mergedRole = platformRoleToLegacyRbac(u.platformRole);
        const permissions = this.jwtPermissionsForCompany(u, mergedRole, co.id);
        const jwtPayload: JwtSession = {
            userId: u.id,
            companyId: co.id,
            role: mergedRole,
            sessionKind: "portal",
            platformRole: u.platformRole,
            permissions,
        };
        const token = this.issueToken(jwtPayload, remember);
        const staffRe = this.rewardsEnrolledForScopedCompany(u, co.id);
        const memStaff = u.memberships?.find((x) => x.companyId === co.id);
        return {
            token,
            user: this.sessionUserFields(u, mergedRole, co, permissions, staffRe, memStaff ? String(memStaff.role) : null),
            company: this.companyPayload(co),
            needsCompanySelection: false,
        };
    }
}
