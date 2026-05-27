import { describe, expect, it } from "vitest";
import { buildMetrcPackageSyncDiagnostics } from "./metrcPackageSyncDiagnostics.js";

describe("buildMetrcPackageSyncDiagnostics", () => {
  it("reports counts and newest modified label", () => {
    const diagnostics = buildMetrcPackageSyncDiagnostics({
      rawMetrcPackageCount: 3,
      parsed: [
        {
          packageLabel: "AAA00090000196B000000001",
          itemName: "A",
          quantity: 1,
          unitOfMeasure: "Grams",
          location: "",
          productionBatchNumber: "",
          sourceHarvestNames: "",
          packagedDate: null,
          expirationDate: null,
          strainName: "",
          raw: { LastModified: "2026-05-20T10:00:00Z" },
        },
        {
          packageLabel: "AAA00090000196B000000002",
          itemName: "B",
          quantity: 2,
          unitOfMeasure: "Grams",
          location: "",
          productionBatchNumber: "",
          sourceHarvestNames: "",
          packagedDate: null,
          expirationDate: null,
          strainName: "",
          raw: { LastModified: "2026-05-26T12:00:00Z" },
        },
      ],
      pagesFetched: 2,
    });

    expect(diagnostics.rawMetrcPackageCount).toBe(3);
    expect(diagnostics.filteredPackageCount).toBe(2);
    expect(diagnostics.newestPackageLabel).toBe("AAA00090000196B000000002");
    expect(diagnostics.returnedLabels[0]).toBe("AAA00090000196B000000002");
    expect(diagnostics.pagesFetched).toBe(2);
  });
});
