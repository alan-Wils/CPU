import { describe, expect, it } from "vitest";
import {
    buildCultivationStrainMetricPoints,
    mergeFreshFrozenSourcesForAnalytics,
} from "./buildCultivationStrainMetricPoints.js";

const parentUpdated = new Date("2026-04-28T15:00:00.000Z");

describe("buildCultivationStrainMetricPoints", () => {
    it("emits one point per dry batch with lab THC and skips parent when dry is in range", () => {
        const cultivationRows = [
            {
                id: "TAHA.050726",
                strain: "Tangerine Haze",
                strainAcronym: "TAHA",
                updatedAt: parentUpdated,
                cultivationUiState: {
                    finalLabPotencyPct: 25,
                    finalLabPotencyAt: "2026-05-07T12:00:00.000Z",
                    dryYieldGPerSqFt: 1.2,
                },
            },
        ];
        const dryFlowerBatches = [
            {
                id: "DRY-TAHA.050726-7475",
                source: "TAHA.050726",
                status: "Passed / Ready for Packaging",
                testStatus: "Test Passed",
                finalLabPotencyPct: 24,
                finalLabPotencyAt: "2026-05-01T12:00:00.000Z",
                dryYieldGPerSqFt: 1.1,
            },
            {
                id: "DRY-TAHA.050726-5287",
                source: "TAHA.050726",
                status: "Passed / Ready for Packaging",
                testStatus: "Test Passed",
                finalLabPotencyPct: 25,
                finalLabPotencyAt: "2026-05-03T12:00:00.000Z",
                dryYieldGPerSqFt: 1.15,
            },
        ];

        const fromMs = Date.UTC(2026, 4, 1, 0, 0, 0, 0);
        const toMs = Date.UTC(2026, 4, 31, 23, 59, 59, 999);

        const points = buildCultivationStrainMetricPoints({
            fromMs,
            toMs,
            strainFilter: null,
            cultivationRows,
            dryFlowerBatches,
            sourceBatches: [],
        });

        expect(points).toHaveLength(2);
        expect(points.map((p) => p.batchId).sort()).toEqual([
            "DRY-TAHA.050726-5287",
            "DRY-TAHA.050726-7475",
        ]);
        expect(points.find((p) => p.batchId.endsWith("7475"))?.date).toBe("2026-05-01");
        expect(points.find((p) => p.batchId.endsWith("5287"))?.date).toBe("2026-05-03");
    });

    it("falls back to parent cultivation row when no dry batch in date range", () => {
        const cultivationRows = [
            {
                id: "TAHA.050726",
                strain: "Tangerine Haze",
                strainAcronym: "TAHA",
                updatedAt: parentUpdated,
                cultivationUiState: {
                    finalLabPotencyPct: 22,
                    finalLabPotencyAt: "2026-04-15T12:00:00.000Z",
                    dryYieldGPerSqFt: 0.9,
                },
            },
        ];
        const dryFlowerBatches = [
            {
                id: "DRY-TAHA.050726-7475",
                source: "TAHA.050726",
                status: "Passed / Ready for Packaging",
                finalLabPotencyPct: 24,
                finalLabPotencyAt: "2026-05-01T12:00:00.000Z",
            },
        ];

        const fromMs = Date.UTC(2026, 3, 1, 0, 0, 0, 0);
        const toMs = Date.UTC(2026, 3, 30, 23, 59, 59, 999);

        const points = buildCultivationStrainMetricPoints({
            fromMs,
            toMs,
            strainFilter: null,
            cultivationRows,
            dryFlowerBatches,
            sourceBatches: [],
        });

        expect(points).toHaveLength(1);
        expect(points[0].batchId).toBe("TAHA.050726");
        expect(points[0].date).toBe("2026-04-15");
    });

    it("filters by strain acronym", () => {
        const cultivationRows = [
            {
                id: "TAHA.050726",
                strain: "Tangerine Haze",
                strainAcronym: "TAHA",
                updatedAt: parentUpdated,
                cultivationUiState: {},
            },
            {
                id: "GRCR.010726",
                strain: "Green Crack",
                strainAcronym: "GRCR",
                updatedAt: parentUpdated,
                cultivationUiState: {},
            },
        ];
        const dryFlowerBatches = [
            {
                id: "DRY-TAHA.050726-7475",
                source: "TAHA.050726",
                status: "Passed / Ready for Packaging",
                finalLabPotencyPct: 24,
                finalLabPotencyAt: "2026-05-01T12:00:00.000Z",
            },
            {
                id: "DRY-GRCR.010726-1111",
                source: "GRCR.010726",
                status: "Passed / Ready for Packaging",
                finalLabPotencyPct: 20,
                finalLabPotencyAt: "2026-05-02T12:00:00.000Z",
            },
        ];

        const fromMs = Date.UTC(2026, 4, 1, 0, 0, 0, 0);
        const toMs = Date.UTC(2026, 4, 31, 23, 59, 59, 999);

        const points = buildCultivationStrainMetricPoints({
            fromMs,
            toMs,
            strainFilter: ["TAHA"],
            cultivationRows,
            dryFlowerBatches,
            sourceBatches: [],
        });

        expect(points).toHaveLength(1);
        expect(points[0].strainAcronym).toBe("TAHA");
    });

    it("emits fresh frozen yield from source grams and parent dryCanopySqFt", () => {
        const cultivationRows = [
            {
                id: "TAHA.050726",
                strain: "Tangerine Haze",
                strainAcronym: "TAHA",
                updatedAt: parentUpdated,
                cultivationUiState: { dryCanopySqFt: 10, plants: 0 },
            },
        ];
        const sourceBatches = [
            {
                id: "FF-TAHA.050726-8899",
                type: "Fresh Frozen",
                source: "TAHA.050726",
                grams: 453.592,
                freshFrozenStemWasteGrams: 50,
                createdAt: "2026-05-10T12:00:00.000Z",
            },
        ];

        const fromMs = Date.UTC(2026, 4, 1, 0, 0, 0, 0);
        const toMs = Date.UTC(2026, 4, 31, 23, 59, 59, 999);

        const points = buildCultivationStrainMetricPoints({
            fromMs,
            toMs,
            strainFilter: null,
            cultivationRows,
            dryFlowerBatches: [],
            sourceBatches,
        });

        expect(points).toHaveLength(1);
        expect(points[0].batchId).toBe("FF-TAHA.050726-8899");
        expect(points[0].freshFrozenYieldGPerSqFt).toBeCloseTo(45.3592, 3);
        expect(points[0].freshFrozenStemWasteGPerSqFt).toBeCloseTo(5, 3);
        expect(points[0].potencyPct).toBeNull();
        expect(points[0].dryYieldGPerSqFt).toBeNull();
        expect(points[0].date).toBe("2026-05-10");
    });

    it("includes fresh frozen metrics even when parent batch still shows plants remaining (partial harvest)", () => {
        const cultivationRows = [
            {
                id: "TAHA.050726",
                strain: "Tangerine Haze",
                strainAcronym: "TAHA",
                updatedAt: parentUpdated,
                cultivationUiState: { dryCanopySqFt: 10, plants: 4 },
            },
        ];
        const sourceBatches = [
            {
                id: "FF-TAHA.050726-8899",
                type: "Fresh Frozen",
                source: "TAHA.050726",
                grams: 453.592,
                createdAt: "2026-05-10T12:00:00.000Z",
            },
        ];

        const fromMs = Date.UTC(2026, 4, 1, 0, 0, 0, 0);
        const toMs = Date.UTC(2026, 4, 31, 23, 59, 59, 999);

        const points = buildCultivationStrainMetricPoints({
            fromMs,
            toMs,
            strainFilter: null,
            cultivationRows,
            dryFlowerBatches: [],
            sourceBatches,
        });

        expect(points).toHaveLength(1);
        expect(points[0].batchId).toBe("FF-TAHA.050726-8899");
        expect(points[0].freshFrozenYieldGPerSqFt).toBeCloseTo(45.3592, 3);
    });

    it("mergeFreshFrozenSourcesForAnalytics picks FF rows only from productionBatches when sourceBatches empty", () => {
        const merged = mergeFreshFrozenSourcesForAnalytics(
            [],
            [
                {
                    id: "FF-RUCA.020926-8673",
                    type: "Fresh Frozen",
                    source: "RUCA.020926",
                    grams: 18018,
                    createdAt: "2026-05-06T15:10:40.000Z",
                },
            ],
            [],
        );
        expect(merged).toHaveLength(1);
        expect(String((merged[0] as { id?: string }).id)).toBe("FF-RUCA.020926-8673");
    });

    it("plots FF when batch exists only under productionBatches in company store merge", () => {
        const cultivationRows = [
            {
                id: "RUCA.020926",
                strain: "Rum Cake",
                strainAcronym: "RUCA",
                updatedAt: parentUpdated,
                cultivationUiState: { dryCanopySqFt: 100 },
            },
        ];
        const merged = mergeFreshFrozenSourcesForAnalytics(
            [],
            [
                {
                    id: "FF-RUCA.020926-8673",
                    type: "Fresh Frozen",
                    source: "RUCA.020926",
                    grams: 18018,
                    createdAt: "2026-05-06T15:10:40.000Z",
                },
            ],
            [],
        );

        const fromMs = Date.UTC(2026, 4, 1, 0, 0, 0, 0);
        const toMs = Date.UTC(2026, 4, 31, 23, 59, 59, 999);

        const points = buildCultivationStrainMetricPoints({
            fromMs,
            toMs,
            strainFilter: null,
            cultivationRows,
            dryFlowerBatches: [],
            sourceBatches: merged,
        });

        expect(points).toHaveLength(1);
        expect(points[0].batchId).toBe("FF-RUCA.020926-8673");
        expect(points[0].freshFrozenYieldGPerSqFt).toBeCloseTo(180.18, 3);
    });
});
