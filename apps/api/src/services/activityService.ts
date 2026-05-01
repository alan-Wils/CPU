import { ActivityRepository } from "../repositories/activityRepository.js";
function formatActorLine(usersById, userId) {
    const u = usersById.get(userId);
    if (!u) {
        return `user ${userId.slice(0, 8)}…`;
    }
    const role = String(u.role).replaceAll("_", " ");
    return `${u.email} (${role})`;
}
export class ActivityService {
    repo = new ActivityRepository();
    async listMerged(companyId) {
        const [audits, tasks] = await Promise.all([this.repo.listAudit(companyId), this.repo.listTask(companyId)]);
        const actorIds = [
            ...audits.map((a) => a.actorUserId),
            ...tasks.map((t) => t.actorUserId)
        ];
        const userRows = await this.repo.findUsersByIds(companyId, actorIds);
        const usersById = new Map(userRows.map((u) => [u.id, { email: u.email, role: String(u.role) }]));
        const merged = [
            ...audits.map((a) => {
                const who = formatActorLine(usersById, a.actorUserId);
                return {
                    id: a.id,
                    kind: "audit",
                    when: a.createdAt.toISOString(),
                    summary: `${a.action} on ${a.entityType} ${a.entityId} — ${who}`
                };
            }),
            ...tasks.map((t) => {
                const who = formatActorLine(usersById, t.actorUserId);
                return {
                    id: t.id,
                    kind: "task",
                    when: t.createdAt.toISOString(),
                    summary: `Task ${t.stage} — ${t.note} (${t.minutes}m) — ${who}`
                };
            })
        ]
            .sort((a, b) => b.when.localeCompare(a.when))
            .slice(0, 500);
        return { items: merged };
    }
    async getVersion(companyId) {
        return this.repo.getLatestVersion(companyId);
    }
}
