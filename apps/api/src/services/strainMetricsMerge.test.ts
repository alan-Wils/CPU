import { describe, expect, it } from "vitest";
import { mergeStrainAutoMetricsIntoCultivation } from "./strainMetricsMerge.js";

describe("mergeStrainAutoMetricsIntoCultivation", () => {
    it("preserves unrelated strains and top-level keys", () => {
        const cultivation = {
            supplies: [{ id: "s1", name: "Soil" }],
            rooms: { vegRooms: [], flowerRooms: [] },
            strains: [
                {
                    id: "a",
                    name: "Alpha",
                    acronym: "ALP",
                    dominance: "Hybrid",
                    potency: "High",
                    averageYield: "Medium",
                    customField: "keep-me",
                },
                {
                    id: "b",
                    name: "Beta",
                    acronym: "BET",
                    dominance: "Indica",
                    potency: "Low",
                    averageYield: "Light",
                },
            ],
        };
        const byAcronym = new Map([
            ["ALP", { potencies: [20, 24], yields: [10, 12] }],
        ]);
        const out = mergeStrainAutoMetricsIntoCultivation(cultivation, byAcronym, "2026-05-05T00:00:00.000Z");
        expect(out.supplies).toEqual(cultivation.supplies);
        expect(out.rooms).toEqual(cultivation.rooms);
        const strains = out.strains as Record<string, unknown>[];
        expect(strains[0].customField).toBe("keep-me");
        expect(strains[0].autoAvgPotencyPct).toBe(22);
        expect(strains[0].autoAvgDryYieldGPerSqFt).toBe(11);
        expect(strains[0].autoMetricsSampleCount).toBe(2);
        expect(strains[1].autoAvgPotencyPct).toBeUndefined();
    });
});
