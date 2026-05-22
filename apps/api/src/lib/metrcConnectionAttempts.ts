/**
 * Labels for METRC GET /locations/v2/active connection-test attempts (no secrets).
 */
export type MetrcAuthModeUsed =
  | "vendor_only"
  | "sandbox_x_metrc_key"
  | "sandbox_x_metrc_key_and_user_key_header"
  | "sandbox_x_metrc_key_and_userkey_header"
  | "sandbox_x_metrc_key_and_x_user_key"
  | "sandbox_basic_license_user"
  | "sandbox_basic_vendor_user"
  | "sandbox_bearer_user"
  | "production_x_metrc_key"
  | "production_x_metrc_key_and_user_key"
  | "production_x_metrc_key_and_userkey"
  | "dual_key_basic"
  | "bearer_user"
  | "basic_user_colon"
  | "basic_colon_user"
  | "basic_vendor_user"
  | "x_metrc_key_header"
  | "x_metrc_key_and_user_key_header"
  | "x_metrc_key_and_userkey_header";

export type MetrcAttemptFailure = {
  mode: MetrcAuthModeUsed;
  status: number;
  durationMs: number;
  /** Short safe excerpt from METRC JSON/text when available */
  metrcSnippet: string | null;
};

export function buildAuthorizationHeader(
  mode: MetrcAuthModeUsed,
  vendorKey: string,
  userKey: string,
): string | null {
  const v = String(vendorKey || "").trim();
  const u = String(userKey || "").trim();
  if (!u) return null;

  switch (mode) {
    case "dual_key_basic":
      if (!v) return null;
      return `Basic ${Buffer.from(`${v}:${u}`, "utf8").toString("base64")}`;
    case "bearer_user":
      return `Bearer ${u}`;
    case "basic_user_colon":
      return `Basic ${Buffer.from(`${u}:`, "utf8").toString("base64")}`;
    case "basic_colon_user":
      return `Basic ${Buffer.from(`:${u}`, "utf8").toString("base64")}`;
    default:
      return null;
  }
}

/** Order per product spec: dual-key first when vendor exists; else Bearer → Basic(user:) → Basic(:user). */
export function buildMetrcAttemptPlan(hasVendorKey: boolean): MetrcAuthModeUsed[] {
  if (hasVendorKey) {
    return ["dual_key_basic", "bearer_user", "basic_user_colon", "basic_colon_user"];
  }
  return ["bearer_user", "basic_user_colon", "basic_colon_user"];
}
