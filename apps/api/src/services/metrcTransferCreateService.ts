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
};

export type MetrcCreateTestTransferResponse =
  | MetrcCreateTestTransferSuccess
  | MetrcCreateTestTransferFailure;

function licenseQuery(licenseNumber: string): string {
  const license = String(licenseNumber || "").trim();
  return license ? `?licenseNumber=${encodeURIComponent(license)}` : "";
}

export function buildTransferTemplateCreatePathCandidates(licenseNumber: string): string[] {
  const q = licenseQuery(licenseNumber);
  return [`/transfers/v2/templates/outgoing${q}`, `/transfers/v1/templates${q}`];
}

function toMetrcDateTime(ymd: string, hour: number): string {
  const [y, m, d] = ymd.split("-").map((v) => Number(v));
  if (!y || !m || !d) return `${ymd}T10:00:00.000`;
  const dt = new Date(Date.UTC(y, m - 1, d, hour, 0, 0, 0));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}:00:00.000`;
}

export function buildMetrcTransferTemplateCreateBody(input: {
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
}): unknown[] {
  const departure = toMetrcDateTime(input.transferDate, 10);
  const arrival = toMetrcDateTime(input.transferDate, 14);
  const transporterLicense = input.transporterFacilityLicense || input.sourceLicense;

  return [
    {
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
      Destinations: [
        {
          RecipientLicenseNumber: input.destinationLicense,
          InvoiceNumber: `INV-NB-${Date.now()}`,
          TransferTypeName: input.transferTypeName,
          PlannedRoute: input.plannedRoute,
          EstimatedDepartureDateTime: departure,
          EstimatedArrivalDateTime: arrival,
          Transporters: [
            {
              TransporterFacilityLicenseNumber: transporterLicense,
              DriverOccupationalLicenseNumber: "SANDBOX",
              DriverName: "NexBatch Sandbox Driver",
              DriverLicenseNumber: "SANDBOX",
              DriverLayoverLeg: "FromAndToLayover",
              PhoneNumberForQuestions: "18005555555",
              VehicleMake: "NexBatch",
              VehicleModel: "Van",
              VehicleLicensePlateNumber: "NB-TEST",
              VehicleRegistrationNumber: null,
              IsLayover: false,
              EstimatedDepartureDateTime: departure,
              EstimatedArrivalDateTime: arrival,
              TransporterDetails: [],
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
        },
      ],
    },
  ];
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
    const transferTypeName = String(input.transferTypeName || "Transfer").trim() || "Transfer";
    const templateName =
      String(input.notes || "").trim() || `NexBatch Test Transfer ${transferDate}`;

    const requestBody = buildMetrcTransferTemplateCreateBody({
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
    });

    const client = MetrcClient.fromLoadedConfig(loaded, input.companyId);
    const candidates = buildTransferTemplateCreatePathCandidates(sourceLicense);
    const startedAt = Date.now();
    let lastStatus = 502;
    let lastMessage = "METRC transfer create failed.";
    let lastEndpoint: string | undefined;
    let lastResponse: unknown = null;

    for (const pathname of candidates) {
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
          requestPayload: { pathname, body: requestBody, packageLabel, destinationLicense },
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
      });
    }

    const durationMs = Date.now() - startedAt;
    await appendMetrcTransferRequestLog({
      companyId: input.companyId,
      action: "create_test",
      method: "POST",
      endpoint: lastEndpoint || "/transfers/v2/templates/outgoing",
      httpStatus: lastStatus,
      requestPayload: { body: requestBody, packageLabel, destinationLicense },
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
      requestPayload: { body: requestBody },
      responsePayload: lastResponse,
      metrcMessage:
        lastResponse && typeof lastResponse === "object" && "metrcMessage" in lastResponse
          ? String((lastResponse as { metrcMessage?: unknown }).metrcMessage ?? "")
          : undefined,
    };
  }
}
