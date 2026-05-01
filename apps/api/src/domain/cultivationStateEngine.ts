const EPS = 0.0001;
const g = (n) => Number(n.toFixed(4));
export function aggregateLinePackaging(runs, line) {
    const forLine = runs.filter((r) => r.line === line);
    const completed = forLine.filter((r) => r.status === "COMPLETED").reduce((s, r) => s + r.netMaterialGramsCompleted, 0);
    const inProgress = forLine
        .filter((r) => r.status === "IN_PROGRESS")
        .reduce((s, r) => s + r.netMaterialGramsInProgress + r.netMaterialGramsCompleted, 0);
    const hasOpen = forLine.some((r) => r.status === "IN_PROGRESS");
    return { completed, inProgress, hasOpen, forLine };
}
export function aGradePopcornAvailable(params) {
    const a = aggregateLinePackaging(params.cultRuns, "A_GRADE_FLOWER");
    const p = aggregateLinePackaging(params.cultRuns, "POPCORN");
    return {
        a: {
            total: g(params.batch.aGradeFlowerGrams),
            remaining: g(params.batch.aGradeFlowerGrams - a.completed - a.inProgress)
        },
        p: {
            total: g(params.batch.popcornGrams),
            remaining: g(params.batch.popcornGrams - p.completed - p.inProgress)
        }
    };
}
export function isAgriculturallyCompleteForAutoStatus(input) {
    if (input.batch.autoStatus === "AUTO_COMPLETED") {
        return true;
    }
    const a = aggregateLinePackaging(input.cultRuns, "A_GRADE_FLOWER");
    const p = aggregateLinePackaging(input.cultRuns, "POPCORN");
    if (a.hasOpen || p.hasOpen) {
        return false;
    }
    if (g(a.completed) + EPS < g(input.batch.aGradeFlowerGrams) || g(a.completed) - g(input.batch.aGradeFlowerGrams) > EPS) {
        return false;
    }
    if (g(p.completed) + EPS < g(input.batch.popcornGrams) || g(p.completed) - g(input.batch.popcornGrams) > EPS) {
        return false;
    }
    const trimSum = g(input.trim.toExtractionGrams + input.trim.consumedGrams);
    if (trimSum + EPS < g(input.batch.trimGrams) || trimSum - g(input.batch.trimGrams) > EPS) {
        return false;
    }
    if (g(input.fresh.toExtractionGrams) + EPS < g(input.batch.freshFrozenGrams) || g(input.fresh.toExtractionGrams) - g(input.batch.freshFrozenGrams) > EPS) {
        return false;
    }
    return true;
}
export function productCategoryForSource(type) {
    if (type === "FRESH_FROZEN") {
        return "LIVE";
    }
    return "CURED_WAX";
}
export function isCompatibleSourceProductPair(input) {
    if (input.source === "FRESH_FROZEN" && input.product === "LIVE") {
        return true;
    }
    if (input.source === "DRY_TRIM" && input.product === "CURED_WAX") {
        return true;
    }
    return false;
}
