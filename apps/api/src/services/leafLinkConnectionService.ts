import { AppError } from "../errors/AppError.js";
import { logInfo } from "../lib/logger.js";
import {
  buildLeafLinkAuthCandidates,
  buildLeafLinkHeaders,
  fetchJsonWithRetry,
  leafLinkAuthMode,
  LeafLinkService,
} from "./leaflinkService.js";

type LeafLinkProbeFailure = {
  endpoint: string;
  authMode: string;
  message: string;
  code: string;
};

export type LeafLinkTestConnectionSuccess = {
  ok: true;
  connected: true;
  checkedAt: string;
  authSource: "db" | "env";
  companyId: string;
  endpoint: string;
  authMode: string;
  status: number;
  bodyPreview: string;
};

export type LeafLinkTestConnectionFailure = {
  ok: false;
  connected: false;
  checkedAt: string;
  authSource: "db" | "env";
  companyId: string;
  status: number;
  message: string;
  failures: LeafLinkProbeFailure[];
};

export type LeafLinkTestConnectionResponse = LeafLinkTestConnectionSuccess | LeafLinkTestConnectionFailure;

function previewJson(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 600);
  } catch {
    return "[unserializable]";
  }
}

function buildOrdersProbeCandidates(baseUrl: string, companyId: string, companySlug: string): string[] {
  const base = baseUrl.replace(/\/+$/, "");
  const q = new URLSearchParams({
    page_size: "1",
    page: "1",
    ordering: "-created_on",
  });
  const out: string[] = [];
  if (companyId) out.push(`${base}/v2/companies/${encodeURIComponent(companyId)}/orders-received/?${q.toString()}`);
  if (companySlug) {
    const uq = new URLSearchParams(q.toString());
    uq.set("seller__slug__iexact", companySlug);
    out.push(`${base}/v2/orders-received/?${uq.toString()}`);
  }
  out.push(`${base}/v2/orders-received/?${q.toString()}`);
  return [...new Set(out)];
}

export class LeafLinkConnectionService {
  leafLinkService = new LeafLinkService();

  async runTestConnection(input: {
    companyId: string;
    actorUserId: string;
  }): Promise<LeafLinkTestConnectionResponse> {
    const checkedAt = new Date().toISOString();
    logInfo("[LEAFLINK] test_connection_start", {
      companyId: input.companyId,
      actorUserId: input.actorUserId || "system",
    });
    const creds = await this.leafLinkService.resolveRuntimeCredentials(input.companyId, { source: "db" });
    if (!creds.integrationEnabled) {
      return {
        ok: false,
        connected: false,
        checkedAt,
        authSource: creds.source,
        companyId: input.companyId,
        status: 400,
        message: "LeafLink integration is disabled in saved company config.",
        failures: [],
      };
    }
    if (!creds.apiKey || (!creds.companyId && !creds.companySlug)) {
      return {
        ok: false,
        connected: false,
        checkedAt,
        authSource: creds.source,
        companyId: input.companyId,
        status: 400,
        message: "Saved LeafLink credentials are incomplete (need API key and company ID or slug).",
        failures: [],
      };
    }

    const urls = buildOrdersProbeCandidates(creds.baseUrl, creds.companyId, creds.companySlug);
    const authCandidates = buildLeafLinkAuthCandidates(creds);
    const failures: LeafLinkProbeFailure[] = [];

    for (const endpoint of urls) {
      for (const authValue of authCandidates) {
        const authMode = leafLinkAuthMode(authValue);
        try {
          const body = await fetchJsonWithRetry(
            endpoint,
            {
              method: "GET",
              headers: buildLeafLinkHeaders(creds, authValue),
            },
            15_000,
          );
          logInfo("[LEAFLINK] test_connection_success", {
            companyId: input.companyId,
            authSource: creds.source,
            authMode,
            endpoint: endpoint.slice(0, 220),
            fallbackTriggered: failures.length > 0,
          });
          return {
            ok: true,
            connected: true,
            checkedAt,
            authSource: creds.source,
            companyId: input.companyId,
            endpoint,
            authMode,
            status: 200,
            bodyPreview: previewJson(body),
          };
        } catch (error) {
          const code = error instanceof AppError ? error.code : "UNKNOWN";
          failures.push({
            endpoint: endpoint.slice(0, 220),
            authMode,
            message: error instanceof Error ? error.message : String(error),
            code,
          });
        }
      }
    }

    return {
      ok: false,
      connected: false,
      checkedAt,
      authSource: creds.source,
      companyId: input.companyId,
      status: 502,
      message: "LeafLink test connection failed for all endpoint/auth combinations.",
      failures,
    };
  }
}
