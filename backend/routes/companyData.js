const express = require("express");
const prisma = require("../db");
const authRequired = require("../middleware/auth");

const router = express.Router();

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

function tableForType(type) {
  const tables = {
    cultivation: prisma.cultivationBatch,
    source: prisma.sourceBatch,
    extraction: prisma.extractionBatch,
    packaging: prisma.packagingBatch,
  };

  return tables[type] || null;
}

router.get("/:type", authRequired, async (req, res) => {
  try {
    const table = tableForType(req.params.type);

    if (!table) {
      return res.status(400).json({ error: "Invalid data type" });
    }

    const targetCompanyId = getTargetCompanyId(req);

    if (!targetCompanyId) {
      return res.status(400).json({ error: "Company is required" });
    }

    const rows = await table.findMany({
      where: {
        companyId: targetCompanyId,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    return res.json(rows.map((row) => row.data));
  } catch (error) {
    console.error("Load company data error:", error);
    return res.status(500).json({ error: "Could not load data" });
  }
});

router.post("/:type", authRequired, async (req, res) => {
  try {
    const table = tableForType(req.params.type);

    if (!table) {
      return res.status(400).json({ error: "Invalid data type" });
    }

    const item = req.body;

    if (!item.id) {
      return res.status(400).json({ error: "Item id is required" });
    }

    const targetCompanyId = getTargetCompanyId(req);

    if (!targetCompanyId) {
      return res.status(400).json({ error: "Company is required" });
    }

    const existing = await table.findFirst({
      where: {
        id: item.id,
        companyId: targetCompanyId,
      },
    });

    let saved;

    if (existing) {
      saved = await table.update({
        where: {
          id: item.id,
        },
        data: {
          data: item,
          updatedBy: req.user.userId,
        },
      });
    } else {
      saved = await table.create({
        data: {
          id: item.id,
          companyId: targetCompanyId,
          data: item,
          createdBy: req.user.userId,
          updatedBy: req.user.userId,
        },
      });
    }

    return res.json(saved.data);
  } catch (error) {
    console.error("Save company data error:", error);
    return res.status(500).json({ error: "Could not save data" });
  }
});

router.delete("/:type/:id", authRequired, async (req, res) => {
  try {
    const table = tableForType(req.params.type);

    if (!table) {
      return res.status(400).json({ error: "Invalid data type" });
    }

    const targetCompanyId = getTargetCompanyId(req);

    if (!targetCompanyId) {
      return res.status(400).json({ error: "Company is required" });
    }

    const existing = await table.findFirst({
      where: {
        id: req.params.id,
        companyId: targetCompanyId,
      },
    });

    if (!existing) {
      return res.status(404).json({ error: "Item not found" });
    }

    await table.delete({
      where: {
        id: req.params.id,
      },
    });

    return res.json({ ok: true });
  } catch (error) {
    console.error("Delete company data error:", error);
    return res.status(500).json({ error: "Could not delete data" });
  }
});

module.exports = router;