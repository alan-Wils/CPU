import { Router } from "express";
import { z } from "zod";
import { getScopedCompanyId } from "../../middleware/companyScope.js";
import { validate } from "../../middleware/validate.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";
import {
    adminUserIdParam,
    adminUserStatusSchema,
    adminUserUpdateSchema,
    employeeSampleCreateSchema,
    employeeSampleIdParam,
    employeeSampleListQuerySchema,
    employeeSampleMonthlyUsageQuerySchema,
    inviteCreateSchema,
    inviteIdParam,
    vendorBillingManualOverrideSchema,
} from "../../validation/schemas.js";
import { AdminService } from "../../services/adminService.js";
import { requirePlatformRoles, requireRole } from "../../middleware/rbac.js";
import { UsageCostService } from "../../services/usageCostService.js";
import { utcMonthLabel, VendorBillingSyncService } from "../../services/vendorBillingSyncService.js";
import { NexbatchCompanyUsageLogService } from "../../services/nexbatchCompanyUsageLogService.js";
import { requireEmployeeSampleAccess } from "../../middleware/employeeSampleAccess.js";
import { EmployeeSampleService } from "../../services/employeeSampleService.js";
import { AppError } from "../../errors/AppError.js";
import { LeafLinkOrdersService } from "../../services/leafLinkOrdersService.js";

export const adminRouter = Router();
const leafLinkOrdersService = new LeafLinkOrdersService();
const adminService = new AdminService();
const usageCostService = new UsageCostService();
const vendorBillingSyncService = new VendorBillingSyncService();
const nexbatchCompanyUsageLogService = new NexbatchCompanyUsageLogService();
const employeeSampleService = new EmployeeSampleService();

function parseEmployeeSampleTransferDate(raw: string): Date {
    const s = String(raw || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        return new Date(`${s}T12:00:00.000-07:00`);
    }
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) {
        throw new AppError("Invalid transfer date", 400);
    }
    return d;
}
const leafLinkFullRebuildSchema = z.object({
    confirmFullRebuild: z.literal(true),
});

adminRouter.post(
    "/leaflink/orders/full-rebuild",
    asyncHandler((req, res, next) => {
        const pr = String((req.auth as { platformRole?: string | null })?.platformRole || "");
        if (pr === "nexbatch_admin" || pr === "owner") {
            next();
            return;
        }
        if (req.auth && ["OWNER", "ADMIN"].includes(req.auth.role)) {
            next();
            return;
        }
        res.status(403).json({ message: "Forbidden" });
    }),
    validate({ body: leafLinkFullRebuildSchema }),
    asyncHandler(async (req, res) => {
        const body = req.body as z.infer<typeof leafLinkFullRebuildSchema>;
        if (!body.confirmFullRebuild) {
            throw new AppError("confirmFullRebuild must be true.", 400, "LEAFLINK_FULL_REBUILD_NOT_CONFIRMED");
        }
        const companyId = getScopedCompanyId(req);
        const out = await leafLinkOrdersService.syncOrdersFullRebuild(companyId);
        res.json(out);
    }),
);

adminRouter.get(
    "/companies/:companyId/usage-costs",
    requirePlatformRoles(["nexbatch_admin", "owner"]),
    asyncHandler(async (req, res) => {
        const companyId = String(req.params.companyId || "").trim();
        const out = await usageCostService.getCompanyUsageCosts(companyId);
        res.json(out);
    }),
);
adminRouter.post(
    "/usage-costs/sync",
    requirePlatformRoles(["nexbatch_admin", "owner"]),
    asyncHandler(async (_req, res) => {
        const out = await vendorBillingSyncService.syncCurrentMonthAllProviders();
        res.json(out);
    }),
);

adminRouter.get(
    "/usage-costs",
    requirePlatformRoles(["nexbatch_admin", "owner"]),
    asyncHandler(async (req, res) => {
        const q = req.query.month;
        const month =
            typeof q === "string" && /^\d{4}-\d{2}$/.test(q.trim()) ? q.trim() : utcMonthLabel();
        const snapshots = await vendorBillingSyncService.listSnapshotsForMonth(month);
        res.json({ month, snapshots });
    }),
);

adminRouter.post(
    "/usage-costs/manual-override",
    requirePlatformRoles(["nexbatch_admin", "owner"]),
    validate({ body: vendorBillingManualOverrideSchema }),
    asyncHandler(async (req, res) => {
        const body = req.body as z.infer<typeof vendorBillingManualOverrideSchema>;
        const month = body.month ?? utcMonthLabel();
        await vendorBillingSyncService.saveManualOverride({
            provider: body.provider,
            month,
            totalCostUsd: body.totalCostUsd,
            billingPeriodStart: body.billingPeriodStart ? new Date(body.billingPeriodStart) : null,
            billingPeriodEnd: body.billingPeriodEnd ? new Date(body.billingPeriodEnd) : null,
            rawUsageJson: body.rawUsageJson ?? null,
        });
        const snapshots = await vendorBillingSyncService.listSnapshotsForMonth(month);
        res.json({ ok: true, month, snapshots });
    }),
);

adminRouter.get(
    "/companies/:companyId/nexbatch-company-usage-log",
    requirePlatformRoles(["nexbatch_admin", "owner"]),
    asyncHandler(async (req, res) => {
        const companyId = String(req.params.companyId || "").trim();
        const takeRaw = typeof req.query.take === "string" ? Number(req.query.take) : NaN;
        const take = Number.isFinite(takeRaw) ? takeRaw : 50;
        const out = await nexbatchCompanyUsageLogService.listForCompany(companyId, take);
        res.json(out);
    }),
);
adminRouter.get("/users", requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER"]), asyncHandler(async (req, res) => {
    const users = await adminService.listUsers({ companyId: getScopedCompanyId(req) });
    res.json({ users });
}));
adminRouter.post("/users/:userId/status", requireRole(["OWNER", "ADMIN"]), validate({ body: adminUserStatusSchema }), asyncHandler(async (req, res) => {
    const payload = req.body;
    const result = await adminService.setUserStatus({
        companyId: getScopedCompanyId(req),
        actorUserId: req.auth.userId,
        targetUserId: String(req.params.userId),
        isActive: payload.isActive
    });
    res.json(result);
}));
adminRouter.patch("/users/:userId", requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER"]), validate({ body: adminUserUpdateSchema }), asyncHandler(async (req, res) => {
    const payload = req.body;
    const updated = await adminService.updateUser({
        companyId: getScopedCompanyId(req),
        actorUserId: req.auth.userId,
        actorRole: req.auth.role,
        targetUserId: String(req.params.userId),
        email: payload.email,
        username: payload.username,
        role: payload.role,
        isActive: payload.isActive,
        appPermissions: payload.appPermissions,
        cashLogEodEnabled: payload.cashLogEodEnabled,
        rewardsEnrolled: payload.rewardsEnrolled,
        cultivationAlertsEnabled: payload.cultivationAlertsEnabled,
        designatedRnDSamplingEmployee: payload.designatedRnDSamplingEmployee,
    });
    res.json(updated);
}));
adminRouter.delete("/users/:userId", requireRole(["OWNER", "ADMIN"]), asyncHandler(async (req, res) => {
    const out = await adminService.deleteUser({
        companyId: getScopedCompanyId(req),
        actorUserId: req.auth.userId,
        actorRole: req.auth.role,
        targetUserId: String(req.params.userId)
    });
    res.json(out);
}));
adminRouter.post("/users/:userId/password-reset-email", requireRole(["OWNER", "ADMIN", "OPERATIONS_MANAGER"]), validate({ params: adminUserIdParam }), asyncHandler(async (req, res) => {
    const out = await adminService.sendUserPasswordResetEmail({
        companyId: getScopedCompanyId(req),
        actorUserId: req.auth.userId,
        actorRole: req.auth.role,
        targetUserId: String(req.params.userId),
    });
    res.json(out);
}));
adminRouter.get("/invites", requireRole(["OWNER", "ADMIN"]), asyncHandler(async (req, res) => {
    const invites = await adminService.listInvites({ companyId: getScopedCompanyId(req) });
    res.json({ invites });
}));
adminRouter.post("/invites", requireRole(["OWNER", "ADMIN"]), validate({ body: inviteCreateSchema }), asyncHandler(async (req, res) => {
    const payload = req.body;
    const result = await adminService.createInvite({
        companyId: getScopedCompanyId(req),
        actorUserId: req.auth.userId,
        email: payload.email,
        role: payload.role
    });
    res.status(201).json(result);
}));
adminRouter.delete("/invites/:inviteId", requireRole(["OWNER", "ADMIN"]), validate({ params: inviteIdParam }), asyncHandler(async (req, res) => {
    const out = await adminService.deleteInvite({
        companyId: getScopedCompanyId(req),
        actorUserId: req.auth.userId,
        inviteId: String(req.params.inviteId),
    });
    res.json(out);
}));

adminRouter.get(
    "/employee-samples/eligible-employees",
    asyncHandler(requireEmployeeSampleAccess),
    asyncHandler(async (req, res) => {
        const rows = await employeeSampleService.listEligibleEmployees(getScopedCompanyId(req));
        res.json({ employees: rows });
    }),
);

adminRouter.get(
    "/employee-samples/monthly-usage",
    asyncHandler(requireEmployeeSampleAccess),
    validate({ query: employeeSampleMonthlyUsageQuerySchema }),
    asyncHandler(async (req, res) => {
        const q = req.query as z.infer<typeof employeeSampleMonthlyUsageQuerySchema>;
        const companyId = getScopedCompanyId(req);
        if (q.previewQuantity !== undefined && q.previewProductCategory && q.previewUnit) {
            const out = await employeeSampleService.previewAfterTransfer({
                companyId,
                employeeId: q.employeeId,
                month: q.month,
                licenseType: q.licenseType,
                productCategory: q.previewProductCategory,
                unit: q.previewUnit,
                quantity: q.previewQuantity,
            });
            res.json(out);
            return;
        }
        const out = await employeeSampleService.monthlyUsage({
            companyId,
            employeeId: q.employeeId,
            month: q.month,
            licenseType: q.licenseType,
        });
        res.json(out);
    }),
);

adminRouter.post(
    "/employee-samples",
    asyncHandler(requireEmployeeSampleAccess),
    validate({ body: employeeSampleCreateSchema }),
    asyncHandler(async (req, res) => {
        const companyId = getScopedCompanyId(req);
        const b = req.body as z.infer<typeof employeeSampleCreateSchema>;
        const transferDate = parseEmployeeSampleTransferDate(b.transferDate);
        const created = await employeeSampleService.create({
            companyId,
            actorUserId: req.auth.userId,
            employeeId: b.employeeId,
            employeeIdentifierSnapshot: b.employeeIdentifierSnapshot ?? null,
            licenseType: b.licenseType,
            sourceType: b.sourceType,
            productCategory: b.productCategory,
            productName: b.productName,
            batchNumber: b.batchNumber,
            metrcPackageTag: b.metrcPackageTag,
            quantity: b.quantity,
            unit: b.unit,
            thcMgPerServing: b.thcMgPerServing ?? null,
            transferDate,
            purpose: b.purpose,
            notes: b.notes ?? null,
            sopAcknowledged: b.sopAcknowledged,
            employeeConfirmedMonthlyLimit: b.employeeConfirmedMonthlyLimit,
            notCompensationAcknowledged: b.notCompensationAcknowledged,
            noOnPremConsumptionAcknowledged: b.noOnPremConsumptionAcknowledged,
            noResaleOrTransferAcknowledged: b.noResaleOrTransferAcknowledged,
        });
        res.status(201).json(created);
    }),
);

adminRouter.get(
    "/employee-samples",
    asyncHandler(requireEmployeeSampleAccess),
    validate({ query: employeeSampleListQuerySchema }),
    asyncHandler(async (req, res) => {
        const q = req.query as z.infer<typeof employeeSampleListQuerySchema>;
        const take = q.take ?? 500;
        const rows = await employeeSampleService.list({
            companyId: getScopedCompanyId(req),
            take,
            employeeId: q.employeeId || null,
            calendarMonth: q.month || null,
            dateFrom: q.dateFrom || null,
            dateTo: q.dateTo || null,
            productCategory: q.productCategory || null,
            batchNumber: q.batchNumber || null,
            metrcTag: q.metrcTag || null,
        });
        res.json({ samples: rows });
    }),
);

adminRouter.get(
    "/employee-samples/:id",
    asyncHandler(requireEmployeeSampleAccess),
    validate({ params: employeeSampleIdParam }),
    asyncHandler(async (req, res) => {
        const row = await employeeSampleService.getById(getScopedCompanyId(req), String(req.params.id));
        res.json(row);
    }),
);