"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import Nav from "@/components/Nav";
import PageAccessGate from "@/components/PageAccessGate";
import {
  API_BASE_URL,
  appendCompanyIdQuery,
  getSelectedCompanyId,
} from "@/lib/api";
import { getAuthToken, getAuthUser } from "@/lib/auth";
import { recordSandboxCreateEvaluation } from "@/lib/metrcEvaluation";
import { formatCompanyTimestamp } from "@/lib/companyTimezone";
import type { MetrcLastConnectionStatus } from "@/lib/metrcCompanyConfig";
import { formatMetrcFacilityTypeLabel } from "@/lib/metrcDisplayLabel";

type IntegrationsMeta = {
  metrcIntegrationEnabled?: boolean;
  metrcStateCode?: string;
  metrcEnvironment?: string;
  metrcLicenseNumberDisplay?: string;
  metrcFacilityName?: string;
  metrcUsernameDisplay?: string;
  hasMetrcVendorApiKey?: boolean;
  hasMetrcUserApiKey?: boolean;
  metrcUserKeyLength?: number | null;
  metrcVendorKeyLength?: number | null;
  metrcSandboxCredentialsReady?: boolean;
  metrcSandboxProvisioning?: boolean;
  metrcSandboxReady?: boolean;
  metrcSandboxProvisioningStartedAt?: string | null;
  metrcLastConnectionStatus?: MetrcLastConnectionStatus | "";
  metrcLastConnectionCheckedAt?: string | null;
  metrcSandboxLastFacilitiesSyncAt?: string | null;
  metrcSandboxLastFacilitiesCount?: number | null;
  totalFacilitiesSynced?: number | null;
  metrcSandboxLastRoomsSyncAt?: string | null;
  metrcLastLocationsSyncAt?: string | null;
  lastLocationsSync?: string | null;
  metrcTotalLocationsSynced?: number | null;
  totalLocationsSynced?: number | null;
  metrcSandboxLastStrainsSyncAt?: string | null;
  metrcLastStrainsSyncAt?: string | null;
  lastStrainsSync?: string | null;
  metrcSandboxLastPackagesSyncAt?: string | null;
  metrcLastPackagesSyncAt?: string | null;
  lastPackagesSync?: string | null;
  metrcSandboxLastRoomsCount?: number | null;
  metrcSandboxLastStrainsCount?: number | null;
  totalStrainsSynced?: number | null;
  metrcSandboxLastPackagesCount?: number | null;
  totalPackagesSynced?: number | null;
  metrcSandboxLastPlantBatchesSyncAt?: string | null;
  metrcLastPlantBatchesSyncAt?: string | null;
  lastPlantBatchesSync?: string | null;
  metrcSandboxLastPlantBatchesCount?: number | null;
  totalPlantBatchesSynced?: number | null;
  metrcSandboxLastHarvestsSyncAt?: string | null;
  metrcLastHarvestsSyncAt?: string | null;
  lastHarvestsSync?: string | null;
  metrcSandboxLastHarvestsCount?: number | null;
  totalHarvestsSynced?: number | null;
  metrcSandboxLastTransfersSyncAt?: string | null;
  metrcLastTransfersSyncAt?: string | null;
  lastTransfersSync?: string | null;
  metrcSandboxLastTransfersCount?: number | null;
  totalTransfersSynced?: number | null;
  metrcSandboxLastRateLimitWarning?: string | null;
  metrcSandboxUiStatus?: string | null;
  metrcOperationalAccessGranted?: boolean;
  metrcLastAuthAttemptMode?: string | null;
  metrcLastMetrcResponseMessage?: string | null;
  metrcMessage?: string | null;
  metrcLastConnectionHttpStatus?: number | null;
  metrcHttpStatus?: number | null;
  metrcLastConnectionMessage?: string | null;
  metrcLastSuccessfulAuthMode?: string | null;
};

type MetrcUpstreamErrorPayload = {
  upstream?: string;
  type?: string;
  endpoint?: string;
  status?: number;
};

type PullResult = {
  ok: boolean;
  resource?: string;
  status?: number;
  count?: number;
  syncedAt?: string;
  sample?: { id?: unknown; name?: unknown; label?: unknown }[];
  message?: string;
  rateLimitWarning?: string | null;
  error?: MetrcUpstreamErrorPayload;
  endpoint?: string;
  endpointNotAvailable?: boolean;
  credentialHint?: string;
};

type MetrcFacilityRow = {
  licenseNumber: string;
  facilityName: string;
  facilityType: string;
  facilityTypeName?: string;
  stateCode: string;
  active: boolean;
};

type FacilitiesSyncResult = {
  ok: boolean;
  status?: number;
  count?: number;
  syncedAt?: string;
  facilities?: MetrcFacilityRow[];
  message?: string;
  rateLimitWarning?: string | null;
  credentialHint?: string;
  endpoint?: string;
};

type NexbatchRoomSuite = "vegRooms" | "flowerRooms" | "dryRooms" | "freezers";

type NexbatchRoomOption = {
  suite: NexbatchRoomSuite;
  roomId: string;
  name: string;
};

type LocationCapabilityFilter = "all" | "plants" | "harvest" | "packages";

type MetrcLocationRow = {
  metrcLocationId: string;
  name: string;
  locationTypeId: number | null;
  locationTypeName: string;
  forPlants: boolean;
  forHarvests: boolean;
  forPackages: boolean;
  licenseNumber: string;
  nexbatchRoomSuite: NexbatchRoomSuite | null;
  nexbatchRoomId: string | null;
  nexbatchRoomLabel: string | null;
  mappingSource?: "manual" | "auto" | "none";
  nexbatchMappingManual?: boolean;
};

type LocationsSyncResult = {
  ok: boolean;
  status?: number;
  count?: number;
  totalLocationsSynced?: number;
  lastLocationsSync?: string;
  syncedAt?: string;
  locations?: MetrcLocationRow[];
  nexbatchRooms?: NexbatchRoomOption[];
  autoMappedCount?: number;
  message?: string;
  rateLimitWarning?: string | null;
  credentialHint?: string;
  endpoint?: string;
};

type MetrcStrainRow = {
  metrcStrainId: string;
  name: string;
  testingStatus: string;
  active: boolean;
  archived: boolean;
  lastModified: string | null;
  licenseNumber: string;
  nexbatchStrainId: string | null;
  nexbatchStrainLabel: string | null;
};

type StrainsSyncResult = {
  ok: boolean;
  status?: number;
  count?: number;
  totalStrainsSynced?: number;
  lastStrainsSync?: string;
  syncedAt?: string;
  nexbatchStrainsCreated?: number;
  strains?: MetrcStrainRow[];
  message?: string;
  rateLimitWarning?: string | null;
  credentialHint?: string;
  endpoint?: string;
};

const DEFAULT_TEST_STRAIN_NAME = "NexBatch Test Strain";
const DEFAULT_TEST_ITEM_NAME = "NexBatch Test Item";
const DEFAULT_TEST_ITEM_CATEGORY = "Buds";
const DEFAULT_TEST_ITEM_UOM = "Grams";
const PACKAGE_ITEM_REQUIRED_MSG = "Sync or create an item before creating a package.";
const DEFAULT_TEST_HARVEST_NAME = "NexBatch Test Harvest";
const DEFAULT_PLANT_GROWTH_LOCATION_NAME = "SBX Default Location Type Location 1";
const DEFAULT_SANDBOX_PACKAGE_ITEM_NAME = "SBX Bud allocated for extraction SBX Strain 1 Item";
const DEFAULT_SANDBOX_PLANT_BATCH_PACKAGE_ITEM_NAME =
  "SBX Immature Plants SBX Strain 2 Item";
const DEFAULT_PLANT_BATCH_PACKAGE_NOTE =
  "NexBatch sandbox evaluation - plant batch package.";
const METRC_PLANT_BATCH_GROWTH_PHASE_OPTIONS = ["Vegetative", "Flowering"] as const;
const METRC_PLANT_BATCH_WASTE_METHOD_OPTIONS = [
  "Compost",
  "Mulch",
  "Self-Haul",
  "Waste Disposal Transfer",
  "Grinding with Compostable Material",
  "Grinding with Non-Compostable Material",
  "Other",
] as const;
const METRC_PLANT_BATCH_WASTE_UOM_OPTIONS = [
  "Grams",
  "Kilograms",
  "Ounces",
  "Pounds",
] as const;
const DEFAULT_DESTROY_PLANT_BATCH_REASON_NOTE =
  "NexBatch sandbox evaluation destroy test";
const DEFAULT_LAB_RESULT_NOTES = "NexBatch sandbox evaluation";
const METRC_LAB_TEST_LICENSE = "SF-SBX-CO-7-13402";
const METRC_HARVEST_TYPE_OPTIONS = ["Product", "WholePlant"] as const;
const DEFAULT_STRAIN_INDICA_PCT = "50";
const DEFAULT_STRAIN_SATIVA_PCT = "50";

const METRC_STRAIN_TESTING_STATUSES = ["None", "InHouse", "ThirdParty"] as const;

function resolveDefaultSandboxPackageItemId(items: MetrcItemRow[]): string | null {
  if (!items.length) return null;
  const preferred = DEFAULT_SANDBOX_PACKAGE_ITEM_NAME.trim().toLowerCase();
  const exact = items.find((i) => i.itemName.trim().toLowerCase() === preferred);
  if (exact) return exact.metrcItemId;
  const partial = items.find((i) =>
    i.itemName.trim().toLowerCase().includes("sbx bud allocated"),
  );
  if (partial) return partial.metrcItemId;
  return items[0]!.metrcItemId;
}

function resolveDefaultSandboxPlantBatchPackageItemId(items: MetrcItemRow[]): string | null {
  if (!items.length) return null;
  const preferred = DEFAULT_SANDBOX_PLANT_BATCH_PACKAGE_ITEM_NAME.trim().toLowerCase();
  const exact = items.find((i) => i.itemName.trim().toLowerCase() === preferred);
  if (exact) return exact.metrcItemId;
  const partial = items.find((i) =>
    i.itemName.trim().toLowerCase().includes("sbx immature plants"),
  );
  if (partial) return partial.metrcItemId;
  return items[0]!.metrcItemId;
}

function parseStrainPercentagePair(indicaRaw: string, sativaRaw: string): {
  valid: boolean;
  indica: number;
  sativa: number;
  total: number | null;
} {
  const indica = Number.parseFloat(indicaRaw);
  const sativa = Number.parseFloat(sativaRaw);
  if (!Number.isFinite(indica) || !Number.isFinite(sativa)) {
    return { valid: false, indica: 0, sativa: 0, total: null };
  }
  const total = indica + sativa;
  const valid =
    indica >= 0 && sativa >= 0 && indica <= 100 && sativa <= 100 && Math.round(total) === 100;
  return { valid, indica, sativa, total };
}

type CreateTestStrainResult = {
  ok: boolean;
  status?: number;
  message?: string;
  alreadyExists?: boolean;
  credentialHint?: string;
  endpoint?: string;
  requestPayload?: unknown;
  responsePayload?: unknown;
  durationMs?: number;
  metrcStrainId?: string;
  strain?: MetrcStrainRow;
  metrcMessage?: string;
};

type MetrcPackageRow = {
  packageLabel: string;
  itemName: string;
  quantity: number;
  unitOfMeasure: string;
  location: string;
  strainName: string;
  lastSyncedAt: string;
};

type PackagesSyncResult = {
  ok: boolean;
  status?: number;
  count?: number;
  totalPackagesSynced?: number;
  lastPackagesSync?: string;
  syncedAt?: string;
  packages?: MetrcPackageRow[];
  message?: string;
  rateLimitWarning?: string | null;
  credentialHint?: string;
  endpoint?: string;
};

type MetrcPlantBatchRow = {
  metrcPlantBatchId: string;
  name: string;
  strainName: string;
  metrcStrainId: string | null;
  count: number;
  metrcLocationId: string;
  locationName: string;
  plantedDate: string | null;
  lastModified: string | null;
  active: boolean;
  createdViaTest: boolean;
  lastSyncedAt: string;
};

type PlantBatchesSyncResult = {
  ok: boolean;
  status?: number;
  count?: number;
  totalPlantBatchesSynced?: number;
  lastPlantBatchesSync?: string;
  syncedAt?: string;
  plantBatches?: MetrcPlantBatchRow[];
  message?: string;
  rateLimitWarning?: string | null;
  credentialHint?: string;
  endpoint?: string;
  pagesFetched?: number;
};

type CreateTestPlantBatchResult = {
  ok: boolean;
  status?: number;
  message?: string;
  credentialHint?: string;
  endpoint?: string;
  requestPayload?: unknown;
  responsePayload?: unknown;
  durationMs?: number;
  metrcPlantBatchId?: string | null;
  plantBatch?: {
    metrcPlantBatchId: string;
    metrcPlantBatchName: string;
    metrcLocationId: string;
    metrcStrainName: string;
    count: number;
    syncedAt: string;
  };
  metrcMessage?: string;
};

type MotherPlantPackageDebug = {
  sourcePlantLabel: string;
  sourcePlantGrowthPhase: string;
  sourceFacilityLicense: string;
  packageTag: string;
  tagSourceFacilityLicense: string;
  item: string;
  itemFacilityLicense: string | null;
  location: string | null;
  locationFacilityLicense: string | null;
  finalLicenseNumber: string;
  license: string;
};

type MotherPlantPackageAuthEvidence = {
  endpoint: string;
  finalLicenseNumber: string;
  authMode: string;
  exactPayload: unknown;
  tagSourceFacilityLicense: string;
  sourcePlantLabel: string;
  sourceFacilityLicense: string;
  item: string;
  itemFacilityLicense: string | null;
  location: string | null;
  locationFacilityLicense: string | null;
  sameAuthUsedByEndpoints: string[];
};

type MotherPlantPackageRequestDebug = MotherPlantPackageDebug & {
  authMode: string;
  baseUrl: string;
  endpoint: string;
  payloadBody: unknown;
};

type MotherPlantPackageResult = {
  ok: boolean;
  status?: number;
  message?: string;
  credentialHint?: string;
  endpoint?: string;
  requestPayload?: unknown;
  requestDebug?: MotherPlantPackageRequestDebug;
  debug?: MotherPlantPackageDebug;
  authEvidence?: MotherPlantPackageAuthEvidence;
  responsePayload?: unknown;
  durationMs?: number;
  packageTag?: string;
  sourcePlantLabel?: string;
  metrcMessage?: string;
};

type LabTestTypesResult = {
  ok: boolean;
  status?: number;
  message?: string;
  labTestTypes?: string[];
  parsedCount?: number;
  licenseNumber?: string;
  endpoint?: string;
};

type LabResultBuilderRow = {
  id: string;
  labTestTypeName: string;
  quantity: string;
  passed: boolean;
  notes: string;
};

type LabTestRecordResult = {
  ok: boolean;
  status?: number;
  message?: string;
  credentialHint?: string;
  endpoint?: string;
  requestPayload?: unknown;
  requestDebug?: {
    licenseNumber: string;
    authMode: string;
    baseUrl: string;
    endpoint: string;
    payloadBody: unknown;
  };
  authEvidence?: {
    endpoint: string;
    finalLicenseNumber: string;
    authMode: string;
    baseUrl: string;
    exactPayload: unknown;
    selectedPackageLabel: string;
    packageFacilityLicense: string | null;
    labTestTypesSourceLicense: string;
    sameAuthUsedByEndpoints: string[];
  };
  responsePayload?: unknown;
  durationMs?: number;
  metrcMessage?: string;
};

function isMotherSourcePlant(plant: MetrcPlantRow): boolean {
  if (!plant.active) return false;
  const phase = plant.growthPhase.trim().toLowerCase();
  if (!phase || phase.includes("immatur") || phase.includes("clone")) return false;
  return (
    phase.includes("veg") ||
    phase.includes("flower") ||
    phase === "mother" ||
    phase === "motherplant"
  );
}

type MetrcHarvestRow = {
  metrcHarvestId: string;
  harvestName: string;
  sourcePlantBatchId: string;
  sourcePlantBatchName: string;
  strainName: string;
  metrcLocationId: string;
  locationName: string;
  harvestType: string;
  wetWeight: number;
  totalWeight: number;
  unitOfWeight: string;
  plantedDate: string | null;
  finishedDate: string | null;
  active: boolean;
  createdViaTest: boolean;
  lastSyncedAt: string;
};

type HarvestsSyncResult = {
  ok: boolean;
  status?: number;
  count?: number;
  totalHarvestsSynced?: number;
  lastHarvestsSync?: string;
  syncedAt?: string;
  harvests?: MetrcHarvestRow[];
  message?: string;
  rateLimitWarning?: string | null;
  credentialHint?: string;
  endpoint?: string;
  pagesFetched?: number;
};

type MetrcPlantRow = {
  metrcPlantId: string;
  label: string;
  sourcePlantBatchId: string;
  sourcePlantBatchName: string;
  strainName: string;
  growthPhase: string;
  locationName: string;
  licenseNumber?: string;
  active: boolean;
};

type CreateTestHarvestResult = {
  ok: boolean;
  status?: number;
  message?: string;
  alreadyExists?: boolean;
  credentialHint?: string;
  endpoint?: string;
  requestPayload?: unknown;
  responsePayload?: unknown;
  durationMs?: number;
  metrcHarvestId?: string;
  harvest?: MetrcHarvestRow;
  metrcMessage?: string;
  plantLabelsUsed?: string[];
  promotedBatch?: boolean;
};

type MetrcItemRow = {
  metrcItemId: string;
  itemName: string;
  categoryName: string;
  unitOfMeasureName: string;
  quantityType: string;
  licenseNumber: string;
  lastSyncedAt: string;
};

type ItemsSyncDiagnostics = {
  licenseNumber: string;
  endpoint: string;
  resolvedUrl: string;
  params: {
    licenseNumber: string;
    lastModifiedStart: string;
    lastModifiedEnd: string;
    pageNumber: number;
    pageSize: number;
  };
  httpStatus: number;
  totalReturned: number;
  firstRawItem: Record<string, unknown> | null;
  facilitySource?: string;
  pagesFetched?: number;
  triedLicenses?: string[];
};

type ItemsSyncResult = {
  ok: boolean;
  status?: number;
  count?: number;
  totalItemsSynced?: number;
  lastItemsSync?: string;
  syncedAt?: string;
  items?: MetrcItemRow[];
  message?: string;
  rateLimitWarning?: string | null;
  credentialHint?: string;
  endpoint?: string;
  diagnostics?: ItemsSyncDiagnostics;
  noItemsForFacility?: boolean;
};

type CreateTestItemResult = {
  ok: boolean;
  status?: number;
  message?: string;
  alreadyExists?: boolean;
  credentialHint?: string;
  endpoint?: string;
  requestPayload?: unknown;
  responsePayload?: unknown;
  durationMs?: number;
  metrcItemId?: string;
  item?: MetrcItemRow;
  metrcMessage?: string;
};

type CreateTestPackageResult = {
  ok: boolean;
  status?: number;
  message?: string;
  alreadyExists?: boolean;
  credentialHint?: string;
  endpoint?: string;
  requestPayload?: unknown;
  responsePayload?: unknown;
  durationMs?: number;
  packageLabel?: string;
  packagesSynced?: number;
  metrcMessage?: string;
};

type MetrcTransferRow = {
  metrcTransferId: string;
  direction: string;
  manifestNumber: string;
  transferType: string;
  status: string;
  licenseNumber: string;
  transporter: string;
  destinationFacility: string;
  packageLabels: string[];
  plannedRoute: string;
  plannedDate: string | null;
  createdViaTest: boolean;
  lastSyncedAt: string;
};

type TransfersSyncDiagnostics = {
  licenseNumber: string;
  endpoints: Array<{
    direction: string;
    url: string;
    params: Record<string, unknown>;
    httpStatus: number | null;
    totalReturned: number;
    firstRawItem: Record<string, unknown> | null;
  }>;
};

type TransfersSyncResult = {
  ok: boolean;
  status?: number;
  count?: number;
  totalTransfersSynced?: number;
  lastTransfersSync?: string;
  syncedAt?: string;
  transfers?: MetrcTransferRow[];
  message?: string;
  rateLimitWarning?: string | null;
  credentialHint?: string;
  endpoint?: string;
  diagnostics?: TransfersSyncDiagnostics;
};

type CreateTestTransferResult = {
  ok: boolean;
  status?: number;
  message?: string;
  credentialHint?: string;
  endpoint?: string;
  requestPayload?: unknown;
  responsePayload?: unknown;
  durationMs?: number;
  metrcTransferId?: string | null;
  transfersSynced?: number;
  metrcMessage?: string;
  validationErrors?: string[];
  payloadDiagnostics?: {
    endpoint: string;
    apiVersion: string;
    topLevelTransferTypeName: string;
    destinationRecipientLicense: string;
    packageLabels: string[];
  };
};

const DEFAULT_TRANSFER_PLANNED_ROUTE =
  "NexBatch sandbox evaluation — direct facility transfer.";
const TRANSFER_PACKAGE_REQUIRED_MSG =
  "Sync or create a package before creating a transfer.";

type MetrcTransferTypeRow = {
  name: string;
  typeCode: string;
  licenseNumber: string;
  source: string;
  lastSyncedAt: string;
  raw: Record<string, unknown>;
};

type TransferTypesSyncDiagnostics = {
  licenseNumber: string;
  endpoint: string | null;
  httpStatus: number | null;
  transferTypeOptionsCount: number;
  selectedTransferTypeName: string | null;
  firstRawTransferType: Record<string, unknown> | null;
  usedFallback: boolean;
  fallbackNames: string[];
};

type TransferTypesSyncResult = {
  ok: boolean;
  status?: number;
  count?: number;
  transferTypes?: MetrcTransferTypeRow[];
  usedFallback?: boolean;
  diagnostics?: TransferTypesSyncDiagnostics;
  message?: string;
  credentialHint?: string;
  endpoint?: string | null;
};

const TRANSFER_TYPE_REQUIRED_MSG = "Select a METRC transfer type.";
const TRANSFER_TYPES_EMPTY_MSG =
  "No synced transfer types yet. Click Sync Transfer Types.";

type PackageReconciliationSummary = {
  metrcCount: number;
  nexbatchCount: number;
  matched: number;
  metrcOnly: number;
  nexbatchOnly: number;
  quantityMismatch: number;
};

function nexbatchRoomTypeLabel(suite: NexbatchRoomSuite): string {
  switch (suite) {
    case "vegRooms":
      return "Veg";
    case "flowerRooms":
      return "Flower";
    case "dryRooms":
      return "Dry";
    case "freezers":
      return "Freezer";
    default:
      return suite;
  }
}

function formatNexbatchRoomOptionLabel(option: NexbatchRoomOption): string {
  return `${option.name} (${nexbatchRoomTypeLabel(option.suite)})`;
}

function mappingSelectValue(row: MetrcLocationRow): string {
  if (!row.nexbatchRoomSuite || !row.nexbatchRoomId) return "";
  return `${row.nexbatchRoomSuite}:${row.nexbatchRoomId}`;
}

function parseMappingSelectValue(value: string): {
  suite: NexbatchRoomSuite | null;
  roomId: string | null;
} {
  if (!value) return { suite: null, roomId: null };
  const colon = value.indexOf(":");
  if (colon < 0) return { suite: null, roomId: null };
  const suite = value.slice(0, colon) as NexbatchRoomSuite;
  const roomId = value.slice(colon + 1).trim();
  if (
    suite !== "vegRooms" &&
    suite !== "flowerRooms" &&
    suite !== "dryRooms" &&
    suite !== "freezers"
  ) {
    return { suite: null, roomId: null };
  }
  return { suite, roomId: roomId || null };
}

function CapabilityBadge({ active, label }: { active: boolean; label: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        marginRight: 4,
        marginBottom: 2,
        padding: "2px 6px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        border: `1px solid ${active ? "rgba(34, 197, 94, 0.5)" : "rgba(100, 116, 139, 0.5)"}`,
        background: active ? "rgba(6, 78, 59, 0.45)" : "rgba(30, 41, 59, 0.6)",
        color: active ? "#bbf7d0" : "#94a3b8",
      }}
    >
      {label}
    </span>
  );
}

function formatMetrcPullError(json: PullResult, resource: string): string {
  if (json.credentialHint && (json.status === 401 || json.status === 403)) {
    return json.credentialHint;
  }
  if (json.endpointNotAvailable || json.status === 404) {
    return "METRC endpoint not available for this resource (HTTP 404).";
  }
  if (json.error?.type === "html_runtime_error") {
    return "METRC sandbox returned a server/runtime error for this endpoint.";
  }
  const msg = String(json.message || "").trim();
  if (/<html|<!doctype/i.test(msg)) {
    return "METRC sandbox returned a server/runtime error for this endpoint.";
  }
  return msg || `Failed to pull ${resource}.`;
}

type MetrcDiagnostics = {
  sandboxStatus: string;
  sandboxStatusLabel: string;
  lastAttemptedAuthMode: string | null;
  metrcResponseCode: number;
  metrcResponseMessage: string;
  provisioningComplete: boolean;
  userCreationPending: boolean;
  operationalAccessGranted: boolean;
  environment: string;
};

function resolveMetrcHttpStatus(
  meta: IntegrationsMeta | null,
  diagnostics: MetrcDiagnostics | null,
): number | string {
  const persisted = meta?.metrcLastConnectionHttpStatus ?? meta?.metrcHttpStatus;
  if (typeof persisted === "number") return persisted;
  return diagnostics?.metrcResponseCode ?? "—";
}

function resolveMetrcDisplayMessage(
  meta: IntegrationsMeta | null,
  diagnostics: MetrcDiagnostics | null,
): string {
  const http =
    meta?.metrcLastConnectionHttpStatus ?? meta?.metrcHttpStatus ?? diagnostics?.metrcResponseCode;
  if (http === 200) {
    return (
      meta?.metrcLastMetrcResponseMessage ||
      meta?.metrcMessage ||
      diagnostics?.metrcResponseMessage ||
      "Connection successful."
    );
  }
  if (typeof http === "number" && http !== 200) {
    return (
      meta?.metrcLastMetrcResponseMessage ||
      meta?.metrcMessage ||
      diagnostics?.metrcResponseMessage ||
      "—"
    );
  }
  return (
    meta?.metrcLastMetrcResponseMessage ||
    meta?.metrcMessage ||
    diagnostics?.metrcResponseMessage ||
    "—"
  );
}

type TestConnectionJson =
  | {
      ok: true;
      connected: true;
      checkedAt: string;
      locationCount: number;
      authMode?: string;
      diagnostics: MetrcDiagnostics;
    }
  | {
      ok: false;
      connected: false;
      checkedAt: string;
      message: string;
      status: number;
      diagnostics: MetrcDiagnostics;
      attemptedModes?: string[];
    };

type SandboxSetupDebug = {
  topLevelKeys: string[];
  fieldsFound: string[];
  parserPaths: {
    userApiKey?: string | null;
    facilityLicenseNumber?: string | null;
    username?: string | null;
    facilityName?: string | null;
  };
  structureOutline: unknown;
};

type SandboxSetupJson =
  | {
      ok: true;
      status?: "ready" | "provisioning";
      message?: string;
      provisioningStartedAt?: string;
      facilityName?: string;
      facilityLicenseNumber?: string;
      username?: string;
      credentialsReady?: boolean;
      debug?: SandboxSetupDebug;
    }
  | { ok: false; status?: string; message?: string; debug?: SandboxSetupDebug };

type SandboxStatusJson = {
  ok: true;
  status: "idle" | "provisioning" | "ready" | "timeout" | "error";
  sandboxUiStatus: string;
  sandboxUiStatusLabel: string;
  sandboxProvisioning: boolean;
  sandboxReady: boolean;
  message: string;
  credentialsReady: boolean;
  provisioningComplete: boolean;
  userCreationPending: boolean;
  operationalAccessGranted: boolean;
  remainingMs: number | null;
  lastConnectionHttpStatus: number | null;
  lastMetrcResponseMessage: string;
  lastAuthAttemptMode: string | null;
};

const POLL_INTERVAL_MS = 10_000;
const POLL_MAX_MS = 5 * 60 * 1000;

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#020617", color: "#e5e7eb", padding: 24 },
  header: {
    maxWidth: 960,
    margin: "24px auto",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 16,
    flexWrap: "wrap",
  },
  title: { fontSize: 28, fontWeight: 900, margin: 0 },
  subtitle: { color: "#94a3b8", marginTop: 8, lineHeight: 1.5 },
  card: {
    maxWidth: 960,
    margin: "16px auto",
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: 16,
    padding: 20,
  },
  row: { display: "flex", flexWrap: "wrap", gap: 10, marginTop: 14 },
  btn: {
    border: "1px solid rgba(56, 189, 248, 0.45)",
    background: "rgba(8, 47, 73, 0.55)",
    color: "#bae6fd",
    borderRadius: 10,
    padding: "10px 14px",
    fontWeight: 700,
    cursor: "pointer",
  },
  btnPrimary: {
    border: "1px solid rgba(34, 197, 94, 0.5)",
    background: "rgba(6, 78, 59, 0.45)",
    color: "#bbf7d0",
  },
  metaGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    gap: 12,
    marginTop: 12,
  },
  metaItem: {
    background: "rgba(2, 6, 23, 0.65)",
    border: "1px solid #334155",
    borderRadius: 10,
    padding: 12,
  },
  metaLabel: { fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em" },
  metaValue: { marginTop: 4, fontWeight: 700, color: "#e2e8f0" },
  warn: {
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    border: "1px solid rgba(251, 191, 36, 0.45)",
    background: "rgba(69, 26, 3, 0.35)",
    color: "#fde68a",
    fontSize: 13,
  },
  error: {
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    border: "1px solid rgba(248, 113, 113, 0.45)",
    background: "rgba(69, 10, 10, 0.35)",
    color: "#fecaca",
    fontSize: 13,
  },
  ok: {
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    border: "1px solid rgba(34, 197, 94, 0.4)",
    background: "rgba(6, 78, 59, 0.3)",
    color: "#bbf7d0",
    fontSize: 13,
  },
  sampleTable: { width: "100%", marginTop: 10, borderCollapse: "collapse", fontSize: 13 },
};

function sandboxEvaluationUser(): string {
  const user = getAuthUser();
  return user?.email || user?.username || user?.id || "Unknown user";
}

async function authFetch(path: string, init?: RequestInit) {
  const token = getAuthToken();
  const companyId = getSelectedCompanyId();
  const url = `${API_BASE_URL}${appendCompanyIdQuery(path, companyId)}`;
  return fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
  });
}

export default function MetrcSandboxPage() {
  const [meta, setMeta] = useState<IntegrationsMeta | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ tone: "ok" | "error" | "warn"; text: string } | null>(null);
  const [lastPull, setLastPull] = useState<PullResult | null>(null);
  const [lastFacilities, setLastFacilities] = useState<FacilitiesSyncResult | null>(null);
  const [lastLocationsSync, setLastLocationsSync] = useState<LocationsSyncResult | null>(null);
  const [locationsRows, setLocationsRows] = useState<MetrcLocationRow[] | null>(null);
  const [locationsLoaded, setLocationsLoaded] = useState(false);
  const [lastStrainsSync, setLastStrainsSync] = useState<StrainsSyncResult | null>(null);
  const [strainsRows, setStrainsRows] = useState<MetrcStrainRow[] | null>(null);
  const [strainsLoaded, setStrainsLoaded] = useState(false);
  const [createStrainName, setCreateStrainName] = useState(DEFAULT_TEST_STRAIN_NAME);
  const [createStrainTestingStatus, setCreateStrainTestingStatus] = useState<string>("None");
  const [createStrainIndicaPct, setCreateStrainIndicaPct] = useState(DEFAULT_STRAIN_INDICA_PCT);
  const [createStrainSativaPct, setCreateStrainSativaPct] = useState(DEFAULT_STRAIN_SATIVA_PCT);
  const [createStrainConfirmOpen, setCreateStrainConfirmOpen] = useState(false);
  const [lastCreateStrain, setLastCreateStrain] = useState<CreateTestStrainResult | null>(null);
  const [lastPackagesSync, setLastPackagesSync] = useState<PackagesSyncResult | null>(null);
  const [packagesRows, setPackagesRows] = useState<MetrcPackageRow[] | null>(null);
  const [packagesLoaded, setPackagesLoaded] = useState(false);
  const [packageReconciliation, setPackageReconciliation] =
    useState<PackageReconciliationSummary | null>(null);
  const [lastPlantBatchesSync, setLastPlantBatchesSync] = useState<PlantBatchesSyncResult | null>(null);
  const [plantBatchesRows, setPlantBatchesRows] = useState<MetrcPlantBatchRow[] | null>(null);
  const [plantBatchesLoaded, setPlantBatchesLoaded] = useState(false);
  const [createBatchName, setCreateBatchName] = useState("");
  const [createBatchStrain, setCreateBatchStrain] = useState(DEFAULT_TEST_STRAIN_NAME);
  const [createBatchCount, setCreateBatchCount] = useState("25");
  const [createBatchPlantingDate, setCreateBatchPlantingDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [createBatchRoomValue, setCreateBatchRoomValue] = useState("");
  const [createBatchConfirmOpen, setCreateBatchConfirmOpen] = useState(false);
  const [lastCreatePlantBatch, setLastCreatePlantBatch] = useState<CreateTestPlantBatchResult | null>(
    null,
  );
  const [motherSourcePlantsRows, setMotherSourcePlantsRows] = useState<MetrcPlantRow[] | null>(
    null,
  );
  const [motherSourcePlantsLoaded, setMotherSourcePlantsLoaded] = useState(false);
  const [motherPackageSourcePlantLabel, setMotherPackageSourcePlantLabel] = useState("");
  const [motherPackageTag, setMotherPackageTag] = useState("");
  const [motherPackageTagSourceLicense, setMotherPackageTagSourceLicense] = useState("");
  const [motherPackageTagsHint, setMotherPackageTagsHint] = useState<string | null>(null);
  const [motherPackageCount, setMotherPackageCount] = useState("3");
  const [motherPackageDate, setMotherPackageDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [motherPackageLocationId, setMotherPackageLocationId] = useState("");
  const [motherPackageItemId, setMotherPackageItemId] = useState("");
  const [lastMotherPlantPackage, setLastMotherPlantPackage] =
    useState<MotherPlantPackageResult | null>(null);
  const [plantBatchPackagePlantBatchId, setPlantBatchPackagePlantBatchId] = useState("");
  const [plantBatchPackageTag, setPlantBatchPackageTag] = useState("");
  const [plantBatchPackageCount, setPlantBatchPackageCount] = useState("3");
  const [plantBatchPackageDate, setPlantBatchPackageDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [plantBatchPackageLocationId, setPlantBatchPackageLocationId] = useState("");
  const [plantBatchPackageItemId, setPlantBatchPackageItemId] = useState("");
  const [plantBatchPackageNote, setPlantBatchPackageNote] = useState(
    DEFAULT_PLANT_BATCH_PACKAGE_NOTE,
  );
  const [lastPlantBatchPackage, setLastPlantBatchPackage] =
    useState<MotherPlantPackageResult | null>(null);
  const [growthPhasePlantBatchId, setGrowthPhasePlantBatchId] = useState("");
  const [growthPhaseSelection, setGrowthPhaseSelection] = useState<string>("Flowering");
  const [growthPhaseCount, setGrowthPhaseCount] = useState("2");
  const [growthPhaseDate, setGrowthPhaseDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [growthPhaseLocationId, setGrowthPhaseLocationId] = useState("");
  const [growthPhaseStartingTag, setGrowthPhaseStartingTag] = useState("");
  const [growthPhaseAvailableTags, setGrowthPhaseAvailableTags] = useState<string[]>([]);
  const [growthPhasePlantTagsHint, setGrowthPhasePlantTagsHint] = useState<string | null>(null);
  const [lastGrowthPhaseChange, setLastGrowthPhaseChange] =
    useState<MotherPlantPackageResult | null>(null);
  const [destroyPlantBatchId, setDestroyPlantBatchId] = useState("");
  const [destroyPlantBatchCount, setDestroyPlantBatchCount] = useState("1");
  const [destroyPlantBatchDate, setDestroyPlantBatchDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [destroyPlantBatchWasteReason, setDestroyPlantBatchWasteReason] = useState("");
  const [destroyPlantBatchWasteReasons, setDestroyPlantBatchWasteReasons] = useState<string[]>([]);
  const [destroyPlantBatchWasteReasonsHint, setDestroyPlantBatchWasteReasonsHint] = useState<
    string | null
  >(null);
  const [destroyPlantBatchWasteMethod, setDestroyPlantBatchWasteMethod] = useState("");
  const [destroyPlantBatchWasteWeight, setDestroyPlantBatchWasteWeight] = useState("");
  const [destroyPlantBatchWasteUom, setDestroyPlantBatchWasteUom] = useState("");
  const [destroyPlantBatchReasonNote, setDestroyPlantBatchReasonNote] = useState(
    DEFAULT_DESTROY_PLANT_BATCH_REASON_NOTE,
  );
  const [lastDestroyPlantBatch, setLastDestroyPlantBatch] =
    useState<MotherPlantPackageResult | null>(null);
  const [labTestTypeNames, setLabTestTypeNames] = useState<string[]>([]);
  const [labTestTypesHint, setLabTestTypesHint] = useState<string | null>(null);
  const [labTestTypesSourceLicense, setLabTestTypesSourceLicense] = useState("");
  const [labResultPackageLabel, setLabResultPackageLabel] = useState("");
  const [labResultDate, setLabResultDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [labResultRows, setLabResultRows] = useState<LabResultBuilderRow[]>([
    {
      id: "row-1",
      labTestTypeName: "",
      quantity: "1",
      passed: true,
      notes: DEFAULT_LAB_RESULT_NOTES,
    },
  ]);
  const [lastLabTestRecord, setLastLabTestRecord] = useState<LabTestRecordResult | null>(null);
  const [lastHarvestsSync, setLastHarvestsSync] = useState<HarvestsSyncResult | null>(null);
  const [harvestsRows, setHarvestsRows] = useState<MetrcHarvestRow[] | null>(null);
  const [harvestsLoaded, setHarvestsLoaded] = useState(false);
  const [createHarvestPlantBatchId, setCreateHarvestPlantBatchId] = useState("");
  const [createHarvestName, setCreateHarvestName] = useState(DEFAULT_TEST_HARVEST_NAME);
  const [createHarvestType, setCreateHarvestType] = useState<string>("Product");
  const [createHarvestConfirmOpen, setCreateHarvestConfirmOpen] = useState(false);
  const [lastCreateHarvest, setLastCreateHarvest] = useState<CreateTestHarvestResult | null>(null);
  const [batchPlantsRows, setBatchPlantsRows] = useState<MetrcPlantRow[] | null>(null);
  const [batchPlantsLoaded, setBatchPlantsLoaded] = useState(false);
  const [createHarvestPlantLabels, setCreateHarvestPlantLabels] = useState<string[]>([]);
  const [createHarvestGrowthLocationId, setCreateHarvestGrowthLocationId] = useState("");
  const [createHarvestDryingLocationId, setCreateHarvestDryingLocationId] = useState("");
  const [lastItemsSync, setLastItemsSync] = useState<ItemsSyncResult | null>(null);
  const [itemsRows, setItemsRows] = useState<MetrcItemRow[] | null>(null);
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const [itemSyncLicense, setItemSyncLicense] = useState("");
  const [itemSyncTryAllFacilities, setItemSyncTryAllFacilities] = useState(false);
  const [createItemName, setCreateItemName] = useState(DEFAULT_TEST_ITEM_NAME);
  const [createItemCategory, setCreateItemCategory] = useState(DEFAULT_TEST_ITEM_CATEGORY);
  const [createItemUom, setCreateItemUom] = useState(DEFAULT_TEST_ITEM_UOM);
  const [createItemStrain, setCreateItemStrain] = useState("");
  const [createItemConfirmOpen, setCreateItemConfirmOpen] = useState(false);
  const [lastCreateItem, setLastCreateItem] = useState<CreateTestItemResult | null>(null);
  const [createPackageHarvestId, setCreatePackageHarvestId] = useState("");
  const [createPackageItemId, setCreatePackageItemId] = useState("");
  const [createPackageTag, setCreatePackageTag] = useState("");
  const [createPackageQuantity, setCreatePackageQuantity] = useState("10");
  const [createPackageUnit, setCreatePackageUnit] = useState("Grams");
  const [createPackageLocationId, setCreatePackageLocationId] = useState("");
  const [createPackageDate, setCreatePackageDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [createPackageNote, setCreatePackageNote] = useState("");
  const [createPackageConfirmOpen, setCreatePackageConfirmOpen] = useState(false);
  const [lastCreatePackage, setLastCreatePackage] = useState<CreateTestPackageResult | null>(null);
  const [packageTagsHint, setPackageTagsHint] = useState<string | null>(null);
  const [lastTransfersSync, setLastTransfersSync] = useState<TransfersSyncResult | null>(null);
  const [transfersRows, setTransfersRows] = useState<MetrcTransferRow[] | null>(null);
  const [transfersLoaded, setTransfersLoaded] = useState(false);
  const [createTransferPackageLabel, setCreateTransferPackageLabel] = useState("");
  const [createTransferDestinationLicense, setCreateTransferDestinationLicense] = useState("");
  const [createTransferDate, setCreateTransferDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [createTransferRoute, setCreateTransferRoute] = useState(DEFAULT_TRANSFER_PLANNED_ROUTE);
  const [createTransferNotes, setCreateTransferNotes] = useState("NexBatch Test Transfer");
  const [createTransferTypeName, setCreateTransferTypeName] = useState("");
  const [transferTypesRows, setTransferTypesRows] = useState<MetrcTransferTypeRow[]>([]);
  const [transferTypesLoaded, setTransferTypesLoaded] = useState(false);
  const [transferTypesSource, setTransferTypesSource] = useState<"metrc" | "fallback" | "none">(
    "none",
  );
  const [lastTransferTypesSync, setLastTransferTypesSync] = useState<TransferTypesSyncResult | null>(
    null,
  );
  const [createTransferConfirmOpen, setCreateTransferConfirmOpen] = useState(false);
  const [lastCreateTransfer, setLastCreateTransfer] = useState<CreateTestTransferResult | null>(null);
  const [nexbatchRooms, setNexbatchRooms] = useState<NexbatchRoomOption[]>([]);
  const [mappingBusy, setMappingBusy] = useState<string | null>(null);
  const [locationCapabilityFilter, setLocationCapabilityFilter] =
    useState<LocationCapabilityFilter>("all");
  const [mappingToast, setMappingToast] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);
  const [testAt, setTestAt] = useState<string | null>(null);
  const [setupDebug, setSetupDebug] = useState<SandboxSetupDebug | null>(null);
  const [sandboxUiStatus, setSandboxUiStatus] = useState<
    "idle" | "provisioning" | "ready" | "timeout" | "error"
  >("idle");
  const [provisioningMessage, setProvisioningMessage] = useState<string | null>(null);
  const [lastDiagnostics, setLastDiagnostics] = useState<MetrcDiagnostics | null>(null);

  const loadNexbatchRooms = useCallback(async () => {
    try {
      const res = await authFetch("/api/metrc/locations/nexbatch-rooms");
      if (res.ok) {
        const json = (await res.json()) as {
          ok?: boolean;
          rooms?: NexbatchRoomOption[];
          total?: number;
        };
        const rooms = json.rooms ?? [];
        setNexbatchRooms(rooms);
        if (process.env.NODE_ENV === "development") {
          console.debug("[METRC] nexbatch rooms loaded", {
            total: json.total ?? rooms.length,
            rooms: rooms.map((r) => ({
              roomId: r.roomId,
              name: r.name,
              suite: r.suite,
              type: nexbatchRoomTypeLabel(r.suite),
            })),
          });
        }
      } else {
        setNexbatchRooms([]);
      }
    } catch {
      setNexbatchRooms([]);
    }
  }, []);

  const loadSyncedLocations = useCallback(async () => {
    try {
      const res = await authFetch("/api/metrc/locations");
      if (!res.ok) return;
      const json = (await res.json()) as { ok?: boolean; locations?: MetrcLocationRow[] };
      setLocationsRows(json.locations ?? []);
    } catch {
      setLocationsRows([]);
    } finally {
      setLocationsLoaded(true);
    }
  }, []);

  const loadSyncedStrains = useCallback(async () => {
    try {
      const res = await authFetch("/api/metrc/strains/persisted");
      if (!res.ok) return;
      const json = (await res.json()) as { ok?: boolean; strains?: MetrcStrainRow[] };
      setStrainsRows(json.strains ?? []);
    } catch {
      setStrainsRows([]);
    } finally {
      setStrainsLoaded(true);
    }
  }, []);

  const loadSyncedPackages = useCallback(async () => {
    try {
      const res = await authFetch("/api/metrc/packages/persisted");
      if (!res.ok) return;
      const json = (await res.json()) as { ok?: boolean; packages?: MetrcPackageRow[] };
      setPackagesRows(json.packages ?? []);
    } catch {
      setPackagesRows([]);
    } finally {
      setPackagesLoaded(true);
    }
  }, []);

  const loadPackageReconciliation = useCallback(async () => {
    try {
      const res = await authFetch("/api/metrc/packages/reconciliation");
      if (!res.ok) return;
      const json = (await res.json()) as {
        ok?: boolean;
        summary?: PackageReconciliationSummary;
      };
      setPackageReconciliation(json.summary ?? null);
    } catch {
      setPackageReconciliation(null);
    }
  }, []);

  const loadSyncedPlantBatches = useCallback(async () => {
    try {
      const res = await authFetch("/api/metrc/plant-batches/persisted");
      if (!res.ok) return;
      const json = (await res.json()) as { ok?: boolean; plantBatches?: MetrcPlantBatchRow[] };
      setPlantBatchesRows(json.plantBatches ?? []);
    } catch {
      setPlantBatchesRows([]);
    } finally {
      setPlantBatchesLoaded(true);
    }
  }, []);

  const loadSyncedHarvests = useCallback(async () => {
    try {
      const res = await authFetch("/api/metrc/harvests/persisted");
      if (!res.ok) return;
      const json = (await res.json()) as { ok?: boolean; harvests?: MetrcHarvestRow[] };
      setHarvestsRows(json.harvests ?? []);
    } catch {
      setHarvestsRows([]);
    } finally {
      setHarvestsLoaded(true);
    }
  }, []);

  const loadSyncedItems = useCallback(async () => {
    try {
      const res = await authFetch("/api/metrc/items/persisted");
      if (!res.ok) return;
      const json = (await res.json()) as { ok?: boolean; items?: MetrcItemRow[] };
      setItemsRows(json.items ?? []);
    } catch {
      setItemsRows([]);
    } finally {
      setItemsLoaded(true);
    }
  }, []);

  const loadSyncedTransfers = useCallback(async () => {
    try {
      const res = await authFetch("/api/metrc/transfers/persisted");
      if (!res.ok) return;
      const json = (await res.json()) as { ok?: boolean; transfers?: MetrcTransferRow[] };
      setTransfersRows(json.transfers ?? []);
    } catch {
      setTransfersRows([]);
    } finally {
      setTransfersLoaded(true);
    }
  }, []);

  const loadSyncedTransferTypes = useCallback(async (): Promise<MetrcTransferTypeRow[]> => {
    try {
      const res = await authFetch("/api/metrc/transfer-types/persisted");
      if (!res.ok) {
        setTransferTypesRows([]);
        setTransferTypesSource("none");
        setCreateTransferTypeName("");
        return [];
      }
      const json = (await res.json()) as {
        ok?: boolean;
        transferTypes?: MetrcTransferTypeRow[];
        source?: "metrc" | "fallback" | "none";
      };
      const types = json.transferTypes ?? [];
      const source =
        json.source ??
        (types.length === 0
          ? "none"
          : types.every((row) => row.source === "fallback")
            ? "fallback"
            : "metrc");
      setTransferTypesRows(types);
      setTransferTypesSource(source);
      setCreateTransferTypeName((prev) => {
        if (prev && types.some((t) => t.name === prev)) return prev;
        if (types.length === 1) return types[0]!.name;
        return types.length ? "" : "";
      });
      return types;
    } catch {
      setTransferTypesRows([]);
      setTransferTypesSource("none");
      setCreateTransferTypeName("");
      return [];
    } finally {
      setTransferTypesLoaded(true);
    }
  }, []);

  const loadMotherSourcePlants = useCallback(async () => {
    setMotherSourcePlantsLoaded(false);
    try {
      const res = await authFetch("/api/metrc/plants/persisted");
      if (!res.ok) {
        setMotherSourcePlantsRows([]);
        return;
      }
      const json = (await res.json()) as { ok?: boolean; plants?: MetrcPlantRow[] };
      const plants = (json.plants ?? []).filter(isMotherSourcePlant);
      setMotherSourcePlantsRows(plants);
      setMotherPackageSourcePlantLabel((current) => current.trim() || plants[0]?.label || "");
    } catch {
      setMotherSourcePlantsRows([]);
    } finally {
      setMotherSourcePlantsLoaded(true);
    }
  }, []);

  const loadBatchPlants = useCallback(async (metrcPlantBatchId: string) => {
    const batchId = metrcPlantBatchId.trim();
    if (!batchId) {
      setBatchPlantsRows([]);
      setBatchPlantsLoaded(true);
      return;
    }
    setBatchPlantsLoaded(false);
    try {
      const res = await authFetch(
        `/api/metrc/plants/persisted?metrcPlantBatchId=${encodeURIComponent(batchId)}`,
      );
      if (!res.ok) {
        setBatchPlantsRows([]);
        return;
      }
      const json = (await res.json()) as { ok?: boolean; plants?: MetrcPlantRow[] };
      const plants = (json.plants ?? []).filter((p) => p.active);
      setBatchPlantsRows(plants);
      setCreateHarvestPlantLabels(plants.slice(0, 5).map((p) => p.label));
    } catch {
      setBatchPlantsRows([]);
    } finally {
      setBatchPlantsLoaded(true);
    }
  }, []);

  const loadMeta = useCallback(async () => {
    setLoadingMeta(true);
    try {
      const res = await authFetch("/api/config/integrations");
      const json = res.ok ? ((await res.json()) as IntegrationsMeta) : null;
      setMeta(json);
      const ui = String(json?.metrcSandboxUiStatus || "").trim();
      if (ui === "awaiting_user_activation" || json?.metrcSandboxProvisioning) {
        setSandboxUiStatus("provisioning");
        setProvisioningMessage("METRC is creating your sandbox user…");
      } else if (ui === "connected" || json?.metrcOperationalAccessGranted) {
        setSandboxUiStatus("ready");
        setProvisioningMessage("Operational access granted");
      } else if (json?.metrcSandboxReady || json?.metrcSandboxCredentialsReady) {
        setSandboxUiStatus("ready");
        setProvisioningMessage("Sandbox credentials stored — run Test Connection");
      } else if (ui === "auth_rejected") {
        setSandboxUiStatus("error");
        setProvisioningMessage(json?.metrcLastMetrcResponseMessage || "Authorization rejected");
      }
    } catch {
      setMeta(null);
    } finally {
      setLoadingMeta(false);
    }
  }, []);

  const pollSandboxStatus = useCallback(async (): Promise<SandboxStatusJson | null> => {
    try {
      const res = await authFetch("/api/metrc/sandbox/status");
      if (!res.ok) return null;
      return (await res.json()) as SandboxStatusJson;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    void loadMeta();
    void loadNexbatchRooms();
    void loadSyncedLocations();
    void loadSyncedStrains();
    void loadSyncedPackages();
    void loadPackageReconciliation();
    void loadSyncedPlantBatches();
    void loadSyncedHarvests();
    void loadSyncedItems();
    void loadSyncedTransfers();
    void loadSyncedTransferTypes();
  }, [
    loadMeta,
    loadNexbatchRooms,
    loadSyncedLocations,
    loadSyncedStrains,
    loadSyncedPackages,
    loadPackageReconciliation,
    loadSyncedPlantBatches,
    loadSyncedHarvests,
    loadSyncedItems,
    loadSyncedTransfers,
    loadSyncedTransferTypes,
  ]);

  const selectedHarvestPlantBatch = useMemo(() => {
    if (!createHarvestPlantBatchId.trim()) return null;
    return (plantBatchesRows ?? []).find(
      (b) => b.metrcPlantBatchId === createHarvestPlantBatchId,
    ) ?? null;
  }, [createHarvestPlantBatchId, plantBatchesRows]);

  const harvestBatchNeedsTaggedPlants = useMemo(() => {
    if (!createHarvestPlantBatchId.trim()) return false;
    if (!batchPlantsLoaded) return false;
    return (batchPlantsRows?.length ?? 0) === 0 && createHarvestPlantLabels.length === 0;
  }, [
    createHarvestPlantBatchId,
    batchPlantsLoaded,
    batchPlantsRows,
    createHarvestPlantLabels.length,
  ]);

  const plantCapableLocations = useMemo(
    () => (locationsRows ?? []).filter((r) => r.forPlants),
    [locationsRows],
  );

  const harvestCapableLocations = useMemo(
    () => (locationsRows ?? []).filter((r) => r.forHarvests),
    [locationsRows],
  );

  const packageCapableLocations = useMemo(
    () => (locationsRows ?? []).filter((r) => r.forPackages),
    [locationsRows],
  );

  const activeHarvestsForPackage = useMemo(
    () => (harvestsRows ?? []).filter((h) => h.active),
    [harvestsRows],
  );

  const selectedPackageItem = useMemo(
    () => (itemsRows ?? []).find((i) => i.metrcItemId === createPackageItemId) ?? null,
    [itemsRows, createPackageItemId],
  );

  const selectedMotherPackageItem = useMemo(
    () => (itemsRows ?? []).find((i) => i.metrcItemId === motherPackageItemId) ?? null,
    [itemsRows, motherPackageItemId],
  );

  const motherEligiblePlants = useMemo(
    () => (motherSourcePlantsRows ?? []).filter(isMotherSourcePlant),
    [motherSourcePlantsRows],
  );

  const selectedMotherSourcePlant = useMemo(
    () =>
      motherEligiblePlants.find((p) => p.label === motherPackageSourcePlantLabel) ?? null,
    [motherEligiblePlants, motherPackageSourcePlantLabel],
  );

  const selectedMotherPackageLocation = useMemo(
    () => (locationsRows ?? []).find((l) => l.metrcLocationId === motherPackageLocationId) ?? null,
    [locationsRows, motherPackageLocationId],
  );

  const motherPackageDebugPreview = useMemo((): MotherPlantPackageDebug | null => {
    const itemName = selectedMotherPackageItem?.itemName?.trim() || "";
    if (!motherPackageSourcePlantLabel.trim() || !itemName || !motherPackageTag.trim()) {
      return null;
    }
    const sourceFacilityLicense =
      selectedMotherSourcePlant?.licenseNumber?.trim() ||
      meta?.metrcLicenseNumberDisplay?.trim() ||
      "—";
    const tagSourceFacilityLicense =
      motherPackageTagSourceLicense.trim() ||
      meta?.metrcLicenseNumberDisplay?.trim() ||
      "—";
    const finalLicenseNumber = sourceFacilityLicense;
    return {
      sourcePlantLabel: selectedMotherSourcePlant?.label ?? motherPackageSourcePlantLabel.trim(),
      sourcePlantGrowthPhase: selectedMotherSourcePlant?.growthPhase ?? "—",
      sourceFacilityLicense,
      packageTag: motherPackageTag.trim(),
      tagSourceFacilityLicense,
      item: itemName,
      itemFacilityLicense: selectedMotherPackageItem?.licenseNumber?.trim() || null,
      location:
        selectedMotherPackageLocation?.name?.trim() ||
        selectedMotherSourcePlant?.locationName?.trim() ||
        null,
      locationFacilityLicense: selectedMotherPackageLocation?.licenseNumber?.trim() || null,
      finalLicenseNumber,
      license: finalLicenseNumber,
    };
  }, [
    selectedMotherPackageItem,
    motherPackageSourcePlantLabel,
    motherPackageTag,
    motherPackageTagSourceLicense,
    selectedMotherSourcePlant,
    selectedMotherPackageLocation,
    meta?.metrcLicenseNumberDisplay,
  ]);

  const selectedPlantBatchPackageItem = useMemo(
    () => (itemsRows ?? []).find((i) => i.metrcItemId === plantBatchPackageItemId) ?? null,
    [itemsRows, plantBatchPackageItemId],
  );

  const selectedPackageLocation = useMemo(
    () =>
      packageCapableLocations.find((l) => l.metrcLocationId === createPackageLocationId) ?? null,
    [packageCapableLocations, createPackageLocationId],
  );

  const canCreateTestHarvest =
    plantCapableLocations.length > 0 && harvestCapableLocations.length > 0;

  const selectedGrowthLocation = useMemo(
    () =>
      plantCapableLocations.find((l) => l.metrcLocationId === createHarvestGrowthLocationId) ??
      null,
    [plantCapableLocations, createHarvestGrowthLocationId],
  );

  const selectedDryingLocation = useMemo(
    () =>
      harvestCapableLocations.find((l) => l.metrcLocationId === createHarvestDryingLocationId) ??
      null,
    [harvestCapableLocations, createHarvestDryingLocationId],
  );

  useEffect(() => {
    if (!locationsLoaded) return;
    if (plantCapableLocations.length > 0 && !createHarvestGrowthLocationId) {
      const preferred =
        plantCapableLocations.find(
          (l) =>
            l.name.trim().toLowerCase() === DEFAULT_PLANT_GROWTH_LOCATION_NAME.toLowerCase(),
        ) ?? plantCapableLocations[0];
      if (preferred) setCreateHarvestGrowthLocationId(preferred.metrcLocationId);
    }
    if (harvestCapableLocations.length > 0 && !createHarvestDryingLocationId) {
      setCreateHarvestDryingLocationId(harvestCapableLocations[0]!.metrcLocationId);
    }
  }, [
    locationsLoaded,
    plantCapableLocations,
    harvestCapableLocations,
    createHarvestGrowthLocationId,
    createHarvestDryingLocationId,
  ]);

  useEffect(() => {
    if (!itemsLoaded || !itemsRows?.length) return;
    const defaultItemId = resolveDefaultSandboxPackageItemId(itemsRows);
    if (!defaultItemId) return;
    if (!createPackageItemId.trim()) {
      setCreatePackageItemId(defaultItemId);
      const item = itemsRows.find((i) => i.metrcItemId === defaultItemId);
      if (item?.unitOfMeasureName) setCreatePackageUnit(item.unitOfMeasureName);
    }
    if (!motherPackageItemId.trim()) {
      setMotherPackageItemId(defaultItemId);
    }
    if (!plantBatchPackageItemId.trim()) {
      const plantBatchItemId = resolveDefaultSandboxPlantBatchPackageItemId(itemsRows);
      if (plantBatchItemId) setPlantBatchPackageItemId(plantBatchItemId);
    }
  }, [itemsLoaded, itemsRows, createPackageItemId, motherPackageItemId, plantBatchPackageItemId]);

  useEffect(() => {
    if (!createHarvestPlantBatchId.trim()) {
      setBatchPlantsRows(null);
      setBatchPlantsLoaded(false);
      setCreateHarvestPlantLabels([]);
      return;
    }
    void loadBatchPlants(createHarvestPlantBatchId);
  }, [createHarvestPlantBatchId, loadBatchPlants]);

  useEffect(() => {
    if (sandboxUiStatus !== "provisioning") return;

    const startedAt = Date.parse(String(meta?.metrcSandboxProvisioningStartedAt || ""));
    const deadline =
      Number.isFinite(startedAt) && startedAt > 0
        ? startedAt + POLL_MAX_MS
        : Date.now() + POLL_MAX_MS;

    const tick = async () => {
      const status = await pollSandboxStatus();
      if (!status) return;

      setProvisioningMessage(status.message);
      if (status.sandboxUiStatus === "awaiting_user_activation") {
        setSandboxUiStatus("provisioning");
      }

      if (status.status === "ready" || status.credentialsReady) {
        setSandboxUiStatus(status.operationalAccessGranted ? "ready" : "provisioning");
        setStatusMsg({
          tone: status.operationalAccessGranted ? "ok" : "warn",
          text: status.operationalAccessGranted
            ? "Sandbox ready — operational access granted"
            : "Credentials stored — run Test Connection when user key is ready",
        });
        await loadMeta();
        return;
      }

      if (status.status === "timeout") {
        setSandboxUiStatus("timeout");
        setStatusMsg({ tone: "error", text: status.message });
        await loadMeta();
        return;
      }

      if (status.status === "error") {
        setSandboxUiStatus("error");
        setStatusMsg({ tone: "error", text: status.message });
        await loadMeta();
      }
    };

    void tick();
    const intervalId = window.setInterval(() => {
      if (Date.now() >= deadline) {
        setSandboxUiStatus("timeout");
        setStatusMsg({
          tone: "error",
          text: "Sandbox user creation timed out after 5 minutes. Try Generate Sandbox Facility again.",
        });
        window.clearInterval(intervalId);
        return;
      }
      void tick();
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [sandboxUiStatus, meta?.metrcSandboxProvisioningStartedAt, pollSandboxStatus, loadMeta]);

  const credentialsReady = useMemo(() => {
    if (sandboxUiStatus === "ready") return true;
    if (meta?.metrcSandboxCredentialsReady || meta?.metrcSandboxReady) return true;
    return Boolean(
      meta?.hasMetrcVendorApiKey &&
        meta?.hasMetrcUserApiKey &&
        String(meta?.metrcLicenseNumberDisplay || "").trim(),
    );
  }, [meta, sandboxUiStatus]);

  const connectionLabel = useMemo(() => {
    const ui = String(meta?.metrcSandboxUiStatus || lastDiagnostics?.sandboxStatus || "").trim();
    if (busy === "test") return "Testing…";
    if (busy === "setup" || sandboxUiStatus === "provisioning") return "Provisioning…";
    if (ui === "connected" || meta?.metrcOperationalAccessGranted) return "Connected";
    if (ui === "awaiting_user_activation") return "Awaiting user activation";
    if (ui === "auth_rejected") return "Auth rejected";
    if (ui === "endpoint_unavailable") return "Endpoint unavailable";
    if (sandboxUiStatus === "timeout") return "Timed out";
    if (sandboxUiStatus === "error") return "Error";
    if (credentialsReady) return "Credentials ready";
    return "Not provisioned";
  }, [
    meta?.metrcSandboxUiStatus,
    meta?.metrcOperationalAccessGranted,
    meta?.metrcLastConnectionStatus,
    lastDiagnostics?.sandboxStatus,
    busy,
    credentialsReady,
    sandboxUiStatus,
  ]);

  const filteredLocations = useMemo(() => {
    const rows = locationsRows ?? [];
    if (locationCapabilityFilter === "plants") return rows.filter((r) => r.forPlants);
    if (locationCapabilityFilter === "harvest") return rows.filter((r) => r.forHarvests);
    if (locationCapabilityFilter === "packages") return rows.filter((r) => r.forPackages);
    return rows;
  }, [locationsRows, locationCapabilityFilter]);

  async function runSetup() {
    setBusy("setup");
    setStatusMsg(null);
    setLastPull(null);
    setSetupDebug(null);
    try {
      const res = await authFetch("/api/metrc/sandbox/setup", { method: "POST" });
      const json = (await res.json()) as SandboxSetupJson;
      if (json.debug) setSetupDebug(json.debug);

      if (!json.ok) {
        setSandboxUiStatus("error");
        setStatusMsg({
          tone: "error",
          text: json.message || "Sandbox setup failed. Ensure vendor API key is saved in Company Config.",
        });
        return;
      }

      const ok = json as Extract<SandboxSetupJson, { ok: true }>;

      if (res.status === 202 || ok.status === "provisioning") {
        setSandboxUiStatus("provisioning");
        setProvisioningMessage(ok.message || "METRC is creating your sandbox user…");
        setStatusMsg({
          tone: "warn",
          text: ok.message || "METRC is creating your sandbox user…",
        });
        await loadMeta();
        return;
      }

      setSandboxUiStatus("ready");
      setProvisioningMessage("Sandbox ready");
      setStatusMsg({
        tone: "ok",
        text: `Sandbox ready${ok.facilityName ? `: ${ok.facilityName}` : ""}${
          ok.facilityLicenseNumber ? ` (${ok.facilityLicenseNumber})` : ""
        }. User API key stored server-side.`,
      });
      await loadMeta();
    } catch {
      setSandboxUiStatus("error");
      setStatusMsg({ tone: "error", text: "Unable to reach the API server." });
    } finally {
      setBusy(null);
    }
  }

  async function runTestConnection() {
    setBusy("test");
    setStatusMsg(null);
    try {
      const res = await authFetch("/api/metrc/test-connection");
      const json = (await res.json()) as TestConnectionJson;
      setTestAt(json.checkedAt || new Date().toISOString());
      if ("diagnostics" in json && json.diagnostics) {
        setLastDiagnostics(json.diagnostics);
      }
      if (json.ok && "connected" in json && json.connected) {
        setStatusMsg({
          tone: "ok",
          text: `Connection OK — ${json.locationCount} active location(s). Auth: ${json.authMode ?? json.diagnostics.lastAttemptedAuthMode ?? "—"}.`,
        });
      } else {
        const fail = json as Extract<TestConnectionJson, { ok: false }>;
        setStatusMsg({
          tone: "error",
          text: fail.message || "Connection test failed.",
        });
      }
      await loadMeta();
    } catch {
      setStatusMsg({ tone: "error", text: "Connection test could not reach the API." });
    } finally {
      setBusy(null);
    }
  }

  async function runFacilitiesSync() {
    setBusy("facilities");
    setStatusMsg(null);
    setLastFacilities(null);
    try {
      const res = await authFetch("/api/metrc/facilities");
      const json = (await res.json()) as FacilitiesSyncResult;
      setLastFacilities(json);
      if (!res.ok || !json.ok) {
        setStatusMsg({
          tone: "error",
          text: String(json.message || "Facilities sync failed."),
        });
        return;
      }
      const warn = json.rateLimitWarning ? ` ${json.rateLimitWarning}` : "";
      setStatusMsg({
        tone: json.rateLimitWarning ? "warn" : "ok",
        text: `Synced ${json.count ?? 0} facilit${(json.count ?? 0) === 1 ? "y" : "ies"}.${warn}`,
      });
      await loadMeta();
    } catch {
      setStatusMsg({ tone: "error", text: "Facilities sync failed — network error." });
    } finally {
      setBusy(null);
    }
  }

  async function saveLocationMapping(metrcLocationId: string, value: string) {
    const previousRows = locationsRows;
    const { suite: nexbatchRoomSuite, roomId: nexbatchRoomId } = parseMappingSelectValue(value);
    const matched = nexbatchRooms.find(
      (opt) => opt.suite === nexbatchRoomSuite && opt.roomId === nexbatchRoomId,
    );

    setLocationsRows((prev) =>
      (prev ?? []).map((row) =>
        row.metrcLocationId === metrcLocationId
          ? {
              ...row,
              nexbatchRoomSuite,
              nexbatchRoomId,
              nexbatchRoomLabel: matched ? formatNexbatchRoomOptionLabel(matched) : null,
              mappingSource: nexbatchRoomId ? "manual" : "none",
              nexbatchMappingManual: true,
            }
          : row,
      ),
    );
    setMappingBusy(metrcLocationId);
    setMappingToast(null);

    try {
      const res = await authFetch("/api/metrc/locations/mapping", {
        method: "PATCH",
        body: JSON.stringify({ metrcLocationId, nexbatchRoomSuite, nexbatchRoomId }),
      });
      const json = (await res.json()) as { ok?: boolean; location?: MetrcLocationRow; message?: string };
      if (!res.ok || !json.ok || !json.location) {
        setLocationsRows(previousRows);
        setMappingToast({
          tone: "error",
          text: json.message || "Failed to save room mapping.",
        });
        return;
      }
      setLocationsRows((prev) =>
        (prev ?? []).map((row) =>
          row.metrcLocationId === metrcLocationId ? json.location! : row,
        ),
      );
      setMappingToast({
        tone: "ok",
        text: nexbatchRoomId ? "Room mapping saved." : "Room mapping cleared.",
      });
    } catch {
      setLocationsRows(previousRows);
      setMappingToast({ tone: "error", text: "Failed to save room mapping — network error." });
    } finally {
      setMappingBusy(null);
    }
  }

  async function runLocationsSync() {
    setBusy("rooms");
    setStatusMsg(null);
    setLastLocationsSync(null);
    try {
      const res = await authFetch("/api/metrc/rooms");
      const json = (await res.json()) as LocationsSyncResult;
      setLastLocationsSync(json);
      if (!res.ok || !json.ok) {
        setStatusMsg({
          tone: "error",
          text: String(json.message || "Locations sync failed."),
        });
        return;
      }
      const count = json.count ?? json.totalLocationsSynced ?? 0;
      setLocationsRows(json.locations ?? []);
      if (json.nexbatchRooms?.length) {
        setNexbatchRooms(json.nexbatchRooms);
      } else {
        await loadNexbatchRooms();
      }
      setLocationsLoaded(true);
      const autoMapped =
        typeof json.autoMappedCount === "number" && json.autoMappedCount > 0
          ? ` Auto-matched ${json.autoMappedCount} room${json.autoMappedCount === 1 ? "" : "s"} by name.`
          : "";
      const warn = json.rateLimitWarning ? ` ${json.rateLimitWarning}` : "";
      setStatusMsg({
        tone: json.rateLimitWarning ? "warn" : "ok",
        text: `Synced ${count} location${count === 1 ? "" : "s"} (0 is valid when METRC returns no active locations).${autoMapped}${warn}`,
      });
      await loadMeta();
    } catch {
      setStatusMsg({ tone: "error", text: "Locations sync failed — network error." });
    } finally {
      setBusy(null);
    }
  }

  async function runStrainsSync(options?: { quiet?: boolean }) {
    if (!options?.quiet) {
      setBusy("strains");
      setStatusMsg(null);
      setLastStrainsSync(null);
    }
    try {
      const res = await authFetch("/api/metrc/strains");
      const json = (await res.json()) as StrainsSyncResult;
      if (!options?.quiet) setLastStrainsSync(json);
      if (!res.ok || !json.ok) {
        if (!options?.quiet) {
          setStatusMsg({
            tone: "error",
            text: String(json.message || "Strains sync failed."),
          });
        }
        return false;
      }
      const count = json.count ?? json.totalStrainsSynced ?? 0;
      setStrainsRows(json.strains ?? []);
      setStrainsLoaded(true);
      if (!options?.quiet) {
        const created =
          typeof json.nexbatchStrainsCreated === "number" && json.nexbatchStrainsCreated > 0
            ? ` Created ${json.nexbatchStrainsCreated} NexBatch strain${json.nexbatchStrainsCreated === 1 ? "" : "s"}.`
            : "";
        const warn = json.rateLimitWarning ? ` ${json.rateLimitWarning}` : "";
        setStatusMsg({
          tone: json.rateLimitWarning ? "warn" : "ok",
          text: `Synced ${count} strain${count === 1 ? "" : "s"} (0 is valid when METRC returns no active strains).${created}${warn}`,
        });
        await loadMeta();
      }
      return true;
    } catch {
      if (!options?.quiet) {
        setStatusMsg({ tone: "error", text: "Strains sync failed — network error." });
      }
      return false;
    } finally {
      if (!options?.quiet) setBusy(null);
    }
  }

  async function runCreateTestStrain() {
    setCreateStrainConfirmOpen(false);
    setBusy("createStrain");
    setLastCreateStrain(null);
    const name = createStrainName.trim();
    if (!createStrainPct.valid) {
      setStatusMsg({
        tone: "error",
        text: "Indica % and Sativa % must sum to 100 before creating a strain.",
      });
      return;
    }
    const strainRequestBody = {
      name,
      testingStatus: createStrainTestingStatus.trim() || "None",
      indicaPercentage: createStrainPct.indica,
      sativaPercentage: createStrainPct.sativa,
    };
    const strainCreateStarted = performance.now();
    try {
      const res = await authFetch("/api/metrc/strains/create-test", {
        method: "POST",
        body: JSON.stringify(strainRequestBody),
      });
      const json = (await res.json()) as CreateTestStrainResult;
      setLastCreateStrain(json);
      const companyId = getSelectedCompanyId() || "";
      const durationMs =
        typeof json.durationMs === "number"
          ? json.durationMs
          : Math.round(performance.now() - strainCreateStarted);
      if (!res.ok || !json.ok) {
        recordSandboxCreateEvaluation({
          companyId,
          taskId: "create_strain",
          endpoint: "/api/metrc/strains/create-test",
          httpStatus: res.status,
          durationMs,
          requestPayload: strainRequestBody,
          responsePayload: json,
          user: sandboxEvaluationUser(),
          passed: false,
          errorMessage:
            json.credentialHint ||
            json.metrcMessage ||
            String(json.message || "Create test strain failed."),
        });
        setStatusMsg({
          tone: "error",
          text:
            json.credentialHint ||
            json.metrcMessage ||
            String(json.message || "Create test strain failed."),
        });
        return;
      }
      recordSandboxCreateEvaluation({
        companyId,
        taskId: "create_strain",
        endpoint: "/api/metrc/strains/create-test",
        httpStatus: res.status,
        durationMs,
        requestPayload: strainRequestBody,
        responsePayload: json,
        user: sandboxEvaluationUser(),
        passed: true,
      });
      const strainName = json.strain?.name || name;
      setCreateBatchStrain(strainName);
      setStatusMsg({
        tone: "ok",
        text: String(
          json.message ||
            (json.alreadyExists
              ? `Using existing strain "${strainName}".`
              : `Created test strain "${strainName}".`),
        ),
      });
      await runStrainsSync({ quiet: true });
      await loadSyncedStrains();
      await loadMeta();
    } catch {
      setStatusMsg({ tone: "error", text: "Create test strain failed — network error." });
    } finally {
      setBusy(null);
    }
  }

  async function runPackagesSync() {
    setBusy("packages");
    setStatusMsg(null);
    setLastPackagesSync(null);
    try {
      const res = await authFetch("/api/metrc/packages");
      const json = (await res.json()) as PackagesSyncResult;
      setLastPackagesSync(json);
      if (!res.ok || !json.ok) {
        setStatusMsg({
          tone: "error",
          text: String(json.message || "Packages sync failed."),
        });
        return;
      }
      const count = json.count ?? json.totalPackagesSynced ?? 0;
      setPackagesRows(json.packages ?? []);
      setPackagesLoaded(true);
      const warn = json.rateLimitWarning ? ` ${json.rateLimitWarning}` : "";
      setStatusMsg({
        tone: json.rateLimitWarning ? "warn" : "ok",
        text: `Synced ${count} package${count === 1 ? "" : "s"} (0 is valid when METRC returns no active packages).${warn}`,
      });
      await loadMeta();
      await loadPackageReconciliation();
    } catch {
      setStatusMsg({ tone: "error", text: "Packages sync failed — network error." });
    } finally {
      setBusy(null);
    }
  }

  async function runPlantBatchesSync() {
    setBusy("plantBatches");
    setStatusMsg(null);
    setLastPlantBatchesSync(null);
    try {
      const res = await authFetch("/api/metrc/plant-batches");
      const json = (await res.json()) as PlantBatchesSyncResult;
      setLastPlantBatchesSync(json);
      if (!res.ok || !json.ok) {
        setStatusMsg({
          tone: "error",
          text: json.credentialHint || String(json.message || "Plant batches sync failed."),
        });
        return;
      }
      const count = json.count ?? json.totalPlantBatchesSynced ?? 0;
      setPlantBatchesRows(json.plantBatches ?? []);
      setPlantBatchesLoaded(true);
      const pages =
        typeof json.pagesFetched === "number" && json.pagesFetched > 1
          ? ` (${json.pagesFetched} pages)`
          : "";
      const warn = json.rateLimitWarning ? ` ${json.rateLimitWarning}` : "";
      setStatusMsg({
        tone: json.rateLimitWarning ? "warn" : "ok",
        text: `Synced ${count} plant batch${count === 1 ? "" : "es"} (0 is valid when METRC returns none).${pages}${warn}`,
      });
      await loadMeta();
    } catch {
      setStatusMsg({ tone: "error", text: "Plant batches sync failed — network error." });
    } finally {
      setBusy(null);
    }
  }

  async function runHarvestsSync() {
    setBusy("harvests");
    setStatusMsg(null);
    setLastHarvestsSync(null);
    try {
      const res = await authFetch("/api/metrc/harvests");
      const json = (await res.json()) as HarvestsSyncResult;
      setLastHarvestsSync(json);
      if (!res.ok || !json.ok) {
        setStatusMsg({
          tone: "error",
          text: json.credentialHint || String(json.message || "Harvests sync failed."),
        });
        return;
      }
      const count = json.count ?? json.totalHarvestsSynced ?? 0;
      setHarvestsRows(json.harvests ?? []);
      setHarvestsLoaded(true);
      const pages =
        typeof json.pagesFetched === "number" && json.pagesFetched > 1
          ? ` (${json.pagesFetched} pages)`
          : "";
      const warn = json.rateLimitWarning ? ` ${json.rateLimitWarning}` : "";
      setStatusMsg({
        tone: json.rateLimitWarning ? "warn" : "ok",
        text: `Synced ${count} harvest${count === 1 ? "" : "es"} (0 is valid when METRC returns none).${pages}${warn}`,
      });
      await loadMeta();
    } catch {
      setStatusMsg({ tone: "error", text: "Harvests sync failed — network error." });
    } finally {
      setBusy(null);
    }
  }

  async function runCreateTestPlantBatch() {
    setCreateBatchConfirmOpen(false);
    setBusy("createPlantBatch");
    setLastCreatePlantBatch(null);
    const { suite, roomId } = parseMappingSelectValue(createBatchRoomValue);
    const count = Number.parseInt(createBatchCount, 10);
    const plantBatchRequestBody = {
      name: createBatchName.trim(),
      strain: createBatchStrain.trim(),
      count: Number.isFinite(count) && count > 0 ? count : 1,
      plantingDate: createBatchPlantingDate,
      batchType: "Clone" as const,
      nexbatchRoomSuite: suite,
      nexbatchRoomId: roomId,
    };
    const plantBatchCreateStarted = performance.now();
    try {
      const res = await authFetch("/api/metrc/plant-batches/create-test", {
        method: "POST",
        body: JSON.stringify(plantBatchRequestBody),
      });
      const json = (await res.json()) as CreateTestPlantBatchResult;
      setLastCreatePlantBatch(json);
      const companyId = getSelectedCompanyId() || "";
      const durationMs =
        typeof json.durationMs === "number"
          ? json.durationMs
          : Math.round(performance.now() - plantBatchCreateStarted);
      if (!res.ok || !json.ok) {
        recordSandboxCreateEvaluation({
          companyId,
          taskId: "create_plant_batch",
          endpoint: "/api/metrc/plant-batches/create-test",
          httpStatus: res.status,
          durationMs,
          requestPayload: plantBatchRequestBody,
          responsePayload: json,
          user: sandboxEvaluationUser(),
          passed: false,
          errorMessage:
            json.credentialHint ||
            json.metrcMessage ||
            String(json.message || "Create test plant batch failed."),
        });
        setStatusMsg({
          tone: "error",
          text:
            json.credentialHint ||
            json.metrcMessage ||
            String(json.message || "Create test plant batch failed."),
        });
        return;
      }
      recordSandboxCreateEvaluation({
        companyId,
        taskId: "create_plant_batch",
        endpoint: "/api/metrc/plant-batches/create-test",
        httpStatus: res.status,
        durationMs,
        requestPayload: plantBatchRequestBody,
        responsePayload: json,
        user: sandboxEvaluationUser(),
        passed: true,
      });
      setStatusMsg({
        tone: "ok",
        text: String(json.message || "Test plant batch created in METRC sandbox."),
      });
      if (json.plantBatch) {
        setPlantBatchesRows((prev) => {
          const row: MetrcPlantBatchRow = {
            metrcPlantBatchId: json.plantBatch!.metrcPlantBatchId,
            name: json.plantBatch!.metrcPlantBatchName,
            strainName: json.plantBatch!.metrcStrainName,
            metrcStrainId: null,
            count: json.plantBatch!.count,
            metrcLocationId: json.plantBatch!.metrcLocationId,
            locationName: "",
            plantedDate: createBatchPlantingDate ? `${createBatchPlantingDate}T12:00:00.000Z` : null,
            lastModified: json.plantBatch!.syncedAt,
            active: true,
            createdViaTest: true,
            lastSyncedAt: json.plantBatch!.syncedAt,
          };
          const rest = (prev ?? []).filter(
            (p) => p.metrcPlantBatchId !== row.metrcPlantBatchId,
          );
          return [...rest, row].sort((a, b) => a.name.localeCompare(b.name));
        });
        setPlantBatchesLoaded(true);
      }
      await loadSyncedPlantBatches();
      await loadMeta();
    } catch {
      setStatusMsg({ tone: "error", text: "Create test plant batch failed — network error." });
    } finally {
      setBusy(null);
    }
  }

  async function fetchMotherPackageTag() {
    setBusy("motherPackageTags");
    setMotherPackageTagsHint(null);
    try {
      const res = await authFetch("/api/metrc/available-package-tags?limit=20");
      const json = (await res.json()) as {
        ok?: boolean;
        labels?: string[];
        message?: string;
        licenseNumber?: string;
      };
      if (!res.ok || !json.ok) {
        setMotherPackageTagSourceLicense("");
        setMotherPackageTagsHint(String(json.message || "Could not fetch package tags from METRC."));
        return;
      }
      const tagLicense = String(json.licenseNumber || "").trim();
      if (tagLicense) {
        setMotherPackageTagSourceLicense(tagLicense);
      }
      const first = json.labels?.[0];
      if (first) {
        setMotherPackageTag(first);
        setMotherPackageTagsHint(
          json.labels && json.labels.length > 1
            ? `Filled first package tag (${json.labels.length} available${tagLicense ? `, license ${tagLicense}` : ""}). Edit before submit.`
            : `Filled first available package tag${tagLicense ? ` (license ${tagLicense})` : ""}. Edit before submit.`,
        );
      } else {
        setMotherPackageTagsHint("No package tags returned — enter a tag manually.");
      }
    } catch {
      setMotherPackageTagsHint("Package tag fetch failed — enter a tag manually.");
    } finally {
      setBusy(null);
    }
  }

  async function runCreateMotherPlantPackage() {
    const sourcePlantLabel = selectedMotherSourcePlant?.label?.trim() || "";
    const count = Number.parseInt(motherPackageCount, 10);
    if (!selectedMotherSourcePlant || !sourcePlantLabel) {
      setStatusMsg({
        tone: "error",
        text: "Select a synced vegetative or flowering mother plant label.",
      });
      return;
    }
    if (!motherPackageTag.trim()) {
      setStatusMsg({ tone: "error", text: "Package tag is required." });
      return;
    }
    if (!Number.isFinite(count) || count < 1) {
      setStatusMsg({ tone: "error", text: "Quantity must be at least 1." });
      return;
    }
    const selectedItem =
      selectedMotherPackageItem ??
      (itemsRows ?? []).find((i) => i.metrcItemId === motherPackageItemId) ??
      null;
    const itemName = selectedItem?.itemName?.trim() || "";
    if (!itemName) {
      setStatusMsg({ tone: "error", text: PACKAGE_ITEM_REQUIRED_MSG });
      return;
    }

    setBusy("motherPlantPackage");
    setLastMotherPlantPackage(null);
    const requestBody = {
      sourcePlantLabel,
      packageTag: motherPackageTag.trim(),
      count,
      actualDate: motherPackageDate,
      locationName:
        selectedMotherPackageLocation?.name?.trim() ||
        selectedMotherSourcePlant.locationName?.trim() ||
        null,
      itemName,
    };
    try {
      const res = await authFetch("/api/metrc/test/plantbatch-package-from-mother", {
        method: "POST",
        body: JSON.stringify(requestBody),
      });
      const json = (await res.json()) as MotherPlantPackageResult;
      setLastMotherPlantPackage(json);
      if (!res.ok || !json.ok) {
        setStatusMsg({
          tone: "error",
          text:
            json.credentialHint ||
            json.metrcMessage ||
            String(json.message || "Create mother plant package failed."),
        });
        return;
      }
      setStatusMsg({
        tone: "ok",
        text: String(json.message || "Mother plant package created in METRC sandbox."),
      });
      await runPackagesSync();
      await loadSyncedPackages();
      await loadMeta();
    } catch {
      setStatusMsg({ tone: "error", text: "Create mother plant package failed — network error." });
    } finally {
      setBusy(null);
    }
  }

  async function runCreatePlantBatchPackage() {
    const selectedBatch =
      (plantBatchesRows ?? []).find(
        (batch) => batch.metrcPlantBatchId === plantBatchPackagePlantBatchId,
      ) ?? null;
    const plantBatchName = selectedBatch?.name?.trim() || "";
    const plantBatchId = Number.parseInt(plantBatchPackagePlantBatchId, 10);
    const count = Number.parseInt(plantBatchPackageCount, 10);
    if (!selectedBatch || !plantBatchName) {
      setStatusMsg({ tone: "error", text: "Select a source plant batch." });
      return;
    }
    if (!plantBatchPackageTag.trim()) {
      setStatusMsg({ tone: "error", text: "Package tag is required." });
      return;
    }
    if (!Number.isFinite(count) || count < 1) {
      setStatusMsg({ tone: "error", text: "Quantity must be at least 1." });
      return;
    }
    const selectedItem =
      selectedPlantBatchPackageItem ??
      (itemsRows ?? []).find((i) => i.metrcItemId === plantBatchPackageItemId) ??
      null;
    const itemName = selectedItem?.itemName?.trim() || "";
    if (!itemName) {
      setStatusMsg({ tone: "error", text: PACKAGE_ITEM_REQUIRED_MSG });
      return;
    }

    const selectedLocation =
      (locationsRows ?? []).find((l) => l.metrcLocationId === plantBatchPackageLocationId) ??
      null;

    setBusy("plantBatchPackage");
    setLastPlantBatchPackage(null);
    const requestBody = {
      plantBatchName,
      plantBatchId: Number.isFinite(plantBatchId) && plantBatchId > 0 ? plantBatchId : undefined,
      packageTag: plantBatchPackageTag.trim(),
      count,
      actualDate: plantBatchPackageDate,
      locationName: selectedLocation?.name?.trim() || selectedBatch.locationName?.trim() || null,
      itemName,
      note: plantBatchPackageNote.trim() || null,
    };
    try {
      const res = await authFetch("/api/metrc/test/plantbatch-package", {
        method: "POST",
        body: JSON.stringify(requestBody),
      });
      const json = (await res.json()) as MotherPlantPackageResult;
      setLastPlantBatchPackage(json);
      if (!res.ok || !json.ok) {
        setStatusMsg({
          tone: "error",
          text:
            json.credentialHint ||
            json.metrcMessage ||
            String(json.message || "Create plant batch package failed."),
        });
        return;
      }
      setStatusMsg({
        tone: "ok",
        text: String(json.message || "Plant batch package created in METRC sandbox."),
      });
      await runPackagesSync();
      await loadSyncedPackages();
      await loadMeta();
    } catch {
      setStatusMsg({ tone: "error", text: "Create plant batch package failed — network error." });
    } finally {
      setBusy(null);
    }
  }

  async function fetchAvailablePlantTagsForGrowthPhase() {
    setBusy("growthPhasePlantTags");
    setGrowthPhasePlantTagsHint(null);
    try {
      const count = Number.parseInt(growthPhaseCount, 10);
      const lim = Math.min(
        500,
        Math.max(20, Number.isFinite(count) && count >= 1 ? count + 10 : 120),
      );
      const res = await authFetch(`/api/metrc/available-plant-tags?limit=${lim}`);
      const json = (await res.json()) as {
        ok?: boolean;
        labels?: string[];
        parsedCount?: number;
        message?: string;
        licenseNumber?: string;
        authMode?: string;
      };
      if (!res.ok || !json.ok) {
        setGrowthPhaseAvailableTags([]);
        setGrowthPhasePlantTagsHint(
          String(json.message || "Could not fetch plant tags from METRC."),
        );
        return;
      }
      const labels = (json.labels ?? []).map((label) => String(label || "").trim()).filter(Boolean);
      setGrowthPhaseAvailableTags(labels);
      if (labels.length === 0) {
        setGrowthPhaseStartingTag("");
        setGrowthPhasePlantTagsHint(
          typeof json.parsedCount === "number" && json.parsedCount === 0
            ? "METRC returned no available plant tags for this license. Request plant tags in METRC sandbox."
            : "No plant tags returned — fetch again or check METRC tag inventory.",
        );
        return;
      }
      if (!growthPhaseStartingTag.trim() || !labels.includes(growthPhaseStartingTag.trim())) {
        setGrowthPhaseStartingTag("");
      }
      const licenseNote = json.licenseNumber ? ` License: ${json.licenseNumber}.` : "";
      setGrowthPhasePlantTagsHint(
        `Select a starting plant tag (${labels.length} available).${licenseNote}`,
      );
    } catch {
      setGrowthPhaseAvailableTags([]);
      setGrowthPhasePlantTagsHint("Plant tag fetch failed — try again.");
    } finally {
      setBusy(null);
    }
  }

  async function runChangePlantBatchGrowthPhase() {
    const selectedBatch =
      (plantBatchesRows ?? []).find(
        (batch) => batch.metrcPlantBatchId === growthPhasePlantBatchId,
      ) ?? null;
    const plantBatchName = selectedBatch?.name?.trim() || "";
    const plantBatchId = Number.parseInt(growthPhasePlantBatchId, 10);
    const count = Number.parseInt(growthPhaseCount, 10);
    if (!selectedBatch || !plantBatchName) {
      setStatusMsg({ tone: "error", text: "Select a source plant batch." });
      return;
    }
    if (!Number.isFinite(count) || count < 1) {
      setStatusMsg({ tone: "error", text: "Count must be at least 1." });
      return;
    }
    if (!growthPhaseStartingTag.trim()) {
      setStatusMsg({
        tone: "error",
        text: "Fetch available plant tags and select a starting tag.",
      });
      return;
    }
    if (
      growthPhaseAvailableTags.length > 0 &&
      !growthPhaseAvailableTags.includes(growthPhaseStartingTag.trim())
    ) {
      setStatusMsg({
        tone: "error",
        text: "Starting tag must be selected from the fetched METRC available plant tags list.",
      });
      return;
    }
    const growthPhase = METRC_PLANT_BATCH_GROWTH_PHASE_OPTIONS.includes(
      growthPhaseSelection as (typeof METRC_PLANT_BATCH_GROWTH_PHASE_OPTIONS)[number],
    )
      ? growthPhaseSelection
      : "Flowering";

    const selectedLocation =
      packageCapableLocations.find((l) => l.metrcLocationId === growthPhaseLocationId) ?? null;

    setBusy("plantBatchGrowthPhase");
    setLastGrowthPhaseChange(null);
    const requestBody = {
      plantBatchName,
      plantBatchId: Number.isFinite(plantBatchId) && plantBatchId > 0 ? plantBatchId : undefined,
      growthPhase,
      count,
      startingTag: growthPhaseStartingTag.trim(),
      growthDate: growthPhaseDate,
      locationName: selectedLocation?.name?.trim() || selectedBatch.locationName?.trim() || null,
    };
    try {
      const res = await authFetch("/api/metrc/test/plantbatch-growthphase", {
        method: "POST",
        body: JSON.stringify(requestBody),
      });
      const json = (await res.json()) as MotherPlantPackageResult;
      setLastGrowthPhaseChange(json);
      if (!res.ok || !json.ok) {
        setStatusMsg({
          tone: "error",
          text:
            json.credentialHint ||
            json.metrcMessage ||
            String(json.message || "Change plant batch growth phase failed."),
        });
        return;
      }
      setStatusMsg({
        tone: "ok",
        text: String(json.message || "Plant batch growth phase changed in METRC sandbox."),
      });
      await runPlantBatchesSync();
      await loadSyncedPlantBatches();
      await loadMeta();
    } catch {
      setStatusMsg({
        tone: "error",
        text: "Change plant batch growth phase failed — network error.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function fetchPlantBatchWasteReasons() {
    setBusy("destroyWasteReasons");
    setDestroyPlantBatchWasteReasonsHint(null);
    try {
      const res = await authFetch("/api/metrc/plantbatch-waste-reasons");
      const json = (await res.json()) as {
        ok?: boolean;
        reasons?: string[];
        parsedCount?: number;
        message?: string;
        licenseNumber?: string;
        endpoint?: string;
      };
      if (!res.ok || !json.ok) {
        setDestroyPlantBatchWasteReasons([]);
        setDestroyPlantBatchWasteReason("");
        setDestroyPlantBatchWasteReasonsHint(
          String(json.message || "Could not fetch plant batch waste reasons from METRC."),
        );
        return;
      }
      const reasons = (json.reasons ?? []).map((r) => String(r || "").trim()).filter(Boolean);
      setDestroyPlantBatchWasteReasons(reasons);
      if (reasons.length === 0) {
        setDestroyPlantBatchWasteReason("");
        setDestroyPlantBatchWasteReasonsHint(
          typeof json.parsedCount === "number" && json.parsedCount === 0
            ? "METRC returned no plant batch waste reasons for this license."
            : "No waste reasons returned — check METRC sandbox configuration.",
        );
        return;
      }
      if (!destroyPlantBatchWasteReason.trim() || !reasons.includes(destroyPlantBatchWasteReason.trim())) {
        setDestroyPlantBatchWasteReason("");
      }
      const licenseNote = json.licenseNumber ? ` License: ${json.licenseNumber}.` : "";
      setDestroyPlantBatchWasteReasonsHint(
        `Select a waste reason (${reasons.length} available from ${json.endpoint || "GET /plantbatches/v2/waste/reasons"}).${licenseNote}`,
      );
    } catch {
      setDestroyPlantBatchWasteReasons([]);
      setDestroyPlantBatchWasteReason("");
      setDestroyPlantBatchWasteReasonsHint("Waste reasons fetch failed — try again.");
    } finally {
      setBusy(null);
    }
  }

  function addLabResultRow() {
    setLabResultRows((prev) => [
      ...prev,
      {
        id: `row-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        labTestTypeName: "",
        quantity: "1",
        passed: true,
        notes: DEFAULT_LAB_RESULT_NOTES,
      },
    ]);
  }

  function updateLabResultRow(
    rowId: string,
    patch: Partial<Pick<LabResultBuilderRow, "labTestTypeName" | "quantity" | "passed" | "notes">>,
  ) {
    setLabResultRows((prev) =>
      prev.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    );
  }

  function removeLabResultRow(rowId: string) {
    setLabResultRows((prev) => (prev.length <= 1 ? prev : prev.filter((row) => row.id !== rowId)));
  }

  async function runSyncLabTestTypes() {
    setBusy("labTestTypes");
    setLabTestTypesHint(null);
    try {
      const res = await authFetch("/api/metrc/labtest-types");
      const json = (await res.json()) as LabTestTypesResult;
      if (!res.ok || !json.ok) {
        setLabTestTypeNames([]);
        setLabTestTypesSourceLicense("");
        setLabTestTypesHint(String(json.message || "Could not fetch METRC lab test types."));
        return;
      }
      const names = (json.labTestTypes ?? []).map((name) => String(name || "").trim()).filter(Boolean);
      const sourceLicense = String(json.licenseNumber || "").trim();
      setLabTestTypesSourceLicense(sourceLicense);
      setLabTestTypeNames(names);
      setLabResultRows((prev) =>
        prev.map((row) =>
          row.labTestTypeName && names.includes(row.labTestTypeName)
            ? row
            : { ...row, labTestTypeName: "" },
        ),
      );
      if (names.length === 0) {
        setLabTestTypesHint(
          typeof json.parsedCount === "number" && json.parsedCount === 0
            ? "METRC returned no lab test types for this license."
            : "No lab test types returned — check METRC sandbox configuration.",
        );
        return;
      }
      setLabTestTypesHint(
        `Loaded ${names.length} lab test type name(s) from ${json.endpoint || "GET /labtests/v2/types"} for license ${sourceLicense || METRC_LAB_TEST_LICENSE}.`,
      );
    } catch {
      setLabTestTypeNames([]);
      setLabTestTypesSourceLicense("");
      setLabTestTypesHint("Lab test type sync failed — try again.");
    } finally {
      setBusy(null);
    }
  }

  async function runRecordLabTestResult() {
    const packageLabel = labResultPackageLabel.trim();
    if (!packageLabel) {
      setStatusMsg({ tone: "error", text: "Select a synced package tag." });
      return;
    }
    if (!labResultDate.trim()) {
      setStatusMsg({ tone: "error", text: "Result date is required." });
      return;
    }
    if (!labTestTypeNames.length) {
      setStatusMsg({
        tone: "error",
        text: "Sync lab test types first. Lab test type names must come from METRC /labtests/v2/types.",
      });
      return;
    }

    const results = labResultRows
      .map((row) => {
        const quantity = Number.parseFloat(row.quantity);
        return {
          labTestTypeName: row.labTestTypeName.trim(),
          quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
          passed: row.passed,
          notes: row.notes.trim() || null,
        };
      })
      .filter((row) => row.labTestTypeName);

    if (!results.length) {
      setStatusMsg({ tone: "error", text: "Add at least one lab result row with a test type name." });
      return;
    }
    if (results.some((row) => !labTestTypeNames.includes(row.labTestTypeName))) {
      setStatusMsg({
        tone: "error",
        text: "Each Lab Test Type Name must be selected from synced METRC lab test types.",
      });
      return;
    }

    const requestBody = {
      packageLabel,
      resultDate: `${labResultDate.trim()}T00:00:00Z`,
      results,
    };

    setBusy("labTestRecord");
    setLastLabTestRecord(null);
    try {
      const res = await authFetch("/api/metrc/test/labtests-record", {
        method: "POST",
        body: JSON.stringify(requestBody),
      });
      const json = (await res.json()) as LabTestRecordResult;
      setLastLabTestRecord(json);
      if (!res.ok || !json.ok) {
        setStatusMsg({
          tone: "error",
          text:
            json.credentialHint ||
            json.metrcMessage ||
            String(json.message || "Record lab test result failed."),
        });
        return;
      }
      setStatusMsg({
        tone: "ok",
        text: String(json.message || "Lab test result recorded in METRC sandbox."),
      });
      await runPackagesSync();
      await loadSyncedPackages();
    } catch {
      setStatusMsg({ tone: "error", text: "Record lab test result failed — network error." });
    } finally {
      setBusy(null);
    }
  }

  async function runDestroyPlantBatch() {
    const selectedBatch =
      (plantBatchesRows ?? []).find(
        (batch) => batch.metrcPlantBatchId === destroyPlantBatchId,
      ) ?? null;
    const plantBatchName = selectedBatch?.name?.trim() || "";
    const plantBatchId = Number.parseInt(destroyPlantBatchId, 10);
    const count = Number.parseInt(destroyPlantBatchCount, 10);
    if (!selectedBatch || !plantBatchName) {
      setStatusMsg({ tone: "error", text: "Select a source plant batch." });
      return;
    }
    if (!Number.isFinite(count) || count < 1) {
      setStatusMsg({ tone: "error", text: "Destroy count must be at least 1." });
      return;
    }

    const wasteReasonName = destroyPlantBatchWasteReason.trim();
    const reasonNote = destroyPlantBatchReasonNote.trim();
    if (!wasteReasonName) {
      setStatusMsg({
        tone: "error",
        text: "Fetch plant batch waste reasons and select a waste reason.",
      });
      return;
    }
    if (
      destroyPlantBatchWasteReasons.length > 0 &&
      !destroyPlantBatchWasteReasons.includes(wasteReasonName)
    ) {
      setStatusMsg({
        tone: "error",
        text: "Waste reason must be selected from the fetched METRC waste reasons list.",
      });
      return;
    }
    if (!reasonNote) {
      setStatusMsg({ tone: "error", text: "Reason note is required." });
      return;
    }
    const wasteWeight = Number.parseFloat(destroyPlantBatchWasteWeight);
    const wasteMethodName = destroyPlantBatchWasteMethod.trim() || null;
    const wasteUnitOfMeasureName = destroyPlantBatchWasteUom.trim() || null;

    setBusy("destroyPlantBatch");
    setLastDestroyPlantBatch(null);
    const requestBody = {
      plantBatchName,
      plantBatchId: Number.isFinite(plantBatchId) && plantBatchId > 0 ? plantBatchId : undefined,
      count,
      actualDate: destroyPlantBatchDate,
      wasteReasonName,
      reasonNote,
      wasteMethodName,
      wasteWeight: Number.isFinite(wasteWeight) && wasteWeight > 0 ? wasteWeight : null,
      wasteUnitOfMeasureName,
    };
    try {
      const res = await authFetch("/api/metrc/test/plantbatch-destroy", {
        method: "POST",
        body: JSON.stringify(requestBody),
      });
      const json = (await res.json()) as MotherPlantPackageResult;
      setLastDestroyPlantBatch(json);
      if (!res.ok || !json.ok) {
        setStatusMsg({
          tone: "error",
          text:
            json.credentialHint ||
            json.metrcMessage ||
            String(json.message || "Destroy plant batch failed."),
        });
        return;
      }
      setStatusMsg({
        tone: "ok",
        text: String(json.message || `Plant batch '${plantBatchName}' destroyed in METRC sandbox.`),
      });
      await runPlantBatchesSync();
      await loadSyncedPlantBatches();
      await loadMeta();
    } catch {
      setStatusMsg({ tone: "error", text: "Destroy plant batch failed — network error." });
    } finally {
      setBusy(null);
    }
  }

  async function runSyncPlants() {
    setBusy("plants");
    setStatusMsg(null);
    try {
      const res = await authFetch("/api/metrc/plants");
      const json = (await res.json()) as { ok?: boolean; count?: number; message?: string };
      if (!res.ok || !json.ok) {
        setStatusMsg({
          tone: "error",
          text: String(json.message || "Plant sync failed."),
        });
        return;
      }
      setStatusMsg({
        tone: "ok",
        text: `Synced ${json.count ?? 0} METRC plant tag(s).`,
      });
      await loadMotherSourcePlants();
      if (createHarvestPlantBatchId.trim()) {
        await loadBatchPlants(createHarvestPlantBatchId);
      }
    } catch {
      setStatusMsg({ tone: "error", text: "Plant sync failed — network error." });
    } finally {
      setBusy(null);
    }
  }

  async function runCreateTestHarvest() {
    setCreateHarvestConfirmOpen(false);
    setBusy("createHarvest");
    setLastCreateHarvest(null);
    const harvestRequestBody = {
      metrcPlantBatchId: createHarvestPlantBatchId.trim() || null,
      metrcPlantLabels: createHarvestPlantLabels,
      harvestName: createHarvestName.trim() || DEFAULT_TEST_HARVEST_NAME,
      harvestType: createHarvestType,
      wetWeight: 100,
      unitOfWeight: "Grams",
      actualDate: new Date().toISOString().slice(0, 10),
      autoPromoteBatch: true,
      growthLocationName: selectedGrowthLocation?.name ?? "",
      metrcGrowthLocationId: createHarvestGrowthLocationId || null,
      dryingLocationName: selectedDryingLocation?.name ?? "",
      metrcDryingLocationId: createHarvestDryingLocationId || null,
    };
    const harvestCreateStarted = performance.now();
    try {
      const res = await authFetch("/api/metrc/harvests/create-test", {
        method: "POST",
        body: JSON.stringify(harvestRequestBody),
      });
      const json = (await res.json()) as CreateTestHarvestResult;
      setLastCreateHarvest(json);
      const companyId = getSelectedCompanyId() || "";
      const durationMs =
        typeof json.durationMs === "number"
          ? json.durationMs
          : Math.round(performance.now() - harvestCreateStarted);
      if (!res.ok || !json.ok) {
        recordSandboxCreateEvaluation({
          companyId,
          taskId: "create_harvest",
          endpoint: "/api/metrc/harvests/create-test",
          httpStatus: res.status,
          durationMs,
          requestPayload: harvestRequestBody,
          responsePayload: json,
          user: sandboxEvaluationUser(),
          passed: false,
          errorMessage:
            json.credentialHint ||
            json.metrcMessage ||
            String(json.message || "Create test harvest failed."),
        });
        setStatusMsg({
          tone: "error",
          text:
            json.credentialHint ||
            json.metrcMessage ||
            String(json.message || "Create test harvest failed."),
        });
        return;
      }
      recordSandboxCreateEvaluation({
        companyId,
        taskId: "create_harvest",
        endpoint: "/api/metrc/harvests/create-test",
        httpStatus: res.status,
        durationMs,
        requestPayload: harvestRequestBody,
        responsePayload: json,
        user: sandboxEvaluationUser(),
        passed: true,
      });
      setStatusMsg({
        tone: "ok",
        text: String(json.message || "Test harvest created in METRC sandbox."),
      });
      if (json.harvest) {
        setHarvestsRows((prev) => {
          const row = json.harvest!;
          const rest = (prev ?? []).filter((h) => h.metrcHarvestId !== row.metrcHarvestId);
          return [...rest, row].sort((a, b) => a.harvestName.localeCompare(b.harvestName));
        });
        setHarvestsLoaded(true);
      }
      await loadSyncedHarvests();
      await loadMeta();
    } catch {
      setStatusMsg({ tone: "error", text: "Create test harvest failed — network error." });
    } finally {
      setBusy(null);
    }
  }

  async function runItemsSync(options?: { licenseNumber?: string; tryAllFacilities?: boolean }) {
    setBusy("items");
    setLastItemsSync(null);
    const params = new URLSearchParams();
    const license = String(options?.licenseNumber ?? itemSyncLicense).trim();
    const tryAll = options?.tryAllFacilities ?? itemSyncTryAllFacilities;
    if (license) params.set("licenseNumber", license);
    if (tryAll) params.set("tryAllFacilities", "true");
    const qs = params.toString();
    try {
      const res = await authFetch(`/api/metrc/items${qs ? `?${qs}` : ""}`);
      const json = (await res.json()) as ItemsSyncResult;
      setLastItemsSync(json);
      if (!res.ok || !json.ok) {
        setStatusMsg({
          tone: "error",
          text: String(json.message || json.credentialHint || "Items sync failed."),
        });
        return;
      }
      setItemsRows(json.items ?? []);
      setItemsLoaded(true);
      if (json.items?.length) {
        const defaultItemId = resolveDefaultSandboxPackageItemId(json.items);
        if (defaultItemId) {
          if (!createPackageItemId.trim()) {
            setCreatePackageItemId(defaultItemId);
            const item = json.items.find((i) => i.metrcItemId === defaultItemId);
            if (item?.unitOfMeasureName) setCreatePackageUnit(item.unitOfMeasureName);
          }
          if (!motherPackageItemId.trim()) {
            setMotherPackageItemId(defaultItemId);
          }
          if (!plantBatchPackageItemId.trim()) {
            const plantBatchItemId = resolveDefaultSandboxPlantBatchPackageItemId(json.items);
            if (plantBatchItemId) setPlantBatchPackageItemId(plantBatchItemId);
          }
        }
      }
      const tone = json.noItemsForFacility ? "error" : "ok";
      setStatusMsg({
        tone,
        text:
          json.message ||
          (json.noItemsForFacility
            ? "No items found for selected facility."
            : `Synced ${json.count ?? json.totalItemsSynced ?? 0} METRC item(s).`),
      });
      await loadMeta();
    } catch {
      setStatusMsg({ tone: "error", text: "Items sync failed — network error." });
    } finally {
      setBusy(null);
    }
  }

  async function runCreateTestItem() {
    setCreateItemConfirmOpen(false);
    setBusy("createItem");
    setLastCreateItem(null);
    const itemRequestBody = {
      name: createItemName.trim(),
      productCategory: createItemCategory.trim(),
      unitOfMeasure: createItemUom.trim(),
      quantityType: "WeightBased",
      strainName: createItemStrain.trim() || null,
    };
    try {
      const res = await authFetch("/api/metrc/items/create-test", {
        method: "POST",
        body: JSON.stringify(itemRequestBody),
      });
      const json = (await res.json()) as CreateTestItemResult;
      setLastCreateItem(json);
      if (!res.ok || !json.ok) {
        setStatusMsg({
          tone: "error",
          text: String(json.credentialHint || json.metrcMessage || json.message || "Create test item failed."),
        });
        return;
      }
      if (json.item) {
        setItemsRows((prev) => {
          const row = json.item!;
          const rest = (prev ?? []).filter((i) => i.metrcItemId !== row.metrcItemId);
          return [...rest, row].sort((a, b) => a.itemName.localeCompare(b.itemName));
        });
        setCreatePackageItemId(json.item.metrcItemId);
        if (json.item.unitOfMeasureName) setCreatePackageUnit(json.item.unitOfMeasureName);
        setItemsLoaded(true);
      } else {
        await runItemsSync();
      }
      setStatusMsg({
        tone: "ok",
        text: String(json.message || "Test item created in METRC sandbox."),
      });
      await loadMeta();
    } catch {
      setStatusMsg({ tone: "error", text: "Create test item failed — network error." });
    } finally {
      setBusy(null);
    }
  }

  function openCreatePackageConfirm() {
    if (!(itemsRows?.length ?? 0) || !createPackageItemId.trim()) {
      setStatusMsg({ tone: "error", text: PACKAGE_ITEM_REQUIRED_MSG });
      return;
    }
    setCreatePackageConfirmOpen(true);
  }

  async function fetchAvailablePackageTags() {
    setBusy("packageTags");
    setPackageTagsHint(null);
    try {
      const res = await authFetch("/api/metrc/available-package-tags?limit=20");
      const json = (await res.json()) as {
        ok?: boolean;
        labels?: string[];
        message?: string;
      };
      if (!res.ok || !json.ok) {
        setPackageTagsHint(String(json.message || "Could not fetch package tags from METRC."));
        return;
      }
      const first = json.labels?.[0];
      if (first) {
        setCreatePackageTag(first);
        setPackageTagsHint(
          json.labels && json.labels.length > 1
            ? `Filled first tag (${json.labels.length} available). Edit before submit.`
            : "Filled first available package tag. Edit before submit.",
        );
      } else {
        setPackageTagsHint("No package tags returned — enter a tag manually.");
      }
    } catch {
      setPackageTagsHint("Package tag fetch failed — enter a tag manually.");
    } finally {
      setBusy(null);
    }
  }

  async function runCreateTestPackage() {
    setCreatePackageConfirmOpen(false);
    setBusy("createPackage");
    setLastCreatePackage(null);
    const qty = Number(createPackageQuantity);
    const packageRequestBody = {
      metrcHarvestId: createPackageHarvestId.trim(),
      metrcItemId: createPackageItemId.trim() || null,
      packageTag: createPackageTag.trim(),
      quantity: qty,
      unitOfMeasure: createPackageUnit.trim() || "Grams",
      metrcLocationId: createPackageLocationId.trim() || null,
      locationName: selectedPackageLocation?.name ?? null,
      packagedDate: createPackageDate,
      note: createPackageNote.trim() || null,
    };
    const packageCreateStarted = performance.now();
    try {
      const res = await authFetch("/api/metrc/packages/create-test", {
        method: "POST",
        body: JSON.stringify(packageRequestBody),
      });
      const json = (await res.json()) as CreateTestPackageResult;
      setLastCreatePackage(json);
      const companyId = getSelectedCompanyId() || "";
      const durationMs =
        typeof json.durationMs === "number"
          ? json.durationMs
          : Math.round(performance.now() - packageCreateStarted);
      if (!res.ok || !json.ok) {
        recordSandboxCreateEvaluation({
          companyId,
          taskId: "create_package",
          endpoint: "/api/metrc/packages/create-test",
          httpStatus: res.status,
          durationMs,
          requestPayload: packageRequestBody,
          responsePayload: json,
          user: sandboxEvaluationUser(),
          passed: false,
          errorMessage:
            json.credentialHint ||
            json.metrcMessage ||
            String(json.message || "Create test package failed."),
        });
        setStatusMsg({
          tone: "error",
          text:
            json.credentialHint ||
            json.metrcMessage ||
            String(json.message || "Create test package failed."),
        });
        return;
      }
      recordSandboxCreateEvaluation({
        companyId,
        taskId: "create_package",
        endpoint: "/api/metrc/packages/create-test",
        httpStatus: res.status,
        durationMs,
        requestPayload: packageRequestBody,
        responsePayload: json,
        user: sandboxEvaluationUser(),
        passed: true,
      });
      setStatusMsg({
        tone: "ok",
        text: String(
          json.message ||
            `Test package created (${json.packageLabel || createPackageTag.trim()}).`,
        ),
      });
      await runPackagesSync();
      await loadSyncedPackages();
      await loadMeta();
    } catch {
      setStatusMsg({ tone: "error", text: "Create test package failed — network error." });
    } finally {
      setBusy(null);
    }
  }

  async function runTransfersSync() {
    setBusy("transfers");
    setLastTransfersSync(null);
    try {
      const res = await authFetch("/api/metrc/transfers");
      const json = (await res.json()) as TransfersSyncResult;
      setLastTransfersSync(json);
      if (!res.ok || !json.ok) {
        setStatusMsg({
          tone: "error",
          text: String(json.message || json.credentialHint || "Transfers sync failed."),
        });
        return;
      }
      setTransfersRows(json.transfers ?? []);
      setTransfersLoaded(true);
      const count = json.count ?? json.totalTransfersSynced ?? 0;
      const warn = json.rateLimitWarning ? ` ${json.rateLimitWarning}` : "";
      setStatusMsg({
        tone: "ok",
        text: `Synced ${count} transfer${count === 1 ? "" : "s"} (incoming, outgoing, templates).${warn}`,
      });
      await loadMeta();
    } catch {
      setStatusMsg({ tone: "error", text: "Transfers sync failed — network error." });
    } finally {
      setBusy(null);
    }
  }

  async function runTransferTypesSync() {
    setBusy("transferTypes");
    setLastTransferTypesSync(null);
    try {
      const res = await authFetch("/api/metrc/transfer-types");
      const json = (await res.json()) as TransferTypesSyncResult;
      setLastTransferTypesSync(json);
      if (!res.ok || !json.ok) {
        setStatusMsg({
          tone: "error",
          text: String(json.message || json.credentialHint || "Transfer types sync failed."),
        });
        return;
      }
      const types = json.transferTypes ?? [];
      const source = json.usedFallback
        ? "fallback"
        : types.every((row) => row.source === "fallback")
          ? "fallback"
          : types.length
            ? "metrc"
            : "none";
      setTransferTypesRows(types);
      setTransferTypesSource(source);
      setTransferTypesLoaded(true);
      setCreateTransferTypeName((prev) => {
        if (prev && types.some((t) => t.name === prev)) return prev;
        if (types.length === 1) return types[0]!.name;
        return types.length ? prev || "" : "";
      });
      const warn = json.usedFallback
        ? " Using fallback type list — METRC types endpoint unavailable."
        : "";
      setStatusMsg({
        tone: json.usedFallback ? "warn" : "ok",
        text: `Loaded ${types.length} transfer type${types.length === 1 ? "" : "s"} from METRC.${warn}`,
      });
      await loadMeta();
    } catch {
      setStatusMsg({ tone: "error", text: "Transfer types sync failed — network error." });
    } finally {
      setBusy(null);
    }
  }

  function openCreateTransferConfirm() {
    if (!(packagesRows?.length ?? 0) || !createTransferPackageLabel.trim()) {
      setStatusMsg({ tone: "error", text: TRANSFER_PACKAGE_REQUIRED_MSG });
      return;
    }
    if (!transferTypesRows.length) {
      setStatusMsg({ tone: "error", text: TRANSFER_TYPES_EMPTY_MSG });
      return;
    }
    if (!createTransferTypeName.trim()) {
      setStatusMsg({ tone: "error", text: TRANSFER_TYPE_REQUIRED_MSG });
      return;
    }
    if (!transferTypesRows.some((row) => row.name === createTransferTypeName.trim())) {
      setStatusMsg({
        tone: "error",
        text: "Selected transfer type is not in synced types. Click Sync Transfer Types.",
      });
      return;
    }
    if (!createTransferDestinationLicense.trim()) {
      setStatusMsg({
        tone: "error",
        text: "Select a destination facility that differs from the active source license.",
      });
      return;
    }
    if (createTransferDestinationLicense.trim() === activeFacilityLicense) {
      setStatusMsg({
        tone: "error",
        text: "Destination facility must differ from the active source facility license.",
      });
      return;
    }
    setCreateTransferConfirmOpen(true);
  }

  async function runCreateTestTransfer() {
    setCreateTransferConfirmOpen(false);
    setBusy("createTransfer");
    setLastCreateTransfer(null);
    const syncedTypes = await loadSyncedTransferTypes();
    if (!syncedTypes.length) {
      setStatusMsg({ tone: "error", text: TRANSFER_TYPES_EMPTY_MSG });
      setBusy(null);
      return;
    }
    if (!createTransferTypeName.trim() || !syncedTypes.some((row) => row.name === createTransferTypeName.trim())) {
      setStatusMsg({ tone: "error", text: TRANSFER_TYPE_REQUIRED_MSG });
      setBusy(null);
      return;
    }
    const transferRequestBody = {
      packageLabel: createTransferPackageLabel.trim(),
      destinationFacilityLicense: createTransferDestinationLicense.trim(),
      transferDate: createTransferDate,
      plannedRoute: createTransferRoute.trim(),
      notes: createTransferNotes.trim() || null,
      transferTypeName: createTransferTypeName,
    };
    const transferCreateStarted = performance.now();
    try {
      const res = await authFetch("/api/metrc/transfers/create-test", {
        method: "POST",
        body: JSON.stringify(transferRequestBody),
      });
      const json = (await res.json()) as CreateTestTransferResult;
      setLastCreateTransfer(json);
      const companyId = getSelectedCompanyId() || "";
      const durationMs =
        typeof json.durationMs === "number"
          ? json.durationMs
          : Math.round(performance.now() - transferCreateStarted);
      if (!res.ok || !json.ok) {
        const validation =
          json.validationErrors?.length ? ` ${json.validationErrors.join(" ")}` : "";
        recordSandboxCreateEvaluation({
          companyId,
          taskId: "transfers",
          endpoint: "/api/metrc/transfers/create-test",
          httpStatus: res.status,
          durationMs,
          requestPayload: transferRequestBody,
          responsePayload: json,
          user: sandboxEvaluationUser(),
          passed: false,
          errorMessage:
            json.credentialHint ||
            json.metrcMessage ||
            String(json.message || "Create test transfer failed.") + validation,
        });
        setStatusMsg({
          tone: "error",
          text:
            json.credentialHint ||
            json.metrcMessage ||
            String(json.message || "Create test transfer failed.") + validation,
        });
        return;
      }
      recordSandboxCreateEvaluation({
        companyId,
        taskId: "transfers",
        endpoint: "/api/metrc/transfers/create-test",
        httpStatus: res.status,
        durationMs,
        requestPayload: transferRequestBody,
        responsePayload: json,
        user: sandboxEvaluationUser(),
        passed: true,
      });
      setStatusMsg({
        tone: "ok",
        text: String(
          json.message ||
            `Test transfer template created${json.metrcTransferId ? ` (id ${json.metrcTransferId})` : ""}.`,
        ),
      });
      await runTransfersSync();
      await loadSyncedTransfers();
      await loadMeta();
    } catch {
      setStatusMsg({ tone: "error", text: "Create test transfer failed — network error." });
    } finally {
      setBusy(null);
    }
  }

  const isSandboxEnvironment =
    String(meta?.metrcEnvironment || "").trim().toLowerCase() === "sandbox";

  const activeFacilityLicense = String(meta?.metrcLicenseNumberDisplay || "").trim();

  const transferDestinationFacilities = useMemo(() => {
    const rows = lastFacilities?.facilities ?? [];
    return rows.filter(
      (f) => f.licenseNumber.trim() && f.licenseNumber.trim() !== activeFacilityLicense,
    );
  }, [lastFacilities, activeFacilityLicense]);

  const transferPayloadPreview = useMemo(() => {
    const packageLabels = createTransferPackageLabel.trim()
      ? [createTransferPackageLabel.trim()]
      : [];
    const destinationRecipientLicense = createTransferDestinationLicense.trim();
    const diagnostics = lastTransferTypesSync?.diagnostics;
    return {
      selectedTransferTypeName: createTransferTypeName || null,
      transferTypeOptionsCount: transferTypesRows.length || diagnostics?.transferTypeOptionsCount || 0,
      transferTypesSource,
      transferTypesUsedFallback:
        transferTypesSource === "fallback" || lastTransferTypesSync?.usedFallback === true,
      firstRawTransferType: diagnostics?.firstRawTransferType ?? transferTypesRows[0]?.raw ?? null,
      transferTypesSyncEndpoint: diagnostics?.endpoint ?? null,
      endpoints: ["/transfers/v2/templates/outgoing", "/transfers/v1/templates"],
      v1: {
        endpoint: "/transfers/v1/templates",
        topLevelTransferTypeName: createTransferTypeName,
        destinationRecipientLicense,
        packageLabels,
      },
      v2: {
        endpoint: "/transfers/v2/templates/outgoing",
        destinationTransferTypeName: createTransferTypeName,
        destinationRecipientLicense,
        packageLabels,
      },
    };
  }, [
    createTransferPackageLabel,
    createTransferDestinationLicense,
    createTransferTypeName,
    transferTypesRows,
    transferTypesSource,
    lastTransferTypesSync,
  ]);

  const vegRoomOptions = useMemo(
    () => nexbatchRooms.filter((r) => r.suite === "vegRooms"),
    [nexbatchRooms],
  );

  const createStrainPct = useMemo(
    () => parseStrainPercentagePair(createStrainIndicaPct, createStrainSativaPct),
    [createStrainIndicaPct, createStrainSativaPct],
  );

  const rateWarn =
    String(meta?.metrcSandboxLastRateLimitWarning || "").trim() ||
    (lastPull?.rateLimitWarning ?? "");

  return (
    <PageAccessGate allowedRoles={["OWNER", "ADMIN", "OPERATIONS_MANAGER"]}>
      <main style={styles.page}>
        <Nav />
        <header style={styles.header}>
          <div>
            <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
              <Link href="/admin" style={{ color: "#93c5fd", textDecoration: "none" }}>
                Admin
              </Link>
              {" / "}
              <Link href="/admin/config" style={{ color: "#93c5fd", textDecoration: "none" }}>
                Integrations
              </Link>
              {" / METRC Sandbox"}
            </p>
            <h1 style={styles.title}>METRC Sandbox</h1>
            <p style={styles.subtitle}>
              Provision and test Colorado-style sandbox credentials. API keys never leave the server — only
              status and counts are shown here.
            </p>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            <Link
              href="/admin/integrations/metrc-evaluation"
              style={{
                textDecoration: "none",
                border: "1px solid rgba(167, 139, 250, 0.45)",
                color: "#c4b5fd",
                borderRadius: 10,
                padding: "10px 14px",
                fontWeight: 700,
              }}
            >
              Evaluation Mode
            </Link>
            <Link
              href="/admin/config"
              style={{
                textDecoration: "none",
                border: "1px solid #475569",
                color: "#cbd5e1",
                borderRadius: 10,
                padding: "10px 14px",
                fontWeight: 700,
              }}
            >
              Company Config
            </Link>
          </div>
        </header>

        <section style={styles.card}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Facility info</h2>
          {loadingMeta ? (
            <p style={{ color: "#94a3b8", marginTop: 12 }}>Loading…</p>
          ) : (
            <div style={styles.metaGrid}>
              <div style={styles.metaItem}>
                <div style={styles.metaLabel}>Environment</div>
                <div style={styles.metaValue}>{meta?.metrcEnvironment || "—"}</div>
              </div>
              <div style={styles.metaItem}>
                <div style={styles.metaLabel}>State</div>
                <div style={styles.metaValue}>{meta?.metrcStateCode || "—"}</div>
              </div>
              <div style={styles.metaItem}>
                <div style={styles.metaLabel}>License</div>
                <div style={styles.metaValue}>{meta?.metrcLicenseNumberDisplay || "—"}</div>
              </div>
              <div style={styles.metaItem}>
                <div style={styles.metaLabel}>Facility name</div>
                <div style={styles.metaValue}>{meta?.metrcFacilityName || "—"}</div>
              </div>
              <div style={styles.metaItem}>
                <div style={styles.metaLabel}>Username</div>
                <div style={styles.metaValue}>{meta?.metrcUsernameDisplay || "—"}</div>
              </div>
              <div style={styles.metaItem}>
                <div style={styles.metaLabel}>Vendor key</div>
                <div style={styles.metaValue}>
                  {meta?.hasMetrcVendorApiKey ? "Configured" : "Missing — set in Company Config"}
                </div>
              </div>
              <div style={styles.metaItem}>
                <div style={styles.metaLabel}>User key</div>
                <div style={styles.metaValue}>
                  {meta?.hasMetrcUserApiKey
                    ? meta.metrcUserKeyLength
                      ? `Saved on server (${meta.metrcUserKeyLength} characters)`
                      : "Saved on server"
                    : "Not provisioned — paste in Company Config and Save"}
                </div>
              </div>
              <div style={styles.metaItem}>
                <div style={styles.metaLabel}>Vendor key</div>
                <div style={styles.metaValue}>
                  {meta?.hasMetrcVendorApiKey
                    ? meta.metrcVendorKeyLength
                      ? `Saved (${meta.metrcVendorKeyLength} characters)`
                      : "Saved"
                    : "Missing"}
                </div>
              </div>
            </div>
          )}
        </section>

        <section style={styles.card}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>METRC status</h2>
          <div style={styles.metaGrid}>
            <div style={styles.metaItem}>
              <div style={styles.metaLabel}>Sandbox state</div>
              <div style={styles.metaValue}>
                {lastDiagnostics?.sandboxStatusLabel
                  || meta?.metrcSandboxUiStatus
                  || connectionLabel}
              </div>
            </div>
            <div style={styles.metaItem}>
              <div style={styles.metaLabel}>Provisioning complete</div>
              <div style={styles.metaValue}>
                {lastDiagnostics?.provisioningComplete ||
                meta?.metrcSandboxReady ||
                meta?.metrcOperationalAccessGranted
                  ? "Yes"
                  : "No"}
              </div>
            </div>
            <div style={styles.metaItem}>
              <div style={styles.metaLabel}>User creation pending</div>
              <div style={styles.metaValue}>
                {lastDiagnostics?.userCreationPending
                  ? "Yes — METRC may still be creating the sandbox user"
                  : sandboxUiStatus === "provisioning"
                    ? "Likely"
                    : "No"}
              </div>
            </div>
            <div style={styles.metaItem}>
              <div style={styles.metaLabel}>Operational access</div>
              <div style={styles.metaValue}>
                {lastDiagnostics?.operationalAccessGranted || meta?.metrcOperationalAccessGranted
                  ? "Granted"
                  : "Not granted"}
              </div>
            </div>
            <div style={styles.metaItem}>
              <div style={styles.metaLabel}>Last auth mode</div>
              <div style={styles.metaValue}>
                {lastDiagnostics?.lastAttemptedAuthMode
                  || meta?.metrcLastAuthAttemptMode
                  || "—"}
              </div>
            </div>
            <div style={styles.metaItem}>
              <div style={styles.metaLabel}>METRC HTTP status</div>
              <div style={styles.metaValue}>
                {resolveMetrcHttpStatus(meta, lastDiagnostics)}
              </div>
            </div>
            <div style={styles.metaItem}>
              <div style={styles.metaLabel}>METRC message</div>
              <div style={styles.metaValue}>
                {resolveMetrcDisplayMessage(meta, lastDiagnostics)}
              </div>
            </div>
            <div style={styles.metaItem}>
              <div style={styles.metaLabel}>Last connection test</div>
              <div style={styles.metaValue}>
                {formatCompanyTimestamp(testAt || meta?.metrcLastConnectionCheckedAt || "") || "—"}
              </div>
            </div>
            <div style={styles.metaItem}>
              <div style={styles.metaLabel}>Last facilities sync</div>
              <div style={styles.metaValue}>
                {formatCompanyTimestamp(meta?.metrcSandboxLastFacilitiesSyncAt || "") || "—"}
                {meta?.totalFacilitiesSynced != null
                  ? ` (${meta.totalFacilitiesSynced})`
                  : meta?.metrcSandboxLastFacilitiesCount != null
                    ? ` (${meta.metrcSandboxLastFacilitiesCount})`
                    : ""}
              </div>
            </div>
            <div style={styles.metaItem}>
              <div style={styles.metaLabel}>Last locations sync</div>
              <div style={styles.metaValue}>
                {formatCompanyTimestamp(
                  meta?.metrcLastLocationsSyncAt ||
                    meta?.lastLocationsSync ||
                    meta?.metrcSandboxLastRoomsSyncAt ||
                    "",
                ) || "—"}
                {meta?.metrcTotalLocationsSynced != null
                  ? ` (${meta.metrcTotalLocationsSynced})`
                  : meta?.totalLocationsSynced != null
                    ? ` (${meta.totalLocationsSynced})`
                    : meta?.metrcSandboxLastRoomsCount != null
                      ? ` (${meta.metrcSandboxLastRoomsCount})`
                      : ""}
              </div>
            </div>
            <div style={styles.metaItem}>
              <div style={styles.metaLabel}>Last strains sync</div>
              <div style={styles.metaValue}>
                {formatCompanyTimestamp(
                  meta?.metrcLastStrainsSyncAt ||
                    meta?.lastStrainsSync ||
                    meta?.metrcSandboxLastStrainsSyncAt ||
                    "",
                ) || "—"}
                {meta?.totalStrainsSynced != null
                  ? ` (${meta.totalStrainsSynced})`
                  : meta?.metrcSandboxLastStrainsCount != null
                    ? ` (${meta.metrcSandboxLastStrainsCount})`
                    : ""}
              </div>
            </div>
            <div style={styles.metaItem}>
              <div style={styles.metaLabel}>Last packages sync</div>
              <div style={styles.metaValue}>
                {formatCompanyTimestamp(
                  meta?.metrcLastPackagesSyncAt ||
                    meta?.lastPackagesSync ||
                    meta?.metrcSandboxLastPackagesSyncAt ||
                    "",
                ) || "—"}
                {meta?.totalPackagesSynced != null
                  ? ` (${meta.totalPackagesSynced})`
                  : meta?.metrcSandboxLastPackagesCount != null
                    ? ` (${meta.metrcSandboxLastPackagesCount})`
                    : ""}
              </div>
            </div>
            <div style={styles.metaItem}>
              <div style={styles.metaLabel}>Last plant batches sync</div>
              <div style={styles.metaValue}>
                {formatCompanyTimestamp(
                  meta?.metrcLastPlantBatchesSyncAt ||
                    meta?.lastPlantBatchesSync ||
                    meta?.metrcSandboxLastPlantBatchesSyncAt ||
                    "",
                ) || "—"}
                {meta?.totalPlantBatchesSynced != null
                  ? ` (${meta.totalPlantBatchesSynced})`
                  : meta?.metrcSandboxLastPlantBatchesCount != null
                    ? ` (${meta.metrcSandboxLastPlantBatchesCount})`
                    : ""}
              </div>
            </div>
            <div style={styles.metaItem}>
              <div style={styles.metaLabel}>Last harvests sync</div>
              <div style={styles.metaValue}>
                {formatCompanyTimestamp(
                  meta?.metrcLastHarvestsSyncAt ||
                    meta?.lastHarvestsSync ||
                    meta?.metrcSandboxLastHarvestsSyncAt ||
                    "",
                ) || "—"}
                {meta?.totalHarvestsSynced != null
                  ? ` (${meta.totalHarvestsSynced})`
                  : meta?.metrcSandboxLastHarvestsCount != null
                    ? ` (${meta.metrcSandboxLastHarvestsCount})`
                    : ""}
              </div>
            </div>
            <div style={styles.metaItem}>
              <div style={styles.metaLabel}>Last transfers sync</div>
              <div style={styles.metaValue}>
                {formatCompanyTimestamp(
                  meta?.metrcLastTransfersSyncAt ||
                    meta?.lastTransfersSync ||
                    meta?.metrcSandboxLastTransfersSyncAt ||
                    "",
                ) || "—"}
                {meta?.totalTransfersSynced != null
                  ? ` (${meta.totalTransfersSynced})`
                  : meta?.metrcSandboxLastTransfersCount != null
                    ? ` (${meta.metrcSandboxLastTransfersCount})`
                    : ""}
              </div>
            </div>
          </div>
          {rateWarn ? (
            <div style={styles.warn}>
              <strong>Rate limit:</strong> {rateWarn}
            </div>
          ) : null}
          {setupDebug ? (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 10,
                border: "1px solid #334155",
                background: "rgba(2, 6, 23, 0.8)",
                fontSize: 12,
                color: "#94a3b8",
              }}
            >
              <strong style={{ color: "#93c5fd" }}>Setup parser debug (development only)</strong>
              <pre
                style={{
                  marginTop: 8,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily: "ui-monospace, monospace",
                  color: "#cbd5e1",
                }}
              >
                {JSON.stringify(setupDebug, null, 2)}
              </pre>
            </div>
          ) : null}
        </section>

        <section style={styles.card}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Actions</h2>
          <div style={styles.row}>
            <button
              type="button"
              style={{ ...styles.btn, ...styles.btnPrimary, opacity: busy ? 0.6 : 1 }}
              disabled={!!busy || sandboxUiStatus === "provisioning"}
              onClick={() => void runSetup()}
            >
              {busy === "setup" || sandboxUiStatus === "provisioning"
                ? "Provisioning…"
                : "Generate Sandbox Facility"}
            </button>
            <button
              type="button"
              style={{ ...styles.btn, opacity: busy ? 0.6 : 1 }}
              disabled={!!busy}
              onClick={() => void runTestConnection()}
            >
              {busy === "test" ? "Testing…" : "Test Connection"}
            </button>
            <button
              type="button"
              style={{ ...styles.btn, opacity: busy ? 0.6 : 1 }}
              disabled={!!busy}
              onClick={() => void runFacilitiesSync()}
            >
              {busy === "facilities" ? "Pulling…" : "Pull Facilities"}
            </button>
            <button
              type="button"
              style={{ ...styles.btn, opacity: busy ? 0.6 : 1 }}
              disabled={!!busy}
              onClick={() => void runLocationsSync()}
            >
              {busy === "rooms" ? "Syncing…" : "Sync Locations/Rooms"}
            </button>
            <button
              type="button"
              style={{ ...styles.btn, opacity: busy ? 0.6 : 1 }}
              disabled={!!busy}
              onClick={() => void runStrainsSync()}
            >
              {busy === "strains" ? "Syncing…" : "Sync Strains"}
            </button>
            <button
              type="button"
              style={{ ...styles.btn, opacity: busy ? 0.6 : 1 }}
              disabled={!!busy}
              onClick={() => void runItemsSync()}
            >
              {busy === "items" ? "Syncing…" : "Sync Items"}
            </button>
            <button
              type="button"
              style={{ ...styles.btn, opacity: busy ? 0.6 : 1 }}
              disabled={!!busy}
              onClick={() => void runPackagesSync()}
            >
              {busy === "packages" ? "Syncing…" : "Sync Packages"}
            </button>
            <button
              type="button"
              style={{ ...styles.btn, opacity: busy ? 0.6 : 1 }}
              disabled={!!busy}
              onClick={() => void runPlantBatchesSync()}
            >
              {busy === "plantBatches" ? "Syncing…" : "Sync Plant Batches"}
            </button>
            <button
              type="button"
              style={{ ...styles.btn, opacity: busy ? 0.6 : 1 }}
              disabled={!!busy}
              onClick={() => void runHarvestsSync()}
            >
              {busy === "harvests" ? "Syncing…" : "Sync Harvests"}
            </button>
          </div>

          {(provisioningMessage || statusMsg) ? (
            <div
              style={
                statusMsg?.tone === "error" || sandboxUiStatus === "timeout" || sandboxUiStatus === "error"
                  ? styles.error
                  : statusMsg?.tone === "warn" || sandboxUiStatus === "provisioning"
                    ? styles.warn
                    : styles.ok
              }
            >
              {statusMsg?.text || provisioningMessage}
            </div>
          ) : null}

          {lastFacilities?.ok && lastFacilities.facilities && lastFacilities.facilities.length > 0 ? (
            <table style={styles.sampleTable}>
              <thead>
                <tr style={{ color: "#94a3b8", textAlign: "left" }}>
                  <th style={{ padding: "6px 8px" }}>License</th>
                  <th style={{ padding: "6px 8px" }}>Facility name</th>
                  <th style={{ padding: "6px 8px" }}>Facility type</th>
                  <th style={{ padding: "6px 8px" }}>Active</th>
                </tr>
              </thead>
              <tbody>
                {lastFacilities.facilities.map((row) => (
                  <tr key={row.licenseNumber} style={{ borderTop: "1px solid #334155" }}>
                    <td style={{ padding: "6px 8px", fontFamily: "ui-monospace, monospace" }}>
                      {row.licenseNumber}
                    </td>
                    <td style={{ padding: "6px 8px" }}>{row.facilityName || "—"}</td>
                    <td style={{ padding: "6px 8px" }}>
                      {formatMetrcFacilityTypeLabel(row) || "—"}
                    </td>
                    <td style={{ padding: "6px 8px" }}>{row.active ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {lastPull?.ok && lastPull.sample && lastPull.sample.length > 0 ? (
            <table style={styles.sampleTable}>
              <thead>
                <tr style={{ color: "#94a3b8", textAlign: "left" }}>
                  <th style={{ padding: "6px 8px" }}>ID</th>
                  <th style={{ padding: "6px 8px" }}>Name / label</th>
                </tr>
              </thead>
              <tbody>
                {lastPull.sample.slice(0, 10).map((row, i) => (
                  <tr key={i} style={{ borderTop: "1px solid #334155" }}>
                    <td style={{ padding: "6px 8px" }}>{String(row.id ?? "—")}</td>
                    <td style={{ padding: "6px 8px" }}>
                      {String(row.name ?? row.label ?? "—")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>

        <section style={styles.card}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>METRC strains</h2>
          <p style={{ margin: "8px 0 0", fontSize: 13, color: "#94a3b8" }}>
            Synced from <code style={{ color: "#cbd5e1" }}>GET /strains/v2/active</code>. Exact name
            matches link to NexBatch cultivation strains; unmatched METRC strains are added to Company
            Config automatically.
          </p>
          {strainsLoaded && strainsRows && strainsRows.length > 0 ? (
            <table style={styles.sampleTable}>
              <thead>
                <tr style={{ color: "#94a3b8", textAlign: "left" }}>
                  <th style={{ padding: "6px 8px" }}>METRC ID</th>
                  <th style={{ padding: "6px 8px" }}>Name</th>
                  <th style={{ padding: "6px 8px" }}>Testing status</th>
                  <th style={{ padding: "6px 8px" }}>Active</th>
                  <th style={{ padding: "6px 8px" }}>Archived</th>
                  <th style={{ padding: "6px 8px" }}>Last modified</th>
                  <th style={{ padding: "6px 8px" }}>NexBatch strain</th>
                </tr>
              </thead>
              <tbody>
                {strainsRows.map((row) => (
                  <tr key={row.metrcStrainId} style={{ borderTop: "1px solid #334155" }}>
                    <td style={{ padding: "6px 8px", fontFamily: "ui-monospace, monospace" }}>
                      {row.metrcStrainId}
                    </td>
                    <td style={{ padding: "6px 8px" }}>{row.name || "—"}</td>
                    <td style={{ padding: "6px 8px" }}>{row.testingStatus || "—"}</td>
                    <td style={{ padding: "6px 8px" }}>{row.active ? "Yes" : "No"}</td>
                    <td style={{ padding: "6px 8px" }}>{row.archived ? "Yes" : "No"}</td>
                    <td style={{ padding: "6px 8px" }}>
                      {row.lastModified
                        ? formatCompanyTimestamp(row.lastModified) || row.lastModified
                        : "—"}
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      {row.nexbatchStrainLabel || row.nexbatchStrainId || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : lastStrainsSync?.ok && strainsRows?.length === 0 ? (
            <p style={{ marginTop: 12, color: "#94a3b8", fontSize: 13 }}>
              Strains sync completed successfully with 0 active strains in METRC.
            </p>
          ) : strainsLoaded ? (
            <p style={{ marginTop: 12, color: "#94a3b8", fontSize: 13 }}>
              No strains stored yet. Use Sync Strains above, or create a test strain below when METRC
              has zero active strains.
            </p>
          ) : (
            <p style={{ marginTop: 12, color: "#94a3b8", fontSize: 13 }}>Loading saved strains…</p>
          )}

          <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid #334155" }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Create test strain</h3>
            <div style={styles.warn}>
              <strong>Sandbox only.</strong> POSTs a strain to METRC sandbox via{" "}
              <code style={{ color: "#cbd5e1" }}>POST /strains/v2/create</code>. Duplicate names reuse
              the existing NexBatch record.
            </div>
            {!isSandboxEnvironment && !loadingMeta ? (
              <p style={{ marginTop: 12, color: "#f87171", fontSize: 13 }}>
                METRC environment is not sandbox. Switch to sandbox in Company Config to enable creation.
              </p>
            ) : null}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                gap: 12,
                marginTop: 14,
              }}
            >
              <label style={{ fontSize: 13 }}>
                <span style={{ color: "#94a3b8" }}>Strain name</span>
                <input
                  type="text"
                  value={createStrainName}
                  onChange={(e) => setCreateStrainName(e.target.value)}
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: 4,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid #475569",
                    background: "#0f172a",
                    color: "#e2e8f0",
                  }}
                />
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ color: "#94a3b8" }}>Testing status (optional)</span>
                <select
                  value={createStrainTestingStatus}
                  onChange={(e) => setCreateStrainTestingStatus(e.target.value)}
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: 4,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid #475569",
                    background: "#0f172a",
                    color: "#e2e8f0",
                  }}
                >
                  {METRC_STRAIN_TESTING_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ color: "#94a3b8" }}>Indica %</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={createStrainIndicaPct}
                  onChange={(e) => setCreateStrainIndicaPct(e.target.value)}
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: 4,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid #475569",
                    background: "#0f172a",
                    color: "#e2e8f0",
                  }}
                />
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ color: "#94a3b8" }}>Sativa %</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={createStrainSativaPct}
                  onChange={(e) => setCreateStrainSativaPct(e.target.value)}
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: 4,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid #475569",
                    background: "#0f172a",
                    color: "#e2e8f0",
                  }}
                />
              </label>
            </div>
            {createStrainPct.total !== null && !createStrainPct.valid ? (
              <p style={{ marginTop: 10, fontSize: 13, color: "#f87171" }}>
                Indica % and Sativa % must sum to 100 (currently {createStrainPct.total}).
              </p>
            ) : null}
            <div style={{ ...styles.row, marginTop: 12 }}>
              <button
                type="button"
                style={{
                  ...styles.btn,
                  ...styles.btnPrimary,
                  opacity: busy || !isSandboxEnvironment || !createStrainPct.valid ? 0.6 : 1,
                }}
                disabled={
                  !!busy ||
                  !isSandboxEnvironment ||
                  !createStrainName.trim() ||
                  !createStrainPct.valid
                }
                onClick={() => setCreateStrainConfirmOpen(true)}
              >
                {busy === "createStrain" ? "Creating…" : "Create Test Strain"}
              </button>
            </div>
            {createStrainConfirmOpen ? (
              <div
                style={{
                  marginTop: 14,
                  padding: 14,
                  borderRadius: 10,
                  border: "1px solid rgba(248, 113, 113, 0.45)",
                  background: "rgba(69, 10, 10, 0.35)",
                }}
              >
                <p style={{ margin: "0 0 10px", fontWeight: 700, color: "#fecaca" }}>
                  Confirm METRC sandbox write
                </p>
                <p style={{ margin: "0 0 12px", fontSize: 13, color: "#fca5a5" }}>
                  Create strain &quot;{createStrainName.trim()}&quot; (testing status:{" "}
                  {createStrainTestingStatus || "None"}, Indica {createStrainPct.indica}% / Sativa{" "}
                  {createStrainPct.sativa}%) in METRC sandbox?
                </p>
                <div style={styles.row}>
                  <button
                    type="button"
                    style={{ ...styles.btn, ...styles.btnPrimary }}
                    onClick={() => void runCreateTestStrain()}
                  >
                    Yes, create in METRC
                  </button>
                  <button
                    type="button"
                    style={styles.btn}
                    onClick={() => setCreateStrainConfirmOpen(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
            {lastCreateStrain ? (
              <div
                style={{
                  marginTop: 12,
                  padding: 12,
                  borderRadius: 10,
                  border: "1px solid #334155",
                  background: "rgba(2, 6, 23, 0.8)",
                  fontSize: 12,
                  color: "#94a3b8",
                }}
              >
                <strong style={{ color: lastCreateStrain.ok ? "#4ade80" : "#f87171" }}>
                  Last create attempt ({lastCreateStrain.status ?? "—"})
                  {lastCreateStrain.alreadyExists ? " · existing strain reused" : ""}
                </strong>
                <pre
                  style={{
                    marginTop: 8,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontFamily: "ui-monospace, monospace",
                    color: "#cbd5e1",
                  }}
                >
                  {JSON.stringify(
                    {
                      message: lastCreateStrain.message,
                      endpoint: lastCreateStrain.endpoint,
                      request: lastCreateStrain.requestPayload,
                      response: lastCreateStrain.responsePayload,
                    },
                    null,
                    2,
                  )}
                </pre>
              </div>
            ) : null}
          </div>
        </section>

        <section style={styles.card}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>METRC plant batches</h2>
          <p style={{ margin: "8px 0 0", fontSize: 13, color: "#94a3b8" }}>
            Synced from <code style={{ color: "#cbd5e1" }}>GET /plantbatches/v2/active</code> using
            the selected facility license and modified-date pagination. Supports Clone → Veg
            workflows in sandbox.
          </p>
          {plantBatchesLoaded && plantBatchesRows && plantBatchesRows.length > 0 ? (
            <table style={styles.sampleTable}>
              <thead>
                <tr style={{ color: "#94a3b8", textAlign: "left" }}>
                  <th style={{ padding: "6px 8px" }}>METRC ID</th>
                  <th style={{ padding: "6px 8px" }}>Batch name</th>
                  <th style={{ padding: "6px 8px" }}>Strain</th>
                  <th style={{ padding: "6px 8px" }}>Count</th>
                  <th style={{ padding: "6px 8px" }}>Location</th>
                  <th style={{ padding: "6px 8px" }}>Planted date</th>
                  <th style={{ padding: "6px 8px" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {plantBatchesRows.map((row) => (
                  <tr key={row.metrcPlantBatchId} style={{ borderTop: "1px solid #334155" }}>
                    <td style={{ padding: "6px 8px", fontFamily: "ui-monospace, monospace" }}>
                      {row.metrcPlantBatchId}
                      {row.createdViaTest ? (
                        <span
                          style={{
                            marginLeft: 6,
                            fontSize: 10,
                            color: "#fbbf24",
                            fontWeight: 700,
                          }}
                        >
                          TEST
                        </span>
                      ) : null}
                    </td>
                    <td style={{ padding: "6px 8px" }}>{row.name || "—"}</td>
                    <td style={{ padding: "6px 8px" }}>{row.strainName || "—"}</td>
                    <td style={{ padding: "6px 8px" }}>{row.count}</td>
                    <td style={{ padding: "6px 8px" }}>
                      {row.locationName || row.metrcLocationId || "—"}
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      {row.plantedDate
                        ? formatCompanyTimestamp(row.plantedDate) || row.plantedDate.slice(0, 10)
                        : "—"}
                    </td>
                    <td style={{ padding: "6px 8px" }}>{row.active ? "Active" : "Inactive"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : lastPlantBatchesSync?.ok && plantBatchesRows?.length === 0 ? (
            <p style={{ marginTop: 12, color: "#94a3b8", fontSize: 13 }}>
              Plant batches sync completed successfully with 0 active batches in METRC.
            </p>
          ) : plantBatchesLoaded ? (
            <p style={{ marginTop: 12, color: "#94a3b8", fontSize: 13 }}>
              No plant batches stored yet. Use Sync Plant Batches above to pull from METRC.
            </p>
          ) : (
            <p style={{ marginTop: 12, color: "#94a3b8", fontSize: 13 }}>Loading saved plant batches…</p>
          )}
        </section>

        <section style={styles.card}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Create test plant batch</h2>
          <div style={styles.warn}>
            <strong>Sandbox only.</strong> This POSTs an immature clone planting to METRC sandbox. It
            is not wired into production Clone → Veg workflows. Confirm before submitting.
          </div>
          {!isSandboxEnvironment && !loadingMeta ? (
            <p style={{ marginTop: 12, color: "#f87171", fontSize: 13 }}>
              METRC environment is not sandbox. Switch to sandbox in Company Config to enable creation.
            </p>
          ) : null}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: 12,
              marginTop: 14,
            }}
          >
            <label style={{ fontSize: 13 }}>
              <span style={{ color: "#94a3b8" }}>Batch name</span>
              <input
                type="text"
                value={createBatchName}
                onChange={(e) => setCreateBatchName(e.target.value)}
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #475569",
                  background: "#0f172a",
                  color: "#e2e8f0",
                }}
              />
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ color: "#94a3b8" }}>Strain</span>
              <input
                type="text"
                list="metrc-strain-options"
                value={createBatchStrain}
                onChange={(e) => setCreateBatchStrain(e.target.value)}
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #475569",
                  background: "#0f172a",
                  color: "#e2e8f0",
                }}
              />
              <datalist id="metrc-strain-options">
                {(strainsRows ?? []).map((s) => (
                  <option key={s.metrcStrainId} value={s.name} />
                ))}
              </datalist>
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ color: "#94a3b8" }}>Count</span>
              <input
                type="number"
                min={1}
                value={createBatchCount}
                onChange={(e) => setCreateBatchCount(e.target.value)}
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #475569",
                  background: "#0f172a",
                  color: "#e2e8f0",
                }}
              />
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ color: "#94a3b8" }}>Planting date</span>
              <input
                type="date"
                value={createBatchPlantingDate}
                onChange={(e) => setCreateBatchPlantingDate(e.target.value)}
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #475569",
                  background: "#0f172a",
                  color: "#e2e8f0",
                }}
              />
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ color: "#94a3b8" }}>NexBatch veg room (METRC location)</span>
              <select
                value={createBatchRoomValue}
                onChange={(e) => setCreateBatchRoomValue(e.target.value)}
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #475569",
                  background: "#0f172a",
                  color: "#e2e8f0",
                }}
              >
                <option value="">Select mapped veg room…</option>
                {vegRoomOptions.map((room) => (
                  <option
                    key={`${room.suite}:${room.roomId}`}
                    value={`${room.suite}:${room.roomId}`}
                  >
                    {formatNexbatchRoomOptionLabel(room)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ ...styles.row, marginTop: 12 }}>
            <button
              type="button"
              style={{
                ...styles.btn,
                ...styles.btnPrimary,
                opacity: busy || !isSandboxEnvironment ? 0.6 : 1,
              }}
              disabled={
                !!busy ||
                !isSandboxEnvironment ||
                !createBatchName.trim() ||
                !createBatchStrain.trim() ||
                !createBatchRoomValue
              }
              onClick={() => setCreateBatchConfirmOpen(true)}
            >
              {busy === "createPlantBatch" ? "Creating…" : "Create Test Plant Batch"}
            </button>
          </div>
          {createBatchConfirmOpen ? (
            <div
              style={{
                marginTop: 14,
                padding: 14,
                borderRadius: 10,
                border: "1px solid rgba(248, 113, 113, 0.45)",
                background: "rgba(69, 10, 10, 0.35)",
              }}
            >
              <p style={{ margin: "0 0 10px", fontWeight: 700, color: "#fecaca" }}>
                Confirm METRC sandbox write
              </p>
              <p style={{ margin: "0 0 12px", fontSize: 13, color: "#fca5a5" }}>
                Create immature clone batch &quot;{createBatchName.trim()}&quot; ({createBatchCount}{" "}
                × {createBatchStrain.trim()}) at mapped room? This cannot be undone from NexBatch.
              </p>
              <div style={styles.row}>
                <button
                  type="button"
                  style={{ ...styles.btn, ...styles.btnPrimary }}
                  onClick={() => void runCreateTestPlantBatch()}
                >
                  Yes, create in METRC
                </button>
                <button
                  type="button"
                  style={styles.btn}
                  onClick={() => setCreateBatchConfirmOpen(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
          {lastCreatePlantBatch ? (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 10,
                border: "1px solid #334155",
                background: "rgba(2, 6, 23, 0.8)",
                fontSize: 12,
                color: "#94a3b8",
              }}
            >
              <strong style={{ color: lastCreatePlantBatch.ok ? "#4ade80" : "#f87171" }}>
                Last create attempt ({lastCreatePlantBatch.status ?? "—"})
              </strong>
              <pre
                style={{
                  marginTop: 8,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily: "ui-monospace, monospace",
                  color: "#cbd5e1",
                }}
              >
                {JSON.stringify(
                  {
                    message: lastCreatePlantBatch.message,
                    endpoint: lastCreatePlantBatch.endpoint,
                    request: lastCreatePlantBatch.requestPayload,
                    response: lastCreatePlantBatch.responsePayload,
                  },
                  null,
                  2,
                )}
              </pre>
            </div>
          ) : null}
        </section>

        <section style={styles.card}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>METRC Lab Results</h2>
          <p style={{ margin: "8px 0 0", fontSize: 13, color: "#94a3b8" }}>
            Sandbox only. Syncs lab test types from{" "}
            <code style={{ color: "#cbd5e1" }}>GET /labtests/v2/types</code> and records package
            lab results with <code style={{ color: "#cbd5e1" }}>POST /labtests/v2/record</code>{" "}
            using license <code style={{ color: "#cbd5e1" }}>{METRC_LAB_TEST_LICENSE}</code>.
          </p>
          {!isSandboxEnvironment && !loadingMeta ? (
            <p style={{ marginTop: 12, color: "#f87171", fontSize: 13 }}>
              METRC environment is not sandbox. Switch to sandbox in Company Config to enable lab
              result testing.
            </p>
          ) : null}
          {packagesLoaded && !(packagesRows?.length ?? 0) ? (
            <p style={{ marginTop: 12, color: "#fbbf24", fontSize: 13 }}>
              Sync METRC packages first — select the package tag from synced packages.
            </p>
          ) : null}
          <div style={{ ...styles.row, marginTop: 12 }}>
            <button
              type="button"
              style={styles.btn}
              disabled={!!busy}
              onClick={() => void runSyncLabTestTypes()}
            >
              {busy === "labTestTypes" ? "Syncing…" : "Sync Lab Test Types"}
            </button>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: 12,
              marginTop: 14,
            }}
          >
            <label style={{ fontSize: 13 }}>
              <span style={{ color: "#94a3b8" }}>Package tag</span>
              <select
                value={labResultPackageLabel}
                onChange={(e) => setLabResultPackageLabel(e.target.value)}
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #475569",
                  background: "#0f172a",
                  color: "#e2e8f0",
                }}
              >
                <option value="">Select package tag…</option>
                {(packagesRows ?? []).map((pkg) => (
                  <option key={pkg.packageLabel} value={pkg.packageLabel}>
                    {pkg.packageLabel} {pkg.itemName ? `- ${pkg.itemName}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ color: "#94a3b8" }}>Result date</span>
              <input
                type="date"
                value={labResultDate}
                onChange={(e) => setLabResultDate(e.target.value)}
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #475569",
                  background: "#0f172a",
                  color: "#e2e8f0",
                }}
              />
            </label>
          </div>
          <div style={{ marginTop: 14 }}>
            <strong style={{ color: "#e2e8f0", fontSize: 13 }}>Lab test results</strong>
            <div style={{ marginTop: 8, display: "grid", gap: 10 }}>
              {labResultRows.map((row, index) => (
                <div
                  key={row.id}
                  style={{
                    border: "1px solid #334155",
                    borderRadius: 10,
                    padding: 10,
                    background: "rgba(15, 23, 42, 0.6)",
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                      gap: 10,
                    }}
                  >
                    <label style={{ fontSize: 13 }}>
                      <span style={{ color: "#94a3b8" }}>Lab Test Type Name</span>
                      <select
                        value={row.labTestTypeName}
                        onChange={(e) =>
                          updateLabResultRow(row.id, { labTestTypeName: e.target.value })
                        }
                        style={{
                          display: "block",
                          width: "100%",
                          marginTop: 4,
                          padding: "8px 10px",
                          borderRadius: 8,
                          border: "1px solid #475569",
                          background: "#0f172a",
                          color: "#e2e8f0",
                        }}
                      >
                        <option value="">
                          {labTestTypeNames.length ? "Select lab test type…" : "Sync lab test types first…"}
                        </option>
                        {labTestTypeNames.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label style={{ fontSize: 13 }}>
                      <span style={{ color: "#94a3b8" }}>Quantity</span>
                      <input
                        type="number"
                        min={0.000001}
                        step="any"
                        value={row.quantity}
                        onChange={(e) => updateLabResultRow(row.id, { quantity: e.target.value })}
                        style={{
                          display: "block",
                          width: "100%",
                          marginTop: 4,
                          padding: "8px 10px",
                          borderRadius: 8,
                          border: "1px solid #475569",
                          background: "#0f172a",
                          color: "#e2e8f0",
                        }}
                      />
                    </label>
                    <label style={{ fontSize: 13 }}>
                      <span style={{ color: "#94a3b8" }}>Passed</span>
                      <select
                        value={row.passed ? "true" : "false"}
                        onChange={(e) => updateLabResultRow(row.id, { passed: e.target.value === "true" })}
                        style={{
                          display: "block",
                          width: "100%",
                          marginTop: 4,
                          padding: "8px 10px",
                          borderRadius: 8,
                          border: "1px solid #475569",
                          background: "#0f172a",
                          color: "#e2e8f0",
                        }}
                      >
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                    </label>
                    <label style={{ fontSize: 13, gridColumn: "1 / -1" }}>
                      <span style={{ color: "#94a3b8" }}>Notes (optional)</span>
                      <input
                        type="text"
                        value={row.notes}
                        onChange={(e) => updateLabResultRow(row.id, { notes: e.target.value })}
                        placeholder={DEFAULT_LAB_RESULT_NOTES}
                        style={{
                          display: "block",
                          width: "100%",
                          marginTop: 4,
                          padding: "8px 10px",
                          borderRadius: 8,
                          border: "1px solid #475569",
                          background: "#0f172a",
                          color: "#e2e8f0",
                        }}
                      />
                    </label>
                  </div>
                  <div style={{ ...styles.row, marginTop: 8 }}>
                    <span style={{ fontSize: 12, color: "#94a3b8" }}>Result #{index + 1}</span>
                    <button
                      type="button"
                      style={styles.btn}
                      disabled={labResultRows.length <= 1}
                      onClick={() => removeLabResultRow(row.id)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ ...styles.row, marginTop: 10 }}>
              <button type="button" style={styles.btn} onClick={addLabResultRow} disabled={!!busy}>
                Add Lab Result
              </button>
            </div>
          </div>
          {labTestTypesHint ? (
            <p style={{ marginTop: 8, fontSize: 12, color: "#94a3b8" }}>{labTestTypesHint}</p>
          ) : null}
          <div style={{ ...styles.row, marginTop: 12 }}>
            <button
              type="button"
              style={{
                ...styles.btn,
                ...styles.btnPrimary,
                opacity:
                  busy ||
                  !isSandboxEnvironment ||
                  !labResultPackageLabel.trim() ||
                  !labResultDate.trim() ||
                  !labTestTypeNames.length
                    ? 0.6
                    : 1,
              }}
              disabled={
                !!busy ||
                !isSandboxEnvironment ||
                !labResultPackageLabel.trim() ||
                !labResultDate.trim() ||
                !labTestTypeNames.length
              }
              onClick={() => void runRecordLabTestResult()}
            >
              {busy === "labTestRecord" ? "Recording…" : "Record Lab Test Result"}
            </button>
          </div>
          {lastLabTestRecord ? (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 10,
                border: "1px solid #334155",
                background: "rgba(2, 6, 23, 0.8)",
                fontSize: 12,
                color: "#94a3b8",
              }}
            >
              <strong style={{ color: lastLabTestRecord.ok ? "#4ade80" : "#f87171" }}>
                Last lab result attempt ({lastLabTestRecord.status ?? "—"})
              </strong>
              <pre
                style={{
                  marginTop: 8,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily: "ui-monospace, monospace",
                  color: "#cbd5e1",
                }}
              >
                {JSON.stringify(
                  {
                    message: lastLabTestRecord.message,
                    endpoint: lastLabTestRecord.endpoint || "/labtests/v2/record",
                    authDiagnostics:
                      lastLabTestRecord.authEvidence ??
                      (lastLabTestRecord.requestDebug
                        ? {
                            endpoint: "/labtests/v2/record",
                            finalLicenseNumber:
                              lastLabTestRecord.requestDebug.licenseNumber || METRC_LAB_TEST_LICENSE,
                            authMode: lastLabTestRecord.requestDebug.authMode,
                            baseUrl: lastLabTestRecord.requestDebug.baseUrl,
                            exactPayload: lastLabTestRecord.requestDebug.payloadBody,
                            selectedPackageLabel: labResultPackageLabel.trim() || null,
                            packageFacilityLicense: null,
                            labTestTypesSourceLicense:
                              labTestTypesSourceLicense || METRC_LAB_TEST_LICENSE,
                            sameAuthUsedByEndpoints: [
                              "GET /labtests/v2/types",
                              "POST /plantbatches/v2/plantings",
                              "POST /plantbatches/v2/packages",
                              "POST /plantbatches/v2/growthphase",
                              "DELETE /plantbatches/v2/",
                            ],
                          }
                        : undefined),
                    requestDebug: lastLabTestRecord.requestDebug,
                    request: lastLabTestRecord.requestPayload,
                    response: lastLabTestRecord.responsePayload,
                  },
                  null,
                  2,
                )}
              </pre>
            </div>
          ) : null}
        </section>

        <section style={styles.card}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Create package from mother plant</h2>
          <p style={{ margin: "8px 0 0", fontSize: 13, color: "#94a3b8" }}>
            Sandbox only. Creates an immature plant package from a synced vegetative or flowering
            mother plant using{" "}
            <code style={{ color: "#cbd5e1" }}>POST /plantbatches/v2/packages/frommotherplant</code>.
            Do not use immature plant batch names as the source — pick a tagged veg/flower plant.
          </p>
          {!isSandboxEnvironment && !loadingMeta ? (
            <p style={{ marginTop: 12, color: "#f87171", fontSize: 13 }}>
              METRC environment is not sandbox. Switch to sandbox in Company Config to enable creation.
            </p>
          ) : null}
          {itemsLoaded && !(itemsRows?.length ?? 0) ? (
            <p style={{ marginTop: 12, color: "#fbbf24", fontSize: 13 }}>
              Sync METRC items first — an item is required for from-mother-plant packages.
            </p>
          ) : null}
          {motherSourcePlantsLoaded && motherEligiblePlants.length === 0 ? (
            <p style={{ marginTop: 12, color: "#fbbf24", fontSize: 13 }}>
              No vegetative or flowering plants in NexBatch yet. Run Sync METRC Plants, then reload
              mother plant options.
            </p>
          ) : null}
          <div style={{ ...styles.row, marginTop: 12 }}>
            <button
              type="button"
              style={styles.btn}
              disabled={!!busy}
              onClick={() => void loadMotherSourcePlants()}
            >
              {motherSourcePlantsLoaded ? "Reload mother plants" : "Load mother plants"}
            </button>
            <button
              type="button"
              style={styles.btn}
              disabled={!!busy}
              onClick={() => void runSyncPlants()}
            >
              {busy === "plants" ? "Syncing plants…" : "Sync METRC plants"}
            </button>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: 12,
              marginTop: 14,
            }}
          >
            <label style={{ fontSize: 13 }}>
              <span style={{ color: "#94a3b8" }}>Source plant (veg / flower)</span>
              <select
                value={motherPackageSourcePlantLabel}
                onChange={(e) => setMotherPackageSourcePlantLabel(e.target.value)}
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #475569",
                  background: "#0f172a",
                  color: "#e2e8f0",
                }}
              >
                <option value="">Select plant label…</option>
                {motherEligiblePlants.map((plant) => (
                  <option key={plant.label} value={plant.label}>
                    {plant.label}
                    {plant.growthPhase ? ` · ${plant.growthPhase}` : ""}
                    {plant.strainName ? ` · ${plant.strainName}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ color: "#94a3b8" }}>Item</span>
              <select
                value={motherPackageItemId}
                onChange={(e) => setMotherPackageItemId(e.target.value)}
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #475569",
                  background: "#0f172a",
                  color: "#e2e8f0",
                }}
              >
                <option value="">Select item…</option>
                {(itemsRows ?? []).map((item) => (
                  <option key={item.metrcItemId} value={item.metrcItemId}>
                    {item.itemName}
                    {item.categoryName ? ` (${item.categoryName})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ color: "#94a3b8" }}>Package tag</span>
              <input
                type="text"
                value={motherPackageTag}
                onChange={(e) => setMotherPackageTag(e.target.value)}
                placeholder="METRC package tag (not a plant tag)"
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #475569",
                  background: "#0f172a",
                  color: "#e2e8f0",
                }}
              />
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ color: "#94a3b8" }}>Quantity</span>
              <input
                type="number"
                min={1}
                value={motherPackageCount}
                onChange={(e) => setMotherPackageCount(e.target.value)}
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #475569",
                  background: "#0f172a",
                  color: "#e2e8f0",
                }}
              />
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ color: "#94a3b8" }}>Packaged date</span>
              <input
                type="date"
                value={motherPackageDate}
                onChange={(e) => setMotherPackageDate(e.target.value)}
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #475569",
                  background: "#0f172a",
                  color: "#e2e8f0",
                }}
              />
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ color: "#94a3b8" }}>Location (optional)</span>
              <select
                value={motherPackageLocationId}
                onChange={(e) => setMotherPackageLocationId(e.target.value)}
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #475569",
                  background: "#0f172a",
                  color: "#e2e8f0",
                }}
              >
                <option value="">METRC default</option>
                {(locationsRows ?? []).map((loc) => (
                  <option key={loc.metrcLocationId} value={loc.metrcLocationId}>
                    {loc.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {motherPackageTagsHint ? (
            <p style={{ marginTop: 8, fontSize: 12, color: "#94a3b8" }}>{motherPackageTagsHint}</p>
          ) : null}
          {motherPackageDebugPreview ? (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 10,
                border: "1px solid #334155",
                background: "rgba(15, 23, 42, 0.6)",
                fontSize: 12,
                color: "#cbd5e1",
              }}
            >
              <strong style={{ color: "#e2e8f0" }}>Request preview</strong>
              <pre
                style={{
                  marginTop: 8,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily: "ui-monospace, monospace",
                }}
              >
                {JSON.stringify(motherPackageDebugPreview, null, 2)}
              </pre>
            </div>
          ) : null}
          <div style={{ ...styles.row, marginTop: 12 }}>
            <button
              type="button"
              style={styles.btn}
              disabled={!!busy}
              onClick={() => void fetchMotherPackageTag()}
            >
              {busy === "motherPackageTags" ? "Fetching…" : "Fetch available package tag"}
            </button>
            <button
              type="button"
              style={{
                ...styles.btn,
                ...styles.btnPrimary,
                opacity:
                  busy ||
                  !isSandboxEnvironment ||
                  !motherPackageSourcePlantLabel ||
                  !motherPackageItemId.trim() ||
                  !motherPackageTag.trim()
                    ? 0.6
                    : 1,
              }}
              disabled={
                !!busy ||
                !isSandboxEnvironment ||
                !motherPackageSourcePlantLabel ||
                !motherPackageItemId.trim() ||
                !motherPackageTag.trim() ||
                Number.parseInt(motherPackageCount, 10) < 1
              }
              onClick={() => void runCreateMotherPlantPackage()}
            >
              {busy === "motherPlantPackage" ? "Creating…" : "Create Mother Plant Package"}
            </button>
          </div>
          {lastMotherPlantPackage ? (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 10,
                border: "1px solid #334155",
                background: "rgba(2, 6, 23, 0.8)",
                fontSize: 12,
                color: "#94a3b8",
              }}
            >
              <strong style={{ color: lastMotherPlantPackage.ok ? "#4ade80" : "#f87171" }}>
                Last create attempt ({lastMotherPlantPackage.status ?? "—"})
              </strong>
              <pre
                style={{
                  marginTop: 8,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily: "ui-monospace, monospace",
                  color: "#cbd5e1",
                }}
              >
                {JSON.stringify(
                  {
                    message: lastMotherPlantPackage.message,
                    endpoint:
                      lastMotherPlantPackage.endpoint ||
                      "/plantbatches/v2/packages/frommotherplant",
                    debug:
                      lastMotherPlantPackage.debug ?? lastMotherPlantPackage.requestDebug,
                    authEvidence: lastMotherPlantPackage.authEvidence,
                    requestDebug: lastMotherPlantPackage.requestDebug,
                    request: lastMotherPlantPackage.requestPayload,
                    response: lastMotherPlantPackage.responsePayload,
                  },
                  null,
                  2,
                )}
              </pre>
            </div>
          ) : null}
        </section>

        <section style={styles.card}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Create package from plant batch</h2>
          <p style={{ margin: "8px 0 0", fontSize: 13, color: "#94a3b8" }}>
            Sandbox only. Creates a package from an existing METRC plant batch using{" "}
            <code style={{ color: "#cbd5e1" }}>POST /plantbatches/v2/packages</code> for METRC
            Generic Evaluation Plant Batches Step 3.
          </p>
          {!isSandboxEnvironment && !loadingMeta ? (
            <p style={{ marginTop: 12, color: "#f87171", fontSize: 13 }}>
              METRC environment is not sandbox. Switch to sandbox in Company Config to enable creation.
            </p>
          ) : null}
          {itemsLoaded && !(itemsRows?.length ?? 0) ? (
            <p style={{ marginTop: 12, color: "#fbbf24", fontSize: 13 }}>
              Sync METRC items first — an item is required for plant batch packages.
            </p>
          ) : null}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: 12,
              marginTop: 14,
            }}
          >
            <label style={{ fontSize: 13 }}>
              <span style={{ color: "#94a3b8" }}>Source plant batch</span>
              <select
                value={plantBatchPackagePlantBatchId}
                onChange={(e) => setPlantBatchPackagePlantBatchId(e.target.value)}
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #475569",
                  background: "#0f172a",
                  color: "#e2e8f0",
                }}
              >
                <option value="">Select plant batch…</option>
                {(plantBatchesRows ?? []).map((batch) => (
                  <option key={batch.metrcPlantBatchId} value={batch.metrcPlantBatchId}>
                    {batch.name || batch.metrcPlantBatchId}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ color: "#94a3b8" }}>Item</span>
              <select
                value={plantBatchPackageItemId}
                onChange={(e) => setPlantBatchPackageItemId(e.target.value)}
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #475569",
                  background: "#0f172a",
                  color: "#e2e8f0",
                }}
              >
                <option value="">Select item…</option>
                {(itemsRows ?? []).map((item) => (
                  <option key={item.metrcItemId} value={item.metrcItemId}>
                    {item.itemName}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ color: "#94a3b8" }}>Package tag / label</span>
              <input
                type="text"
                value={plantBatchPackageTag}
                onChange={(e) => setPlantBatchPackageTag(e.target.value)}
                placeholder="Unused METRC package tag"
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #475569",
                  background: "#0f172a",
                  color: "#e2e8f0",
                }}
              />
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ color: "#94a3b8" }}>Quantity</span>
              <input
                type="number"
                min={1}
                value={plantBatchPackageCount}
                onChange={(e) => setPlantBatchPackageCount(e.target.value)}
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #475569",
                  background: "#0f172a",
                  color: "#e2e8f0",
                }}
              />
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ color: "#94a3b8" }}>Packaged date</span>
              <input
                type="date"
                value={plantBatchPackageDate}
                onChange={(e) => setPlantBatchPackageDate(e.target.value)}
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #475569",
                  background: "#0f172a",
                  color: "#e2e8f0",
                }}
              />
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ color: "#94a3b8" }}>Location (optional)</span>
              <select
                value={plantBatchPackageLocationId}
                onChange={(e) => setPlantBatchPackageLocationId(e.target.value)}
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #475569",
                  background: "#0f172a",
                  color: "#e2e8f0",
                }}
              >
                <option value="">METRC default</option>
                {(locationsRows ?? []).map((loc) => (
                  <option key={loc.metrcLocationId} value={loc.metrcLocationId}>
                    {loc.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 13, gridColumn: "1 / -1" }}>
              <span style={{ color: "#94a3b8" }}>Note (optional)</span>
              <input
                type="text"
                value={plantBatchPackageNote}
                onChange={(e) => setPlantBatchPackageNote(e.target.value)}
                placeholder="Optional package note"
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #475569",
                  background: "#0f172a",
                  color: "#e2e8f0",
                }}
              />
            </label>
          </div>
          <div style={{ ...styles.row, marginTop: 12 }}>
            <button
              type="button"
              style={{
                ...styles.btn,
                ...styles.btnPrimary,
                opacity:
                  busy ||
                  !isSandboxEnvironment ||
                  !plantBatchPackagePlantBatchId ||
                  !plantBatchPackageItemId.trim() ||
                  !plantBatchPackageTag.trim()
                    ? 0.6
                    : 1,
              }}
              disabled={
                !!busy ||
                !isSandboxEnvironment ||
                !plantBatchPackagePlantBatchId ||
                !plantBatchPackageItemId.trim() ||
                !plantBatchPackageTag.trim() ||
                Number.parseInt(plantBatchPackageCount, 10) < 1
              }
              onClick={() => void runCreatePlantBatchPackage()}
            >
              {busy === "plantBatchPackage" ? "Creating…" : "Create Plant Batch Package"}
            </button>
          </div>
          {lastPlantBatchPackage ? (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 10,
                border: "1px solid #334155",
                background: "rgba(2, 6, 23, 0.8)",
                fontSize: 12,
                color: "#94a3b8",
              }}
            >
              <strong style={{ color: lastPlantBatchPackage.ok ? "#4ade80" : "#f87171" }}>
                Last create attempt ({lastPlantBatchPackage.status ?? "—"})
              </strong>
              <pre
                style={{
                  marginTop: 8,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily: "ui-monospace, monospace",
                  color: "#cbd5e1",
                }}
              >
                {JSON.stringify(
                  {
                    message: lastPlantBatchPackage.message,
                    endpoint:
                      lastPlantBatchPackage.endpoint || "/plantbatches/v2/packages",
                    requestDebug: lastPlantBatchPackage.requestDebug,
                    request: lastPlantBatchPackage.requestPayload,
                    response: lastPlantBatchPackage.responsePayload,
                  },
                  null,
                  2,
                )}
              </pre>
            </div>
          ) : null}
        </section>

        <section style={styles.card}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Change plant batch growth phase</h2>
          <p style={{ margin: "8px 0 0", fontSize: 13, color: "#94a3b8" }}>
            Sandbox only. Changes growth phase for a synced METRC plant batch using{" "}
            <code style={{ color: "#cbd5e1" }}>POST /plantbatches/v2/growthphase</code> for METRC
            Generic Evaluation Plant Batches Step 4.
          </p>
          {!isSandboxEnvironment && !loadingMeta ? (
            <p style={{ marginTop: 12, color: "#f87171", fontSize: 13 }}>
              METRC environment is not sandbox. Switch to sandbox in Company Config to enable changes.
            </p>
          ) : null}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: 12,
              marginTop: 14,
            }}
          >
            <label style={{ fontSize: 13 }}>
              <span style={{ color: "#94a3b8" }}>Source plant batch</span>
              <select
                value={growthPhasePlantBatchId}
                onChange={(e) => setGrowthPhasePlantBatchId(e.target.value)}
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #475569",
                  background: "#0f172a",
                  color: "#e2e8f0",
                }}
              >
                <option value="">Select plant batch…</option>
                {(plantBatchesRows ?? []).map((batch) => (
                  <option key={batch.metrcPlantBatchId} value={batch.metrcPlantBatchId}>
                    {batch.name || batch.metrcPlantBatchId}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ color: "#94a3b8" }}>Growth phase</span>
              <select
                value={growthPhaseSelection}
                onChange={(e) => setGrowthPhaseSelection(e.target.value)}
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #475569",
                  background: "#0f172a",
                  color: "#e2e8f0",
                }}
              >
                {METRC_PLANT_BATCH_GROWTH_PHASE_OPTIONS.map((phase) => (
                  <option key={phase} value={phase}>
                    {phase}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ color: "#94a3b8" }}>Count</span>
              <input
                type="number"
                min={1}
                value={growthPhaseCount}
                onChange={(e) => setGrowthPhaseCount(e.target.value)}
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #475569",
                  background: "#0f172a",
                  color: "#e2e8f0",
                }}
              />
            </label>
            <label style={{ fontSize: 13, gridColumn: growthPhaseAvailableTags.length > 0 ? "1 / -1" : undefined }}>
              <span style={{ color: "#94a3b8" }}>Starting plant tag</span>
              {growthPhaseAvailableTags.length > 0 ? (
                <select
                  value={growthPhaseStartingTag}
                  onChange={(e) => setGrowthPhaseStartingTag(e.target.value)}
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: 4,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid #475569",
                    background: "#0f172a",
                    color: "#e2e8f0",
                    fontFamily: "ui-monospace, monospace",
                    fontSize: 12,
                  }}
                >
                  <option value="">Select available plant tag…</option>
                  {growthPhaseAvailableTags.map((tag) => (
                    <option key={tag} value={tag}>
                      {tag}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={growthPhaseStartingTag}
                  onChange={(e) => setGrowthPhaseStartingTag(e.target.value)}
                  placeholder="Fetch available plant tags, then select"
                  disabled
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: 4,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid #475569",
                    background: "#0f172a",
                    color: "#64748b",
                  }}
                />
              )}
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ color: "#94a3b8" }}>Growth date</span>
              <input
                type="date"
                value={growthPhaseDate}
                onChange={(e) => setGrowthPhaseDate(e.target.value)}
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #475569",
                  background: "#0f172a",
                  color: "#e2e8f0",
                }}
              />
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ color: "#94a3b8" }}>Location (optional, package-valid)</span>
              <select
                value={growthPhaseLocationId}
                onChange={(e) => setGrowthPhaseLocationId(e.target.value)}
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #475569",
                  background: "#0f172a",
                  color: "#e2e8f0",
                }}
              >
                <option value="">METRC default</option>
                {packageCapableLocations.map((loc) => (
                  <option key={loc.metrcLocationId} value={loc.metrcLocationId}>
                    {loc.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ ...styles.row, marginTop: 12 }}>
            <button
              type="button"
              style={{ ...styles.btn, opacity: busy ? 0.6 : 1 }}
              disabled={!!busy || !isSandboxEnvironment}
              onClick={() => void fetchAvailablePlantTagsForGrowthPhase()}
            >
              {busy === "growthPhasePlantTags" ? "Fetching…" : "Fetch available plant tags"}
            </button>
            <button
              type="button"
              style={{
                ...styles.btn,
                ...styles.btnPrimary,
                opacity:
                  busy ||
                  !isSandboxEnvironment ||
                  !growthPhasePlantBatchId ||
                  !growthPhaseStartingTag.trim()
                    ? 0.6
                    : 1,
              }}
              disabled={
                !!busy ||
                !isSandboxEnvironment ||
                !growthPhasePlantBatchId ||
                !growthPhaseStartingTag.trim() ||
                Number.parseInt(growthPhaseCount, 10) < 1
              }
              onClick={() => void runChangePlantBatchGrowthPhase()}
            >
              {busy === "plantBatchGrowthPhase" ? "Submitting…" : "Change Growth Phase"}
            </button>
          </div>
          {growthPhasePlantTagsHint ? (
            <p style={{ marginTop: 8, fontSize: 12, color: "#94a3b8" }}>{growthPhasePlantTagsHint}</p>
          ) : null}
          {growthPhaseAvailableTags.length > 0 ? (
            <p style={{ marginTop: 8, fontSize: 12, color: "#64748b" }}>
              {growthPhaseAvailableTags.length} unused METRC plant tag
              {growthPhaseAvailableTags.length === 1 ? "" : "s"} loaded from{" "}
              <code style={{ color: "#cbd5e1" }}>GET /tags/v2/plant/available</code>.
            </p>
          ) : null}
          {lastGrowthPhaseChange ? (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 10,
                border: "1px solid #334155",
                background: "rgba(2, 6, 23, 0.8)",
                fontSize: 12,
                color: "#94a3b8",
              }}
            >
              <strong style={{ color: lastGrowthPhaseChange.ok ? "#4ade80" : "#f87171" }}>
                Last change attempt ({lastGrowthPhaseChange.status ?? "—"})
              </strong>
              <pre
                style={{
                  marginTop: 8,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily: "ui-monospace, monospace",
                  color: "#cbd5e1",
                }}
              >
                {JSON.stringify(
                  {
                    message: lastGrowthPhaseChange.message,
                    endpoint:
                      lastGrowthPhaseChange.endpoint || "/plantbatches/v2/growthphase",
                    requestDebug: lastGrowthPhaseChange.requestDebug,
                    request: lastGrowthPhaseChange.requestPayload,
                    response: lastGrowthPhaseChange.responsePayload,
                  },
                  null,
                  2,
                )}
              </pre>
            </div>
          ) : null}
        </section>

        <section style={styles.card}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Destroy plant batch</h2>
          <p style={{ margin: "8px 0 0", fontSize: 13, color: "#94a3b8" }}>
            Sandbox only. Destroys plants from a synced METRC plant batch using{" "}
            <code style={{ color: "#cbd5e1" }}>DELETE /plantbatches/v2/</code> for METRC Generic
            Evaluation Plant Batches Step 5.
          </p>
          {!isSandboxEnvironment && !loadingMeta ? (
            <p style={{ marginTop: 12, color: "#f87171", fontSize: 13 }}>
              METRC environment is not sandbox. Switch to sandbox in Company Config to enable destroy.
            </p>
          ) : null}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: 12,
              marginTop: 14,
            }}
          >
            <label style={{ fontSize: 13 }}>
              <span style={{ color: "#94a3b8" }}>Source plant batch</span>
              <select
                value={destroyPlantBatchId}
                onChange={(e) => setDestroyPlantBatchId(e.target.value)}
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #475569",
                  background: "#0f172a",
                  color: "#e2e8f0",
                }}
              >
                <option value="">Select plant batch…</option>
                {(plantBatchesRows ?? []).map((batch) => (
                  <option key={batch.metrcPlantBatchId} value={batch.metrcPlantBatchId}>
                    {batch.name || batch.metrcPlantBatchId}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ color: "#94a3b8" }}>Destroy count</span>
              <input
                type="number"
                min={1}
                value={destroyPlantBatchCount}
                onChange={(e) => setDestroyPlantBatchCount(e.target.value)}
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #475569",
                  background: "#0f172a",
                  color: "#e2e8f0",
                }}
              />
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ color: "#94a3b8" }}>Actual date</span>
              <input
                type="date"
                value={destroyPlantBatchDate}
                onChange={(e) => setDestroyPlantBatchDate(e.target.value)}
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #475569",
                  background: "#0f172a",
                  color: "#e2e8f0",
                }}
              />
            </label>
            <label style={{ fontSize: 13, gridColumn: destroyPlantBatchWasteReasons.length > 0 ? "1 / -1" : undefined }}>
              <span style={{ color: "#94a3b8" }}>Waste reason</span>
              {destroyPlantBatchWasteReasons.length > 0 ? (
                <select
                  value={destroyPlantBatchWasteReason}
                  onChange={(e) => setDestroyPlantBatchWasteReason(e.target.value)}
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: 4,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid #475569",
                    background: "#0f172a",
                    color: "#e2e8f0",
                  }}
                >
                  <option value="">Select waste reason…</option>
                  {destroyPlantBatchWasteReasons.map((reason) => (
                    <option key={reason} value={reason}>
                      {reason}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value=""
                  readOnly
                  placeholder="Fetch plant batch waste reasons, then select"
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: 4,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid #475569",
                    background: "#0f172a",
                    color: "#64748b",
                  }}
                />
              )}
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ color: "#94a3b8" }}>Waste method (optional)</span>
              <select
                value={destroyPlantBatchWasteMethod}
                onChange={(e) => setDestroyPlantBatchWasteMethod(e.target.value)}
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #475569",
                  background: "#0f172a",
                  color: "#e2e8f0",
                }}
              >
                <option value="">METRC default</option>
                {METRC_PLANT_BATCH_WASTE_METHOD_OPTIONS.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ color: "#94a3b8" }}>Waste weight (optional)</span>
              <input
                type="number"
                min={0}
                step="any"
                value={destroyPlantBatchWasteWeight}
                onChange={(e) => setDestroyPlantBatchWasteWeight(e.target.value)}
                placeholder="e.g. 12.5"
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #475569",
                  background: "#0f172a",
                  color: "#e2e8f0",
                }}
              />
            </label>
            <label style={{ fontSize: 13 }}>
              <span style={{ color: "#94a3b8" }}>Waste unit of measure (optional)</span>
              <select
                value={destroyPlantBatchWasteUom}
                onChange={(e) => setDestroyPlantBatchWasteUom(e.target.value)}
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #475569",
                  background: "#0f172a",
                  color: "#e2e8f0",
                }}
              >
                <option value="">None</option>
                {METRC_PLANT_BATCH_WASTE_UOM_OPTIONS.map((uom) => (
                  <option key={uom} value={uom}>
                    {uom}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 13, gridColumn: "1 / -1" }}>
              <span style={{ color: "#94a3b8" }}>Reason note</span>
              <input
                type="text"
                value={destroyPlantBatchReasonNote}
                onChange={(e) => setDestroyPlantBatchReasonNote(e.target.value)}
                placeholder="Required destruction explanation"
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #475569",
                  background: "#0f172a",
                  color: "#e2e8f0",
                }}
              />
            </label>
          </div>
          <div style={{ ...styles.row, marginTop: 12 }}>
            <button
              type="button"
              style={{ ...styles.btn, opacity: busy ? 0.6 : 1 }}
              disabled={!!busy || !isSandboxEnvironment}
              onClick={() => void fetchPlantBatchWasteReasons()}
            >
              {busy === "destroyWasteReasons" ? "Fetching…" : "Fetch plant batch waste reasons"}
            </button>
            <button
              type="button"
              style={{
                ...styles.btn,
                ...styles.btnPrimary,
                opacity:
                  busy ||
                  !isSandboxEnvironment ||
                  !destroyPlantBatchId ||
                  !destroyPlantBatchWasteReason.trim() ||
                  !destroyPlantBatchReasonNote.trim()
                    ? 0.6
                    : 1,
              }}
              disabled={
                !!busy ||
                !isSandboxEnvironment ||
                !destroyPlantBatchId ||
                !destroyPlantBatchWasteReason.trim() ||
                !destroyPlantBatchReasonNote.trim() ||
                Number.parseInt(destroyPlantBatchCount, 10) < 1
              }
              onClick={() => void runDestroyPlantBatch()}
            >
              {busy === "destroyPlantBatch" ? "Destroying…" : "Destroy Plant Batch"}
            </button>
          </div>
          {destroyPlantBatchWasteReasonsHint ? (
            <p style={{ marginTop: 8, fontSize: 12, color: "#94a3b8" }}>
              {destroyPlantBatchWasteReasonsHint}
            </p>
          ) : null}
          {destroyPlantBatchWasteReasons.length > 0 ? (
            <p style={{ marginTop: 8, fontSize: 12, color: "#64748b" }}>
              {destroyPlantBatchWasteReasons.length} waste reason
              {destroyPlantBatchWasteReasons.length === 1 ? "" : "s"} loaded from{" "}
              <code style={{ color: "#cbd5e1" }}>GET /plantbatches/v2/waste/reasons</code>.
            </p>
          ) : null}
          {lastDestroyPlantBatch ? (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 10,
                border: "1px solid #334155",
                background: "rgba(2, 6, 23, 0.8)",
                fontSize: 12,
                color: "#94a3b8",
              }}
            >
              <strong style={{ color: lastDestroyPlantBatch.ok ? "#4ade80" : "#f87171" }}>
                Last destroy attempt ({lastDestroyPlantBatch.status ?? "—"})
              </strong>
              <pre
                style={{
                  marginTop: 8,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily: "ui-monospace, monospace",
                  color: "#cbd5e1",
                }}
              >
                {JSON.stringify(
                  {
                    message: lastDestroyPlantBatch.message,
                    status: lastDestroyPlantBatch.status,
                    endpoint: lastDestroyPlantBatch.endpoint || "DELETE /plantbatches/v2/",
                    requestDebug: lastDestroyPlantBatch.requestDebug,
                    request: lastDestroyPlantBatch.requestPayload,
                    response: lastDestroyPlantBatch.responsePayload,
                  },
                  null,
                  2,
                )}
              </pre>
            </div>
          ) : null}
        </section>

        <section style={styles.card}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>METRC harvests</h2>
          <p style={{ margin: "8px 0 0", fontSize: 13, color: "#94a3b8" }}>
            Synced from <code style={{ color: "#cbd5e1" }}>GET /harvests/v2/active</code> using the
            selected facility license and modified-date pagination.
          </p>
          {harvestsLoaded && harvestsRows && harvestsRows.length > 0 ? (
            <table style={styles.sampleTable}>
              <thead>
                <tr style={{ color: "#94a3b8", textAlign: "left" }}>
                  <th style={{ padding: "6px 8px" }}>METRC ID</th>
                  <th style={{ padding: "6px 8px" }}>Harvest name</th>
                  <th style={{ padding: "6px 8px" }}>Source batch</th>
                  <th style={{ padding: "6px 8px" }}>Strain</th>
                  <th style={{ padding: "6px 8px" }}>Room / location</th>
                  <th style={{ padding: "6px 8px" }}>Type</th>
                  <th style={{ padding: "6px 8px" }}>Status</th>
                  <th style={{ padding: "6px 8px" }}>Created</th>
                </tr>
              </thead>
              <tbody>
                {harvestsRows.map((row) => (
                  <tr key={row.metrcHarvestId} style={{ borderTop: "1px solid #334155" }}>
                    <td style={{ padding: "6px 8px", fontFamily: "ui-monospace, monospace" }}>
                      {row.metrcHarvestId}
                      {row.createdViaTest ? (
                        <span
                          style={{
                            marginLeft: 6,
                            fontSize: 10,
                            color: "#fbbf24",
                            fontWeight: 700,
                          }}
                        >
                          TEST
                        </span>
                      ) : null}
                    </td>
                    <td style={{ padding: "6px 8px" }}>{row.harvestName || "—"}</td>
                    <td style={{ padding: "6px 8px" }}>
                      {row.sourcePlantBatchName || row.sourcePlantBatchId || "—"}
                    </td>
                    <td style={{ padding: "6px 8px" }}>{row.strainName || "—"}</td>
                    <td style={{ padding: "6px 8px" }}>
                      {row.locationName || row.metrcLocationId || "—"}
                    </td>
                    <td style={{ padding: "6px 8px" }}>{row.harvestType || "—"}</td>
                    <td style={{ padding: "6px 8px" }}>{row.active ? "Active" : "Finished"}</td>
                    <td style={{ padding: "6px 8px" }}>
                      {row.plantedDate
                        ? formatCompanyTimestamp(row.plantedDate) || row.plantedDate.slice(0, 10)
                        : formatCompanyTimestamp(row.lastSyncedAt) || row.lastSyncedAt.slice(0, 10)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : lastHarvestsSync?.ok && harvestsRows?.length === 0 ? (
            <p style={{ marginTop: 12, color: "#94a3b8", fontSize: 13 }}>
              Harvests sync completed successfully with 0 active harvests in METRC.
            </p>
          ) : harvestsLoaded ? (
            <p style={{ marginTop: 12, color: "#94a3b8", fontSize: 13 }}>
              No harvests stored yet. Use Sync Harvests above, or create a test harvest below.
            </p>
          ) : (
            <p style={{ marginTop: 12, color: "#94a3b8", fontSize: 13 }}>Loading saved harvests…</p>
          )}

          <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid #334155" }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Create test harvest</h3>
            <div style={styles.warn}>
              <strong>Sandbox only.</strong> METRC harvest uses{" "}
              <code style={{ color: "#cbd5e1" }}>PUT /plants/v2/harvest</code> with individual plant
              tags — not plant batch names. Growth phase uses a <strong>plant-capable</strong> location
              (ForPlants); harvest drying uses a separate <strong>harvest-capable</strong> location
              (ForHarvests).
            </div>
            {!canCreateTestHarvest && locationsLoaded ? (
              <p style={{ marginTop: 12, color: "#f87171", fontSize: 13 }}>
                No plant-capable METRC location is mapped. Sync locations and map a plant-capable
                location first.
                {harvestCapableLocations.length === 0
                  ? " Also requires at least one harvest-capable location (ForHarvests)."
                  : ""}
              </p>
            ) : null}
            {!isSandboxEnvironment && !loadingMeta ? (
              <p style={{ marginTop: 12, color: "#f87171", fontSize: 13 }}>
                METRC environment is not sandbox. Switch to sandbox in Company Config to enable creation.
              </p>
            ) : null}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                gap: 12,
                marginTop: 14,
              }}
            >
              <label style={{ fontSize: 13 }}>
                <span style={{ color: "#94a3b8" }}>Plant batch</span>
                <select
                  value={createHarvestPlantBatchId}
                  onChange={(e) => {
                    setCreateHarvestPlantBatchId(e.target.value);
                    setCreateHarvestPlantLabels([]);
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: 4,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid #475569",
                    background: "#0f172a",
                    color: "#e2e8f0",
                  }}
                >
                  <option value="">Select plant batch…</option>
                  {(plantBatchesRows ?? []).map((batch) => (
                    <option key={batch.metrcPlantBatchId} value={batch.metrcPlantBatchId}>
                      {batch.name || batch.metrcPlantBatchId}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ color: "#94a3b8" }}>Strain (from batch)</span>
                <input
                  type="text"
                  readOnly
                  value={selectedHarvestPlantBatch?.strainName ?? ""}
                  placeholder="Select a plant batch"
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: 4,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid #475569",
                    background: "#1e293b",
                    color: "#94a3b8",
                  }}
                />
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ color: "#94a3b8" }}>Plant growth location (required)</span>
                <select
                  value={createHarvestGrowthLocationId}
                  onChange={(e) => setCreateHarvestGrowthLocationId(e.target.value)}
                  disabled={!canCreateTestHarvest}
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: 4,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid #475569",
                    background: "#0f172a",
                    color: "#e2e8f0",
                  }}
                >
                  <option value="">Select plant-capable location…</option>
                  {plantCapableLocations.map((loc) => (
                    <option key={loc.metrcLocationId} value={loc.metrcLocationId}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ color: "#94a3b8" }}>Harvest drying location (required)</span>
                <select
                  value={createHarvestDryingLocationId}
                  onChange={(e) => setCreateHarvestDryingLocationId(e.target.value)}
                  disabled={!canCreateTestHarvest}
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: 4,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid #475569",
                    background: "#0f172a",
                    color: "#e2e8f0",
                  }}
                >
                  <option value="">Select harvest-capable location…</option>
                  {harvestCapableLocations.map((loc) => (
                    <option key={loc.metrcLocationId} value={loc.metrcLocationId}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ color: "#94a3b8" }}>Harvest name</span>
                <input
                  type="text"
                  value={createHarvestName}
                  onChange={(e) => setCreateHarvestName(e.target.value)}
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: 4,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid #475569",
                    background: "#0f172a",
                    color: "#e2e8f0",
                  }}
                />
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ color: "#94a3b8" }}>Harvest type</span>
                <select
                  value={createHarvestType}
                  onChange={(e) => setCreateHarvestType(e.target.value)}
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: 4,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid #475569",
                    background: "#0f172a",
                    color: "#e2e8f0",
                  }}
                >
                  {METRC_HARVEST_TYPE_OPTIONS.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {createHarvestPlantBatchId.trim() ? (
              <div style={{ marginTop: 14 }}>
                <div style={{ ...styles.row, marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>
                    Individual METRC plant tags
                  </span>
                  <button
                    type="button"
                    style={{ ...styles.btn, opacity: busy ? 0.6 : 1 }}
                    disabled={!!busy}
                    onClick={() => void runSyncPlants()}
                  >
                    {busy === "plants" ? "Syncing…" : "Sync Plants"}
                  </button>
                </div>
                {!batchPlantsLoaded ? (
                  <p style={{ fontSize: 13, color: "#94a3b8" }}>Loading plants for this batch…</p>
                ) : harvestBatchNeedsTaggedPlants ? (
                  <p style={{ fontSize: 13, color: "#fbbf24" }}>
                    This is a plant batch, not an individual plant. No tagged plants are stored yet —
                    Create Test Harvest will promote the batch to flowering (requires METRC plant tags),
                    sync plants, then harvest by tag.
                  </p>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      maxHeight: 160,
                      overflow: "auto",
                      padding: 10,
                      borderRadius: 8,
                      border: "1px solid #334155",
                      background: "rgba(2, 6, 23, 0.5)",
                    }}
                  >
                    {(batchPlantsRows ?? []).map((plant) => {
                      const checked = createHarvestPlantLabels.includes(plant.label);
                      return (
                        <label
                          key={plant.label}
                          style={{ fontSize: 13, color: "#cbd5e1", cursor: "pointer" }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              setCreateHarvestPlantLabels((prev) => {
                                if (e.target.checked) {
                                  return [...new Set([...prev, plant.label])];
                                }
                                return prev.filter((l) => l !== plant.label);
                              });
                            }}
                            style={{ marginRight: 8 }}
                          />
                          <span style={{ fontFamily: "ui-monospace, monospace" }}>{plant.label}</span>
                          <span style={{ color: "#64748b", marginLeft: 8 }}>
                            ({plant.growthPhase || "—"})
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : null}
            <div style={{ ...styles.row, marginTop: 12 }}>
              <button
                type="button"
                style={{
                  ...styles.btn,
                  ...styles.btnPrimary,
                  opacity: busy || !isSandboxEnvironment ? 0.6 : 1,
                }}
                disabled={
                  !!busy ||
                  !isSandboxEnvironment ||
                  !canCreateTestHarvest ||
                  !createHarvestPlantBatchId.trim() ||
                  !createHarvestGrowthLocationId ||
                  !createHarvestDryingLocationId ||
                  !createHarvestName.trim()
                }
                onClick={() => setCreateHarvestConfirmOpen(true)}
              >
                {busy === "createHarvest" ? "Creating…" : "Create Test Harvest"}
              </button>
            </div>
            {createHarvestConfirmOpen ? (
              <div
                style={{
                  marginTop: 14,
                  padding: 14,
                  borderRadius: 10,
                  border: "1px solid rgba(248, 113, 113, 0.45)",
                  background: "rgba(69, 10, 10, 0.35)",
                }}
              >
                <p style={{ margin: "0 0 10px", fontWeight: 700, color: "#fecaca" }}>
                  Confirm METRC sandbox write
                </p>
                <p style={{ margin: "0 0 12px", fontSize: 13, color: "#fca5a5" }}>
                  Create harvest &quot;{createHarvestName.trim()}&quot; ({createHarvestType}) using{" "}
                  {createHarvestPlantLabels.length > 0
                    ? `${createHarvestPlantLabels.length} plant tag(s)`
                    : "auto-promoted plant tag(s)"}{" "}
                  from batch &quot;{selectedHarvestPlantBatch?.name || createHarvestPlantBatchId}&quot;?
                  Growth: <strong>{selectedGrowthLocation?.name || "—"}</strong> · Drying:{" "}
                  <strong>{selectedDryingLocation?.name || "—"}</strong>. Plant tags only in{" "}
                  <code>Plant</code> — never the batch name.
                </p>
                <div style={styles.row}>
                  <button
                    type="button"
                    style={{ ...styles.btn, ...styles.btnPrimary }}
                    onClick={() => void runCreateTestHarvest()}
                  >
                    Yes, create in METRC
                  </button>
                  <button
                    type="button"
                    style={styles.btn}
                    onClick={() => setCreateHarvestConfirmOpen(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
            {lastCreateHarvest ? (
              <div
                style={{
                  marginTop: 12,
                  padding: 12,
                  borderRadius: 10,
                  border: "1px solid #334155",
                  background: "rgba(2, 6, 23, 0.8)",
                  fontSize: 12,
                  color: "#94a3b8",
                }}
              >
                <strong style={{ color: lastCreateHarvest.ok ? "#4ade80" : "#f87171" }}>
                  Last create attempt ({lastCreateHarvest.status ?? "—"})
                  {lastCreateHarvest.alreadyExists ? " · existing harvest reused" : ""}
                  {lastCreateHarvest.promotedBatch ? " · batch promoted" : ""}
                </strong>
                <pre
                  style={{
                    marginTop: 8,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontFamily: "ui-monospace, monospace",
                    color: "#cbd5e1",
                  }}
                >
                  {JSON.stringify(
                    {
                      message: lastCreateHarvest.message,
                      endpoint: lastCreateHarvest.endpoint,
                      plantLabelsUsed: lastCreateHarvest.plantLabelsUsed,
                      request: lastCreateHarvest.requestPayload,
                      response: lastCreateHarvest.responsePayload,
                    },
                    null,
                    2,
                  )}
                </pre>
              </div>
            ) : null}
          </div>
        </section>

        <section style={styles.card}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>METRC packages</h2>
          <p style={{ margin: "8px 0 0", fontSize: 13, color: "#94a3b8" }}>
            Synced from <code style={{ color: "#cbd5e1" }}>GET /packages/v2/active</code>. Package
            labels are the upsert key. Reconciliation compares METRC inventory to NexBatch LeafLink
            SKUs and cultivation METRC tags.
          </p>
          {packageReconciliation ? (
            <p style={{ marginTop: 12, fontSize: 13, color: "#94a3b8" }}>
              Reconciliation: {packageReconciliation.matched} matched · {packageReconciliation.metrcOnly}{" "}
              METRC-only · {packageReconciliation.nexbatchOnly} NexBatch-only ·{" "}
              {packageReconciliation.quantityMismatch} quantity mismatch
              {packageReconciliation.metrcCount > 0 || packageReconciliation.nexbatchCount > 0
                ? ` (METRC ${packageReconciliation.metrcCount}, NexBatch ${packageReconciliation.nexbatchCount})`
                : ""}
            </p>
          ) : null}

          <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid #334155" }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Create test package</h3>
            <p style={{ margin: "8px 0 0", fontSize: 13, color: "#94a3b8" }}>
              Creates a package from a harvest via{" "}
              <code style={{ color: "#cbd5e1" }}>POST /harvests/v2/packages</code> (sandbox-only).
              Packages are re-synced after success; NexBatch inventory is not updated until METRC
              confirms the package.
            </p>
            <div style={styles.warn}>
              <strong>Sandbox only.</strong> This will create a package in METRC.
            </div>
            {!isSandboxEnvironment && !loadingMeta ? (
              <p style={{ marginTop: 12, color: "#f87171", fontSize: 13 }}>
                METRC environment is not sandbox. Switch to sandbox in Company Config to enable
                creation.
              </p>
            ) : null}
            {!(itemsRows?.length ?? 0) || !createPackageItemId.trim() ? (
              <p style={{ marginTop: 12, color: "#fbbf24", fontSize: 13 }}>{PACKAGE_ITEM_REQUIRED_MSG}</p>
            ) : null}
            <div
              style={{
                marginTop: 14,
                padding: 12,
                borderRadius: 10,
                border: "1px solid #334155",
                background: "rgba(15, 23, 42, 0.6)",
              }}
            >
              <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>METRC items</h4>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                  gap: 12,
                  marginTop: 10,
                }}
              >
                <label style={{ fontSize: 13 }}>
                  <span style={{ color: "#94a3b8" }}>Sync facility license</span>
                  <select
                    value={itemSyncLicense}
                    onChange={(e) => setItemSyncLicense(e.target.value)}
                    style={{
                      display: "block",
                      width: "100%",
                      marginTop: 4,
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: "1px solid #475569",
                      background: "#0f172a",
                      color: "#e2e8f0",
                    }}
                  >
                    <option value="">Active / config license</option>
                    {(lastFacilities?.facilities ?? []).map((f) => (
                      <option key={f.licenseNumber} value={f.licenseNumber}>
                        {f.licenseNumber}
                        {f.facilityName ? ` — ${f.facilityName}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ fontSize: 13, display: "flex", alignItems: "flex-end", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={itemSyncTryAllFacilities}
                    onChange={(e) => setItemSyncTryAllFacilities(e.target.checked)}
                  />
                  <span style={{ color: "#94a3b8" }}>Try all synced facilities</span>
                </label>
              </div>
              <div style={{ ...styles.row, marginTop: 10 }}>
                <button
                  type="button"
                  style={{ ...styles.btn, opacity: busy ? 0.6 : 1 }}
                  disabled={!!busy}
                  onClick={() => void runItemsSync()}
                >
                  {busy === "items" ? "Syncing…" : "Sync Items"}
                </button>
                <button
                  type="button"
                  style={{ ...styles.btn, opacity: busy ? 0.6 : 1 }}
                  disabled={!!busy}
                  onClick={() =>
                    void runItemsSync({ licenseNumber: itemSyncLicense, tryAllFacilities: true })
                  }
                >
                  {busy === "items" ? "Searching…" : "Try all facilities"}
                </button>
              </div>
              {lastItemsSync?.diagnostics ? (
                <pre
                  style={{
                    marginTop: 10,
                    padding: 10,
                    borderRadius: 8,
                    border: "1px solid #334155",
                    background: "#020617",
                    fontSize: 11,
                    color: "#cbd5e1",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontFamily: "ui-monospace, monospace",
                  }}
                >
                  {JSON.stringify(lastItemsSync.diagnostics, null, 2)}
                </pre>
              ) : null}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                  gap: 10,
                  marginTop: 12,
                }}
              >
                <label style={{ fontSize: 13 }}>
                  <span style={{ color: "#94a3b8" }}>Item name</span>
                  <input
                    value={createItemName}
                    onChange={(e) => setCreateItemName(e.target.value)}
                    style={{
                      display: "block",
                      width: "100%",
                      marginTop: 4,
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: "1px solid #475569",
                      background: "#0f172a",
                      color: "#e2e8f0",
                    }}
                  />
                </label>
                <label style={{ fontSize: 13 }}>
                  <span style={{ color: "#94a3b8" }}>Product category</span>
                  <input
                    value={createItemCategory}
                    onChange={(e) => setCreateItemCategory(e.target.value)}
                    style={{
                      display: "block",
                      width: "100%",
                      marginTop: 4,
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: "1px solid #475569",
                      background: "#0f172a",
                      color: "#e2e8f0",
                    }}
                  />
                </label>
                <label style={{ fontSize: 13 }}>
                  <span style={{ color: "#94a3b8" }}>Unit of measure</span>
                  <input
                    value={createItemUom}
                    onChange={(e) => setCreateItemUom(e.target.value)}
                    style={{
                      display: "block",
                      width: "100%",
                      marginTop: 4,
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: "1px solid #475569",
                      background: "#0f172a",
                      color: "#e2e8f0",
                    }}
                  />
                </label>
                <label style={{ fontSize: 13 }}>
                  <span style={{ color: "#94a3b8" }}>Strain (optional)</span>
                  <input
                    value={createItemStrain}
                    onChange={(e) => setCreateItemStrain(e.target.value)}
                    placeholder="If category requires strain"
                    style={{
                      display: "block",
                      width: "100%",
                      marginTop: 4,
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: "1px solid #475569",
                      background: "#0f172a",
                      color: "#e2e8f0",
                    }}
                  />
                </label>
              </div>
              <div style={{ ...styles.row, marginTop: 10 }}>
                <button
                  type="button"
                  style={{
                    ...styles.btn,
                    ...styles.btnPrimary,
                    opacity:
                      busy || !isSandboxEnvironment || !createItemName.trim() || !createItemCategory.trim()
                        ? 0.6
                        : 1,
                  }}
                  disabled={
                    !!busy ||
                    !isSandboxEnvironment ||
                    !createItemName.trim() ||
                    !createItemCategory.trim()
                  }
                  onClick={() => setCreateItemConfirmOpen(true)}
                >
                  {busy === "createItem" ? "Creating…" : "Create Test Item"}
                </button>
              </div>
              {createItemConfirmOpen ? (
                <div
                  style={{
                    marginTop: 12,
                    padding: 12,
                    borderRadius: 10,
                    border: "1px solid rgba(248, 113, 113, 0.45)",
                    background: "rgba(69, 10, 10, 0.35)",
                  }}
                >
                  <p style={{ margin: "0 0 10px", fontSize: 13, color: "#fca5a5" }}>
                    Create item &quot;{createItemName.trim()}&quot; ({createItemCategory.trim()},{" "}
                    {createItemUom.trim()}) in METRC sandbox?
                  </p>
                  <div style={styles.row}>
                    <button
                      type="button"
                      style={{ ...styles.btn, ...styles.btnPrimary }}
                      onClick={() => void runCreateTestItem()}
                    >
                      Yes, create in METRC
                    </button>
                    <button
                      type="button"
                      style={styles.btn}
                      onClick={() => setCreateItemConfirmOpen(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                gap: 12,
                marginTop: 14,
              }}
            >
              <label style={{ fontSize: 13 }}>
                <span style={{ color: "#94a3b8" }}>Source harvest</span>
                <select
                  value={createPackageHarvestId}
                  onChange={(e) => setCreatePackageHarvestId(e.target.value)}
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: 4,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid #475569",
                    background: "#0f172a",
                    color: "#e2e8f0",
                  }}
                >
                  <option value="">Select harvest…</option>
                  {activeHarvestsForPackage.map((h) => (
                    <option key={h.metrcHarvestId} value={h.metrcHarvestId}>
                      {h.harvestName || h.metrcHarvestId}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ color: "#94a3b8" }}>Item</span>
                <select
                  value={createPackageItemId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setCreatePackageItemId(id);
                    const item = (itemsRows ?? []).find((i) => i.metrcItemId === id);
                    if (item?.unitOfMeasureName) {
                      setCreatePackageUnit(item.unitOfMeasureName);
                    }
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: 4,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid #475569",
                    background: "#0f172a",
                    color: "#e2e8f0",
                  }}
                >
                  <option value="">Select item…</option>
                  {(itemsRows ?? []).map((item) => (
                    <option key={item.metrcItemId} value={item.metrcItemId}>
                      {item.itemName}
                      {item.categoryName ? ` (${item.categoryName})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ color: "#94a3b8" }}>Package tag / label</span>
                <input
                  value={createPackageTag}
                  onChange={(e) => setCreatePackageTag(e.target.value)}
                  placeholder="Required METRC package tag"
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: 4,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid #475569",
                    background: "#0f172a",
                    color: "#e2e8f0",
                    fontFamily: "ui-monospace, monospace",
                  }}
                />
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ color: "#94a3b8" }}>Quantity</span>
                <input
                  type="number"
                  min={0.01}
                  step="any"
                  value={createPackageQuantity}
                  onChange={(e) => setCreatePackageQuantity(e.target.value)}
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: 4,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid #475569",
                    background: "#0f172a",
                    color: "#e2e8f0",
                  }}
                />
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ color: "#94a3b8" }}>Unit of measure</span>
                <input
                  value={createPackageUnit}
                  onChange={(e) => setCreatePackageUnit(e.target.value)}
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: 4,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid #475569",
                    background: "#0f172a",
                    color: "#e2e8f0",
                  }}
                />
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ color: "#94a3b8" }}>Location (optional)</span>
                <select
                  value={createPackageLocationId}
                  onChange={(e) => setCreatePackageLocationId(e.target.value)}
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: 4,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid #475569",
                    background: "#0f172a",
                    color: "#e2e8f0",
                  }}
                >
                  <option value="">METRC default</option>
                  {packageCapableLocations.map((loc) => (
                    <option key={loc.metrcLocationId} value={loc.metrcLocationId}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ color: "#94a3b8" }}>Packaged date</span>
                <input
                  type="date"
                  value={createPackageDate}
                  onChange={(e) => setCreatePackageDate(e.target.value)}
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: 4,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid #475569",
                    background: "#0f172a",
                    color: "#e2e8f0",
                  }}
                />
              </label>
              <label style={{ fontSize: 13, gridColumn: "1 / -1" }}>
                <span style={{ color: "#94a3b8" }}>Note</span>
                <input
                  value={createPackageNote}
                  onChange={(e) => setCreatePackageNote(e.target.value)}
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: 4,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid #475569",
                    background: "#0f172a",
                    color: "#e2e8f0",
                  }}
                />
              </label>
            </div>
            <div style={{ ...styles.row, marginTop: 12 }}>
              <button
                type="button"
                style={{ ...styles.btn, opacity: busy ? 0.6 : 1 }}
                disabled={!!busy}
                onClick={() => void fetchAvailablePackageTags()}
              >
                {busy === "packageTags" ? "Fetching…" : "Fetch available package tags"}
              </button>
              <button
                type="button"
                style={{
                  ...styles.btn,
                  ...styles.btnPrimary,
                  opacity: busy || !isSandboxEnvironment ? 0.6 : 1,
                }}
                disabled={
                  !!busy ||
                  !isSandboxEnvironment ||
                  !createPackageHarvestId.trim() ||
                  !createPackageTag.trim() ||
                  !createPackageQuantity.trim() ||
                  Number(createPackageQuantity) <= 0
                }
                onClick={() => openCreatePackageConfirm()}
              >
                {busy === "createPackage" ? "Creating…" : "Create Test Package"}
              </button>
            </div>
            {packageTagsHint ? (
              <p style={{ marginTop: 8, fontSize: 12, color: "#94a3b8" }}>{packageTagsHint}</p>
            ) : null}
            {selectedPackageItem ? (
              <p style={{ marginTop: 8, fontSize: 12, color: "#64748b" }}>
                Item UOM: {selectedPackageItem.unitOfMeasureName || "—"} ·{" "}
                {selectedPackageItem.quantityType || "—"}
              </p>
            ) : null}
            {createPackageConfirmOpen ? (
              <div
                style={{
                  marginTop: 14,
                  padding: 14,
                  borderRadius: 10,
                  border: "1px solid rgba(248, 113, 113, 0.45)",
                  background: "rgba(69, 10, 10, 0.35)",
                }}
              >
                <p style={{ margin: "0 0 10px", fontWeight: 700, color: "#fecaca" }}>
                  Confirm METRC sandbox write
                </p>
                <p style={{ margin: "0 0 12px", fontSize: 13, color: "#fca5a5" }}>
                  Sandbox only. This will create package tag &quot;{createPackageTag.trim()}&quot; (
                  {createPackageQuantity} {createPackageUnit.trim()}) from harvest &quot;
                  {activeHarvestsForPackage.find((h) => h.metrcHarvestId === createPackageHarvestId)
                    ?.harvestName || createPackageHarvestId}
                  &quot; using item &quot;{selectedPackageItem?.itemName || createPackageItemId}
                  &quot;.
                </p>
                <div style={styles.row}>
                  <button
                    type="button"
                    style={{ ...styles.btn, ...styles.btnPrimary }}
                    onClick={() => void runCreateTestPackage()}
                  >
                    Yes, create in METRC
                  </button>
                  <button
                    type="button"
                    style={styles.btn}
                    onClick={() => setCreatePackageConfirmOpen(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
            {lastCreatePackage ? (
              <div
                style={{
                  marginTop: 12,
                  padding: 12,
                  borderRadius: 10,
                  border: "1px solid #334155",
                  background: "rgba(2, 6, 23, 0.8)",
                  fontSize: 12,
                  color: "#94a3b8",
                }}
              >
                <strong style={{ color: lastCreatePackage.ok ? "#4ade80" : "#f87171" }}>
                  Last create attempt ({lastCreatePackage.status ?? "—"})
                </strong>
                <pre
                  style={{
                    marginTop: 8,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontFamily: "ui-monospace, monospace",
                    color: "#cbd5e1",
                  }}
                >
                  {JSON.stringify(
                    {
                      message: lastCreatePackage.message,
                      endpoint: lastCreatePackage.endpoint,
                      packageLabel: lastCreatePackage.packageLabel,
                      packagesSynced: lastCreatePackage.packagesSynced,
                      request: lastCreatePackage.requestPayload,
                      response: lastCreatePackage.responsePayload,
                    },
                    null,
                    2,
                  )}
                </pre>
              </div>
            ) : null}
          </div>

          {packagesLoaded && packagesRows && packagesRows.length > 0 ? (
            <table style={styles.sampleTable}>
              <thead>
                <tr style={{ color: "#94a3b8", textAlign: "left" }}>
                  <th style={{ padding: "6px 8px" }}>Label</th>
                  <th style={{ padding: "6px 8px" }}>Item</th>
                  <th style={{ padding: "6px 8px" }}>Quantity</th>
                  <th style={{ padding: "6px 8px" }}>Location</th>
                  <th style={{ padding: "6px 8px" }}>Strain</th>
                  <th style={{ padding: "6px 8px" }}>Last synced</th>
                </tr>
              </thead>
              <tbody>
                {packagesRows.map((row) => (
                  <tr key={row.packageLabel} style={{ borderTop: "1px solid #334155" }}>
                    <td style={{ padding: "6px 8px", fontFamily: "ui-monospace, monospace" }}>
                      {row.packageLabel}
                    </td>
                    <td style={{ padding: "6px 8px" }}>{row.itemName || "—"}</td>
                    <td style={{ padding: "6px 8px" }}>
                      {row.quantity} {row.unitOfMeasure || ""}
                    </td>
                    <td style={{ padding: "6px 8px" }}>{row.location || "—"}</td>
                    <td style={{ padding: "6px 8px" }}>{row.strainName || "—"}</td>
                    <td style={{ padding: "6px 8px" }}>
                      {formatCompanyTimestamp(row.lastSyncedAt) || row.lastSyncedAt}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : lastPackagesSync?.ok && packagesRows?.length === 0 ? (
            <p style={{ marginTop: 12, color: "#94a3b8", fontSize: 13 }}>
              Packages sync completed successfully with 0 active packages in METRC.
            </p>
          ) : packagesLoaded ? (
            <p style={{ marginTop: 12, color: "#94a3b8", fontSize: 13 }}>
              No packages stored yet. Use Sync Packages above to pull from METRC.
            </p>
          ) : (
            <p style={{ marginTop: 12, color: "#94a3b8", fontSize: 13 }}>Loading saved packages…</p>
          )}
        </section>

        <section style={styles.card}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>METRC transfers</h2>
          <p style={{ margin: "8px 0 0", fontSize: 13, color: "#94a3b8" }}>
            Sync from{" "}
            <code style={{ color: "#cbd5e1" }}>GET /transfers/v2/incoming</code>,{" "}
            <code style={{ color: "#cbd5e1" }}>/outgoing</code>, and{" "}
            <code style={{ color: "#cbd5e1" }}>/templates/outgoing</code>. Create sandbox outgoing
            transfer templates via{" "}
            <code style={{ color: "#cbd5e1" }}>POST /transfers/v2/templates/outgoing</code> using a
            synced package.
          </p>
          {activeFacilityLicense ? (
            <p style={{ marginTop: 8, fontSize: 12, color: "#64748b" }}>
              Active facility license:{" "}
              <code style={{ color: "#cbd5e1" }}>{activeFacilityLicense}</code>
            </p>
          ) : null}
          <div style={{ ...styles.row, marginTop: 14, flexWrap: "wrap" }}>
            <button
              type="button"
              style={{ ...styles.btn, ...styles.btnPrimary }}
              disabled={busy !== null}
              onClick={() => void runTransfersSync()}
            >
              {busy === "transfers" ? "Syncing…" : "Sync Transfers"}
            </button>
          </div>
          {lastTransfersSync?.diagnostics ? (
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: "pointer", color: "#94a3b8", fontSize: 13 }}>
                Sync diagnostics
              </summary>
              <pre
                style={{
                  marginTop: 8,
                  padding: 12,
                  borderRadius: 10,
                  border: "1px solid #334155",
                  background: "rgba(2, 6, 23, 0.8)",
                  fontSize: 11,
                  color: "#cbd5e1",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {JSON.stringify(lastTransfersSync.diagnostics, null, 2)}
              </pre>
            </details>
          ) : null}
          {isSandboxEnvironment ? (
            <div
              style={{
                marginTop: 20,
                paddingTop: 16,
                borderTop: "1px solid #334155",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  marginBottom: 8,
                }}
              >
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Create Test Transfer</h3>
                <button
                  type="button"
                  style={styles.btn}
                  disabled={busy !== null}
                  onClick={() => void runTransferTypesSync()}
                >
                  {busy === "transferTypes" ? "Syncing types…" : "Sync Transfer Types"}
                </button>
              </div>
              <p style={{ margin: "0 0 8px", fontSize: 13, color: "#94a3b8" }}>
                Destination must be a different synced facility license. Confirmation required before
                METRC write.
              </p>
              <div
                style={{
                  margin: "0 0 12px",
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #334155",
                  background: "rgba(2, 6, 23, 0.55)",
                  fontSize: 12,
                  color: "#cbd5e1",
                }}
              >
                <div>
                  Transfer types loaded:{" "}
                  <strong>{transferTypesLoaded ? transferTypesRows.length : "…"}</strong>
                </div>
                <div>
                  Source:{" "}
                  <strong>
                    {transferTypesLoaded
                      ? transferTypesSource === "none"
                        ? "none"
                        : transferTypesSource
                      : "loading"}
                  </strong>
                  {transferTypesSource === "fallback" ? (
                    <span style={{ color: "#fbbf24" }}> (sandbox fallback list)</span>
                  ) : null}
                </div>
                <div>
                  Selected transfer type:{" "}
                  <strong>{createTransferTypeName.trim() || "—"}</strong>
                </div>
              </div>
              {transferTypesLoaded && transferTypesRows.length === 0 ? (
                <p style={{ margin: "0 0 12px", fontSize: 13, color: "#fbbf24" }}>
                  {TRANSFER_TYPES_EMPTY_MSG}
                </p>
              ) : null}
              {transferDestinationFacilities.length === 0 ? (
                <p style={{ margin: "0 0 12px", fontSize: 13, color: "#fbbf24" }}>
                  Pull facilities first and ensure at least one license differs from the active source
                  facility.
                </p>
              ) : null}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                  gap: 12,
                }}
              >
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
                  <span style={{ color: "#94a3b8" }}>Source package</span>
                  <select
                    value={createTransferPackageLabel}
                    onChange={(e) => setCreateTransferPackageLabel(e.target.value)}
                    style={styles.input}
                  >
                    <option value="">Select package…</option>
                    {(packagesRows ?? []).map((row) => (
                      <option key={row.packageLabel} value={row.packageLabel}>
                        {row.packageLabel} — {row.itemName || "item"} ({row.quantity}{" "}
                        {row.unitOfMeasure})
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
                  <span style={{ color: "#94a3b8" }}>Destination facility</span>
                  <select
                    value={createTransferDestinationLicense}
                    onChange={(e) => setCreateTransferDestinationLicense(e.target.value)}
                    style={styles.input}
                    disabled={transferDestinationFacilities.length === 0}
                  >
                    <option value="">Select facility…</option>
                    {transferDestinationFacilities.map((f) => (
                      <option key={f.licenseNumber} value={f.licenseNumber}>
                        {f.facilityName || f.licenseNumber} ({f.licenseNumber})
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
                  <span style={{ color: "#94a3b8" }}>Transfer type (METRC Name)</span>
                  <select
                    value={createTransferTypeName}
                    onChange={(e) => setCreateTransferTypeName(e.target.value)}
                    style={styles.input}
                    disabled={transferTypesRows.length === 0}
                  >
                    <option value="">
                      {transferTypesRows.length > 0
                        ? "Select transfer type…"
                        : "Sync transfer types first…"}
                    </option>
                    {transferTypesRows.map((row) => (
                      <option key={row.name} value={row.name}>
                        {row.name}
                        {row.source === "fallback" ? " (fallback)" : ""}
                        {row.typeCode && row.typeCode !== row.name ? ` · ${row.typeCode}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
                  <span style={{ color: "#94a3b8" }}>Transfer date</span>
                  <input
                    type="date"
                    value={createTransferDate}
                    onChange={(e) => setCreateTransferDate(e.target.value)}
                    style={styles.input}
                  />
                </label>
                <label
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    fontSize: 13,
                    gridColumn: "1 / -1",
                  }}
                >
                  <span style={{ color: "#94a3b8" }}>Planned route</span>
                  <input
                    type="text"
                    value={createTransferRoute}
                    onChange={(e) => setCreateTransferRoute(e.target.value)}
                    style={styles.input}
                  />
                </label>
                <label
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    fontSize: 13,
                    gridColumn: "1 / -1",
                  }}
                >
                  <span style={{ color: "#94a3b8" }}>Notes / template name</span>
                  <input
                    type="text"
                    value={createTransferNotes}
                    onChange={(e) => setCreateTransferNotes(e.target.value)}
                    style={styles.input}
                  />
                </label>
              </div>
              {lastTransferTypesSync?.usedFallback ? (
                <p style={{ margin: "10px 0 0", fontSize: 12, color: "#fbbf24" }}>
                  Last sync used sandbox fallback names — METRC types API was unavailable.
                </p>
              ) : null}
              {lastTransferTypesSync?.diagnostics ? (
                <details style={{ marginTop: 10 }}>
                  <summary style={{ cursor: "pointer", color: "#94a3b8", fontSize: 13 }}>
                    Transfer types diagnostics
                  </summary>
                  <pre
                    style={{
                      marginTop: 8,
                      padding: 12,
                      borderRadius: 10,
                      border: "1px solid #334155",
                      background: "rgba(2, 6, 23, 0.8)",
                      fontSize: 11,
                      color: "#cbd5e1",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {JSON.stringify(lastTransferTypesSync.diagnostics, null, 2)}
                  </pre>
                </details>
              ) : null}
              <details style={{ marginTop: 12 }}>
                <summary style={{ cursor: "pointer", color: "#94a3b8", fontSize: 13 }}>
                  Payload preview (before submit)
                </summary>
                <pre
                  style={{
                    marginTop: 8,
                    padding: 12,
                    borderRadius: 10,
                    border: "1px solid #334155",
                    background: "rgba(2, 6, 23, 0.8)",
                    fontSize: 11,
                    color: "#cbd5e1",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {JSON.stringify(transferPayloadPreview, null, 2)}
                </pre>
              </details>
              <div style={{ ...styles.row, marginTop: 12 }}>
                <button
                  type="button"
                  style={{ ...styles.btn, ...styles.btnPrimary }}
                  disabled={
                    busy !== null ||
                    transferTypesRows.length === 0 ||
                    !createTransferTypeName.trim()
                  }
                  onClick={() => openCreateTransferConfirm()}
                >
                  {busy === "createTransfer" ? "Creating…" : "Create Test Transfer"}
                </button>
              </div>
              {createTransferConfirmOpen ? (
                <div
                  style={{
                    marginTop: 14,
                    padding: 14,
                    borderRadius: 10,
                    border: "1px solid rgba(248, 113, 113, 0.45)",
                    background: "rgba(69, 10, 10, 0.35)",
                  }}
                >
                  <p style={{ margin: "0 0 10px", fontWeight: 700, color: "#fecaca" }}>
                    Confirm METRC sandbox write
                  </p>
                  <p style={{ margin: "0 0 12px", fontSize: 13, color: "#fca5a5" }}>
                    Sandbox only. This will create an outgoing transfer template for package &quot;
                    {createTransferPackageLabel.trim()}&quot; to facility &quot;
                    {createTransferDestinationLicense.trim()}&quot; on {createTransferDate} (type:{" "}
                    {createTransferTypeName.trim()}).
                  </p>
                  <pre
                    style={{
                      margin: "0 0 12px",
                      fontSize: 11,
                      color: "#fecaca",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {JSON.stringify(transferPayloadPreview.v1, null, 2)}
                  </pre>
                  <div style={styles.row}>
                    <button
                      type="button"
                      style={{ ...styles.btn, ...styles.btnPrimary }}
                      onClick={() => void runCreateTestTransfer()}
                    >
                      Yes, create in METRC
                    </button>
                    <button
                      type="button"
                      style={styles.btn}
                      onClick={() => setCreateTransferConfirmOpen(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
              {lastCreateTransfer ? (
                <div
                  style={{
                    marginTop: 12,
                    padding: 12,
                    borderRadius: 10,
                    border: "1px solid #334155",
                    background: "rgba(2, 6, 23, 0.8)",
                    fontSize: 12,
                    color: "#94a3b8",
                  }}
                >
                  <strong style={{ color: lastCreateTransfer.ok ? "#4ade80" : "#f87171" }}>
                    Last create attempt ({lastCreateTransfer.status ?? "—"})
                  </strong>
                  <pre
                    style={{
                      marginTop: 8,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      fontFamily: "ui-monospace, monospace",
                      color: "#cbd5e1",
                    }}
                  >
                    {JSON.stringify(
                      {
                        message: lastCreateTransfer.message,
                        endpoint: lastCreateTransfer.endpoint,
                        metrcTransferId: lastCreateTransfer.metrcTransferId,
                        transfersSynced: lastCreateTransfer.transfersSynced,
                        validationErrors: lastCreateTransfer.validationErrors,
                        payloadDiagnostics: lastCreateTransfer.payloadDiagnostics,
                        request: lastCreateTransfer.requestPayload,
                        response: lastCreateTransfer.responsePayload,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </div>
              ) : null}
            </div>
          ) : (
            <p style={{ marginTop: 12, color: "#fbbf24", fontSize: 13 }}>
              Create Test Transfer is available only when METRC environment is sandbox.
            </p>
          )}
          {transfersLoaded && transfersRows && transfersRows.length > 0 ? (
            <table style={{ ...styles.sampleTable, marginTop: 16 }}>
              <thead>
                <tr style={{ color: "#94a3b8", textAlign: "left" }}>
                  <th style={{ padding: "6px 8px" }}>ID</th>
                  <th style={{ padding: "6px 8px" }}>Direction</th>
                  <th style={{ padding: "6px 8px" }}>Manifest</th>
                  <th style={{ padding: "6px 8px" }}>Type</th>
                  <th style={{ padding: "6px 8px" }}>Status</th>
                  <th style={{ padding: "6px 8px" }}>Destination</th>
                </tr>
              </thead>
              <tbody>
                {transfersRows.map((row) => (
                  <tr
                    key={`${row.direction}:${row.metrcTransferId}`}
                    style={{ borderTop: "1px solid #334155" }}
                  >
                    <td style={{ padding: "6px 8px", fontFamily: "ui-monospace, monospace" }}>
                      {row.metrcTransferId}
                    </td>
                    <td style={{ padding: "6px 8px" }}>{row.direction}</td>
                    <td style={{ padding: "6px 8px" }}>{row.manifestNumber || "—"}</td>
                    <td style={{ padding: "6px 8px" }}>{row.transferType || "—"}</td>
                    <td style={{ padding: "6px 8px" }}>{row.status}</td>
                    <td style={{ padding: "6px 8px" }}>{row.destinationFacility || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : lastTransfersSync?.ok && transfersRows?.length === 0 ? (
            <p style={{ marginTop: 12, color: "#94a3b8", fontSize: 13 }}>
              Transfers sync completed with 0 records. Create a test transfer or check METRC sandbox
              data.
            </p>
          ) : transfersLoaded ? (
            <p style={{ marginTop: 12, color: "#94a3b8", fontSize: 13 }}>
              No transfers stored yet. Use Sync Transfers above.
            </p>
          ) : null}
        </section>

        <section style={styles.card}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>METRC locations</h2>
          <p style={{ margin: "8px 0 0", fontSize: 13, color: "#94a3b8" }}>
            Synced from <code style={{ color: "#cbd5e1" }}>GET /locations/v2/active</code>. Room
            mappings are saved immediately and persist across refreshes. Auto-match runs on sync for
            unmapped locations only.
          </p>
          {mappingToast ? (
            <div style={mappingToast.tone === "error" ? styles.error : styles.ok}>{mappingToast.text}</div>
          ) : null}
          {locationsLoaded && nexbatchRooms.length === 0 ? (
            <p style={{ marginTop: 12, color: "#fbbf24", fontSize: 13 }}>
              No NexBatch rooms found. Create cultivation rooms first.
            </p>
          ) : null}
          {locationsLoaded && locationsRows && locationsRows.length > 0 ? (
            <>
              <div style={{ ...styles.row, marginTop: 12, flexWrap: "wrap" }}>
                {(
                  [
                    ["all", "All"],
                    ["plants", "Plant capable"],
                    ["harvest", "Harvest capable"],
                    ["packages", "Package capable"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    style={{
                      ...styles.btn,
                      ...(locationCapabilityFilter === key
                        ? { borderColor: "#38bdf8", color: "#e0f2fe" }
                        : {}),
                      opacity: 1,
                    }}
                    onClick={() => setLocationCapabilityFilter(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <table style={styles.sampleTable}>
                <thead>
                  <tr style={{ color: "#94a3b8", textAlign: "left" }}>
                    <th style={{ padding: "6px 8px" }}>METRC ID</th>
                    <th style={{ padding: "6px 8px" }}>Name</th>
                    <th style={{ padding: "6px 8px" }}>Type</th>
                    <th style={{ padding: "6px 8px" }}>Capabilities</th>
                    <th style={{ padding: "6px 8px" }}>NexBatch room</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLocations.map((row) => (
                    <tr key={row.metrcLocationId} style={{ borderTop: "1px solid #334155" }}>
                      <td style={{ padding: "6px 8px", fontFamily: "ui-monospace, monospace" }}>
                        {row.metrcLocationId}
                      </td>
                      <td style={{ padding: "6px 8px" }}>
                        {row.name || "—"}
                        {row.mappingSource === "auto" ? (
                          <span
                            style={{
                              marginLeft: 6,
                              fontSize: 10,
                              color: "#93c5fd",
                              fontWeight: 700,
                            }}
                          >
                            AUTO
                          </span>
                        ) : null}
                      </td>
                      <td style={{ padding: "6px 8px" }}>{row.locationTypeName || "—"}</td>
                      <td style={{ padding: "6px 8px" }}>
                        <CapabilityBadge active={row.forPlants} label="Plant" />
                        <CapabilityBadge active={row.forHarvests} label="Harvest" />
                        <CapabilityBadge active={row.forPackages} label="Package" />
                      </td>
                      <td style={{ padding: "6px 8px" }}>
                        <select
                          value={mappingSelectValue(row)}
                          disabled={mappingBusy === row.metrcLocationId}
                          onChange={(e) =>
                            void saveLocationMapping(row.metrcLocationId, e.target.value)
                          }
                          style={{
                            width: "100%",
                            minWidth: 180,
                            background: "#0f172a",
                            color: "#e2e8f0",
                            border: "1px solid #475569",
                            borderRadius: 6,
                            padding: "4px 6px",
                            fontSize: 12,
                          }}
                        >
                          <option value="">— Not mapped —</option>
                          {nexbatchRooms.map((opt) => (
                            <option
                              key={`${opt.suite}:${opt.roomId}`}
                              value={`${opt.suite}:${opt.roomId}`}
                            >
                              {formatNexbatchRoomOptionLabel(opt)}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredLocations.length === 0 ? (
                <p style={{ marginTop: 12, color: "#94a3b8", fontSize: 13 }}>
                  No locations match the selected capability filter.
                </p>
              ) : null}
            </>
          ) : lastLocationsSync?.ok && locationsRows?.length === 0 ? (
            <p style={{ marginTop: 12, color: "#94a3b8", fontSize: 13 }}>
              Locations sync completed successfully with 0 active locations in the selected date range.
            </p>
          ) : locationsLoaded ? (
            <p style={{ marginTop: 12, color: "#94a3b8", fontSize: 13 }}>
              No locations stored yet. Use Sync Locations/Rooms above to pull from METRC.
            </p>
          ) : (
            <p style={{ marginTop: 12, color: "#94a3b8", fontSize: 13 }}>Loading saved locations…</p>
          )}
        </section>
      </main>
    </PageAccessGate>
  );
}
