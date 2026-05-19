import { describe, expect, it } from "vitest";
import {
  makeChainBatchCode,
  makeDateCode,
  makeExtractionMarketBatchCode,
  parseChainBatchAcronym,
  parseChainBatchDateCode,
} from "./batchChainCodes";

describe("makeDateCode", () => {
  it("formats ISO dates as MMDDYY", () => {
    expect(makeDateCode("2026-05-19")).toBe("051926");
  });
});

describe("makeChainBatchCode", () => {
  it("returns acronym.date for first batch of the day", () => {
    expect(makeChainBatchCode("gmo", "2026-02-09", [])).toBe("GMO.020926");
  });

  it("adds sequence when same strain and day exist", () => {
    const existing = [{ id: "GMO.020926" }, { id: "GMO.2.020926" }];
    expect(makeChainBatchCode("GMO", "2026-02-09", existing)).toBe("GMO.3.020926");
  });
});

describe("makeExtractionMarketBatchCode", () => {
  it("uses single strain acronym and date", () => {
    expect(makeExtractionMarketBatchCode(["GMO"], "2026-05-12")).toBe("GMO.051226");
  });

  it("blends two strain acronyms into a four-letter core", () => {
    expect(makeExtractionMarketBatchCode(["GMO", "RODA"], "2026-05-12")).toBe("GMRO.051226");
  });
});

describe("parseChainBatch", () => {
  it("reads acronym and date from chain id", () => {
    expect(parseChainBatchAcronym("GMO.2.020926")).toBe("GMO");
    expect(parseChainBatchDateCode("GMO.2.020926")).toBe("020926");
  });
});
