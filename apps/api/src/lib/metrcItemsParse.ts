import { parseMetrcDataRecords } from "./metrcConnectionHelpers.js";

export type ParsedMetrcItem = {
  metrcItemId: string;
  itemName: string;
  categoryName: string;
  unitOfMeasureName: string;
  quantityType: string;
  raw: Record<string, unknown>;
};

function readMetrcItemId(row: Record<string, unknown>): string {
  const raw = row.Id ?? row.id ?? row.ItemId ?? row.itemId;
  if (raw === undefined || raw === null) return "";
  return String(raw).trim();
}

function readStringField(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const raw = row[key];
    if (raw === undefined || raw === null) continue;
    const s = String(raw).trim();
    if (s) return s;
  }
  return "";
}

export function parseMetrcItemsPayload(body: unknown): ParsedMetrcItem[] {
  const byId = new Map<string, ParsedMetrcItem>();
  for (const row of parseMetrcDataRecords(body)) {
    const metrcItemId = readMetrcItemId(row);
    if (!metrcItemId) continue;
    byId.set(metrcItemId, {
      metrcItemId,
      itemName: readStringField(row, ["Name", "name", "ItemName", "itemName"]),
      categoryName: readStringField(row, [
        "ProductCategoryName",
        "productCategoryName",
        "CategoryName",
        "categoryName",
      ]),
      unitOfMeasureName: readStringField(row, [
        "UnitOfMeasureName",
        "unitOfMeasureName",
        "UnitOfMeasure",
        "unitOfMeasure",
      ]),
      quantityType: readStringField(row, ["QuantityType", "quantityType"]),
      raw: row,
    });
  }
  return [...byId.values()];
}
