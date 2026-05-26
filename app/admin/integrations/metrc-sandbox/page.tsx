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
import { getAuthToken } from "@/lib/auth";
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
  metrcSandboxLastRoomsCount?: number | null;
  metrcSandboxLastStrainsCount?: number | null;
  totalStrainsSynced?: number | null;
  metrcSandboxLastPackagesCount?: number | null;
  totalPackagesSynced?: number | null;
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
  }, [loadMeta, loadNexbatchRooms, loadSyncedLocations, loadSyncedStrains]);

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

  async function runStrainsSync() {
    setBusy("strains");
    setStatusMsg(null);
    setLastStrainsSync(null);
    try {
      const res = await authFetch("/api/metrc/strains");
      const json = (await res.json()) as StrainsSyncResult;
      setLastStrainsSync(json);
      if (!res.ok || !json.ok) {
        setStatusMsg({
          tone: "error",
          text: String(json.message || "Strains sync failed."),
        });
        return;
      }
      const count = json.count ?? json.totalStrainsSynced ?? 0;
      setStrainsRows(json.strains ?? []);
      setStrainsLoaded(true);
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
    } catch {
      setStatusMsg({ tone: "error", text: "Strains sync failed — network error." });
    } finally {
      setBusy(null);
    }
  }

  async function runPull(resource: "packages") {
    setBusy(resource);
    setStatusMsg(null);
    setLastPull(null);
    try {
      const res = await authFetch(`/api/metrc/${resource}`);
      const json = (await res.json()) as PullResult;
      setLastPull(json);
      if (!res.ok || !json.ok) {
        setStatusMsg({
          tone: "error",
          text: formatMetrcPullError(json, resource),
        });
        return;
      }
      const warn = json.rateLimitWarning ? ` ${json.rateLimitWarning}` : "";
      setStatusMsg({
        tone: json.rateLimitWarning ? "warn" : "ok",
        text: `Pulled ${json.count ?? 0} ${resource}.${warn}`,
      });
      await loadMeta();
    } catch {
      setStatusMsg({ tone: "error", text: `Pull ${resource} failed — network error.` });
    } finally {
      setBusy(null);
    }
  }

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
                {formatCompanyTimestamp(meta?.metrcSandboxLastPackagesSyncAt || "") || "—"}
                {meta?.totalPackagesSynced != null
                  ? ` (${meta.totalPackagesSynced})`
                  : meta?.metrcSandboxLastPackagesCount != null
                    ? ` (${meta.metrcSandboxLastPackagesCount})`
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
              onClick={() => void runPull("packages")}
            >
              {busy === "packages" ? "Pulling…" : "Pull Packages"}
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
              No strains stored yet. Use Sync Strains above to pull from METRC.
            </p>
          ) : (
            <p style={{ marginTop: 12, color: "#94a3b8", fontSize: 13 }}>Loading saved strains…</p>
          )}
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
