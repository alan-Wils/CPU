const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const prisma = require("../db");
const authRequired = require("../middleware/auth");
const { requireMinimumRole } = require("../middleware/permissions");
const { sendInviteEmail } = require("../utils/email");

const router = express.Router();

function createToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      companyId: user.companyId,
      username: user.username,
      role: user.role,
    },
    process.env.JWT_SECRET || "dev_secret_change_this",
    { expiresIn: "12h" }
  );
}

function canManageTargetUser(currentRole, targetRole) {
  if (currentRole === "OWNER") return true;
  if (currentRole === "ADMIN" && targetRole !== "OWNER") return true;
  return false;
}

router.post("/accept-invite", async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ error: "Token and password are required" });
    }

    if (String(password).length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const invitedUser = await prisma.user.findFirst({
      where: { inviteToken: token },
      include: { company: true },
    });

    if (!invitedUser) {
      return res.status(404).json({ error: "Invalid invite token" });
    }

    if (
      invitedUser.inviteTokenExpires &&
      new Date(invitedUser.inviteTokenExpires) < new Date()
    ) {
      return res.status(400).json({ error: "Invite token expired" });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const updatedUser = await prisma.user.update({
      where: { id: invitedUser.id },
      data: {
        passwordHash,
        inviteToken: null,
        inviteTokenExpires: null,
        emailVerified: true,
        mustChangePassword: false,
        status: "ACTIVE",
        active: true,
      },
      include: { company: true },
    });

    const loginToken = createToken(updatedUser);

    return res.json({
      token: loginToken,
      company: {
        id: updatedUser.company.id,
        name: updatedUser.company.name,
        code: updatedUser.company.code,
      },
      user: {
        id: updatedUser.id,
        username: updatedUser.username,
        email: updatedUser.email,
        role: updatedUser.role,
        companyId: updatedUser.companyId,
        mustChangePassword: updatedUser.mustChangePassword,
        emailVerified: updatedUser.emailVerified,
        status: updatedUser.status,
      },
    });
  } catch (error) {
    console.error("Accept invite error:", error);
    return res.status(500).json({ error: "Could not accept invite" });
  }
});

router.post("/bootstrap", async (req, res) => {
  try {
    const { companyName, companyCode, username, password } = req.body;

    if (!companyName || !companyCode || !username || !password) {
      return res.status(400).json({
        error: "companyName, companyCode, username, and password are required",
      });
    }

    const cleanCompanyCode = companyCode.trim().toUpperCase();

    const existingCompany = await prisma.company.findUnique({
      where: { code: cleanCompanyCode },
    });

    if (existingCompany) {
      return res.status(400).json({ error: "Company code already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const company = await prisma.company.create({
      data: {
        name: companyName.trim(),
        code: cleanCompanyCode,
        users: {
          create: {
            username: username.trim(),
            passwordHash,
            role: "OWNER",
            active: true,
            emailVerified: true,
            mustChangePassword: false,
            status: "ACTIVE",
          },
        },
      },
      include: { users: true },
    });

    const owner = company.users[0];
    const token = createToken(owner);

    return res.json({
      token,
      company: {
        id: company.id,
        name: company.name,
        code: company.code,
      },
      user: {
        id: owner.id,
        username: owner.username,
        role: owner.role,
      },
    });
  } catch (error) {
    console.error("Bootstrap error:", error);
    return res.status(500).json({ error: "Could not create company" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { companyCode, username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        error: "username and password are required",
      });
    }

    const cleanUsername = username.trim();
    let company = null;
    let user = null;

    const userIdentifiers = [
      { username: cleanUsername },
      { email: cleanUsername },
    ];

    if (companyCode && companyCode.trim()) {
      company = await prisma.company.findUnique({
        where: { code: companyCode.trim().toUpperCase() },
      });

      if (!company) {
        return res.status(401).json({ error: "Invalid login" });
      }

      user = await prisma.user.findFirst({
        where: {
          companyId: company.id,
          OR: userIdentifiers,
        },
        include: { company: true },
      });
    } else {
      user = await prisma.user.findFirst({
        where: {
          role: "OWNER",
          OR: userIdentifiers,
        },
        include: { company: true },
      });

      if (user) {
        company = user.company;
      }
    }

    if (!user || !user.active || !company) {
      return res.status(401).json({ error: "Invalid login" });
    }

    const passwordOk = await bcrypt.compare(password, user.passwordHash);

    if (!passwordOk) {
      return res.status(401).json({ error: "Invalid login" });
    }

    const token = createToken(user);

    return res.json({
      token,
      company: {
        id: company.id,
        name: company.name,
        code: company.code,
      },
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        companyId: user.companyId,
        mustChangePassword: user.mustChangePassword,
        emailVerified: user.emailVerified,
        status: user.status,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ error: "Could not login" });
  }
});

router.get("/me", authRequired, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      include: { company: true },
    });

    if (!user || !user.active) {
      return res.status(401).json({ error: "User not found" });
    }

    return res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        companyId: user.companyId,
        mustChangePassword: user.mustChangePassword,
        emailVerified: user.emailVerified,
        status: user.status,
      },
      company: {
        id: user.company.id,
        name: user.company.name,
        code: user.company.code,
      },
    });
  } catch (error) {
    console.error("Me error:", error);
    return res.status(500).json({ error: "Could not load user" });
  }
});

router.get(
  "/companies",
  authRequired,
  requireMinimumRole("OWNER"),
  async (req, res) => {
    try {
      const companies = await prisma.company.findMany({
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          code: true,
          createdAt: true,
          _count: { select: { users: true } },
        },
      });

      return res.json(
        companies.map((company) => ({
          id: company.id,
          name: company.name,
          code: company.code,
          createdAt: company.createdAt,
          usersCount: company._count.users,
        }))
      );
    } catch (error) {
      console.error("List companies error:", error);
      return res.status(500).json({ error: "Could not load companies" });
    }
  }
);

router.post(
  "/companies",
  authRequired,
  requireMinimumRole("OWNER"),
  async (req, res) => {
    try {
      const { name, code, ownerUsername, ownerEmail, ownerRole } = req.body;

      if (!name || !code || !ownerUsername || !ownerEmail || !ownerRole) {
        return res.status(400).json({
          error: "name, code, ownerUsername, ownerEmail, and ownerRole are required",
        });
      }

      if (ownerRole !== "OWNER" && ownerRole !== "ADMIN") {
        return res.status(400).json({
          error: "Company starter user must be OWNER or ADMIN.",
        });
      }

      const cleanName = name.trim();
      const cleanCode = code.trim().toUpperCase();
      const cleanOwnerUsername = ownerUsername.trim();
      const cleanOwnerEmail = ownerEmail.trim().toLowerCase();

      const existingCompany = await prisma.company.findUnique({
        where: { code: cleanCode },
      });

      if (existingCompany) {
        return res.status(400).json({ error: "Company code already exists" });
      }

      const existingEmail = await prisma.user.findFirst({
        where: { email: cleanOwnerEmail },
      });

      if (existingEmail) {
        return res.status(400).json({ error: "Starter email already exists" });
      }

      const inviteToken = crypto.randomBytes(32).toString("hex");
      const inviteTokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      const temporaryPassword = crypto.randomBytes(24).toString("hex");
      const passwordHash = await bcrypt.hash(temporaryPassword, 12);

      const company = await prisma.company.create({
        data: {
          name: cleanName,
          code: cleanCode,
          users: {
            create: {
              username: cleanOwnerUsername,
              email: cleanOwnerEmail,
              passwordHash,
              role: ownerRole,
              active: false,
              emailVerified: false,
              mustChangePassword: true,
              status: "INVITED",
              inviteToken,
              inviteTokenExpires,
            },
          },
        },
        include: { users: true },
      });

      const starterUser = company.users[0];

      const appUrl = process.env.APP_URL || "http://localhost:3000";
      const inviteUrl = `${appUrl}/accept-invite?token=${inviteToken}`;

      await sendInviteEmail({
        to: cleanOwnerEmail,
        inviteUrl,
        companyName: company.name,
        role: ownerRole,
      });

      return res.json({
        id: company.id,
        name: company.name,
        code: company.code,
        createdAt: company.createdAt,
        usersCount: company.users.length,
        starterUser: {
          id: starterUser.id,
          username: starterUser.username,
          email: starterUser.email,
          role: starterUser.role,
          active: starterUser.active,
          status: starterUser.status,
        },
        inviteUrl,
      });
    } catch (error) {
      console.error("Create company error:", error);
      return res.status(500).json({
        error: error?.message || "Could not create company",
      });
    }
  }
);

router.patch(
  "/companies/:id",
  authRequired,
  requireMinimumRole("OWNER"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { name, code } = req.body;

      const company = await prisma.company.findUnique({ where: { id } });

      if (!company) {
        return res.status(404).json({ error: "Company not found" });
      }

      const updateData = {};

      if (typeof name === "string") {
        const cleanName = name.trim();

        if (!cleanName) {
          return res.status(400).json({ error: "Company name is required." });
        }

        updateData.name = cleanName;
      }

      if (typeof code === "string") {
        const cleanCode = code.trim().toUpperCase();

        if (!cleanCode) {
          return res.status(400).json({ error: "Company code is required." });
        }

        const existingCompany = await prisma.company.findUnique({
          where: { code: cleanCode },
        });

        if (existingCompany && existingCompany.id !== id) {
          return res.status(400).json({ error: "Company code already exists." });
        }

        updateData.code = cleanCode;
      }

      const updatedCompany = await prisma.company.update({
        where: { id },
        data: updateData,
        include: { _count: { select: { users: true } } },
      });

      return res.json({
        id: updatedCompany.id,
        name: updatedCompany.name,
        code: updatedCompany.code,
        createdAt: updatedCompany.createdAt,
        usersCount: updatedCompany._count.users,
      });
    } catch (error) {
      console.error("Update company error:", error);
      return res.status(500).json({
        error: error?.message || "Could not update company.",
      });
    }
  }
);

router.delete(
  "/companies/:id",
  authRequired,
  requireMinimumRole("OWNER"),
  async (req, res) => {
    try {
      const { id } = req.params;

      const company = await prisma.company.findUnique({ where: { id } });

      if (!company) return res.status(404).json({ error: "Company not found" });

      if (company.id === req.user.companyId) {
        return res.status(400).json({
          error: "You cannot delete your own active company.",
        });
      }

      await prisma.user.deleteMany({ where: { companyId: id } });
      await prisma.company.delete({ where: { id } });

      return res.json({ success: true, deletedCompanyId: id });
    } catch (error) {
      console.error("Delete company error:", error);
      return res.status(500).json({ error: "Could not delete company" });
    }
  }
);

router.post(
  "/users",
  authRequired,
  requireMinimumRole("ADMIN"),
  async (req, res) => {
    try {
      const { username, email, password, role } = req.body;

      if (!username || !password || !role) {
        return res.status(400).json({
          error: "username, password, and role are required",
        });
      }

      if (req.user.role !== "OWNER" && role === "OWNER") {
        return res.status(403).json({
          error: "Only OWNER users can create another OWNER user.",
        });
      }

      const inviteToken = crypto.randomBytes(32).toString("hex");
      const inviteTokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const passwordHash = await bcrypt.hash(password, 12);

      const user = await prisma.user.create({
        data: {
          companyId: req.user.companyId,
          username: username.trim(),
          email: email ? email.trim().toLowerCase() : null,
          passwordHash,
          role,
          active: false,
          emailVerified: false,
          mustChangePassword: true,
          status: "INVITED",
          inviteToken,
          inviteTokenExpires,
        },
      });

      return res.json({
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        active: user.active,
        status: user.status,
        emailVerified: user.emailVerified,
        mustChangePassword: user.mustChangePassword,
        createdAt: user.createdAt,
      });
    } catch (error) {
      console.error("Create user error:", error);
      return res.status(500).json({ error: "Could not create user" });
    }
  }
);

router.get(
  "/users",
  authRequired,
  requireMinimumRole("MANAGER"),
  async (req, res) => {
    try {
      const users = await prisma.user.findMany({
        where: { companyId: req.user.companyId },
        orderBy: { createdAt: "desc" },
      });

      return res.json(
        users.map((user) => ({
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          active: user.active,
          status: user.status,
          emailVerified: user.emailVerified,
          mustChangePassword: user.mustChangePassword,
          createdAt: user.createdAt,
        }))
      );
    } catch (error) {
      console.error("List users error:", error);
      return res.status(500).json({ error: "Could not load users" });
    }
  }
);

router.patch(
  "/users/:id",
  authRequired,
  requireMinimumRole("ADMIN"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { username, email, role, active } = req.body;

      const targetUser = await prisma.user.findFirst({
        where: { id, companyId: req.user.companyId },
      });

      if (!targetUser) return res.status(404).json({ error: "User not found" });

      if (!canManageTargetUser(req.user.role, targetUser.role)) {
        return res.status(403).json({
          error: "You do not have permission to edit this user.",
        });
      }

      const updateData = {};

      if (typeof username === "string") {
        const cleanUsername = username.trim();

        if (!cleanUsername) {
          return res.status(400).json({ error: "Username is required." });
        }

        updateData.username = cleanUsername;
      }

      if (typeof email === "string" || email === null) {
        updateData.email = email ? email.trim().toLowerCase() : null;
      }

      if (typeof role === "string") {
        const cleanRole = role.trim();

        if (!cleanRole) {
          return res.status(400).json({ error: "Role is required." });
        }

        if (req.user.role !== "OWNER" && cleanRole === "OWNER") {
          return res.status(403).json({
            error: "Only OWNER users can assign OWNER access.",
          });
        }

        updateData.role = cleanRole;
      }

      if (typeof active === "boolean") {
        if (req.user.userId === targetUser.id && active === false) {
          return res.status(400).json({
            error: "You cannot deactivate your own account while signed in.",
          });
        }

        updateData.active = active;
      }

      const updatedUser = await prisma.user.update({
        where: { id: targetUser.id },
        data: updateData,
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          active: true,
          status: true,
          emailVerified: true,
          mustChangePassword: true,
          createdAt: true,
        },
      });

      return res.json(updatedUser);
    } catch (error) {
      console.error("Update user error:", error);
      return res.status(500).json({
        error: error?.message || "Could not update user.",
      });
    }
  }
);

router.delete(
  "/users/:id",
  authRequired,
  requireMinimumRole("ADMIN"),
  async (req, res) => {
    try {
      const { id } = req.params;

      const targetUser = await prisma.user.findFirst({
        where: { id, companyId: req.user.companyId },
      });

      if (!targetUser) return res.status(404).json({ error: "User not found" });

      if (req.user.userId === targetUser.id) {
        return res.status(400).json({
          error: "You cannot delete your own account while signed in.",
        });
      }

      if (!canManageTargetUser(req.user.role, targetUser.role)) {
        return res.status(403).json({
          error: "You do not have permission to delete this user.",
        });
      }

      await prisma.user.delete({ where: { id: targetUser.id } });

      return res.json({
        success: true,
        deletedUserId: targetUser.id,
      });
    } catch (error) {
      console.error("Delete user error:", error);
      return res.status(500).json({
        error: error?.message || "Could not delete user.",
      });
    }
  }
);

module.exports = router;