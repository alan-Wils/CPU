import { AppError } from "../errors/AppError.js";
import { TaskRepository } from "../repositories/taskRepository.js";
import { AuditService } from "./auditService.js";
export class TaskService {
    repo = new TaskRepository();
    auditService = new AuditService();
    async create(input) {
        const task = await this.repo.createTaskLog(input.companyId, input);
        await this.auditService.logAction({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: "task.log.create",
            entityType: "TaskLog",
            entityId: task.id,
            after: task
        });
        return task;
    }
    async listRecent(companyId) {
        return this.repo.listRecent(companyId);
    }
    async deleteById(input) {
        if (!["OWNER", "ADMIN"].includes(input.role)) {
            throw new AppError("Only OWNER or ADMIN can delete task logs", 403);
        }
        const changed = await this.repo.deleteById(input.companyId, input.taskLogId);
        if (changed.count === 0)
            throw new AppError("Task log not found", 404);
        await this.auditService.logAction({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: "task.log.delete",
            entityType: "TaskLog",
            entityId: input.taskLogId
        });
        return { ok: true };
    }
    async deleteAll(input) {
        if (!["OWNER", "ADMIN"].includes(input.role)) {
            throw new AppError("Only OWNER or ADMIN can delete all task logs", 403);
        }
        const changed = await this.repo.deleteAll(input.companyId);
        await this.auditService.logAction({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
            action: "task.log.deleteAll",
            entityType: "TaskLog",
            entityId: "ALL",
            after: { deletedCount: changed.count }
        });
        return { ok: true, deletedCount: changed.count };
    }
}
