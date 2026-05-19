import type { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { emptyUsageBuckets, addRecordToBuckets } from "../lib/employeeSampleUsage.js";
import type { EmployeeSampleLicenseType } from "@prisma/client";

export class EmployeeSampleRepository {
    async findFlowerLimitConfigRow(companyId: string): Promise<string | null> {
        const row = await prisma.companyConfig.findUnique({
            where: { companyId_key: { companyId, key: "employeeSamples" } },
            select: { valueJson: true },
        });
        return row?.valueJson ?? null;
    }

    async listEligibleEmployees(companyId: string) {
        return prisma.companyMembership.findMany({
            where: {
                companyId,
                designatedRnDSamplingEmployee: true,
                user: { isActive: true },
            },
            include: {
                user: { select: { id: true, email: true, displayName: true, isActive: true } },
            },
            orderBy: { createdAt: "asc" },
        });
    }

    async assertEmployeeEligibleForSamples(companyId: string, employeeId: string) {
        const m = await prisma.companyMembership.findFirst({
            where: {
                companyId,
                userId: employeeId,
                designatedRnDSamplingEmployee: true,
                user: { isActive: true },
            },
            include: { user: { select: { id: true, email: true, displayName: true, isActive: true } } },
        });
        return m;
    }

    async aggregateMonthlyUsage(input: {
        companyId: string;
        employeeId: string;
        calendarMonth: string;
        licenseType: EmployeeSampleLicenseType;
    }) {
        const rows = await prisma.employeeSample.findMany({
            where: {
                companyId: input.companyId,
                employeeId: input.employeeId,
                calendarMonth: input.calendarMonth,
                licenseType: input.licenseType,
            },
            select: {
                productCategory: true,
                unit: true,
                quantity: true,
            },
        });
        const b = emptyUsageBuckets();
        for (const r of rows) {
            addRecordToBuckets(b, r);
        }
        return b;
    }

    async listSamples(input: {
        companyId: string;
        take: number;
        employeeId?: string | null;
        calendarMonth?: string | null;
        dateFrom?: Date | null;
        dateToExclusive?: Date | null;
        productCategory?: string | null;
        batchNumber?: string | null;
        metrcTag?: string | null;
    }) {
        const where: Prisma.EmployeeSampleWhereInput = { companyId: input.companyId };
        if (input.employeeId)
            where.employeeId = input.employeeId;
        if (input.calendarMonth)
            where.calendarMonth = input.calendarMonth;
        if (input.dateFrom || input.dateToExclusive) {
            where.transferDate = {};
            if (input.dateFrom)
                where.transferDate.gte = input.dateFrom;
            if (input.dateToExclusive)
                where.transferDate.lt = input.dateToExclusive;
        }
        if (input.productCategory)
            where.productCategory = input.productCategory as never;
        if (input.batchNumber)
            where.batchNumber = { contains: input.batchNumber };
        if (input.metrcTag)
            where.metrcPackageTag = { contains: input.metrcTag };

        return prisma.employeeSample.findMany({
            where,
            orderBy: { transferDate: "desc" },
            take: input.take,
            include: {
                employee: { select: { id: true, email: true, displayName: true } },
                createdBy: { select: { id: true, email: true, displayName: true } },
            },
        });
    }

    async findById(companyId: string, id: string) {
        return prisma.employeeSample.findFirst({
            where: { companyId, id },
            include: {
                employee: { select: { id: true, email: true, displayName: true, isActive: true } },
                createdBy: { select: { id: true, email: true, displayName: true } },
            },
        });
    }

    async createRow(data: Prisma.EmployeeSampleCreateInput) {
        return prisma.employeeSample.create({
            data,
            include: {
                employee: { select: { id: true, email: true, displayName: true } },
                createdBy: { select: { id: true, email: true, displayName: true } },
            },
        });
    }
}
