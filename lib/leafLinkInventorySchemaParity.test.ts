import { describe, expect, it } from "vitest";
import {
  LEAFLINK_INVENTORY_COMPACT_COLS as apiCols,
  LEAFLINK_INVENTORY_COMPACT_FIELD_COUNT as apiFieldCount,
  LEAFLINK_INVENTORY_COMPACT_VERSION as apiVersion,
} from "../apps/api/src/lib/leafLinkInventoryListDto.js";
import {
  LEAFLINK_INVENTORY_COMPACT_COLS as sharedCols,
  LEAFLINK_INVENTORY_COMPACT_FIELD_COUNT as sharedFieldCount,
  LEAFLINK_INVENTORY_COMPACT_VERSION as sharedVersion,
} from "@cpu/shared";

/** Guards API (Railway) and frontend shared schema from drifting apart. */
describe("LeafLink inventory compact schema parity", () => {
  it("API and @cpu/shared use identical v1 column order", () => {
    expect(apiVersion).toBe(sharedVersion);
    expect(apiFieldCount).toBe(sharedFieldCount);
    expect(apiCols).toEqual(sharedCols);
    expect(apiFieldCount).toBe(14);
  });
});
