import { prisma } from "../config/prisma.js";
import { gPerPound } from "./operationalWorkflowService.js";
const g = (n) => Number(n.toFixed(4));
export class DataHubService {
    async getSnapshot(companyId) {
        const [batches, cultPackComplete, labors] = await Promise.all([
            prisma.cultivationBatch.findMany({ where: { companyId }, orderBy: { createdAt: "desc" } }),
            prisma.cultivationPackagingRun.findMany({
                where: { companyId, status: "COMPLETED" }
            }),
            prisma.laborEntry.findMany({ where: { companyId, cultivationBatchId: { not: null } } })
        ]);
        const packedFlowerGrams = g(cultPackComplete
            .filter((r) => r.line === "A_GRADE_FLOWER")
            .reduce((s, r) => s + r.netMaterialGramsCompleted, 0));
        const packedPopcornGrams = g(cultPackComplete
            .filter((r) => r.line === "POPCORN")
            .reduce((s, r) => s + r.netMaterialGramsCompleted, 0));
        const poundsBud = g((packedFlowerGrams + packedPopcornGrams) / gPerPound);
        const laborCost = g(labors.reduce((s, l) => s + l.totalCost, 0));
        const laborHours = g(labors.reduce((s, l) => s + l.hours, 0));
        const laborUsdPerPoundBud = poundsBud > 0.0001 ? g(laborCost / poundsBud) : null;
        const laborHoursPerPoundBud = poundsBud > 0.0001 ? g(laborHours / poundsBud) : null;
        const trimTotals = await prisma.trimFlowState.findMany({ where: { companyId } });
        const freshTotals = await prisma.freshFrozenAllocation.findMany({ where: { companyId } });
        const trimByBatch = new Map(trimTotals.map((t) => [t.cultivationBatchId, t]));
        const freshByBatch = new Map(freshTotals.map((f) => [f.cultivationBatchId, f]));
        const dataHubBatches = batches.map((b) => {
            const trimRow = trimByBatch.get(b.id);
            const toEx = trimRow?.toExtractionGrams ?? 0;
            const con = trimRow?.consumedGrams ?? 0;
            const freshRow = freshByBatch.get(b.id);
            const f = freshRow?.toExtractionGrams ?? 0;
            const harvest = g(b.aGradeFlowerGrams + b.popcornGrams + b.trimGrams + b.freshFrozenGrams) || 1;
            return {
                id: b.id,
                strain: b.strain,
                chain: `${b.strainAcronym}-${b.batchChainCode}`,
                autoStatus: b.autoStatus,
                harvest: {
                    aGradeFlowerGrams: b.aGradeFlowerGrams,
                    popcornGrams: b.popcornGrams,
                    trimGrams: b.trimGrams,
                    freshFrozenGrams: b.freshFrozenGrams
                },
                budPopcornTrimFreshRatio: {
                    a: g(b.aGradeFlowerGrams / harvest),
                    p: g(b.popcornGrams / harvest),
                    t: g(b.trimGrams / harvest),
                    f: g(b.freshFrozenGrams / harvest)
                },
                trimDispatched: {
                    toExtraction: toEx,
                    consumed: con,
                    total: b.trimGrams
                },
                freshFrozenToExtraction: f,
                freshFrozenTotal: b.freshFrozenGrams
            };
        });
        return {
            labor: {
                totalCost: laborCost,
                totalHours: laborHours,
                costPerPoundBud: laborUsdPerPoundBud,
                hoursPerPoundBud: laborHoursPerPoundBud,
                fromSavedFieldTasks: true
            },
            packedCultivationSide: { packedFlowerGrams, packedPopcornGrams, poundsBud },
            batches: dataHubBatches
        };
    }
}
