import { describe, expect, it } from "vitest";
import { resolveInventoryCategoryLabel } from "./productCategoryLabels";

describe("resolveInventoryCategoryLabel", () => {
  const overrides = [{ id: "5", displayName: "Concentrates" }];

  it("returns display name when raw is Category #n", () => {
    expect(resolveInventoryCategoryLabel("Category #5", overrides)).toBe("Concentrates");
  });

  it("matches bare id", () => {
    expect(resolveInventoryCategoryLabel("5", overrides)).toBe("Concentrates");
  });

  it("falls back when no override", () => {
    expect(resolveInventoryCategoryLabel("Category #9", overrides)).toBe("Category #9");
  });
});
