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
const STORE_VERSION = process.env.NEXT_PUBLIC_STORE_VERSION || "v2";

function loadInitial(): StoreShape {
  if (typeof window !== "undefined") {
    try {
      const existingVersion = localStorage.getItem(STORE_VERSION_KEY);
      if (existingVersion !== STORE_VERSION) {
        localStorage.removeItem("cpuAppStore");
        localStorage.removeItem("cultivationStore");
        localStorage.setItem(STORE_VERSION_KEY, STORE_VERSION);
      }
    } catch {
      /* ignore */
    }
  }
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

const initial = loadInitial();

/**
 * In-memory workspace only. Business entities are loaded from the API per session;
 * do not persist them to localStorage (avoids cross-device stale merges).
 */
export const store: StoreShape = {
  ...initial,
  save() {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(STORE_VERSION_KEY, STORE_VERSION);
    } catch {
      /* ignore */
    }
  },
  persist() {
    this.save?.();
  }
};
