import { describe, expect, it } from "vitest";
import {
  collectExtractionCultivationSourceLabels,
  extractionBatchMarketBatchCode,
  findActiveExtractionBatchWithMarketCode,
  marketBatchCodeFromExtId,
} from "./extractionBatchDisplay";

describe("extractionBatchDisplay", () => {
  it("marketBatchCodeFromExtId maps EXT ids to acronym.date", () => {
    expect(marketBatchCodeFromExtId("EXT-GMO0-051226")).toBe("GMO.051226");
    expect(marketBatchCodeFromExtId("EXT-GMO0-051226-2")).toBe("GMO.051226");
    expect(marketBatchCodeFromExtId("EXT-1")).toBe("");
  });

  it("extractionBatchMarketBatchCode prefers saved market code", () => {
    expect(
      extractionBatchMarketBatchCode({
        id: "EXT-GMO0-051226",
        marketBatchCode: "GMO.051226",
      }),
    ).toBe("GMO.051226");
    expect(
      extractionBatchMarketBatchCode({ id: "EXT-GMO0-051226" }),
    ).toBe("GMO.051226");
  });

  it("findActiveExtractionBatchWithMarketCode matches saved codes only", () => {
    const batches = [
      { id: "EXT-A", marketBatchCode: "GMO.051226", status: "Purge Active" },
      { id: "EXT-B", marketBatchCode: "GMO.051226.2", status: "Purge Active" },
      { id: "EXT-C", status: "Purge Active" },
    ];
    expect(
      findActiveExtractionBatchWithMarketCode(batches, "GMO.051226", "EXT-B")?.id,
    ).toBe("EXT-A");
    expect(
      findActiveExtractionBatchWithMarketCode(batches, "gmo.051226", "EXT-A"),
    ).toBeNull();
    expect(
      findActiveExtractionBatchWithMarketCode(batches, "GMO.051226", "EXT-A"),
    ).toBeNull();
    expect(
      findActiveExtractionBatchWithMarketCode(batches, "GMO.051226", "EXT-C")?.id,
    ).toBe("EXT-A");
  });

  it("collectExtractionCultivationSourceLabels dedupes blend, anchor, and source rows", () => {
    const labels = collectExtractionCultivationSourceLabels(
      {
        cultivationBatchId: "GMO.051226",
        blendCultivationBatchIds: ["GMO.051226", "BLUE.051226"],
        sources: [{ sourceId: "ff-1" }, { sourceId: "ff-2" }],
      },
      (id) =>
        id === "ff-1"
          ? { source: "GMO.051226" }
          : id === "ff-2"
            ? { source: "BLUE.051226" }
            : null,
    );
    expect(labels).toEqual(["GMO.051226", "BLUE.051226"]);
  });
});
