import { describe, expect, it } from "vitest";
import { inventoryStatusMatchesFilter } from "@/lib/leafLinkInventoryFilters";

describe("inventoryStatusMatchesFilter", () => {
  it("treats empty row status as pass-through", () => {
    expect(inventoryStatusMatchesFilter("", "Available")).toBe(true);
  });
});
