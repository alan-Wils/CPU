import { describe, expect, it } from "vitest";
import { buildExtractionBatchSheetModel } from "@/lib/extractionBatchSheet";
import {
  buildMipSamplePlanModel,
  buildMipSamplePlanPrintHtml,
  readMipSamplePlanFacilityFromConfig,
} from "@/lib/mipSamplePlan";

describe("mipSamplePlan", () => {
  it("reads facility from company config", () => {
    const fac = readMipSamplePlanFacilityFromConfig({
      extraction: {
        mipSamplePlan: {
          businessName: "Test Co",
          businessLicenseId: "LIC-1",
        },
      },
    });
    expect(fac.businessName).toBe("Test Co");
    expect(fac.businessLicenseId).toBe("LIC-1");
  });

  it("prefills containers and MIP form fields from batch sources", () => {
    const process = buildExtractionBatchSheetModel(
      {
        id: "EXT-1",
        marketBatchCode: "GMO.051226",
        productType: "Live Resin Oil",
        sourceBlendLabel: "GMO",
        sources: [{ sourceId: "P1", name: "GMO", amountUsed: 5 }],
      },
      {
        resolveSource: () => ({
          metrcTag: "TAG-ABC",
          harvestCode: "GMO.020926",
          type: "Fresh Frozen",
        }),
      },
    );
    const mip = buildMipSamplePlanModel({ id: "EXT-1", taskData: { Testing: { tests: ["Potency", "Metals"] } } }, process);
    expect(mip.productionBatchId).toBe("GMO.051226");
    expect(mip.containers[0].metrc).toBe("TAG-ABC");
    expect(mip.testedMarks.Potency).toBe(true);
    expect(mip.testedMarks.Metals).toBe(true);
    const html = buildMipSamplePlanPrintHtml(mip);
    expect(html).toContain("MIP Sample Plan");
    expect(html).toContain("Sheet 2 of 2");
    expect(html).toContain("0.25");
  });
});
