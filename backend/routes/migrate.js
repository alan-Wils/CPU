const express = require("express");
const prisma = require("../db");
const authRequired = require("../middleware/auth");

const router = express.Router();

const ROLE_LEVELS = {
  VIEW_ONLY: 1,
  CULTIVATION: 2,
  EXTRACTION: 2,
  PACKAGING: 2,
  MANAGER: 3,
  ADMIN: 4,
  OWNER: 5,
};

function hasMinimumRole(userRole, minimumRole) {
  const currentLevel = ROLE_LEVELS[String(userRole || "").toUpperCase()] || 0;
  const requiredLevel = ROLE_LEVELS[String(minimumRole || "").toUpperCase()] || 0;
  return currentLevel >= requiredLevel;
}

router.post("/app-state-to-tables", authRequired, async (req, res) => {
  try {
    if (!hasMinimumRole(req.user.role, "OWNER")) {
      return res.status(403).json({
        error: "Only Owner users can run migrations",
      });
    }

    const appState = await prisma.appState.findUnique({
      where: {
        companyId: req.user.companyId,
      },
    });

    if (!appState || !appState.data) {
      return res.json({
        ok: true,
        message: "No AppState data found to migrate",
        counts: {
          cultivationBatches: 0,
          sourceBatches: 0,
          extractionBatches: 0,
          packagingBatches: 0,
          taskLogs: 0,
        },
      });
    }

    const data = appState.data;

    const cultivationItems = [
      ...(Array.isArray(data.cultivationBatches) ? data.cultivationBatches : []),
      ...(Array.isArray(data.completedCultivationBatches)
        ? data.completedCultivationBatches
        : []),
    ];

    const sourceItems = [
      ...(Array.isArray(data.sourceBatches) ? data.sourceBatches : []),
      ...(Array.isArray(data.completedSourceBatches)
        ? data.completedSourceBatches
        : []),
    ];

    const extractionItems = Array.isArray(data.extractionBatches)
      ? data.extractionBatches
      : [];

    const packagingItems = [
      ...(Array.isArray(data.packagingBatches) ? data.packagingBatches : []),
      ...(Array.isArray(data.inProgressPackagingBatches)
        ? data.inProgressPackagingBatches
        : []),
      ...(Array.isArray(data.completedPackagingBatches)
        ? data.completedPackagingBatches
        : []),
    ];

    const logItems = Array.isArray(data.logs) ? data.logs : [];

    let cultivationCount = 0;
    let sourceCount = 0;
    let extractionCount = 0;
    let packagingCount = 0;
    let logCount = 0;

    for (const batch of cultivationItems) {
      if (!batch?.id) continue;

      await prisma.cultivationBatch.upsert({
        where: { id: batch.id },
        create: {
          id: batch.id,
          companyId: req.user.companyId,
          data: batch,
          createdBy: req.user.userId,
          updatedBy: req.user.userId,
        },
        update: {
          data: batch,
          updatedBy: req.user.userId,
        },
      });

      cultivationCount += 1;
    }

    for (const batch of sourceItems) {
      if (!batch?.id) continue;

      await prisma.sourceBatch.upsert({
        where: { id: batch.id },
        create: {
          id: batch.id,
          companyId: req.user.companyId,
          data: batch,
          createdBy: req.user.userId,
          updatedBy: req.user.userId,
        },
        update: {
          data: batch,
          updatedBy: req.user.userId,
        },
      });

      sourceCount += 1;
    }

    for (const batch of extractionItems) {
      if (!batch?.id) continue;

      await prisma.extractionBatch.upsert({
        where: { id: batch.id },
        create: {
          id: batch.id,
          companyId: req.user.companyId,
          data: batch,
          createdBy: req.user.userId,
          updatedBy: req.user.userId,
        },
        update: {
          data: batch,
          updatedBy: req.user.userId,
        },
      });

      extractionCount += 1;
    }

    for (const batch of packagingItems) {
      if (!batch?.id) continue;

      await prisma.packagingBatch.upsert({
        where: { id: batch.id },
        create: {
          id: batch.id,
          companyId: req.user.companyId,
          data: batch,
          createdBy: req.user.userId,
          updatedBy: req.user.userId,
        },
        update: {
          data: batch,
          updatedBy: req.user.userId,
        },
      });

      packagingCount += 1;
    }

    for (const log of logItems) {
      await prisma.taskLog.create({
        data: {
          companyId: req.user.companyId,
          area: String(log.area || "Unknown"),
          batch: log.batch ? String(log.batch) : null,
          task: String(log.task || "Log"),
          output: log.output ? String(log.output) : null,
          data: log,
          createdBy: req.user.userId,
        },
      });

      logCount += 1;
    }

    return res.json({
      ok: true,
      message: "AppState migrated into real tables",
      counts: {
        cultivationBatches: cultivationCount,
        sourceBatches: sourceCount,
        extractionBatches: extractionCount,
        packagingBatches: packagingCount,
        taskLogs: logCount,
      },
    });
  } catch (error) {
    console.error("Migration error:", error);
    return res.status(500).json({ error: "Migration failed" });
  }
});

module.exports = router;