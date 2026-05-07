import { describe, expect, it } from "vitest";
import {
  buildAuthorizationHeader,
  buildMetrcAttemptPlan,
} from "./metrcConnectionAttempts.js";

describe("buildMetrcAttemptPlan", () => {
  it("dual-key first when vendor exists", () => {
    expect(buildMetrcAttemptPlan(true)).toEqual([
      "dual_key_basic",
      "bearer_user",
      "basic_user_colon",
      "basic_colon_user",
    ]);
  });

  it("user-only modes when no vendor", () => {
    expect(buildMetrcAttemptPlan(false)).toEqual([
      "bearer_user",
      "basic_user_colon",
      "basic_colon_user",
    ]);
  });
});

describe("buildAuthorizationHeader", () => {
  it("dual_key_basic", () => {
    const h = buildAuthorizationHeader("dual_key_basic", "V", "U");
    expect(h?.startsWith("Basic ")).toBe(true);
    expect(Buffer.from(h!.slice(6), "base64").toString("utf8")).toBe("V:U");
  });

  it("bearer_user", () => {
    expect(buildAuthorizationHeader("bearer_user", "", "tok")).toBe("Bearer tok");
  });

  it("basic_user_colon", () => {
    const h = buildAuthorizationHeader("basic_user_colon", "", "tok");
    expect(Buffer.from(h!.slice(6), "base64").toString("utf8")).toBe("tok:");
  });

  it("basic_colon_user", () => {
    const h = buildAuthorizationHeader("basic_colon_user", "", "tok");
    expect(Buffer.from(h!.slice(6), "base64").toString("utf8")).toBe(":tok");
  });

  it("dual_key_basic returns null without vendor", () => {
    expect(buildAuthorizationHeader("dual_key_basic", "", "U")).toBeNull();
  });
});
