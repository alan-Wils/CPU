import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LEAFLINK_INVENTORY_COMPACT_COLS as sharedCols,
  LEAFLINK_INVENTORY_COMPACT_FIELD_COUNT as sharedFieldCount,
  LEAFLINK_INVENTORY_COMPACT_VERSION as sharedVersion,
} from "@cpu/shared";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Read API column constants from source without importing apps/api (avoids Prisma in Next typecheck). */
function readApiCompactSchemaFromSource(): {
  version: number;
  fieldCount: number;
  cols: readonly string[];
} {
  const path = join(repoRoot, "apps/api/src/lib/leafLinkInventoryListDto.ts");
  const src = readFileSync(path, "utf8");
  const versionMatch = src.match(
    /export const LEAFLINK_INVENTORY_COMPACT_VERSION\s*=\s*(\d+)/,
  );
  const colsBlock = src.match(
    /export const LEAFLINK_INVENTORY_COMPACT_COLS\s*=\s*\[([\s\S]*?)\]\s*as const/,
  );
  const cols =
    colsBlock?.[1]
      ?.split(",")
      .map((s) => s.replace(/["'\s]/g, ""))
      .filter(Boolean) ?? [];
  return {
    version: Number(versionMatch?.[1] ?? 0),
    fieldCount: cols.length,
    cols,
  };
}

/** Guards API (Railway) and frontend shared schema from drifting apart. */
describe("LeafLink inventory compact schema parity", () => {
  it("API and @cpu/shared use identical v1 column order", () => {
    const api = readApiCompactSchemaFromSource();
    expect(api.version).toBe(sharedVersion);
    expect(api.fieldCount).toBe(sharedFieldCount);
    expect([...api.cols]).toEqual([...sharedCols]);
    expect(api.fieldCount).toBe(14);
  });
});
