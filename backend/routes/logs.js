const express = require("express");
const prisma = require("../db");
const authRequired = require("../middleware/auth");
const canDeleteLogs = require("../middleware/canDeleteLogs");
const auditDelete = require("../utils/auditDelete");

const router = express.Router();

function userCanCloseOpenLabor(user) {
  const role = String(user?.role || "").toUpperCase();
  return [
    "CULTIVATION",
    "CULTIVATION_SPECIALIST",
    "MANAGER",
    "OPERATIONS_MANAGER",
    "ADMIN",
    "OWNER",
  ].includes(role);
}

function userCanEditTaskLogLabor(user) {
  const role = String(user?.role || "").toUpperCase();
  return ["MANAGER", "OPERATIONS_MANAGER", "ADMIN", "OWNER"].includes(role);
}

function getRequestedCompanyId(req) {
  return (
    req.headers["x-company-id"] ||
    req.body?.companyId ||
    req.query?.companyId ||
    ""
  );
}

function getTargetCompanyId(req) {
  const requestedCompanyId = String(getRequestedCompanyId(req) || "").trim();

  if (req.user.role === "OWNER" && requestedCompanyId) {
    return requestedCompanyId;
  }

  return req.user.companyId;
}

router.get("/", authRequired, async (req, res) => {
  try {
    const targetCompanyId = getTargetCompanyId(req);

    const logs = await prisma.taskLog.findMany({
      where: {
        companyId: targetCompanyId,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.json(logs);
  } catch (error) {
    console.error("Get logs error:", error);
    return res.status(500).json({ error: "Could not load logs" });
  }
});

/**
 * PATCH task log — used to close open cultivation labor (pending end) or
 * manager-edit labor fields. Body: { output?: string, data?: object, closeLaborPendingEnd?: boolean }
 */
router.patch("/:id", authRequired, async (req, res) => {
  try {
    const targetCompanyId = getTargetCompanyId(req);
    const existing = await prisma.taskLog.findFirst({
      where: {
        id: req.params.id,
        companyId: targetCompanyId,
      },
    });

    if (!existing) {
      return res.status(404).json({ error: "Log not found" });
    }

    const body = req.body || {};
    const existingData =
      existing.data && typeof existing.data === "object" ? { ...existing.data } : {};
    const closeLabor = body.closeLaborPendingEnd === true;

    const runClose = () => {
      if (!existingData.laborPendingEnd) {
        return { error: "This log is not waiting for an end time" };
      }
      const patch = body.data && typeof body.data === "object" ? body.data : null;
      if (!patch || !patch.taskEndTime) {
        return { error: "End time is required to close this labor entry" };
      }
      const total = Number(patch.totalLaborMinutes);
      if (!Number.isFinite(total) || total <= 0) {
        return { error: "Closed labor must have a positive total person-minutes value" };
      }
      if (patch.laborPendingEnd === true) {
        return { error: "Labor cannot stay in pending state when closing" };
      }
      return null;
    };

    const runManagerEdit = () => {
      const patch = body.data && typeof body.data === "object" ? body.data : null;
      if (!patch && body.output === undefined) {
        return { error: "Nothing to update" };
      }
      return null;
    };

    if (closeLabor) {
      const err = runClose();
      if (err) return res.status(400).json(err);
      if (!userCanCloseOpenLabor(req.user)) {
        return res.status(403).json({
          error: "Your role cannot close open labor entries",
        });
      }
      const patch = body.data && typeof body.data === "object" ? body.data : {};
      const nextData = { ...existingData, ...patch, laborPendingEnd: false };
      const nextOutput =
        body.output !== undefined ? String(body.output) : existing.output;
      const updated = await prisma.taskLog.update({
        where: { id: existing.id },
        data: {
          output: nextOutput,
          data: nextData,
        },
      });
      return res.json(updated);
    }

    const err = runManagerEdit();
    if (err) return res.status(400).json(err);
    if (!userCanEditTaskLogLabor(req.user)) {
      return res.status(403).json({
        error: "Only Managers (and above) can edit saved labor on a task log",
      });
    }
    const patch = body.data && typeof body.data === "object" ? body.data : {};
    const nextData = { ...existingData, ...patch };
    const nextOutput =
      body.output !== undefined ? String(body.output) : existing.output;
    const updated = await prisma.taskLog.update({
      where: { id: existing.id },
      data: {
        output: nextOutput,
        data: nextData,
      },
    });
    return res.json(updated);
  } catch (error) {
    console.error("Patch log error:", error);
    return res.status(500).json({ error: "Could not update log" });
  }
});

router.post("/", authRequired, async (req, res) => {
  try {
    const body = req.body || {};
    const targetCompanyId = getTargetCompanyId(req);

    const log = await prisma.taskLog.create({
      data: {
        companyId: targetCompanyId,
        area: body.area || "System",
        batch: body.batch ? String(body.batch) : null,
        task: body.task || "Log",
        output: body.output || "",
        data: body.data || body,
        createdBy: req.user.userId,
      },
    });

    return res.json(log);
  } catch (error) {
    console.error("Create log error:", error);
    return res.status(500).json({ error: "Could not create log" });
  }
});

router.delete("/all/clear", authRequired, canDeleteLogs, async (req, res) => {
  try {
    const targetCompanyId = getTargetCompanyId(req);

    const count = await prisma.taskLog.count({
      where: {
        companyId: targetCompanyId,
      },
    });

    await prisma.taskLog.deleteMany({
      where: {
        companyId: targetCompanyId,
      },
    });

    const auditLog = await prisma.taskLog.create({
      data: {
        companyId: targetCompanyId,
        area: "Logs",
        batch: "ALL_LOGS",
        task: "Deleted All Logs",
        output: `All logs deleted. Count deleted: ${count}`,
        data: {
          deletedCount: count,
          deletedBy: {
            userId: req.user.userId,
            username: req.user.username,
            role: req.user.role,
          },
          deletedAt: new Date().toISOString(),
        },
        createdBy: req.user.userId,
      },
    });

    return res.json({
      ok: true,
      deletedCount: count,
      auditLog,
    });
  } catch (error) {
    console.error("Delete all logs error:", error);
    return res.status(500).json({ error: "Could not delete all logs" });
  }
});

router.delete("/:id", authRequired, canDeleteLogs, async (req, res) => {
  try {
    const targetCompanyId = getTargetCompanyId(req);

    const existing = await prisma.taskLog.findFirst({
      where: {
        id: req.params.id,
        companyId: targetCompanyId,
      },
    });

    if (!existing) {
      return res.status(404).json({ error: "Log not found" });
    }

    await auditDelete(prisma, req, {
      area: "Logs",
      batch: existing.batch,
      recordType: "Task Log",
      recordId: existing.id,
      recordData: {
        area: existing.area,
        batch: existing.batch,
        task: existing.task,
        output: existing.output,
        data: existing.data,
        createdAt: existing.createdAt,
      },
    });

    await prisma.taskLog.delete({
      where: {
        id: existing.id,
      },
    });

    return res.json({ ok: true });
  } catch (error) {
    console.error("Delete log error:", error);
    return res.status(500).json({ error: "Could not delete log" });
  }
});

module.exports = router;