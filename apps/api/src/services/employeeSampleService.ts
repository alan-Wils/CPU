import type {
    EmployeeSampleLicenseType,
    EmployeeSampleProductCategory,
    EmployeeSamplePurpose,
    EmployeeSampleSourceType,
    EmployeeSampleUnit,
} from "@prisma/client";
import { AppError } from "../errors/AppError.js";
import {
    parseEmployeeSamplesConfigJson,
    resolveFlowerGramMonthlyLimit,
    COLORADO_EMPLOYEE_SAMPLE_SERVINGS_OR_PRODUCTS_PER_MONTH,
} from "../lib/coloradoEmployeeSampleLimits.js";
import { evaluateMonthlyLimits, concentrateCap } from "../lib/employeeSampleUsage.js";
import { EmployeeSampleRepository } from "../repositories/employeeSampleRepository.js";

function denverYearMonth(d: Date): string {
    const y = new Intl.DateTimeFormat("en", { timeZone: "America/Denver", year: "numeric" }).format(d);
    const m = new Intl.DateTimeFormat("en", { timeZone: "America/Denver", month: "2-digit" }).format(d);
    return `${y}-${m}`;
}

function displayNameFromEmail(email: string): string {
    const e = String(email || "").trim().toLowerCase();
    if (!e.includes("@"))
        return e || "User";
    return e.slice(0, e.indexOf("@")) || "User";
}

export class EmployeeSampleService {
    repo = new EmployeeSampleRepository();

    async listEligibleEmployees(companyId: string) {
        const rows = await this.repo.listEligibleEmployees(companyId);
        return rows.map((r) => ({
            id: r.user.id,
            email: r.user.email,
            displayName: displayNameFromEmail(r.user.email),
            active: r.user.isActive,
        }));
    }

    async monthlyUsage(input: {
        companyId: string;
        employeeId: string;
        month: string;
        licenseType: EmployeeSampleLicenseType;
    }) {
        const cfgRaw = await this.repo.findFlowerLimitConfigRow(input.companyId);
        const flowerCfg = parseEmployeeSamplesConfigJson(cfgRaw);
        const current = await this.repo.aggregateMonthlyUsage({
            companyId: input.companyId,
            employeeId: input.employeeId,
            calendarMonth: input.month,
            licenseType: input.licenseType,
        });
        const caps = {
            concentrateGrams: concentrateCap(input.licenseType),
            productsOrServings: COLORADO_EMPLOYEE_SAMPLE_SERVINGS_OR_PRODUCTS_PER_MONTH,
            flowerGrams: resolveFlowerGramMonthlyLimit(flowerCfg),
        };
        return {
            month: input.month,
            licenseType: input.licenseType,
            used: current,
            caps,
            remaining: {
                concentrateGrams: Math.max(0, caps.concentrateGrams - current.concentrateGrams),
                productsOrServings: Math.max(0, caps.productsOrServings - current.productsOrServings),
                flowerGrams: Math.max(0, caps.flowerGrams - current.flowerGrams),
            },
        };
    }

    async previewAfterTransfer(input: {
        companyId: string;
        employeeId: string;
        month: string;
        licenseType: EmployeeSampleLicenseType;
        productCategory: EmployeeSampleProductCategory;
        unit: EmployeeSampleUnit;
        quantity: number;
    }) {
        const cfgRaw = await this.repo.findFlowerLimitConfigRow(input.companyId);
        const flowerCfg = parseEmployeeSamplesConfigJson(cfgRaw);
        const current = await this.repo.aggregateMonthlyUsage({
            companyId: input.companyId,
            employeeId: input.employeeId,
            calendarMonth: input.month,
            licenseType: input.licenseType,
        });
        const ev = evaluateMonthlyLimits({
            licenseType: input.licenseType,
            flowerConfig: flowerCfg,
            current,
            proposed: {
                productCategory: input.productCategory,
                unit: input.unit,
                quantity: input.quantity,
            },
        });
        return {
            used: current,
            after: ev.bucketsAfter,
            caps: ev.caps,
            remaining: {
                concentrateGrams: Math.max(0, ev.caps.concentrateGrams - current.concentrateGrams),
                productsOrServings: Math.max(0, ev.caps.productsOrServings - current.productsOrServings),
                flowerGrams: Math.max(0, ev.caps.flowerGrams - current.flowerGrams),
            },
            remainingAfter: {
                concentrateGrams: Math.max(0, ev.caps.concentrateGrams - ev.bucketsAfter.concentrateGrams),
                productsOrServings: Math.max(0, ev.caps.productsOrServings - ev.bucketsAfter.productsOrServings),
                flowerGrams: Math.max(0, ev.caps.flowerGrams - ev.bucketsAfter.flowerGrams),
            },
            ok: ev.ok,
            violations: ev.violations,
        };
    }

    async create(input: {
        companyId: string;
        actorUserId: string;
        employeeId: string;
        employeeIdentifierSnapshot?: string | null;
        licenseType: EmployeeSampleLicenseType;
        sourceType: EmployeeSampleSourceType;
        productCategory: EmployeeSampleProductCategory;
        productName: string;
        batchNumber: string;
        metrcPackageTag: string;
        quantity: number;
        unit: EmployeeSampleUnit;
        thcMgPerServing?: number | null;
        transferDate: Date;
        purpose: EmployeeSamplePurpose;
        notes?: string | null;
        sopAcknowledged: boolean;
        employeeConfirmedMonthlyLimit: boolean;
        notCompensationAcknowledged: boolean;
        noOnPremConsumptionAcknowledged: boolean;
        noResaleOrTransferAcknowledged: boolean;
    }) {
        const m = await this.repo.assertEmployeeEligibleForSamples(input.companyId, input.employeeId);
        if (!m?.user)
            throw new AppError("Employee is not active or is not designated for R&D sampling in this company.", 400);

        const ack =
            input.sopAcknowledged &&
            input.employeeConfirmedMonthlyLimit &&
            input.notCompensationAcknowledged &&
            input.noOnPremConsumptionAcknowledged &&
            input.noResaleOrTransferAcknowledged;
        if (!ack)
            throw new AppError("All compliance confirmations are required before saving.", 400);

        const qty = Number(input.quantity);
        if (!Number.isFinite(qty) || qty <= 0)
            throw new AppError("Quantity must be a positive number.", 400);

        const calendarMonth = denverYearMonth(input.transferDate);
        const cfgRaw = await this.repo.findFlowerLimitConfigRow(input.companyId);
        const flowerCfg = parseEmployeeSamplesConfigJson(cfgRaw);
        const current = await this.repo.aggregateMonthlyUsage({
            companyId: input.companyId,
            employeeId: input.employeeId,
            calendarMonth,
            licenseType: input.licenseType,
        });
        const ev = evaluateMonthlyLimits({
            licenseType: input.licenseType,
            flowerConfig: flowerCfg,
            current,
            proposed: {
                productCategory: input.productCategory,
                unit: input.unit,
                quantity: qty,
            },
        });
        if (!ev.ok)
            throw new AppError(ev.violations.join(" "), 400);

        const email = String(m.user.email || "").trim();
        const created = await this.repo.createRow({
            company: { connect: { id: input.companyId } },
            employee: { connect: { id: input.employeeId } },
            employeeNameSnapshot: displayNameFromEmail(email),
            employeeIdentifierSnapshot: input.employeeIdentifierSnapshot?.trim() || null,
            licenseType: input.licenseType,
            sourceType: input.sourceType,
            productCategory: input.productCategory,
            productName: input.productName.trim(),
            batchNumber: input.batchNumber.trim(),
            metrcPackageTag: input.metrcPackageTag.trim(),
            quantity: qty,
            unit: input.unit,
            thcMgPerServing:
                input.thcMgPerServing == null || !Number.isFinite(Number(input.thcMgPerServing))
                    ? null
                    : Number(input.thcMgPerServing),
            transferDate: input.transferDate,
            calendarMonth,
            purpose: input.purpose,
            sopAcknowledged: true,
            employeeConfirmedMonthlyLimit: true,
            notCompensationAcknowledged: true,
            noOnPremConsumptionAcknowledged: true,
            noResaleOrTransferAcknowledged: true,
            createdBy: { connect: { id: input.actorUserId } },
            notes: input.notes?.trim() || null,
        });
        return this.serializeRow(created);
    }

    async list(input: {
        companyId: string;
        take: number;
        employeeId?: string | null;
        calendarMonth?: string | null;
        dateFrom?: string | null;
        dateTo?: string | null;
        productCategory?: string | null;
        batchNumber?: string | null;
        metrcTag?: string | null;
    }) {
        let dateFrom: Date | null = null;
        let dateToExclusive: Date | null = null;
        if (input.dateFrom) {
            const d = new Date(`${input.dateFrom}T00:00:00.000Z`);
            if (!Number.isNaN(d.getTime()))
                dateFrom = d;
        }
        if (input.dateTo) {
            const d = new Date(`${input.dateTo}T00:00:00.000Z`);
            if (!Number.isNaN(d.getTime())) {
                d.setUTCDate(d.getUTCDate() + 1);
                dateToExclusive = d;
            }
        }
        const rows = await this.repo.listSamples({
            companyId: input.companyId,
            take: input.take,
            employeeId: input.employeeId,
            calendarMonth: input.calendarMonth,
            dateFrom,
            dateToExclusive,
            productCategory: input.productCategory,
            batchNumber: input.batchNumber,
            metrcTag: input.metrcTag,
        });
        return rows.map((r) => this.serializeRow(r));
    }

    async getById(companyId: string, id: string) {
        const r = await this.repo.findById(companyId, id);
        if (!r)
            throw new AppError("Sample record not found", 404);
        return this.serializeRow(r);
    }

    private serializeRow(r: {
        id: string;
        companyId: string;
        employeeId: string;
        employeeNameSnapshot: string;
        employeeIdentifierSnapshot: string | null;
        licenseType: EmployeeSampleLicenseType;
        sourceType: EmployeeSampleSourceType;
        productCategory: EmployeeSampleProductCategory;
        productName: string;
        batchNumber: string;
        metrcPackageTag: string;
        quantity: number;
        unit: EmployeeSampleUnit;
        thcMgPerServing: number | null;
        transferDate: Date;
        calendarMonth: string;
        purpose: EmployeeSamplePurpose;
        notes: string | null;
        createdAt: Date;
        updatedAt: Date;
        employee: { id: string; email: string };
        createdBy: { id: string; email: string };
    }) {
        return {
            id: r.id,
            companyId: r.companyId,
            employeeId: r.employeeId,
            employeeNameSnapshot: r.employeeNameSnapshot,
            employeeIdentifierSnapshot: r.employeeIdentifierSnapshot,
            licenseType: r.licenseType,
            sourceType: r.sourceType,
            productCategory: r.productCategory,
            productName: r.productName,
            batchNumber: r.batchNumber,
            metrcPackageTag: r.metrcPackageTag,
            quantity: r.quantity,
            unit: r.unit,
            thcMgPerServing: r.thcMgPerServing,
            transferDate: r.transferDate.toISOString(),
            calendarMonth: r.calendarMonth,
            purpose: r.purpose,
            notes: r.notes,
            createdAt: r.createdAt.toISOString(),
            updatedAt: r.updatedAt.toISOString(),
            employeeEmail: r.employee.email,
            createdByUserId: r.createdBy.id,
            createdByEmail: r.createdBy.email,
            compliance: {
                sopAcknowledged: true,
                employeeConfirmedMonthlyLimit: true,
                notCompensationAcknowledged: true,
                noOnPremConsumptionAcknowledged: true,
                noResaleOrTransferAcknowledged: true,
            },
        };
    }
}
