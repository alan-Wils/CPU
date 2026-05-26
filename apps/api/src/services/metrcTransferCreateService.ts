import { prisma } from "../config/prisma.js";
import { logInfo, logWarn } from "../lib/logger.js";
import { MetrcClient, isMetrcClientFailure } from "../lib/metrcClient.js";
import { loadCompanyMetrcConfig } from "../lib/metrcConfigLoader.js";
import { buildMetrcCredentialHintFromLoaded } from "../lib/metrcCredentialDiagnostics.js";
import { metrcPullFailureMessage } from "../lib/metrcEndpoints.js";
import { findMetrcPackageByLabel } from "../repositories/metrcPackageRepository.js";
import {
  appendMetrcTransferRequestLog,
} from "../repositories/metrcTransferRepository.js";
import { MetrcTransfersSyncService } from "./metrcTransfersSyncService.js";
import {
  METRC_TRANSFER_TYPE_FALLBACK_NAMES,
  MetrcTransferTypesSyncService,
} from "./metrcTransferTypesSyncService.js";

export type MetrcCreateTestTransferInput = {
  companyId: string;
  actorUserId: string;
  packageLabel: string;
  destinationFacilityLicense: string;
  transferDate: string;
  plannedRoute: string;
  notes?: string | null;
  transporterFacilityLicense?: string | null;
  transferTypeName?: string | null;
  grossWeight?: number | null;
  grossUnitOfWeightName?: string | null;
};

export type MetrcCreateTestTransferSuccess = {
  ok: true;
  status: number;
  message: string;
  endpoint: string;
  requestPayload: unknown;
  responsePayload: unknown;
  durationMs: number;
  metrcTransferId: string | null;
  transfersSynced: number;
  payloadDiagnostics?: MetrcTransferTemplatePayloadDiagnostics;
};

export type MetrcCreateTestTransferFailure = {
  ok: false;
  status: number;
  message: string;
  credentialHint?: string;
  endpoint?: string;
  requestPayload?: unknown;
  responsePayload?: unknown;
  metrcMessage?: string;
  validationErrors?: string[];
  payloadDiagnostics?: MetrcTransferTemplatePayloadDiagnostics;
};

export type MetrcCreateTestTransferResponse =
  | MetrcCreateTestTransferSuccess
  | MetrcCreateTestTransferFailure;

function licenseQuery(licenseNumber: string): string {
  const license = String(licenseNumber || "").trim();
  return license ? `?licenseNumber=${encodeURIComponent(license)}` : "";
}

export type MetrcTransferTemplateApiVersion = "v1" | "v2";

function isTransferTypeNameMetrcError(message: string): boolean {
  return /transfer type name/i.test(message);
}

export function resolveTransferTemplateApiVersion(pathname: string): MetrcTransferTemplateApiVersion {
  return pathname.includes("/v1/") ? "v1" : "v2";
}

export function buildTransferTemplateCreatePathCandidates(licenseNumber: string): string[] {
  const q = licenseQuery(licenseNumber);
  return [`/transfers/v2/templates/outgoing${q}`, `/transfers/v1/templates${q}`];
}

export type MetrcTransferTemplatePayloadDiagnostics = {
  endpoint: string;
  apiVersion: MetrcTransferTemplateApiVersion;
  topLevelTransferTypeName: string;
  destinationRecipientLicense: string;
  packageLabels: string[];
  selectedTransferTypeName: string;
  transferTypeOptionsCount: number;
  transferTypesUsedFallback: boolean;
  firstRawTransferType: Record<string, unknown> | null;
  transferTypeAttempts?: string[];
};

function toMetrcDateTime(ymd: string, hour: number): string {
  const [y, m, d] = ymd.split("-").map((v) => Number(v));
  if (!y || !m || !d) return `${ymd}T10:00:00.000`;
  const dt = new Date(Date.UTC(y, m - 1, d, hour, 0, 0, 0));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}:00:00.000`;
}

export function buildMetrcTransferTemplateCreateBody(
  input: {
    name: string;
    sourceLicense: string;
    destinationLicense: string;
    packageLabel: string;
    transferDate: string;
    plannedRoute: string;
    notes: string | null;
    transporterFacilityLicense: string | null;
    transferTypeName: string;
    grossWeight: number;
    grossUnitOfWeightName: string;
  },
  apiVersion: MetrcTransferTemplateApiVersion,
): unknown[] {
  const departure = toMetrcDateTime(input.transferDate, 10);
  const arrival = toMetrcDateTime(input.transferDate, 14);
  const transporterLicense = input.transporterFacilityLicense || input.sourceLicense;

  const destination: Record<string, unknown> = {
    RecipientLicenseNumber: input.destinationLicense,
    InvoiceNumber: `INV-NB-${Date.now()}`,
    PlannedRoute: input.plannedRoute,
    EstimatedDepartureDateTime: departure,
    EstimatedArrivalDateTime: arrival,
    Transporters: [
      {
        TransporterFacilityLicenseNumber: transporterLicense,
        DriverOccupationalLicenseNumber: "SANDBOX",
        DriverName: "NexBatch Sandbox Driver",
        DriverLicenseNumber: "SANDBOX",
        DriverLayoverLeg: apiVersion === "v1" ? "ToLayover" : "FromAndToLayover",
        PhoneNumberForQuestions: "18005555555",
        VehicleMake: "NexBatch",
        VehicleModel: "Van",
        VehicleLicensePlateNumber: "NB-TEST",
        VehicleRegistrationNumber: null,
        IsLayover: false,
        EstimatedDepartureDateTime: departure,
        EstimatedArrivalDateTime: arrival,
        TransporterDetails: apiVersion === "v1" ? null : [],
      },
    ],
    Packages: [
      {
        PackageLabel: input.packageLabel,
        WholesalePrice: null,
        GrossWeight: input.grossWeight,
        GrossUnitOfWeightName: input.grossUnitOfWeightName,
      },
    ],
  };

  // v2 docs: TransferTypeName on destination. v1 sandbox expects top-level only.
  if (apiVersion === "v2") {
    destination.TransferTypeName = input.transferTypeName;
  }

  const template: Record<string, unknown> = {
    Name: input.name,
    TransporterFacilityLicenseNumber: transporterLicense,
    DriverOccupationalLicenseNumber: null,
    DriverName: null,
    DriverLicenseNumber: null,
    PhoneNumberForQuestions: null,
    VehicleMake: null,
    VehicleModel: null,
    VehicleLicensePlateNumber: null,
    VehicleRegistrationNumber: null,
    Destinations: [destination],
  };

  if (apiVersion === "v1") {
    template.TransferTypeName = input.transferTypeName;
  }

  return [template];
}

export function buildTransferTemplatePayloadDiagnostics(input: {
  pathname: string;
  transferTypeName: string;
  destinationLicense: string;
  packageLabel: string;
  body: unknown;
}): MetrcTransferTemplatePayloadDiagnostics {
  const apiVersion = resolveTransferTemplateApiVersion(input.pathname);
  const row = Array.isArray(input.body) ? (input.body[0] as Record<string, unknown>) : null;
  const topLevel =
    row && typeof row.TransferTypeName === "string"
      ? row.TransferTypeName
      : apiVersion === "v1"
        ? input.transferTypeName
        : "";
  const dest = row?.Destinations;
  const destRow =
    Array.isArray(dest) && dest[0] && typeof dest[0] === "object"
      ? (dest[0] as Record<string, unknown>)
      : null;
  const recipient = String(destRow?.RecipientLicenseNumber ?? input.destinationLicense).trim();
  const packages = destRow?.Packages;
  const labels: string[] = [];
  if (Array.isArray(packages)) {
    for (const pkg of packages) {
      if (!pkg || typeof pkg !== "object") continue;
      const label = String((pkg as { PackageLabel?: unknown }).PackageLabel ?? "").trim();
      if (label) labels.push(label);
    }
  }
  if (!labels.length && input.packageLabel.trim()) {
    labels.push(input.packageLabel.trim());
  }

  return {
    endpoint: input.pathname.split("?")[0] || input.pathname,
    apiVersion,
    topLevelTransferTypeName: topLevel,
    destinationRecipientLicense: recipient,
    packageLabels: labels,
    selectedTransferTypeName: input.transferTypeName,
    transferTypeOptionsCount: 0,
    transferTypesUsedFallback: false,
    firstRawTransferType: null,
  };
}

function extractCreatedTransferId(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;
  const ids = (response as { Ids?: unknown }).Ids;
  if (Array.isArray(ids) && ids.length > 0) {
    return String(ids[0] ?? "").trim() || null;
  }
  return null;
}

export class MetrcTransferCreateService {
  transfersSyncService = new MetrcTransfersSyncService();
  transferTypesSyncService = new MetrcTransferTypesSyncService();

  async createTestTransfer(
    input: MetrcCreateTestTransferInput,
  ): Promise<MetrcCreateTestTransferResponse> {
    const validationErrors: string[] = [];

    logInfo("[METRC] transfer_create_test_start", {
      companyId: input.companyId,
      packageLabel: input.packageLabel,
      destinationFacilityLicense: input.destinationFacilityLicense,
    });

    const loaded = await loadCompanyMetrcConfig(input.companyId);
    if (!loaded) {
      return { ok: false, status: 404, message: "Company configuration not found." };
    }

    if (loaded.environment !== "sandbox") {
      return {
        ok: false,
        status: 403,
        message: "Create Test Transfer is sandbox-only. Switch METRC environment to sandbox.",
      };
    }

    if (!loaded.userApiKey) {
      return {
        ok: false,
        status: 400,
        message: "User API key is required. Run sandbox setup or save a user key in Company Config.",
      };
    }

    const sourceLicense = String(loaded.licenseNumber || "").trim();
    if (!sourceLicense) {
      validationErrors.push("Active facility license is required.");
    }

    const packageLabel = String(input.packageLabel || "").trim();
    if (!packageLabel) {
      validationErrors.push("Source package label is required.");
    }

    const destinationLicense = String(input.destinationFacilityLicense || "").trim();
    if (!destinationLicense) {
      validationErrors.push("Destination facility license is required.");
    } else if (sourceLicense && destinationLicense === sourceLicense) {
      validationErrors.push(
        "Destination facility must differ from the active source facility license.",
      );
    }

    const transferDate = String(input.transferDate || "").trim();
    if (!transferDate || !/^\d{4}-\d{2}-\d{2}$/.test(transferDate)) {
      validationErrors.push("Transfer date must be YYYY-MM-DD.");
    }

    const plannedRoute = String(input.plannedRoute || "").trim();
    if (!plannedRoute) {
      validationErrors.push("Planned route is required.");
    }

    if (validationErrors.length) {
      return {
        ok: false,
        status: 400,
        message: validationErrors.join(" "),
        validationErrors,
      };
    }

    const destinationFacility = await prisma.metrcFacility.findFirst({
      where: { companyId: input.companyId, licenseNumber: destinationLicense },
    });
    if (!destinationFacility) {
      return {
        ok: false,
        status: 400,
        message: `Destination facility "${destinationLicense}" was not found. Pull facilities first.`,
        validationErrors: ["Unknown destination facility license."],
      };
    }

    const pkg = await findMetrcPackageByLabel(input.companyId, packageLabel);
    if (!pkg) {
      return {
        ok: false,
        status: 400,
        message: `Package "${packageLabel}" was not found. Sync packages or create a test package first.`,
        validationErrors: ["Unknown source package label."],
      };
    }

    const grossWeight =
      input.grossWeight != null && Number.isFinite(Number(input.grossWeight)) && Number(input.grossWeight) > 0
        ? Number(input.grossWeight)
        : pkg.quantity > 0
          ? pkg.quantity
          : 10;
    const grossUnit = String(input.grossUnitOfWeightName || pkg.unitOfMeasure || "Grams").trim() || "Grams";
    const transferTypeName = String(input.transferTypeName || "").trim();
    if (!transferTypeName) {
      return {
        ok: false,
        status: 400,
        message: "Select a METRC transfer type.",
        validationErrors: ["Select a METRC transfer type."],
      };
    }

    const { transferTypes, source: transferTypesSource } =
      await this.transferTypesSyncService.resolveTransferTypesForCompany({
        companyId: input.companyId,
        licenseNumber: sourceLicense,
        environment: loaded.environment,
      });
    const transferTypesUsedFallback = transferTypesSource === "fallback";
    const transferTypeOptionsCount = transferTypes.length;
    const firstRawTransferType = transferTypes[0]?.raw ?? null;

    if (!transferTypes.length) {
      return {
        ok: false,
        status: 400,
        message: "No METRC transfer types loaded. Sync transfer types before creating a transfer.",
        validationErrors: ["Sync transfer types first."],
      };
    }

    const knownNames = new Set(transferTypes.map((row) => row.name));
    if (!knownNames.has(transferTypeName)) {
      return {
        ok: false,
        status: 400,
        message: `Transfer type "${transferTypeName}" was not found. Sync transfer types and select a valid type.`,
        validationErrors: ["Unknown transfer type name."],
      };
    }

    const typeNamesToTry: string[] = [transferTypeName];
    if (transferTypesUsedFallback) {
      for (const name of METRC_TRANSFER_TYPE_FALLBACK_NAMES) {
        if (!typeNamesToTry.includes(name)) typeNamesToTry.push(name);
      }
    }
    const templateName =
      String(input.notes || "").trim() || `NexBatch Test Transfer ${transferDate}`;

    const bodyInput = {
      name: templateName,
      sourceLicense,
      destinationLicense,
      packageLabel,
      transferDate,
      plannedRoute,
      notes: String(input.notes ?? "").trim() || null,
      transporterFacilityLicense: String(input.transporterFacilityLicense ?? "").trim() || null,
      transferTypeName,
      grossWeight,
      grossUnitOfWeightName: grossUnit,
    };

    const client = MetrcClient.fromLoadedConfig(loaded, input.companyId);
    const candidates = buildTransferTemplateCreatePathCandidates(sourceLicense);
    const startedAt = Date.now();
    let lastStatus = 502;
    let lastMessage = "METRC transfer create failed.";
    let lastEndpoint: string | undefined;
    let lastResponse: unknown = null;
    let lastPayloadDiagnostics: MetrcTransferTemplatePayloadDiagnostics | undefined;
    let lastRequestBody: unknown = null;
    const transferTypeAttempts: string[] = [];

    outer: for (const pathname of candidates) {
      const apiVersion = resolveTransferTemplateApiVersion(pathname);

      for (const attemptTypeName of typeNamesToTry) {
        transferTypeAttempts.push(attemptTypeName);
        const attemptBodyInput = { ...bodyInput, transferTypeName: attemptTypeName };
        const requestBody = buildMetrcTransferTemplateCreateBody(attemptBodyInput, apiVersion);
        const payloadDiagnostics: MetrcTransferTemplatePayloadDiagnostics = {
          ...buildTransferTemplatePayloadDiagnostics({
            pathname,
            transferTypeName: attemptTypeName,
            destinationLicense,
            packageLabel,
            body: requestBody,
          }),
          selectedTransferTypeName: transferTypeName,
          transferTypeOptionsCount,
          transferTypesUsedFallback,
          firstRawTransferType,
          transferTypeAttempts: [...transferTypeAttempts],
        };
        lastPayloadDiagnostics = payloadDiagnostics;
        lastRequestBody = requestBody;

        logInfo("[METRC] transfer_create_test_payload", {
          companyId: input.companyId,
          attemptTransferTypeName: attemptTypeName,
          ...payloadDiagnostics,
        });

        const result = await client.post<unknown>(pathname, requestBody);
        lastEndpoint = pathname.split("?")[0];

        if (!isMetrcClientFailure(result)) {
          const durationMs = Date.now() - startedAt;
          const metrcTransferId = extractCreatedTransferId(result.data);
          const logPayload = {
            companyId: input.companyId,
            action: "create_test",
            method: "POST",
            endpoint: lastEndpoint,
            httpStatus: result.status,
            requestPayload: {
              pathname,
              body: requestBody,
              packageLabel,
              destinationLicense,
              payloadDiagnostics,
            },
            responsePayload: result.data,
            durationMs,
            actorUserId: input.actorUserId,
          };
          await appendMetrcTransferRequestLog(logPayload);

          const syncResult = await this.transfersSyncService.syncMetrcTransfers({
            companyId: input.companyId,
            actorUserId: input.actorUserId,
          });
          const transfersSynced =
            syncResult.ok === true ? syncResult.totalTransfersSynced ?? syncResult.count : 0;

          logInfo("[METRC] transfer_create_test_success", {
            companyId: input.companyId,
            endpoint: lastEndpoint,
            status: result.status,
            metrcTransferId,
            transfersSynced,
            acceptedTransferTypeName: attemptTypeName,
          });

          return {
            ok: true,
            status: result.status,
            message: "Test transfer template submitted to METRC sandbox and transfers re-synced.",
            endpoint: lastEndpoint,
            requestPayload: logPayload.requestPayload,
            responsePayload: result.data,
            durationMs,
            metrcTransferId,
            transfersSynced,
            payloadDiagnostics: {
              ...payloadDiagnostics,
              topLevelTransferTypeName: attemptTypeName,
            },
          };
        }

        lastStatus = result.status || 502;
        lastMessage = metrcPullFailureMessage(lastStatus, result.metrcMessage || result.message);
        lastResponse = {
          status: result.status,
          message: result.message,
          metrcMessage: result.metrcMessage,
          endpoint: result.endpoint,
          upstreamError: result.upstreamError,
        };

        logWarn("[METRC] transfer_create_test_attempt_failed", {
          companyId: input.companyId,
          endpoint: lastEndpoint,
          status: lastStatus,
          message: lastMessage,
          attemptTransferTypeName: attemptTypeName,
        });

        if (
          transferTypesUsedFallback &&
          isTransferTypeNameMetrcError(lastMessage) &&
          attemptTypeName !== typeNamesToTry[typeNamesToTry.length - 1]
        ) {
          continue;
        }

        if (!transferTypesUsedFallback || !isTransferTypeNameMetrcError(lastMessage)) {
          break outer;
        }
      }
    }

    const durationMs = Date.now() - startedAt;
    await appendMetrcTransferRequestLog({
      companyId: input.companyId,
      action: "create_test",
      method: "POST",
      endpoint: lastEndpoint || "/transfers/v2/templates/outgoing",
      httpStatus: lastStatus,
      requestPayload: {
        body: lastRequestBody,
        packageLabel,
        destinationLicense,
        payloadDiagnostics: lastPayloadDiagnostics,
      },
      responsePayload: lastResponse,
      durationMs,
      actorUserId: input.actorUserId,
    });

    return {
      ok: false,
      status: lastStatus,
      message: lastMessage,
      credentialHint:
        lastStatus === 401 || lastStatus === 403
          ? buildMetrcCredentialHintFromLoaded(loaded)
          : undefined,
      endpoint: lastEndpoint,
      requestPayload: { body: lastRequestBody, payloadDiagnostics: lastPayloadDiagnostics },
      responsePayload: lastResponse,
      payloadDiagnostics: lastPayloadDiagnostics,
      metrcMessage:
        lastResponse && typeof lastResponse === "object" && "metrcMessage" in lastResponse
          ? String((lastResponse as { metrcMessage?: unknown }).metrcMessage ?? "")
          : undefined,
    };
  }
}
