import type { EmployeeSampleLicenseType, EmployeeSampleProductCategory, EmployeeSampleUnit } from "@prisma/client";
import {
    COLORADO_EMPLOYEE_SAMPLE_MEDICAL_CONCENTRATE_GRAMS_PER_MONTH,
    COLORADO_EMPLOYEE_SAMPLE_RETAIL_CONCENTRATE_GRAMS_PER_MONTH,
    COLORADO_EMPLOYEE_SAMPLE_SERVINGS_OR_PRODUCTS_PER_MONTH,
    resolveFlowerGramMonthlyLimit,
    type EmployeeSamplesCompanyConfigShape,
} from "./coloradoEmployeeSampleLimits.js";

export type UsageBuckets = {
    concentrateGrams: number;
    productsOrServings: number;
    flowerGrams: number;
};

export function emptyUsageBuckets(): UsageBuckets {
    return { concentrateGrams: 0, productsOrServings: 0, flowerGrams: 0 };
}

export function addRecordToBuckets(
    b: UsageBuckets,
    row: {
        productCategory: EmployeeSampleProductCategory;
        unit: EmployeeSampleUnit;
        quantity: number;
    },
): void {
    const q = Number(row.quantity);
    if (!Number.isFinite(q) || q <= 0)
        return;
    const { productCategory, unit } = row;
    if (productCategory === "CONCENTRATE" && unit === "GRAMS") {
        b.concentrateGrams += q;
        return;
    }
    if (productCategory === "FLOWER" && unit === "GRAMS") {
        b.flowerGrams += q;
        return;
    }
    if (productCategory === "FLOWER" && (unit === "EACH" || unit === "SERVINGS")) {
        b.productsOrServings += q;
        return;
    }
    if (productCategory === "EDIBLE" || productCategory === "NON_EDIBLE_PRODUCT") {
        b.productsOrServings += q;
        return;
    }
    if (productCategory === "CONCENTRATE" && (unit === "SERVINGS" || unit === "EACH")) {
        b.productsOrServings += q;
    }
}

export function concentrateCap(licenseType: EmployeeSampleLicenseType): number {
    return licenseType === "MEDICAL"
        ? COLORADO_EMPLOYEE_SAMPLE_MEDICAL_CONCENTRATE_GRAMS_PER_MONTH
        : COLORADO_EMPLOYEE_SAMPLE_RETAIL_CONCENTRATE_GRAMS_PER_MONTH;
}

export type LimitCheckResult = {
    ok: boolean;
    violations: string[];
    bucketsAfter: UsageBuckets;
    caps: {
        concentrateGrams: number;
        productsOrServings: number;
        flowerGrams: number;
    };
};

export function evaluateMonthlyLimits(input: {
    licenseType: EmployeeSampleLicenseType;
    flowerConfig: EmployeeSamplesCompanyConfigShape;
    current: UsageBuckets;
    proposed: {
        productCategory: EmployeeSampleProductCategory;
        unit: EmployeeSampleUnit;
        quantity: number;
    };
}): LimitCheckResult {
    const after: UsageBuckets = { ...input.current };
    addRecordToBuckets(after, {
        productCategory: input.proposed.productCategory,
        unit: input.proposed.unit,
        quantity: input.proposed.quantity,
    });
    const caps = {
        concentrateGrams: concentrateCap(input.licenseType),
        productsOrServings: COLORADO_EMPLOYEE_SAMPLE_SERVINGS_OR_PRODUCTS_PER_MONTH,
        flowerGrams: resolveFlowerGramMonthlyLimit(input.flowerConfig),
    };
    const violations: string[] = [];
    if (after.concentrateGrams > caps.concentrateGrams + 1e-9) {
        violations.push(
            `Concentrate limit exceeded for ${input.licenseType === "MEDICAL" ? "medical" : "retail"} (${caps.concentrateGrams}g / month).`,
        );
    }
    if (after.productsOrServings > caps.productsOrServings + 1e-9) {
        violations.push(`Servings / products limit exceeded (${caps.productsOrServings} / month).`);
    }
    if (after.flowerGrams > caps.flowerGrams + 1e-9) {
        violations.push(`Flower limit exceeded (${caps.flowerGrams}g configured for this company / month).`);
    }
    return {
        ok: violations.length === 0,
        violations,
        bucketsAfter: after,
        caps,
    };
}
