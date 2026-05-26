import { describe, expect, it } from "vitest";
import {
  buildMetrcTransfersListQueryString,
  buildMetrcTransfersSyncQueryParamVariants,
} from "./metrcTransfersActiveQuery.js";

describe("metrcTransfersActiveQuery", () => {
  it("omits date filters for sandbox template sync first variant", () => {
    const variants = buildMetrcTransfersSyncQueryParamVariants({
      direction: "template",
      licenseNumber: "SF-SBX-CO-7-13402",
      environment: "sandbox",
      facilityStartDate: "2026-01-01",
      pageNumber: 1,
      pageSize: 20,
    });
    expect(variants).toHaveLength(2);
    expect(variants[0]?.lastModifiedStart).toBeUndefined();
    expect(variants[1]?.lastModifiedStart).toBeDefined();
    expect(buildMetrcTransfersListQueryString(variants[0]!)).not.toContain("lastModifiedStart");
  });

  it("uses 365-day window for sandbox outgoing transfers", () => {
    const variants = buildMetrcTransfersSyncQueryParamVariants({
      direction: "outgoing",
      licenseNumber: "SF-SBX-CO-7-13402",
      environment: "sandbox",
      facilityStartDate: null,
      pageNumber: 1,
      pageSize: 20,
    });
    expect(variants).toHaveLength(1);
    expect(variants[0]?.lastModifiedStart).toBeDefined();
    expect(variants[0]?.lastModifiedEnd).toBeDefined();
  });
});
