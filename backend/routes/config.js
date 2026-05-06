const express = require("express");
const prisma = require("../db");
const authRequired = require("../middleware/auth");

const router = express.Router();

function adminOnly(req, res, next) {
  const role = String(req.user?.role || "").toLowerCase();

  if (role !== "admin" && role !== "owner") {
    return res.status(403).json({ error: "Admin access required" });
  }

  next();
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

const defaultConfig = {
  company: {
    metrc: {
      apiKey: "",
      userKey: "",
      licenseNumber: "",
      facilityName: "",
      notes: "",
    },
    settings: {
      companyWideNotes: "",
      /** IANA zone for displaying timestamps app-wide (empty = browser default). */
      displayTimezone: "",
    },
  },

  cultivation: {
    strains: [
      {
        id: "strain-gogo",
        name: "Golden Goat",
        acronym: "GOGO",
        dominance: "Sativa",
        potency: "High",
        averageYield: "Heavy",
      },
      {
        id: "strain-grcr",
        name: "Green Crack",
        acronym: "GRCR",
        dominance: "Sativa",
        potency: "High",
        averageYield: "Medium",
      },
      {
        id: "strain-buku",
        name: "Bubba Kush",
        acronym: "BUKU",
        dominance: "Indica",
        potency: "High",
        averageYield: "Medium",
      },
    ],
    supplies: [],
    rooms: {
      vegRooms: [],
      flowerRooms: [],
    },
  },

  extraction: {
    productNames: [],
    supplies: [],
  },

  packaging: {
    supplies: [],
  },
};

router.get("/", authRequired, adminOnly, async (req, res) => {
  try {
    const targetCompanyId = getTargetCompanyId(req);

    let config = await prisma.companyConfig.findUnique({
      where: {
        companyId: targetCompanyId,
      },
    });

    if (!config) {
      config = await prisma.companyConfig.create({
        data: {
          companyId: targetCompanyId,
          data: defaultConfig,
        },
      });
    }

    return res.json(config.data);
  } catch (error) {
    console.error("Get config error:", error);
    return res.status(500).json({
      error: "Could not load config",
    });
  }
});

router.put("/", authRequired, adminOnly, async (req, res) => {
  try {
    const incomingConfig = req.body;
    const targetCompanyId = getTargetCompanyId(req);

    const saved = await prisma.companyConfig.upsert({
      where: {
        companyId: targetCompanyId,
      },
      update: {
        data: incomingConfig,
      },
      create: {
        companyId: targetCompanyId,
        data: incomingConfig,
      },
    });

    return res.json(saved.data);
  } catch (error) {
    console.error("Save config error:", error);
    return res.status(500).json({
      error: "Could not save config",
    });
  }
});

module.exports = router;