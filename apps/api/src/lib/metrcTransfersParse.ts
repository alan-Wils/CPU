import { parseMetrcDataRecords } from "./metrcConnectionHelpers.js";
import type { MetrcTransfersListDirection } from "./metrcTransfersActiveQuery.js";

export type ParsedMetrcTransfer = {
  metrcTransferId: string;
  direction: MetrcTransfersListDirection;
  manifestNumber: string;
  transferType: string;
  status: string;
  transporter: string;
  destinationFacility: string;
  packageLabels: string[];
  plannedRoute: string;
  plannedDate: Date | null;
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

function readTransferId(row: Record<string, unknown>): string {
  const raw = row.Id ?? row.id ?? row.TransferId ?? row.transferId;
  if (raw === undefined || raw === null) return "";
  return String(raw).trim();
}

function readDateField(row: Record<string, unknown>, keys: string[]): Date | null {
  for (const key of keys) {
    const raw = row[key];
    if (raw === undefined || raw === null || raw === "") continue;
    if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
    const parsed = new Date(String(raw).trim());
    if (!Number.isNaN(parsed.getTime()) && parsed.getFullYear() > 1970) return parsed;
  }
  return null;
}

function deriveTransferStatus(row: Record<string, unknown>): string {
  if (row.IsVoided === true || String(row.IsVoided).toLowerCase() === "true") return "voided";
  const packageCount = Number(row.PackageCount ?? row.packageCount ?? 0);
  const received = Number(row.ReceivedPackageCount ?? row.receivedPackageCount ?? 0);
  if (packageCount > 0 && received >= packageCount) return "received";
  if (received > 0) return "partial";
  return "active";
}

function formatTransporter(row: Record<string, unknown>): string {
  const license = readStringField(row, [
    "TransporterFacilityLicenseNumber",
    "transporterFacilityLicenseNumber",
  ]);
  const name = readStringField(row, ["TransporterFacilityName", "transporterFacilityName"]);
  if (license && name) return `${name} (${license})`;
  return license || name;
}

function formatDestination(row: Record<string, unknown>): string {
  const license = readStringField(row, [
    "RecipientFacilityLicenseNumber",
    "recipientFacilityLicenseNumber",
  ]);
  const name = readStringField(row, ["RecipientFacilityName", "recipientFacilityName"]);
  if (license && name) return `${name} (${license})`;
  return license || name;
}

export function parseMetrcTransfersPayload(
  bodyJson: unknown,
  direction: MetrcTransfersListDirection,
): ParsedMetrcTransfer[] {
  const rows = parseMetrcDataRecords(bodyJson);
  const out: ParsedMetrcTransfer[] = [];

  for (const row of rows) {
    const metrcTransferId = readTransferId(row);
    if (!metrcTransferId) continue;

    const manifestNumber = readStringField(row, ["ManifestNumber", "manifestNumber"]);
    const transferType =
      readStringField(row, [
        "ShipmentTypeName",
        "shipmentTypeName",
        "TransferTypeName",
        "transferTypeName",
        "Name",
        "name",
      ]) || "Transfer";

    out.push({
      metrcTransferId,
      direction,
      manifestNumber,
      transferType,
      status: deriveTransferStatus(row),
      transporter: formatTransporter(row),
      destinationFacility: formatDestination(row),
      packageLabels: [],
      plannedRoute: readStringField(row, ["PlannedRoute", "plannedRoute"]),
      plannedDate: readDateField(row, [
        "EstimatedDepartureDateTime",
        "estimatedDepartureDateTime",
        "CreatedDateTime",
        "createdDateTime",
      ]),
      raw: row,
    });
  }

  return out;
}
