import { describe, expect, it } from "vitest";
import { addRecordToBuckets, emptyUsageBuckets, evaluateMonthlyLimits } from "./employeeSampleUsage.js";

describe("employeeSampleUsage", () => {
    it("counts concentrate grams toward medical cap bucket", () => {
        const b = emptyUsageBuckets();
        addRecordToBuckets(b, { productCategory: "CONCENTRATE", unit: "GRAMS", quantity: 10 });
        expect(b.concentrateGrams).toBe(10);
    });

    it("blocks medical concentrate over 15g", () => {
        const current = emptyUsageBuckets();
        current.concentrateGrams = 10;
        const ev = evaluateMonthlyLimits({
            licenseType: "MEDICAL",
            flowerConfig: {},
            current,
            proposed: { productCategory: "CONCENTRATE", unit: "GRAMS", quantity: 6 },
        });
        expect(ev.ok).toBe(false);
    });

    it("allows retail concentrate under 8g", () => {
        const current = emptyUsageBuckets();
        const ev = evaluateMonthlyLimits({
            licenseType: "RETAIL",
            flowerConfig: {},
            current,
            proposed: { productCategory: "CONCENTRATE", unit: "GRAMS", quantity: 8 },
        });
        expect(ev.ok).toBe(true);
    });
});
