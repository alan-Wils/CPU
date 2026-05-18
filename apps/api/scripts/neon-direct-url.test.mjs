import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { neonDirectDatabaseUrl } from "./neon-direct-url.mjs";

describe("neonDirectDatabaseUrl", () => {
  it("removes -pooler from Neon hostname", () => {
    const pool =
      "postgresql://user:pass@ep-snowy-recipe-aml16w9e-pooler.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require";
    const direct = neonDirectDatabaseUrl(pool);
    assert.match(direct, /ep-snowy-recipe-aml16w9e\.c-5\.us-east-1\.aws\.neon\.tech/);
    assert.doesNotMatch(direct, /-pooler/);
  });

  it("returns unchanged when already direct", () => {
    const url = "postgresql://user:pass@ep-abc.c-5.us-east-1.aws.neon.tech/db";
    assert.equal(neonDirectDatabaseUrl(url), url);
  });
});
