/** UI-facing sandbox lifecycle states (distinct from production METRC connection). */

export type MetrcSandboxUiStatus =
  | "idle"
  | "provisioning"
  | "awaiting_user_activation"
  | "auth_rejected"
  | "connected"
  | "endpoint_unavailable"
  | "timeout"
  | "error";

export function resolveMetrcSandboxUiStatus(input: {
  sandboxProvisioning: boolean;
  sandboxReady: boolean;
  credentialsReady: boolean;
  hasUserApiKey: boolean;
  lastConnectionStatus?: string;
  lastConnectionHttpStatus?: number | null;
  provisioningTimedOut?: boolean;
  provisioningError?: string;
}): MetrcSandboxUiStatus {
  if (input.provisioningTimedOut) return "timeout";
  if (input.provisioningError) return "error";
  if (input.sandboxProvisioning) {
    return input.hasUserApiKey ? "provisioning" : "awaiting_user_activation";
  }
  if (input.lastConnectionStatus === "connected" || input.credentialsReady) {
    return "connected";
  }
  const http = input.lastConnectionHttpStatus;
  if (http === 404) return "endpoint_unavailable";
  if (http === 401 || http === 403) return "auth_rejected";
  if (!input.sandboxReady && !input.credentialsReady) return "idle";
  if (input.credentialsReady && input.lastConnectionStatus === "not_connected") {
    return "auth_rejected";
  }
  return input.sandboxReady ? "connected" : "idle";
}

export function sandboxStatusLabel(status: MetrcSandboxUiStatus): string {
  switch (status) {
    case "provisioning":
      return "Provisioning sandbox facility…";
    case "awaiting_user_activation":
      return "Awaiting sandbox user activation";
    case "auth_rejected":
      return "Authorization rejected";
    case "connected":
      return "Connected";
    case "endpoint_unavailable":
      return "Endpoint unavailable";
    case "timeout":
      return "Provisioning timed out";
    case "error":
      return "Sandbox error";
    default:
      return "Not provisioned";
  }
}
