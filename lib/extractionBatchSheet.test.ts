import { describe, expect, it } from "vitest";
import {
  buildExtractionBatchSheetModel,
  buildExtractionBatchSheetPrintHtml,
} from "@/lib/extractionBatchSheet";

describe("extractionBatchSheet", () => {
  it("builds source rows with METRC, weights, and cultivation batch", () => {
    const model = buildExtractionBatchSheetModel(
      {
        id: "EXT-GMO-051226-1",
        marketBatchCode: "GMO.051226",
        productType: "Live Resin Oil",
        name: "Live Resin Oil",
        status: "Ready For Pack Socks Start",
        createdAt: "2026-01-02",
        sourceBlendLabel: "GMO · Gelato",
        sources: [{ sourceId: "PKG-1", name: "GMO", amountUsed: 10, materialType: "freshFrozen" }],
        completedTasks: [],
      },
      {
        resolveSource: (id) =>
          id === "PKG-1"
            ? {
                id: "PKG-1",
                harvestCode: "GMO.020926",
                metrcTag: "1A4060300002E890000012345",
                type: "Fresh Frozen",
                source: "GMO.020926",
                weightLbs: 12,
                grams: 5443,
                bundles: 2,
              }
            : null,
        nextRequiredTask: "Pack Socks Start",
      },
    );

    expect(model.sourceRows).toHaveLength(1);
    expect(model.sourceRows[0].metrcTag).toContain("1A40603");
    expect(model.sourceRows[0].usedGramsLabel).toMatch(/g$/);
    expect(model.sourceRows[0].cultivationBatch).toBe("GMO.020926");
    expect(model.cultivationSourceLine).toContain("GMO.020926");
  });

  it("print HTML escapes strain names and includes table headers", () => {
    const model = buildExtractionBatchSheetModel({
      id: "EXT-1",
      sources: [{ sourceId: "x", name: "<script>", amountUsed: 1 }],
    });
    const html = buildExtractionBatchSheetPrintHtml(model);
    expect(html).toContain("METRC tag");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
