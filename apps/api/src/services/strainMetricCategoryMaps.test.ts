import { describe, expect, it } from "vitest";
import { potencyCategoryFromAvgThcPct, yieldCategoryFromAvgGPerSqFt } from "./strainMetricCategoryMaps.js";

describe("potencyCategoryFromAvgThcPct", () => {
    it("maps THC bands to config labels", () => {
        expect(potencyCategoryFromAvgThcPct(10)).toBe("Low");
        expect(potencyCategoryFromAvgThcPct(18)).toBe("Medium");
        expect(potencyCategoryFromAvgThcPct(24)).toBe("High");
        expect(potencyCategoryFromAvgThcPct(30)).toBe("Very High");
    });
});

describe("yieldCategoryFromAvgGPerSqFt", () => {
    it("maps g/sq ft bands to config labels", () => {
        expect(yieldCategoryFromAvgGPerSqFt(10)).toBe("Light");
        expect(yieldCategoryFromAvgGPerSqFt(25)).toBe("Medium");
        expect(yieldCategoryFromAvgGPerSqFt(50)).toBe("Heavy");
    });
});
