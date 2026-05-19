import { describe, expect, it } from "vitest";
import { loggedByFromTaskLogNote, resolveLoggedByForRow } from "./taskLogActorLookup.js";

describe("taskLogActorLookup", () => {
  it("falls back to note data.loggedBy when actor user is missing", () => {
    const note = JSON.stringify({
      task: "Combine Batches",
      data: {
        loggedBy: { username: "Jordan", email: "jordan@example.com", role: "EXTRACTION_SPECIALIST" },
      },
    });
    const row = { actorUserId: "deleted-user", note };
    const resolved = resolveLoggedByForRow(row, new Map());
    expect(resolved.username).toBe("Jordan");
    expect(resolved.role).toBe("EXTRACTION_SPECIALIST");
  });

  it("prefers database user over note snapshot", () => {
    const note = JSON.stringify({
      data: { loggedBy: { username: "Old Name", email: "old@example.com" } },
    });
    const users = new Map([
      ["u1", { userId: "u1", username: "Current Name", email: "cur@example.com", role: "ADMIN" }],
    ]);
    const resolved = resolveLoggedByForRow({ actorUserId: "u1", note }, users);
    expect(resolved.username).toBe("Current Name");
  });

  it("parses loggedBy from note via helper", () => {
    const lb = loggedByFromTaskLogNote(
      JSON.stringify({ data: { loggedBy: { username: "Sam", email: "sam@test.com" } } }),
    );
    expect(lb?.username).toBe("Sam");
  });
});
