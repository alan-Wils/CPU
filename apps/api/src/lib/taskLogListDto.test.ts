import { describe, expect, it } from "vitest";
import { taskLogToListRow } from "./taskLogListDto.js";

describe("taskLogToListRow", () => {
  it("omits output and large data blobs from list rows", () => {
    const huge = "x".repeat(8_000);
    const row = taskLogToListRow(
      {
        id: "log1",
        actorUserId: "user1",
        stage: "CULTIVATION",
        minutes: 12,
        referenceId: "batch-1",
        createdAt: new Date("2026-05-01T12:00:00.000Z"),
        note: JSON.stringify({
          area: "Cultivation",
          batch: "batch-1",
          task: "Harvest",
          output: huge,
          data: { snapshot: huge, people: "A", minutes: 12 },
        }),
      },
      { userId: "user1", username: "Alex", email: "alex@example.com", role: "ADMIN" },
    );
    expect(row.loggedBy.username).toBe("Alex");
    expect(row).not.toHaveProperty("output");
    expect(row).not.toHaveProperty("data");
    expect(row).not.toHaveProperty("time");
    const json = JSON.stringify([row]);
    expect(json.length).toBeLessThan(600);
  });
});
