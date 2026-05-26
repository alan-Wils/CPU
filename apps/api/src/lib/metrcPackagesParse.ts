import { parseMetrcDataRecords } from "./metrcConnectionHelpers.js";

export type ParsedMetrcPackage = {
  packageLabel: string;
  itemName: string;
  quantity: number;
  unitOfMeasure: string;
  location: string;
  productionBatchNumber: string;
  sourceHarvestNames: string;
  packagedDate: Date | null;
  expirationDate: Date | null;
  strainName: string;
  raw: Record<string, unknown>;
};

function readPackageLabel(row: Record<string, unknown>): string {
  const raw = row.Label ?? row.label ?? row.PackageLabel ?? row.packageLabel;
  if (raw === undefined || raw === null) return "";
  return String(raw).trim();
}

function readNumberField(row: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const raw = row[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const n = typeof raw === "number" ? raw : Number(String(raw).trim());
    if (Number.isFinite(n)) return n;
  }
  return 0;
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

function readNestedItemField(row: Record<string, unknown>, keys: string[]): string {
  const item = row.Item ?? row.item;
  if (!item || typeof item !== "object" || Array.isArray(item)) return "";
  return readStringField(item as Record<string, unknown>, keys);
}

function readDateField(row: Record<string, unknown>, keys: string[]): Date | null {
  for (const key of keys) {
    const raw = row[key];
    if (raw === undefined || raw === null || raw === "") continue;
    if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
    const parsed = new Date(String(raw).trim());
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function readSourceHarvestNames(row: Record<string, unknown>): string {
  const raw =
    row.SourceHarvestNames ??
    row.sourceHarvestNames ??
    row.SourceHarvestName ??
    row.sourceHarvestName;
  if (Array.isArray(raw)) {
    return raw
      .map((v) => String(v ?? "").trim())
      .filter(Boolean)
      .join(", ");
  }
  return String(raw ?? "").trim();
}

function mergeParsedMetrcPackage(
  prev: ParsedMetrcPackage | undefined,
  next: ParsedMetrcPackage,
): ParsedMetrcPackage {
  if (!prev) return next;
  return {
    packageLabel: next.packageLabel,
    itemName: next.itemName || prev.itemName,
    quantity: next.quantity !== 0 ? next.quantity : prev.quantity,
    unitOfMeasure: next.unitOfMeasure || prev.unitOfMeasure,
    location: next.location || prev.location,
    productionBatchNumber: next.productionBatchNumber || prev.productionBatchNumber,
    sourceHarvestNames: next.sourceHarvestNames || prev.sourceHarvestNames,
    packagedDate: next.packagedDate ?? prev.packagedDate,
    expirationDate: next.expirationDate ?? prev.expirationDate,
    strainName: next.strainName || prev.strainName,
    raw: { ...prev.raw, ...next.raw },
  };
}

export function parseMetrcPackagesPayload(body: unknown): ParsedMetrcPackage[] {
  const byLabel = new Map<string, ParsedMetrcPackage>();
  for (const row of parseMetrcDataRecords(body)) {
    const packageLabel = readPackageLabel(row);
    if (!packageLabel) continue;

    const itemName =
      readStringField(row, ["ItemName", "itemName"]) ||
      readNestedItemField(row, ["Name", "name"]);

    const strainName =
      readStringField(row, ["StrainName", "strainName"]) ||
      readNestedItemField(row, ["StrainName", "strainName"]);

    const location =
      readStringField(row, [
        "LocationName",
        "locationName",
        "Location",
        "location",
        "CurrentLocation",
        "currentLocation",
      ]) || readStringField(row, ["LocationTypeName", "locationTypeName"]);

    const parsed: ParsedMetrcPackage = {
      packageLabel,
      itemName,
      quantity: readNumberField(row, ["Quantity", "quantity", "RemainingQuantity", "remainingQuantity"]),
      unitOfMeasure: readStringField(row, [
        "UnitOfMeasureName",
        "unitOfMeasureName",
        "UnitOfMeasure",
        "unitOfMeasure",
      ]),
      location,
      productionBatchNumber: readStringField(row, [
        "ProductionBatchNumber",
        "productionBatchNumber",
        "BatchNumber",
        "batchNumber",
      ]),
      sourceHarvestNames: readSourceHarvestNames(row),
      packagedDate: readDateField(row, ["PackagedDate", "packagedDate", "PackageDate", "packageDate"]),
      expirationDate: readDateField(row, [
        "ExpirationDate",
        "expirationDate",
        "UseByDate",
        "useByDate",
      ]),
      strainName,
      raw: row,
    };

    byLabel.set(packageLabel, mergeParsedMetrcPackage(byLabel.get(packageLabel), parsed));
  }
  return [...byLabel.values()];
}
