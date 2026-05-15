import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { TenantRepository } from "./TenantRepository.js";
import { legacyUserRoleToCompanyRole } from "../lib/nexbatchRoles.js";
import {
    firstValidCashLogEodScheduleFromDonors,
    mergeCashLogEodPrefs,
} from "../lib/cashLogEodPrefs.js";
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
        return rows.map((r) => ({
            user: r.user,
            appPermissions: r.appPermissions ?? null,
            cashLogEodEnabled: mergeCashLogEodPrefs(r.cashLogEodPrefs).enabled,
            rewardsEnrolled: Boolean(r.rewardsEnrolled),
            cultivationAlertsEnabled: Boolean(r.cultivationAlertsEnabled),
            designatedRnDSamplingEmployee: Boolean(r.designatedRnDSamplingEmployee),
        }));
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
        const membershipData: Prisma.CompanyMembershipUpdateInput = {};
        if (data.role) {
            membershipData.role = legacyUserRoleToCompanyRole(data.role);
        }
        if (Object.prototype.hasOwnProperty.call(data, "appPermissions")) {
            membershipData.appPermissions =
                data.appPermissions === null ? null : (data.appPermissions as Prisma.InputJsonValue);
        }
        if (Object.prototype.hasOwnProperty.call(data, "rewardsEnrolled")) {
            membershipData.rewardsEnrolled = Boolean(data.rewardsEnrolled);
        }
        if (Object.prototype.hasOwnProperty.call(data, "cultivationAlertsEnabled")) {
            membershipData.cultivationAlertsEnabled = Boolean(data.cultivationAlertsEnabled);
        }
        if (Object.prototype.hasOwnProperty.call(data, "designatedRnDSamplingEmployee")) {
            membershipData.designatedRnDSamplingEmployee = Boolean(data.designatedRnDSamplingEmployee);
        }
        if (data.cashLogEodEnabled !== undefined) {
            let mergedPrefs = mergeCashLogEodPrefs(m.cashLogEodPrefs);
            mergedPrefs.enabled = Boolean(data.cashLogEodEnabled);
            // Opt-in from Admin with no JSON yet used to default to LAST_24H even when the company
            // schedule was already saved as 7-day (PUT /eod-prefs skips null `cashLogEodPrefs` peers).
            if (m.cashLogEodPrefs == null && mergedPrefs.enabled) {
                const donorRows = await this.db.companyMembership.findMany({
                    where: { companyId, id: { not: m.id } },
                    select: { cashLogEodPrefs: true },
                });
                const donorSchedule = firstValidCashLogEodScheduleFromDonors(
                    donorRows.map((r) => r.cashLogEodPrefs),
                );
                if (donorSchedule) {
                    mergedPrefs = { ...mergedPrefs, ...donorSchedule };
                }
            }
            membershipData.cashLogEodPrefs = mergedPrefs as unknown as Prisma.InputJsonValue;
        }
        let membershipTouched = false;
        if (Object.keys(membershipData).length) {
            await this.db.companyMembership.update({
                where: { id: m.id },
                data: membershipData,
            });
            membershipTouched = true;
        }
        const userPatch: Prisma.UserUpdateManyMutationInput = {};
        if (data.email !== undefined)
            userPatch.email = data.email;
        if (data.role !== undefined)
            userPatch.role = data.role;
        if (data.isActive !== undefined)
            userPatch.isActive = data.isActive;
        if (Object.keys(userPatch).length)
            return this.db.user.updateMany({ where: { id: userId }, data: userPatch });
        return { count: membershipTouched ? 1 : 0 };
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
