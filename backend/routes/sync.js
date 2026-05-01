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

function getDefaultState() {
  return {
    cultivationBatches: [],
    completedCultivationBatches: [],
    dryFlowerBatches: [],
    productionBatches: [],
    sourceBatches: [],
    completedSourceBatches: [],
    extractionBatches: [],
    packagingBatches: [],
    inProgressPackagingBatches: [],
    completedPackagingBatches: [],
    logs: [],
  };
}

router.get("/", authRequired, async (req, res) => {
  try {
    const state = await prisma.appState.findUnique({
      where: {
        companyId: req.user.companyId,
      },
    });

    if (!state) {
      return res.json(getDefaultState());
    }

    return res.json(state.data || getDefaultState());
  } catch (error) {
    console.error("Load app state error:", error);
    return res.status(500).json({ error: "Could not load app state" });
  }
});

router.post("/", authRequired, async (req, res) => {
  try {
    if (!hasMinimumRole(req.user.role, "CULTIVATION")) {
      return res.status(403).json({
        error: "Read-only users cannot save company data",
      });
    }

    const data = req.body || getDefaultState();

    const saved = await prisma.appState.upsert({
      where: {
        companyId: req.user.companyId,
      },
      create: {
        companyId: req.user.companyId,
        data,
        updatedBy: req.user.userId,
      },
      update: {
        data,
        updatedBy: req.user.userId,
      },
    });

    return res.json({
      ok: true,
      updatedAt: saved.updatedAt,
    });
  } catch (error) {
    console.error("Save app state error:", error);
    return res.status(500).json({ error: "Could not save app state" });
  }
});

module.exports = router;