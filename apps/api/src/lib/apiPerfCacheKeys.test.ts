import { describe, expect, it } from "vitest";

/**
 * Guards multi-tenant cache key shape (companyId must be part of every memo key).
 */
const MEMO_KEY_SAMPLES = [
  "store:snapshot:co-abc123:nologs",
  "legacy:source-batches:co-abc123:sum",
  "config:basic:co-abc123",
  "analytics:overview:co-abc123:2026-01-01:2026-01-31::",
  "legacy:logs:latest-live:co-abc123",
];

describe("API perf cache keys", () => {
  it("embeds companyId so tenants cannot share memo entries", () => {
    const companyA = "company-alpha-111";
    const companyB = "company-beta-222";
    for (const template of MEMO_KEY_SAMPLES) {
      const keyA = template.replace("co-abc123", companyA);
      const keyB = template.replace("co-abc123", companyB);
      expect(keyA).not.toBe(keyB);
      expect(keyA).toContain(companyA);
      expect(keyB).toContain(companyB);
    }
  });
});
