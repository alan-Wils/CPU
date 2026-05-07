export type MetrcAuthMode = "dual_key" | "single_key_fallback";

export type MetrcAuthorizationOk = {
  ok: true;
  authorization: string;
  authMode: MetrcAuthMode;
};

export type MetrcAuthorizationErr = {
  ok: false;
  status: number;
  message: string;
};

export type MetrcAuthorizationResult = MetrcAuthorizationOk | MetrcAuthorizationErr;

export function isMetrcAuthorizationErr(r: MetrcAuthorizationResult): r is MetrcAuthorizationErr {
  return r.ok === false;
}

/**
 * METRC HTTP Authorization header.
 * - Dual-key: Basic base64(vendorKey:userKey) (official integrator + user).
 * - Single-key fallback: Bearer {userKey} (dev / facilities without vendor key yet).
 */
export function buildMetrcAuthorization(vendorKey: string, userKey: string): MetrcAuthorizationResult {
  const v = String(vendorKey || "").trim();
  const u = String(userKey || "").trim();

  if (!u) {
    return {
      ok: false,
      status: 400,
      message: "User API key is required. Save a facility user key before testing.",
    };
  }

  if (v) {
    const token = Buffer.from(`${v}:${u}`, "utf8").toString("base64");
    return {
      ok: true,
      authorization: `Basic ${token}`,
      authMode: "dual_key",
    };
  }

  return {
    ok: true,
    authorization: `Bearer ${u}`,
    authMode: "single_key_fallback",
  };
}
