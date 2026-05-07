import { describe, expect, it } from "vitest";
import { buildMetrcAuthorization } from "./metrcAuthHeaders.js";

describe("buildMetrcAuthorization", () => {
  it("uses Basic auth when both vendor and user keys exist", () => {
    const r = buildMetrcAuthorization("vendor-secret", "user-secret");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.authMode).toBe("dual_key");
    expect(r.authorization.startsWith("Basic ")).toBe(true);
    const b64 = r.authorization.slice("Basic ".length);
    const decoded = Buffer.from(b64, "base64").toString("utf8");
    expect(decoded).toBe("vendor-secret:user-secret");
  });

  it("uses Bearer auth when only user key exists", () => {
    const r = buildMetrcAuthorization("", "only-user-key");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.authMode).toBe("single_key_fallback");
    expect(r.authorization).toBe("Bearer only-user-key");
  });

  it("uses Bearer when vendor is whitespace-only", () => {
    const r = buildMetrcAuthorization("   ", "user-key");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.authMode).toBe("single_key_fallback");
    expect(r.authorization).toBe("Bearer user-key");
  });

  it("fails when user key is missing", () => {
    const r = buildMetrcAuthorization("vendor-only", "");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(400);
    expect(r.message).toMatch(/user api key/i);
  });

  it("fails when both keys missing", () => {
    const r = buildMetrcAuthorization("", "");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(400);
  });
});
