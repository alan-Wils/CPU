/** Safe parse + log helpers for POST /sandbox/v2/integrator/setup responses. */

const SECRET_KEY_RE =
  /^(apikey|api_key|userapikey|userkey|user_key|vendorapikey|vendorkey|password|secret|token|authorization|key)$/i;

const USER_KEY_ALIASES = new Set([
  "userapikey",
  "userkey",
  "apikey",
  "password",
  "key",
]);

const LICENSE_ALIASES = new Set([
  "facilitylicensenumber",
  "licensenumber",
  "facilitylicense",
  "license",
]);

const USERNAME_ALIASES = new Set(["username", "user", "login", "email"]);

const FACILITY_NAME_ALIASES = new Set(["facilityname", "name"]);

export type MetrcSandboxSetupParsed = {
  userApiKey: string;
  facilityLicenseNumber: string;
  username: string;
  facilityName: string;
  parserPaths: {
    userApiKey: string | null;
    facilityLicenseNumber: string | null;
    username: string | null;
    facilityName: string | null;
  };
  fieldsFound: string[];
  /** Human-readable status lines from METRC setup response (no secrets). */
  provisioningMessages: string[];
};

export type MetrcSandboxSetupDebugInfo = {
  topLevelKeys: string[];
  fieldsFound: string[];
  parserPaths: MetrcSandboxSetupParsed["parserPaths"];
  structureOutline: unknown;
};

/** Extract human-readable text from METRC setup response bodies. */
export function extractMetrcSandboxResponseText(body: unknown): string {
  if (typeof body === "string") return body.trim();
  if (body == null) return "";
  if (Array.isArray(body)) {
    return body
      .map((item) => extractMetrcSandboxResponseText(item))
      .filter(Boolean)
      .join(" ");
  }
  if (typeof body === "object") {
    const r = body as Record<string, unknown>;
    const direct = r.message ?? r.Message ?? r.status ?? r.Status ?? r.detail ?? r.Detail;
    if (typeof direct === "string" && direct.trim()) return direct.trim();
    return JSON.stringify(body);
  }
  return String(body);
}

/** METRC sandbox setup is still creating the facility user (HTTP 202 or known message). */
export function isMetrcSandboxAsyncProvisioningResponse(
  httpStatus: number,
  body: unknown,
): boolean {
  if (httpStatus === 202) return true;
  const msg = extractMetrcSandboxResponseText(body).toLowerCase();
  return (
    msg.includes("user creation is in process")
    || msg.includes("user creation is in progress")
    || msg.includes("creation is in process")
  );
}

/** Facility metadata returned but user API key not yet available — keep polling. */
export function isMetrcSandboxPartialProvisioning(
  parsed: MetrcSandboxSetupParsed,
  httpStatus: number,
  body: unknown,
): boolean {
  if (isMetrcSandboxAsyncProvisioningResponse(httpStatus, body)) return true;
  if (parsed.userApiKey) return false;
  return Boolean(parsed.facilityLicenseNumber || parsed.facilityName || parsed.username);
}

function normalizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s.length > 0 ? s : null;
}

function isSecretKeyName(key: string): boolean {
  return SECRET_KEY_RE.test(normalizeKey(key));
}

/** Redact secret-like values; keep structure and non-secret scalars for logs. */
export function redactMetrcSandboxPayload(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[max-depth]";
  if (value == null) return value;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redactMetrcSandboxPayload(item, depth + 1));
  }
  if (typeof value !== "object") {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretKeyName(key)) {
      const s = nonEmptyString(raw);
      out[key] = s ? `[redacted:${s.length}chars]` : null;
      continue;
    }
    if (raw && typeof raw === "object") {
      out[key] = redactMetrcSandboxPayload(raw, depth + 1);
      continue;
    }
    out[key] = raw;
  }
  return out;
}

/** Compact outline: keys, array lengths, and value types (no secret values). */
export function outlineMetrcSandboxPayload(value: unknown, depth = 0): unknown {
  if (depth > 6) return "...";
  if (value == null) return value;
  if (Array.isArray(value)) {
    return {
      _type: "array",
      length: value.length,
      sample: value.length ? outlineMetrcSandboxPayload(value[0], depth + 1) : null,
    };
  }
  if (typeof value !== "object") {
    return typeof value;
  }
  const outline: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretKeyName(key)) {
      const s = nonEmptyString(raw);
      outline[key] = s ? `secret(${s.length})` : "empty";
      continue;
    }
    outline[key] = outlineMetrcSandboxPayload(raw, depth + 1);
  }
  return outline;
}

function getAtPath(root: unknown, path: string[]): unknown {
  let cur: unknown = root;
  for (const seg of path) {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(seg);
      cur = Number.isFinite(idx) ? cur[idx] : undefined;
      continue;
    }
    cur = asRecord(cur)[seg];
  }
  return cur;
}

function listPathAttempts(): Array<{ path: string[]; field: keyof MetrcSandboxSetupParsed["parserPaths"]; source: string }> {
  const prefixes = ["", "data", "Data", "credentials", "Credentials", "result", "Result", "setupDetails", "SetupDetails", "integrator", "Integrator"];
  const attempts: Array<{ path: string[]; field: keyof MetrcSandboxSetupParsed["parserPaths"]; source: string }> = [];

  const add = (field: keyof MetrcSandboxSetupParsed["parserPaths"], tail: string[], keys: string[]) => {
    for (const prefix of prefixes) {
      for (const key of keys) {
        const path = prefix ? [prefix, key] : [key];
        attempts.push({ path, field, source: path.join(".") });
      }
    }
  };

  add("userApiKey", [], [
    "userApiKey",
    "UserApiKey",
    "userKey",
    "UserKey",
    "password",
    "Password",
    "key",
    "Key",
  ]);
  add("facilityLicenseNumber", [], [
    "facilityLicenseNumber",
    "FacilityLicenseNumber",
    "licenseNumber",
    "LicenseNumber",
    "facilityLicense",
    "FacilityLicense",
    "license",
    "License",
  ]);
  add("username", [], ["username", "Username", "userName", "UserName", "login", "Login"]);
  add("facilityName", [], ["facilityName", "FacilityName", "name", "Name"]);

  return attempts;
}

function deepFindByAliases(
  value: unknown,
  aliases: Set<string>,
  opts: { vendorApiKey?: string; facilityContext?: boolean },
  path: string[] = [],
  depth = 0,
): { value: string; source: string } | null {
  if (depth > 10 || value == null) return null;

  if (Array.isArray(value)) {
    for (let i = 0; i < Math.min(value.length, 10); i++) {
      const hit = deepFindByAliases(value[i], aliases, opts, [...path, String(i)], depth + 1);
      if (hit) return hit;
    }
    return null;
  }

  if (typeof value !== "object") return null;

  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const nk = normalizeKey(key);
    const nextPath = [...path, key];

    if (aliases.has(nk)) {
      if (FACILITY_NAME_ALIASES.has(nk) && opts.facilityContext && !nextPath.join(".").toLowerCase().includes("facility")) {
        // skip generic "name" unless under a facility-like parent
      } else {
        const s = nonEmptyString(raw);
        if (s) {
          if (USER_KEY_ALIASES.has(nk) && opts.vendorApiKey && s === opts.vendorApiKey) {
            // skip vendor key echoed as apiKey
          } else {
            return { value: s, source: nextPath.join(".") };
          }
        }
      }
    }

    if (raw && typeof raw === "object") {
      const hit = deepFindByAliases(raw, aliases, opts, nextPath, depth + 1);
      if (hit) return hit;
    }
  }

  return null;
}

function topLevelKeys(body: unknown): string[] {
  if (Array.isArray(body)) {
    return body.length ? [`[array:${body.length}]`, ...topLevelKeys(body[0])] : ["[array:0]"];
  }
  if (body && typeof body === "object") {
    return Object.keys(body as Record<string, unknown>).sort();
  }
  return [typeof body];
}

/**
 * Parse METRC sandbox integrator setup JSON into normalized credential fields.
 */
export function parseMetrcSandboxSetupResponse(
  body: unknown,
  opts?: { vendorApiKey?: string },
): MetrcSandboxSetupParsed {
  const vendorApiKey = String(opts?.vendorApiKey || "").trim();
  const roots: unknown[] = [];
  if (Array.isArray(body)) {
    roots.push(...body);
  } else {
    roots.push(body);
    const r = asRecord(body);
    if (r.Data != null) roots.push(r.Data);
    if (r.data != null) roots.push(r.data);
    if (r.credentials != null) roots.push(r.credentials);
    if (r.Credentials != null) roots.push(r.Credentials);
    if (r.result != null) roots.push(r.result);
    if (r.Result != null) roots.push(r.Result);
  }

  const parserPaths: MetrcSandboxSetupParsed["parserPaths"] = {
    userApiKey: null,
    facilityLicenseNumber: null,
    username: null,
    facilityName: null,
  };
  const out: Omit<MetrcSandboxSetupParsed, "parserPaths" | "fieldsFound" | "provisioningMessages"> = {
    userApiKey: "",
    facilityLicenseNumber: "",
    username: "",
    facilityName: "",
  };

  const attempts = listPathAttempts();

  for (const root of roots) {
    for (const attempt of attempts) {
      const field = attempt.field as keyof Omit<MetrcSandboxSetupParsed, "parserPaths" | "fieldsFound" | "provisioningMessages">;
      if (out[field]) continue;
      const raw = getAtPath(root, attempt.path);
      const s = nonEmptyString(raw);
      if (!s) continue;
      if (field === "userApiKey" && vendorApiKey && s === vendorApiKey) continue;
      out[field] = s;
      parserPaths[field] = attempt.source;
    }
  }

  for (const root of roots) {
    if (!out.userApiKey) {
      const hit = deepFindByAliases(root, USER_KEY_ALIASES, { vendorApiKey });
      if (hit) {
        out.userApiKey = hit.value;
        parserPaths.userApiKey = hit.source;
      }
    }
    if (!out.facilityLicenseNumber) {
      const hit = deepFindByAliases(root, LICENSE_ALIASES, {});
      if (hit) {
        out.facilityLicenseNumber = hit.value;
        parserPaths.facilityLicenseNumber = hit.source;
      }
    }
    if (!out.username) {
      const hit = deepFindByAliases(root, USERNAME_ALIASES, {});
      if (hit) {
        out.username = hit.value;
        parserPaths.username = hit.source;
      }
    }
    if (!out.facilityName) {
      const hit = deepFindByAliases(root, FACILITY_NAME_ALIASES, { facilityContext: true });
      if (hit) {
        out.facilityName = hit.value;
        parserPaths.facilityName = hit.source;
      }
    }
  }

  const fieldsFound = (Object.keys(out) as Array<keyof typeof out>).filter((k) => Boolean(out[k]));

  const responseText = extractMetrcSandboxResponseText(body);
  const provisioningMessages = responseText ? [responseText.slice(0, 2000)] : [];

  return { ...out, parserPaths, fieldsFound, provisioningMessages };
}

export function buildMetrcSandboxSetupDebug(
  body: unknown,
  parsed: MetrcSandboxSetupParsed,
): MetrcSandboxSetupDebugInfo {
  return {
    topLevelKeys: topLevelKeys(body),
    fieldsFound: parsed.fieldsFound,
    parserPaths: parsed.parserPaths,
    structureOutline: outlineMetrcSandboxPayload(body),
  };
}
