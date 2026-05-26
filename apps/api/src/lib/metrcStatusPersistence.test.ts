import { describe, expect, it } from "vitest";
import {
  applyMetrcSuccessStatus,
  formatMetrcFailureMessage,
  formatMetrcSuccessMessage,
} from "./metrcStatusPersistence.js";

describe("metrcStatusPersistence", () => {
  it("formats success messages for sync actions", () => {
    expect(formatMetrcSuccessMessage({ kind: "connection_test" })).toBe("Connection successful.");
    expect(formatMetrcSuccessMessage({ kind: "locations_sync", count: 1 })).toBe(
      "Synced 1 location.",
    );
    expect(formatMetrcSuccessMessage({ kind: "strains_sync", count: 0 })).toBe("Synced 0 strains.");
    expect(formatMetrcSuccessMessage({ kind: "packages_sync", count: 0 })).toBe(
      "Synced 0 packages.",
    );
    expect(formatMetrcSuccessMessage({ kind: "facilities_sync", count: 2 })).toBe(
      "Synced 2 facilities.",
    );
  });

  it("formats failure messages by HTTP status", () => {
    expect(formatMetrcFailureMessage(401)).toBe("Authentication failed.");
    expect(formatMetrcFailureMessage(403)).toBe("Operational access denied.");
    expect(formatMetrcFailureMessage(500)).toBe("METRC service error.");
  });

  it("clears stale failure fields on success", () => {
    const next = applyMetrcSuccessStatus(
      {
        metrcLastMetrcResponseMessage: "METRC returned HTTP 401.",
        lastError: "old",
        lastFailureReason: "old",
      },
      {
        httpStatus: 200,
        message: "Synced 1 location.",
        totalLocationsSynced: 1,
      },
    );
    expect(next.metrcLastConnectionHttpStatus).toBe(200);
    expect(next.metrcLastMetrcResponseMessage).toBe("Synced 1 location.");
    expect(next.lastError).toBeNull();
    expect(next.lastFailureReason).toBeNull();
    expect(next.totalLocationsSynced).toBe(1);
  });
});
