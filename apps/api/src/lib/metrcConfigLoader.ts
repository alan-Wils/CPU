import { ConfigService } from "../services/configService.js";
import type { MetrcEnvironment } from "./metrcResolveBaseUrl.js";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export type LoadedMetrcConfig = {
  company: Record<string, unknown>;
  metrc: Record<string, unknown>;
  vendorApiKey: string;
  userApiKey: string;
  username: string;
  licenseNumber: string;
  facilityName: string;
  stateCode: string;
  environment: MetrcEnvironment;
  apiBaseUrlOverride: string;
};

export function readVendorApiKey(metrc: Record<string, unknown>): string {
  return String(metrc.apiKey || metrc.vendorApiKey || "").trim();
}

export function readUserApiKey(metrc: Record<string, unknown>): string {
  return String(metrc.userKey || metrc.userApiKey || "").trim();
}

export async function loadCompanyMetrcConfig(companyId: string): Promise<LoadedMetrcConfig | null> {
  const configService = new ConfigService();
  const rows = await configService.list(companyId);
  const companyRow = rows.find((r) => r.key === "company");
  if (!companyRow) return null;
  const company = asRecord(companyRow.value);
  const metrc = asRecord(company.metrc);
  return {
    company,
    metrc,
    vendorApiKey: readVendorApiKey(metrc),
    userApiKey: readUserApiKey(metrc),
    username: String(metrc.username || "").trim(),
    licenseNumber: String(metrc.licenseNumber || metrc.facilityLicenseNumber || "").trim(),
    facilityName: String(metrc.facilityName || "").trim(),
    stateCode: String(metrc.stateCode || "").trim(),
    environment: metrc.environment === "sandbox" ? "sandbox" : "production",
    apiBaseUrlOverride: String(metrc.apiBaseUrlOverride || "").trim(),
  };
}
