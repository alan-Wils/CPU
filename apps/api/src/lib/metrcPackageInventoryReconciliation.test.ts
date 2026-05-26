import { describe, expect, it } from "vitest";
import {
  buildMetrcPackageInventoryReconciliation,
  collectNexbatchInventoryPackageRefs,
} from "./metrcPackageInventoryReconciliation.js";

describe("metrcPackageInventoryReconciliation", () => {
  it("matches METRC packages to LeafLink SKU and flags mismatches", () => {
    const nexbatchRefs = collectNexbatchInventoryPackageRefs({
      leafLinkItems: [
        {
          id: "ll-1",
          productName: "Live Sugar",
          sku: "1A4060300002EE1000000123",
          strain: "Guava",
          category: "Vault",
          productType: "Concentrate",
          subcategory: "",
          brand: "",
          availableQuantity: 500,
          unit: "Grams",
          packageSize: "",
          price: null,
          status: "active",
          updatedAt: "",
          imageUrl: "",
          sourcePackageGroup: "1A4060300002EE1000000123",
        },
      ],
      cultivationTransfers: [],
    });

    const { rows, summary } = buildMetrcPackageInventoryReconciliation({
      metrcPackages: [
        {
          packageLabel: "1A4060300002EE1000000123",
          itemName: "Live Sugar",
          quantity: 480,
          unitOfMeasure: "Grams",
          location: "Vault",
          strainName: "Guava",
        },
      ],
      nexbatchRefs,
    });

    expect(summary.quantityMismatch).toBe(1);
    expect(rows[0]?.status).toBe("quantity_mismatch");
    expect(rows[0]?.quantityDelta).toBe(-20);
  });

  it("reports metrc-only and nexbatch-only rows", () => {
    const nexbatchRefs = collectNexbatchInventoryPackageRefs({
      leafLinkItems: [
        {
          id: "ll-2",
          productName: "Only NexBatch",
          sku: "NB-ONLY",
          strain: "",
          category: "",
          productType: "",
          subcategory: "",
          brand: "",
          availableQuantity: 10,
          unit: "Each",
          packageSize: "",
          price: null,
          status: "active",
          updatedAt: "",
          imageUrl: "",
          sourcePackageGroup: "NB-ONLY",
        },
      ],
      cultivationTransfers: [],
    });

    const { rows, summary } = buildMetrcPackageInventoryReconciliation({
      metrcPackages: [
        {
          packageLabel: "METRC-ONLY",
          itemName: "X",
          quantity: 1,
          unitOfMeasure: "Each",
          location: "",
          strainName: "",
        },
      ],
      nexbatchRefs,
    });

    expect(summary.metrcOnly).toBe(1);
    expect(summary.nexbatchOnly).toBe(1);
    expect(rows.some((r) => r.status === "metrc_only")).toBe(true);
    expect(rows.some((r) => r.status === "nexbatch_only")).toBe(true);
  });
});
