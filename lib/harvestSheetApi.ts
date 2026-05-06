import { apiRequest } from "@/lib/api";

export type HarvestSheetUploadResponse = {
  imageUrl: string;
  storedPath: string;
  mimeType: string;
  bytes: number;
};

export async function uploadHarvestSheetImage(
  imageBase64: string,
  mimeType: string,
): Promise<HarvestSheetUploadResponse> {
  return apiRequest("/api/harvest-sheet/upload", {
    method: "POST",
    body: { imageBase64, mimeType },
  });
}

export type HarvestSheetExtractRow = {
  tag: string;
  weightValue: number | null;
  unitGuess: string;
};

export type HarvestSheetExtractResponse = {
  rows: HarvestSheetExtractRow[];
  bundles: number | null;
  totalGrams: number | null;
  notes: string;
  warnings: string[];
  model: string;
};

export async function extractHarvestSheet(body: {
  storedPath?: string;
  storedPaths?: string[];
  plantsHarvested?: number;
}): Promise<HarvestSheetExtractResponse> {
  return apiRequest("/api/harvest-sheet/extract", {
    method: "POST",
    body,
  });
}
