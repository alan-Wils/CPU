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

function readTransferId(
  row: Record<string, unknown>,
  direction: MetrcTransfersListDirection,
): string {
  const keys =
    direction === "template"
      ? [
          "Id",
          "id",
          "TemplateId",
          "templateId",
          "OutgoingTransferTemplateId",
          "outgoingTransferTemplateId",
          "TransferId",
          "transferId",
        ]
      : ["Id", "id", "TransferId", "transferId"];
  for (const key of keys) {
    const raw = row[key];
    if (raw === undefined || raw === null) continue;
    const s = String(raw).trim();
    if (s) return s;
  }
  return "";
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

function deriveTransferStatus(
  row: Record<string, unknown>,
  direction: MetrcTransfersListDirection,
): string {
  if (direction === "template") return "template";
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
    "RecipientLicenseNumber",
    "recipientFacilityLicenseNumber",
    "RecipientFacilityLicenseNumber",
  ]);
  const name = readStringField(row, ["RecipientFacilityName", "recipientFacilityName"]);
  if (license && name) return `${name} (${license})`;
  return license || name;
}

function readFirstDestination(row: Record<string, unknown>): Record<string, unknown> | null {
  const destinations = row.Destinations ?? row.destinations;
  if (!Array.isArray(destinations) || !destinations.length) return null;
  const first = destinations[0];
  if (!first || typeof first !== "object") return null;
  return first as Record<string, unknown>;
}

function readTemplatePackageLabels(row: Record<string, unknown>): string[] {
  const dest = readFirstDestination(row);
  if (!dest) return [];
  const packages = dest.Packages ?? dest.packages;
  if (!Array.isArray(packages)) return [];
  const labels: string[] = [];
  for (const pkg of packages) {
    if (!pkg || typeof pkg !== "object") continue;
    const pkgRow = pkg as Record<string, unknown>;
    const label = readStringField(pkgRow, ["PackageLabel", "packageLabel"]);
    if (label) labels.push(label);
  }
  return labels;
}

function parseTemplateTransferRow(row: Record<string, unknown>): ParsedMetrcTransfer | null {
  const metrcTransferId = readTransferId(row, "template");
  if (!metrcTransferId) return null;

  const dest = readFirstDestination(row);
  const manifestNumber =
    readStringField(row, ["ManifestNumber", "manifestNumber"]) ||
    readStringField(row, ["Name", "name"]) ||
    `template-${metrcTransferId}`;

  const transferType =
    (dest
      ? readStringField(dest, ["TransferTypeName", "transferTypeName", "ShipmentTypeName"])
      : "") ||
    readStringField(row, [
      "TransferTypeName",
      "transferTypeName",
      "ShipmentTypeName",
      "shipmentTypeName",
      "Name",
      "name",
    ]) ||
    "Transfer";

  const destinationFacility = dest ? formatDestination(dest) : formatDestination(row);
  const plannedRoute =
    (dest ? readStringField(dest, ["PlannedRoute", "plannedRoute"]) : "") ||
    readStringField(row, ["PlannedRoute", "plannedRoute"]);

  const plannedDate =
    (dest
      ? readDateField(dest, [
          "EstimatedDepartureDateTime",
          "estimatedDepartureDateTime",
          "EstimatedArrivalDateTime",
        ])
      : null) ||
    readDateField(row, [
      "EstimatedDepartureDateTime",
      "estimatedDepartureDateTime",
      "CreatedDateTime",
      "createdDateTime",
      "LastModified",
      "lastModified",
    ]);

  return {
    metrcTransferId,
    direction: "template",
    manifestNumber,
    transferType,
    status: "template",
    transporter: formatTransporter(row),
    destinationFacility,
    packageLabels: readTemplatePackageLabels(row),
    plannedRoute,
    plannedDate,
    raw: row,
  };
}

function parseStandardTransferRow(
  row: Record<string, unknown>,
  direction: MetrcTransfersListDirection,
): ParsedMetrcTransfer | null {
  const metrcTransferId = readTransferId(row, direction);
  if (!metrcTransferId) return null;

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

  return {
    metrcTransferId,
    direction,
    manifestNumber,
    transferType,
    status: deriveTransferStatus(row, direction),
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
  };
}

export function parseMetrcTransfersPayload(
  bodyJson: unknown,
  direction: MetrcTransfersListDirection,
): ParsedMetrcTransfer[] {
  const rows = parseMetrcDataRecords(bodyJson);
  const out: ParsedMetrcTransfer[] = [];

  for (const row of rows) {
    const parsed =
      direction === "template"
        ? parseTemplateTransferRow(row)
        : parseStandardTransferRow(row, direction);
    if (parsed) out.push(parsed);
  }

  return out;
}
