import { TenantRepository } from "./TenantRepository.js";
export class ActivityRepository extends TenantRepository {
    async listAudit(companyId, take = 400) {
        return this.db.auditLog.findMany({
            where: { companyId },
            orderBy: { createdAt: "desc" },
            take
        });
    }
    async listTask(companyId, take = 400) {
        return this.db.taskLog.findMany({
            where: { companyId },
            orderBy: { createdAt: "desc" },
            take
        });
    }
    async getLatestVersion(companyId) {
        const [a, t] = await Promise.all([
            this.db.auditLog.findFirst({ where: { companyId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
            this.db.taskLog.findFirst({ where: { companyId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } })
        ]);
        const ts = [a?.createdAt?.toISOString(), t?.createdAt?.toISOString()].filter(Boolean).sort().pop() ?? null;
        return { updatedAt: ts };
    }
    async findUsersByIds(companyId, userIds) {
        const unique = Array.from(
            new Set((userIds || []).filter((id) => Boolean(id && String(id).trim())))
        ) as string[];
        if (unique.length === 0)
            return [];
        return this.db.user.findMany({
            where: { companyId, id: { in: unique } },
            select: { id: true, email: true, role: true }
        });
    }
}
