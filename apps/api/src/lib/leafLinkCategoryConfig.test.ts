import { describe, expect, it } from "vitest";
import { mergeLeafLinkCategoryLabelsFromConfigBlocks } from "./leafLinkCategoryConfig.js";
import { resolveInventoryCategoryLabel } from "./productCategoryLabels.js";

describe("mergeLeafLinkCategoryLabelsFromConfigBlocks", () => {
  it("prefers sales.leafLinkCategoryLabels when key exists, even if empty", () => {
    expect(
      mergeLeafLinkCategoryLabelsFromConfigBlocks({ leafLinkCategoryLabels: [] }, { categoryLabels: [{ id: "1", displayName: "X" }] }),
    ).toEqual([]);
  });

  it("uses legacy sales.categoryLabels when leafLinkCategoryLabels key missing", () => {
    expect(
      mergeLeafLinkCategoryLabelsFromConfigBlocks(
        { categoryLabels: [{ id: "5", displayName: "Dabbables" }] },
        undefined,
      ),
    ).toEqual([{ id: "5", displayName: "Dabbables" }]);
  });

  it("falls back to products.categoryLabels", () => {
    expect(
      mergeLeafLinkCategoryLabelsFromConfigBlocks(undefined, {
        categoryLabels: [{ id: "5", displayName: "Flower" }],
      }),
    ).toEqual([{ id: "5", displayName: "Flower" }]);
  });
});

describe("resolveInventoryCategoryLabel integration", () => {
  it("maps Category #5 with configured overrides", () => {
    const overrides = [{ id: "5", displayName: "Dabbables" }];
    expect(resolveInventoryCategoryLabel("Category #5", overrides)).toBe("Dabbables");
  });
});
