import { TenantRepository } from "./TenantRepository.js";
export class TaskRepository extends TenantRepository {
    async createTaskLog(companyId, data) {
        return this.db.taskLog.create({ data: { companyId, ...data } });
    }
    async listRecent(companyId, take = 200) {
        const rows = await this.db.taskLog.findMany({
            where: { companyId },
            orderBy: { createdAt: "desc" },
            take
        });
        const actorIds = Array.from(new Set(rows.map((r) => String(r.actorUserId || "").trim()).filter(Boolean)));
        if (actorIds.length === 0)
            return rows;
        const users = await this.db.user.findMany({
            where: {
                companyId,
                id: { in: actorIds }
            },
            select: {
                id: true,
                email: true,
                role: true
            }
        });
        const usersById = new Map(users.map((u) => [
            u.id,
            {
                // UI expects username in many places; prefer email local-part as readable name.
                username: String(u.email || "").split("@")[0] || "User",
                email: u.email || "",
                role: String(u.role || "")
            }
        ]));
        return rows.map((row) => ({
            ...row,
            loggedBy: usersById.get(row.actorUserId) || {
                username: "System User",
                email: "",
                role: ""
            }
        }));
    }
    async deleteById(companyId, id) {
        return this.db.taskLog.deleteMany({
            where: { companyId, id }
        });
    }
    async deleteAll(companyId) {
        return this.db.taskLog.deleteMany({
            where: { companyId }
        });
    }
}
