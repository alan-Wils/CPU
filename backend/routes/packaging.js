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
  return hasMinimumRole(req.user.role, "PACKAGING");
}

function canDelete(req) {
  return hasMinimumRole(req.user.role, "MANAGER");
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

    const batches = await prisma.packagingBatch.findMany({
      where: {
        companyId: targetCompanyId,
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
    console.error("Load packaging batches error:", error);
    return res.status(500).json({
      error: "Could not load packaging batches",
    });
  }
});

router.get("/:id", authRequired, async (req, res) => {
  try {
    const targetCompanyId = getTargetCompanyId(req);

    const batch = await prisma.packagingBatch.findFirst({
      where: {
        id: req.params.id,
        companyId: targetCompanyId,
      },
    });

    if (!batch) {
      return res.status(404).json({
        error: "Packaging batch not found",
      });
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
    console.error("Load packaging batch error:", error);
    return res.status(500).json({
      error: "Could not load packaging batch",
    });
  }
});

router.post("/", authRequired, async (req, res) => {
  try {
    if (!hasMinimumRole(req.user.role, "EXTRACTION")) {
      return res.status(403).json({
        error: "You do not have permission to create packaging batches",
      });
    }

    const batch = req.body || {};

    if (!batch.id) {
      return res.status(400).json({
        error: "Packaging batch id is required",
      });
    }

    const targetCompanyId = getTargetCompanyId(req);

    const saved = await prisma.packagingBatch.upsert({
      where: {
        id: batch.id,
      },
      create: {
        id: batch.id,
        companyId: targetCompanyId,
        data: batch,
        createdBy: req.user.userId,
        updatedBy: req.user.userId,
      },
      update: {
        data: {
          ...batch,
          id: batch.id,
        },
        updatedBy: req.user.userId,
      },
    });

    return res.json({
      id: saved.id,
      ...saved.data,
    });
  } catch (error) {
    console.error("Create packaging batch error:", error);
    return res.status(500).json({
      error: "Could not create packaging batch",
    });
  }
});

router.put("/:id", authRequired, async (req, res) => {
  try {
    if (!canWrite(req)) {
      return res.status(403).json({
        error: "You do not have permission to update packaging batches",
      });
    }

    const batch = req.body || {};
    const targetCompanyId = getTargetCompanyId(req);

    const existing = await prisma.packagingBatch.findFirst({
      where: {
        id: req.params.id,
        companyId: targetCompanyId,
      },
    });

    if (!existing) {
      return res.status(404).json({
        error: "Packaging batch not found",
      });
    }

    const saved = await prisma.packagingBatch.update({
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
    console.error("Update packaging batch error:", error);
    return res.status(500).json({
      error: "Could not update packaging batch",
    });
  }
});

router.delete("/:id", authRequired, async (req, res) => {
  try {
    if (!canDelete(req)) {
      return res.status(403).json({
        error:
          "Only Manager, Admin, or Owner users can delete packaging batches",
      });
    }

    const targetCompanyId = getTargetCompanyId(req);

    const existing = await prisma.packagingBatch.findFirst({
      where: {
        id: req.params.id,
        companyId: targetCompanyId,
      },
    });

    if (!existing) {
      return res.status(404).json({
        error: "Packaging batch not found",
      });
    }

    await prisma.packagingBatch.delete({
      where: {
        id: req.params.id,
      },
    });

    return res.json({ ok: true });
  } catch (error) {
    console.error("Delete packaging batch error:", error);
    return res.status(500).json({
      error: "Could not delete packaging batch",
    });
  }
});

module.exports = router;