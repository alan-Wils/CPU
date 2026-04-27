export type MetrcSyncStatus = "not_synced" | "ready_to_sync" | "synced" | "error";

export type CultivationBatch = {
  id: string;
  dbId?: string;
  strain: string;
  stage: string;
  status?: string;
  plants: number;
  originalPlants?: number;
  createdAt?: string;
  completedAt?: string;
  metrcSourceMotherPlantTag?: string;
  metrcFirstPlantTag?: string;
  metrcPlantTags?: string[];
  metrcTagCreatedAt?: string;
  metrcTagPlantCount?: number;
  metrcLocationName?: string;
  metrcSublocationName?: string;
  metrcActualDate?: string;
  metrcSyncStatus?: MetrcSyncStatus;
  [key: string]: unknown;
};

type StoreShape = {
  cultivationBatches: CultivationBatch[];
  completedCultivationBatches: CultivationBatch[];
  dryFlowerBatches: any[];
  productionBatches: any[];
  sourceBatches: any[];
  extractionBatches: any[];
  packagingBatches: any[];
  logs: any[];
  save?: () => void;
  persist?: () => void;
};

const STORE_VERSION_KEY = "cpuAppStoreVersion";
const STORE_VERSION = process.env.NEXT_PUBLIC_STORE_VERSION || "v1";

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
    const existingVersion = localStorage.getItem(STORE_VERSION_KEY);
    if (existingVersion !== STORE_VERSION) {
      localStorage.removeItem("cpuAppStore");
      localStorage.removeItem("cultivationStore");
      localStorage.setItem(STORE_VERSION_KEY, STORE_VERSION);
    }
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
    localStorage.setItem(STORE_VERSION_KEY, STORE_VERSION);
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
