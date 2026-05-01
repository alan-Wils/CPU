import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import { taskLogCreateSchema, taskLogIdParam } from "../../validation/schemas.js";
import { TaskService } from "../../services/taskService.js";
export const tasksRouter = Router();
const taskService = new TaskService();
tasksRouter.post("/logs", validate({ body: taskLogCreateSchema }), asyncHandler(async (req, res) => {
    const payload = req.body;
    const row = await taskService.create({
        companyId: req.auth.companyId,
        actorUserId: req.auth.userId,
        ...payload
    });
    res.status(201).json(row);
}));
tasksRouter.get("/logs/recent", asyncHandler(async (req, res) => {
    const rows = await taskService.listRecent(req.auth.companyId);
    res.json({ rows });
}));
tasksRouter.delete("/logs/:taskLogId", validate({ params: taskLogIdParam }), asyncHandler(async (req, res) => {
    const { taskLogId } = req.params;
    const out = await taskService.deleteById({
        companyId: req.auth.companyId,
        actorUserId: req.auth.userId,
        role: req.auth.role,
        taskLogId
    });
    res.json(out);
}));
tasksRouter.delete("/logs", asyncHandler(async (req, res) => {
    const out = await taskService.deleteAll({
        companyId: req.auth.companyId,
        actorUserId: req.auth.userId,
        role: req.auth.role
    });
    res.json(out);
}));
