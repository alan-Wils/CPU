type StoreShape = {
  cultivationBatches: any[];
  completedCultivationBatches: any[];
  dryFlowerBatches: any[];
  productionBatches: any[];
  sourceBatches: any[];
  extractionBatches: any[];
  packagingBatches: any[];
  logs: any[];
  save?: () => void;
  persist?: () => void;
};

function loadInitial(): StoreShape {
  if (typeof window === "undefined") {
    return {
      cultivationBatches: [],
      completedCultivationBatches: [],
      dryFlowerBatches: [],
      productionBatches: [],
      sourceBatches: [],
      extractionBatches: [],
      packagingBatches: [],
      logs: []
    };
  }
  try {
    const raw = localStorage.getItem("cpuAppStore") || localStorage.getItem("cultivationStore");
    if (!raw) {
      throw new Error("No local snapshot");
    }
    const parsed = JSON.parse(raw) as Partial<StoreShape>;
    return {
      cultivationBatches: parsed.cultivationBatches ?? [],
      completedCultivationBatches: parsed.completedCultivationBatches ?? [],
      dryFlowerBatches: parsed.dryFlowerBatches ?? [],
      productionBatches: parsed.productionBatches ?? [],
      sourceBatches: parsed.sourceBatches ?? [],
      extractionBatches: (parsed as any).extractionBatches ?? [],
      packagingBatches: parsed.packagingBatches ?? [],
      logs: parsed.logs ?? []
    };
  } catch {
    return {
      cultivationBatches: [],
      completedCultivationBatches: [],
      dryFlowerBatches: [],
      productionBatches: [],
      sourceBatches: [],
      extractionBatches: [],
      packagingBatches: [],
      logs: []
    };
  }
}

const initial = loadInitial();

export const store: StoreShape = {
  ...initial,
  save() {
    if (typeof window === "undefined") return;
    localStorage.setItem(
      "cpuAppStore",
      JSON.stringify({
        cultivationBatches: this.cultivationBatches,
        completedCultivationBatches: this.completedCultivationBatches,
        dryFlowerBatches: this.dryFlowerBatches,
        productionBatches: this.productionBatches,
        sourceBatches: this.sourceBatches,
        extractionBatches: this.extractionBatches,
        packagingBatches: this.packagingBatches,
        logs: this.logs
      })
    );
  },
  persist() {
    this.save?.();
  }
};
