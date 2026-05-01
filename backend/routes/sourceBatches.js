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

function canWrite(req) {
  return hasMinimumRole(req.user.role, "CULTIVATION");
}

function canDelete(req) {
  return hasMinimumRole(req.user.role, "MANAGER");
}

router.get("/", authRequired, async (req, res) => {
  try {
    const batches = await prisma.sourceBatch.findMany({
      where: {
        companyId: req.user.companyId,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    return res.json(
      batches.map((batch) => ({
        id: batch.id,
        ...batch.data,
        _db: {
          createdBy: batch.createdBy,
          updatedBy: batch.updatedBy,
          createdAt: batch.createdAt,
          updatedAt: batch.updatedAt,
        },
      }))
    );
  } catch (error) {
    console.error("Load source batches error:", error);
    return res.status(500).json({ error: "Could not load source batches" });
  }
});

router.get("/:id", authRequired, async (req, res) => {
  try {
    const batch = await prisma.sourceBatch.findFirst({
      where: {
        id: req.params.id,
        companyId: req.user.companyId,
      },
    });

    if (!batch) {
      return res.status(404).json({ error: "Source batch not found" });
    }

    return res.json({
      id: batch.id,
      ...batch.data,
      _db: {
        createdBy: batch.createdBy,
        updatedBy: batch.updatedBy,
        createdAt: batch.createdAt,
        updatedAt: batch.updatedAt,
      },
    });
  } catch (error) {
    console.error("Load source batch error:", error);
    return res.status(500).json({ error: "Could not load source batch" });
  }
});

router.post("/", authRequired, async (req, res) => {
  try {
    if (!canWrite(req)) {
      return res.status(403).json({
        error: "You do not have permission to create source batches",
      });
    }

    const batch = req.body || {};

    if (!batch.id) {
      return res.status(400).json({ error: "Source batch id is required" });
    }

    const saved = await prisma.sourceBatch.create({
      data: {
        id: batch.id,
        companyId: req.user.companyId,
        data: batch,
        createdBy: req.user.userId,
        updatedBy: req.user.userId,
      },
    });

    return res.json({
      id: saved.id,
      ...saved.data,
    });
  } catch (error) {
    console.error("Create source batch error:", error);

    if (error.code === "P2002") {
      return res.status(409).json({ error: "Source batch already exists" });
    }

    return res.status(500).json({ error: "Could not create source batch" });
  }
});

router.put("/:id", authRequired, async (req, res) => {
  try {
    if (!hasMinimumRole(req.user.role, "EXTRACTION")) {
      return res.status(403).json({
        error: "You do not have permission to update source batches",
      });
    }

    const batch = req.body || {};

    const existing = await prisma.sourceBatch.findFirst({
      where: {
        id: req.params.id,
        companyId: req.user.companyId,
      },
    });

    if (!existing) {
      return res.status(404).json({ error: "Source batch not found" });
    }

    const saved = await prisma.sourceBatch.update({
      where: {
        id: req.params.id,
      },
      data: {
        data: {
          ...batch,
          id: req.params.id,
        },
        updatedBy: req.user.userId,
      },
    });

    return res.json({
      id: saved.id,
      ...saved.data,
    });
  } catch (error) {
    console.error("Update source batch error:", error);
    return res.status(500).json({ error: "Could not update source batch" });
  }
});

router.delete("/:id", authRequired, async (req, res) => {
  try {
    if (!canDelete(req)) {
      return res.status(403).json({
        error: "Only Manager, Admin, or Owner users can delete source batches",
      });
    }

    const existing = await prisma.sourceBatch.findFirst({
      where: {
        id: req.params.id,
        companyId: req.user.companyId,
      },
    });

    if (!existing) {
      return res.status(404).json({ error: "Source batch not found" });
    }

    await prisma.sourceBatch.delete({
      where: {
        id: req.params.id,
      },
    });

    return res.json({ ok: true });
  } catch (error) {
    console.error("Delete source batch error:", error);
    return res.status(500).json({ error: "Could not delete source batch" });
  }
});

module.exports = router;