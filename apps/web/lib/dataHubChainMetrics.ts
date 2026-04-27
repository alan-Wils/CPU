/**
 * Shared metrics for Data Hub: dry flower (A / popcorn / trim) and product rollups for exports.
 */

function num(value: any) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function lower(value: any) {
  return String(value || "").toLowerCase();
}

function cleanId(value: any) {
  return String(value || "")
    .toUpperCase()
    .replaceAll(".", "")
    .replaceAll("-", "")
    .replaceAll("_", "")
    .replaceAll(" ", "");
}

function lbsToGrams(lbs: any) {
  return +(num(lbs) * 453.592).toFixed(2);
}

function isDryTrimBatch(batch: any) {
  const text = `${lower(batch?.id)} ${lower(batch?.name)} ${lower(batch?.type)} ${lower(batch?.productType)}`;
  return (
    text.includes("dry trim") ||
    text.includes("trim-") ||
    text.startsWith("trim") ||
    lower(batch?.type) === "dry trim"
  );
}

/** Same logic as the Data Hub page — weights per dry flower / burping batch. */
export function getFlowerWeights(batch: any, relatedSourceBatches: any[] = []) {
  const originalAGrade =
    num(batch?.aGradeFlowerWeightLbs) || num(batch?.trimmedWeightLbs) || num(batch?.finalAGradeFlowerLbs);

  const originalPopcorn = num(batch?.popcornWeightLbs) || num(batch?.finalPopcornLbs);

  const trimFromRelatedSources = relatedSourceBatches
    .filter((source: any) => isDryTrimBatch(source))
    .filter((source: any) => {
      const batchId = String(batch?.id || "");
      const sourceLink = String(source?.source || "");
      const sourceBatchId = String(source?.sourceBatchId || "");
      const originalBatchId = String(source?.originalBatchId || "");
      return (
        sourceLink === batchId ||
        sourceBatchId === batchId ||
        originalBatchId === batchId ||
        cleanId(sourceLink).includes(cleanId(batchId)) ||
        cleanId(batchId).includes(cleanId(sourceLink))
      );
    })
    .reduce((sum: number, source: any) => {
      const sourceWeight =
        num(source?.weightLbs) ||
        num(source?.totalTrimLbs) ||
        num(source?.trimWeightLbs) ||
        num(String(source?.amount || "").replace(/[^0-9.]/g, ""));
      return sum + sourceWeight;
    }, 0);

  const trim = num(batch?.totalTrimLbs) || num(batch?.trimWeightLbs) || trimFromRelatedSources;
  const totalAvailable = originalAGrade + originalPopcorn;

  let packagedAGrade = num(batch?.finalAGradeFlowerLbs);
  let packagedPopcorn = num(batch?.finalPopcornLbs);

  const directPackagedTotal = num(batch?.totalFinalPackagedLbs) || num(batch?.packagedWeightLbs);
  const loggedPackagedTotal = Array.isArray(batch?.packagingLogs)
    ? batch.packagingLogs.reduce((sum: number, log: any) => sum + num(log.packagedLbs || log.weightLbs), 0)
    : 0;

  let packagedTotal = directPackagedTotal || loggedPackagedTotal;

  if (packagedTotal <= 0 && num(batch?.packagedGrams) > 0) {
    packagedTotal = num(batch.packagedGrams) / 453.592;
  }

  if (packagedAGrade + packagedPopcorn <= 0 && packagedTotal > 0) {
    if (totalAvailable > 0) {
      packagedAGrade = +(packagedTotal * (originalAGrade / totalAvailable)).toFixed(2);
      packagedPopcorn = +(packagedTotal * (originalPopcorn / totalAvailable)).toFixed(2);
    } else {
      packagedAGrade = packagedTotal;
      packagedPopcorn = 0;
    }
  }

  if (packagedTotal <= 0) {
    packagedTotal = packagedAGrade + packagedPopcorn;
  }

  if (packagedTotal > totalAvailable && totalAvailable > 0) {
    packagedTotal = totalAvailable;
  }

  if (packagedAGrade > originalAGrade && originalAGrade > 0) packagedAGrade = originalAGrade;
  if (packagedPopcorn > originalPopcorn && originalPopcorn > 0) packagedPopcorn = originalPopcorn;

  const remaining = Math.max(totalAvailable - packagedTotal, 0);

  return {
    originalAGrade,
    originalPopcorn,
    trim,
    totalAvailable,
    packagedAGrade,
    packagedPopcorn,
    packagedTotal,
    packagedGrams: lbsToGrams(packagedTotal),
    aGradeGrams: lbsToGrams(packagedAGrade),
    popcornGrams: lbsToGrams(packagedPopcorn),
    remaining
  };
}

function round2(n: number) {
  return n > 0 ? +n.toFixed(2) : 0;
}

function extractionLabel(ex: any) {
  return (
    [ex?.productType, ex?.name, ex?.type, (ex as any)?.productName]
      .map((x) => String(x || "").trim())
      .find((s) => s.length) || "Extraction"
  );
}

function packagingLabel(p: any) {
  return String(p?.sku || p?.name || p?.id || "SKU").trim() || "Packaging";
}

/**
 * Aggregate lbs for all dry-flower rows in the chain, plus text rollups for extraction + packaging.
 */
export function computeChainExportSummary(chain: any) {
  const src = chain.source || [];
  const flowers = Array.isArray(chain.flowerOutput) ? chain.flowerOutput : [];

  let aGradeLbs = 0;
  let popcornLbs = 0;
  let trimLbs = 0;
  let packagedALbs = 0;
  let packagedPopLbs = 0;
  let totalPackagedLbs = 0;
  let remainingLbs = 0;

  for (const b of flowers) {
    const w = getFlowerWeights(b, src);
    aGradeLbs += w.originalAGrade;
    popcornLbs += w.originalPopcorn;
    trimLbs += w.trim;
    packagedALbs += w.packagedAGrade;
    packagedPopLbs += w.packagedPopcorn;
    totalPackagedLbs += w.packagedTotal;
    remainingLbs += w.remaining;
  }

  const extMap = new Map<string, { runs: number; outGrams: number }>();
  for (const ex of chain.extraction || []) {
    const label = extractionLabel(ex);
    const g = num(ex.outputGrams);
    const prev = extMap.get(label) || { runs: 0, outGrams: 0 };
    prev.runs += 1;
    prev.outGrams += g;
    extMap.set(label, prev);
  }
  const extractionSummary = Array.from(extMap.entries())
    .map(([label, v]) => {
      const outLb = v.outGrams > 0 ? (v.outGrams / 453.592).toFixed(2) : null;
      return outLb ? `${label} (${v.runs} run${v.runs > 1 ? "s" : ""}, ${outLb} lb out)` : `${label} (${v.runs} run${v.runs > 1 ? "s" : ""})`;
    })
    .join(" | ");

  const pkgMap = new Map<string, { units: number; grams: number }>();
  for (const p of chain.packaging || []) {
    const label = packagingLabel(p);
    const u = num(p.units);
    const g = num(p.netOutputGrams) + num(p.terpeneGrams);
    const prev = pkgMap.get(label) || { units: 0, grams: 0 };
    prev.units += u;
    prev.grams += g;
    pkgMap.set(label, prev);
  }
  const packagingSummary = Array.from(pkgMap.entries())
    .map(([label, v]) => {
      const parts: string[] = [];
      if (v.units > 0) parts.push(`${v.units} u`);
      if (v.grams > 0) parts.push(`${(v.grams / 453.592).toFixed(2)} lb`);
      return parts.length ? `${label}: ${parts.join(", ")}` : label;
    })
    .join(" | ");

  return {
    aGradeLbs: round2(aGradeLbs),
    popcornLbs: round2(popcornLbs),
    trimLbs: round2(trimLbs),
    packagedAgradeLbs: round2(packagedALbs),
    packagedPopcornLbs: round2(packagedPopLbs),
    totalPackagedDryFlowerLbs: round2(totalPackagedLbs),
    remainingDryFlowerLbs: round2(remainingLbs),
    extractionProductSummary: extractionSummary,
    packagingProductSummary: packagingSummary
  };
}
