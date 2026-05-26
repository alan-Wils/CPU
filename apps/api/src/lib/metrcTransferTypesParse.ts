import { parseMetrcDataRecords } from "./metrcConnectionHelpers.js";

export type ParsedMetrcTransferType = {
  name: string;
  typeCode: string;
  raw: Record<string, unknown>;
};

function readStringField(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const raw = row[key];
    if (raw === undefined || raw === null) continue;
    const s = String(raw).trim();
    if (s) return s;
  }
  return "";
}

export function parseMetrcTransferTypesPayload(bodyJson: unknown): ParsedMetrcTransferType[] {
  const rows = parseMetrcDataRecords(bodyJson);
  const byName = new Map<string, ParsedMetrcTransferType>();

  for (const row of rows) {
    const name = readStringField(row, ["Name", "name", "TransferTypeName", "transferTypeName"]);
    if (!name) continue;
    const typeCode = readStringField(row, [
      "TransactionType",
      "transactionType",
      "Type",
      "type",
      "Id",
      "id",
    ]);
    byName.set(name, {
      name,
      typeCode: typeCode || name,
      raw: row,
    });
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
