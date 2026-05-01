const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../db");
const authRequired = require("../middleware/auth");
const { sendInviteEmail } = require("../utils/email");

const router = express.Router();

function getRequestedCompanyId(req) {
  return (
    req.headers["x-company-id"] ||
    req.headers["X-Company-Id"] ||
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

function canInviteRole(currentRole, newRole) {
  if (currentRole === "OWNER") return true;
  if (currentRole === "ADMIN") return newRole !== "OWNER";
  return false;
}

function canManageTarget(currentUser, targetUser) {
  if (currentUser.role === "OWNER") return true;
  if (currentUser.role === "ADMIN" && targetUser.role !== "OWNER") return true;
  return false;
}

function formatUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    active: user.active,
    status: user.status,
    emailVerified: user.emailVerified,
    mustChangePassword: user.mustChangePassword,
    companyId: user.companyId,
    companyName: user.company?.name || "",
    createdAt: user.createdAt,
  };
}

router.get("/", authRequired, async (req, res) => {
  try {
    if (!["OWNER", "ADMIN"].includes(req.user.role)) {
      return res.status(403).json({ error: "Not allowed" });
    }

    const targetCompanyId = getTargetCompanyId(req);

    if (!targetCompanyId) {
      return res.status(400).json({ error: "Company is required" });
    }

    const company = await prisma.company.findUnique({
      where: { id: targetCompanyId },
    });

    if (!company) {
      return res.status(404).json({ error: "Company not found" });
    }

    if (req.user.role !== "OWNER" && targetCompanyId !== req.user.companyId) {
      return res.status(403).json({ error: "Not allowed" });
    }

    const users = await prisma.user.findMany({
      where: { companyId: targetCompanyId },
      include: { company: true },
      orderBy: { createdAt: "desc" },
    });

    return res.json(users.map(formatUser));
  } catch (error) {
    console.error("Get users error:", error);
    return res.status(500).json({ error: "Could not load users" });
  }
});

router.post("/invite", authRequired, async (req, res) => {
  try {
    const { email, username, role } = req.body;

    if (!email || !username || !role) {
      return res.status(400).json({ error: "Email, username, and role are required" });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanUsername = String(username).trim();
    const normalizedRole = String(role).toUpperCase();

    if (!cleanEmail || !cleanUsername) {
      return res.status(400).json({ error: "Email and username are required" });
    }

    if (!canInviteRole(req.user.role, normalizedRole)) {
      return res.status(403).json({ error: "You cannot invite this role" });
    }

    const targetCompanyId = getTargetCompanyId(req);

    if (!targetCompanyId) {
      return res.status(400).json({ error: "Company is required" });
    }

    const company = await prisma.company.findUnique({
      where: { id: targetCompanyId },
    });

    if (!company) {
      return res.status(404).json({ error: "Company not found" });
    }

    if (req.user.role !== "OWNER" && targetCompanyId !== req.user.companyId) {
      return res.status(403).json({ error: "Not allowed" });
    }

    const existingEmail = await prisma.user.findFirst({
      where: { email: cleanEmail },
    });

    if (existingEmail) {
      return res.status(400).json({ error: "Email already exists" });
    }

    const existingUsername = await prisma.user.findUnique({
      where: {
        companyId_username: {
          companyId: targetCompanyId,
          username: cleanUsername,
        },
      },
    });

    if (existingUsername) {
      return res.status(400).json({ error: "Username already exists for this company" });
    }

    const inviteToken = crypto.randomBytes(32).toString("hex");
    const inviteTokenExpires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);

    const temporaryPassword = crypto.randomBytes(24).toString("hex");
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);

    const user = await prisma.user.create({
      data: {
        companyId: targetCompanyId,
        username: cleanUsername,
        email: cleanEmail,
        passwordHash,
        role: normalizedRole,
        active: false,
        inviteToken,
        inviteTokenExpires,
        emailVerified: false,
        mustChangePassword: true,
        status: "INVITED",
      },
      include: { company: true },
    });

    const appUrl = process.env.APP_URL || "http://localhost:3000";
    const inviteUrl = `${appUrl}/accept-invite?token=${inviteToken}`;

    await sendInviteEmail({
      to: cleanEmail,
      inviteUrl,
      companyName: company.name,
      role: normalizedRole,
    });

    return res.json({
      ok: true,
      message: "Invite created",
      inviteUrl,
      user: formatUser(user),
    });
  } catch (error) {
    console.error("Invite user error:", error);
    return res.status(500).json({ error: "Could not invite user" });
  }
});

router.patch("/:id", authRequired, async (req, res) => {
  try {
    if (!["OWNER", "ADMIN"].includes(req.user.role)) {
      return res.status(403).json({ error: "Not allowed" });
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: { company: true },
    });

    if (!targetUser) {
      return res.status(404).json({ error: "User not found" });
    }

    if (req.user.role !== "OWNER" && targetUser.companyId !== req.user.companyId) {
      return res.status(403).json({ error: "Not allowed" });
    }

    if (!canManageTarget(req.user, targetUser)) {
      return res.status(403).json({ error: "You cannot edit this user" });
    }

    const updateData = {};

    if (req.body.username !== undefined) {
      const cleanUsername = String(req.body.username).trim();

      if (!cleanUsername) {
        return res.status(400).json({ error: "Username is required" });
      }

      updateData.username = cleanUsername;
    }

    if (req.body.email !== undefined) {
      updateData.email = req.body.email ? String(req.body.email).trim().toLowerCase() : null;
    }

    if (req.body.active !== undefined) {
      updateData.active = Boolean(req.body.active);
    }

    if (req.body.role !== undefined) {
      const nextRole = String(req.body.role).toUpperCase();

      if (!canInviteRole(req.user.role, nextRole)) {
        return res.status(403).json({ error: "You cannot assign this role" });
      }

      updateData.role = nextRole;
    }

    if (updateData.username) {
      const duplicateUsername = await prisma.user.findUnique({
        where: {
          companyId_username: {
            companyId: targetUser.companyId,
            username: updateData.username,
          },
        },
      });

      if (duplicateUsername && duplicateUsername.id !== targetUser.id) {
        return res.status(400).json({ error: "Username already exists for this company" });
      }
    }

    if (updateData.email) {
      const duplicateEmail = await prisma.user.findFirst({
        where: {
          email: updateData.email,
          NOT: { id: targetUser.id },
        },
      });

      if (duplicateEmail) {
        return res.status(400).json({ error: "Email already exists" });
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: targetUser.id },
      data: updateData,
      include: { company: true },
    });

    return res.json(formatUser(updatedUser));
  } catch (error) {
    console.error("Update user error:", error);
    return res.status(500).json({ error: "Could not update user" });
  }
});

router.delete("/:id", authRequired, async (req, res) => {
  try {
    if (!["OWNER", "ADMIN"].includes(req.user.role)) {
      return res.status(403).json({ error: "Not allowed" });
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: req.params.id },
    });

    if (!targetUser) {
      return res.status(404).json({ error: "User not found" });
    }

    if (targetUser.id === req.user.id || targetUser.id === req.user.userId) {
      return res.status(400).json({ error: "You cannot delete your own account" });
    }

    if (req.user.role !== "OWNER" && targetUser.companyId !== req.user.companyId) {
      return res.status(403).json({ error: "Not allowed" });
    }

    if (!canManageTarget(req.user, targetUser)) {
      return res.status(403).json({ error: "You cannot delete this user" });
    }

    await prisma.user.delete({
      where: { id: targetUser.id },
    });

    return res.json({ ok: true });
  } catch (error) {
    console.error("Delete user error:", error);
    return res.status(500).json({ error: "Could not delete user" });
  }
});

module.exports = router;