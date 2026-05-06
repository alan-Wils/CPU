const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const authRequired = require("../middleware/auth");
const {
  extractHarvestSheetFromImageBuffer,
} = require("../services/openaiHarvestSheetExtract");

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

function canWriteCultivation(req) {
  return hasMinimumRole(req.user.role, "CULTIVATION");
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

/** Resolve uploads root (same directory as server.js parent). */
function uploadsRoot() {
  return path.join(__dirname, "..", "uploads");
}

function safeCompanySegment(companyId) {
  const s = String(companyId || "").replace(/[^a-zA-Z0-9_-]/g, "");
  return s.length > 0 ? s : "unknown";
}

function extFromMime(mimeType) {
  const m = String(mimeType || "").toLowerCase();
  if (m === "image/png") return ".png";
  if (m === "image/webp") return ".webp";
  return ".jpg";
}

/**
 * Validate storedPath is under harvest-sheets/{companyId}/ with no traversal.
 */
function resolveStoredHarvestSheetPath(req, storedPath) {
  const companyId = getTargetCompanyId(req);
  const seg = safeCompanySegment(companyId);
  const rel = String(storedPath || "").replace(/\\/g, "/").trim();
  if (!rel.startsWith(`harvest-sheets/${seg}/`)) {
    return null;
  }
  if (rel.includes("..")) {
    return null;
  }
  const root = uploadsRoot();
  const absolute = path.normalize(path.join(root, rel));
  const rootNorm = path.normalize(root + path.sep);
  if (!absolute.startsWith(rootNorm)) {
    return null;
  }
  return absolute;
}

router.post("/upload", authRequired, (req, res) => {
  try {
    if (!canWriteCultivation(req)) {
      return res.status(403).json({ error: "Cultivation write access required" });
    }

    const companyId = getTargetCompanyId(req);
    const seg = safeCompanySegment(companyId);
    let imageBase64 = req.body?.imageBase64;
    const mimeTypeRaw = String(req.body?.mimeType || "image/jpeg").toLowerCase();

    if (typeof imageBase64 !== "string") {
      return res.status(400).json({ error: "imageBase64 required" });
    }

    const comma = imageBase64.indexOf(",");
    if (imageBase64.startsWith("data:") && comma > 0) {
      imageBase64 = imageBase64.slice(comma + 1);
    }

    let buffer;
    try {
      buffer = Buffer.from(imageBase64, "base64");
    } catch {
      return res.status(400).json({ error: "Invalid base64 image" });
    }

    const maxBytes = 9 * 1024 * 1024;
    if (!buffer.length || buffer.length > maxBytes) {
      return res.status(400).json({ error: "Image too large or empty (max ~9MB decoded)" });
    }

    const allowed = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    const mimeType = allowed.includes(mimeTypeRaw) ? mimeTypeRaw.replace("jpg", "jpeg") : "image/jpeg";

    const id = crypto.randomBytes(16).toString("hex");
    const ext = extFromMime(mimeType);
    const relDir = path.join("harvest-sheets", seg);
    const dir = path.join(uploadsRoot(), relDir);
    fs.mkdirSync(dir, { recursive: true });

    const fileName = `${id}${ext}`;
    const absolute = path.join(dir, fileName);
    fs.writeFileSync(absolute, buffer);

    const storedPath = `${relDir.replace(/\\/g, "/")}/${fileName}`;

    return res.status(201).json({
      imageUrl: `/uploads/${storedPath}`,
      storedPath,
      mimeType,
      bytes: buffer.length,
    });
  } catch (error) {
    console.error("Harvest sheet upload error:", error);
    return res.status(500).json({ error: "Could not save harvest sheet image" });
  }
});

router.post("/extract", authRequired, async (req, res) => {
  try {
    if (!canWriteCultivation(req)) {
      return res.status(403).json({ error: "Cultivation write access required" });
    }

    const storedPath = req.body?.storedPath;
    const plantsHarvested = req.body?.plantsHarvested;

    const absolute = resolveStoredHarvestSheetPath(req, storedPath);
    if (!absolute || !fs.existsSync(absolute)) {
      return res.status(400).json({ error: "Invalid or missing storedPath for this company" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({
        error: "OpenAI is not configured",
        message: "Set OPENAI_API_KEY on the API server to enable harvest sheet extraction.",
      });
    }

    const buffer = fs.readFileSync(absolute);
    const ext = path.extname(absolute).toLowerCase();
    const mimeType =
      ext === ".png"
        ? "image/png"
        : ext === ".webp"
          ? "image/webp"
          : "image/jpeg";

    const opts = {};
    if (plantsHarvested != null && Number.isFinite(Number(plantsHarvested))) {
      opts.plantsHarvested = Number(plantsHarvested);
    }

    const extracted = await extractHarvestSheetFromImageBuffer(buffer, mimeType, opts);

    const warnings = [];
    if (
      opts.plantsHarvested &&
      extracted.rows.length > 0 &&
      Math.abs(extracted.rows.length - opts.plantsHarvested) > Math.max(3, opts.plantsHarvested * 0.15)
    ) {
      warnings.push(
        `Extracted ${extracted.rows.length} rows but harvest count was ${opts.plantsHarvested} — verify before saving.`,
      );
    }

    return res.json({
      ...extracted,
      warnings,
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    });
  } catch (error) {
    console.error("Harvest sheet extract error:", error);
    if (error.code === "OPENAI_MISSING") {
      return res.status(503).json({
        error: "OpenAI is not configured",
        message: error.message,
      });
    }
    return res.status(500).json({
      error: "Extraction failed",
      message: error.message || String(error),
    });
  }
});

module.exports = router;
