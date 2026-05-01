import type { CheckParsedFlat } from "@cpu/shared";

export type ParsedCheckFields = CheckParsedFlat;

export {
  mergeCheckParsedPreferBetter,
  parseCheckOcrTextWithConfidence,
  parseCheckTextFromOcr,
  runLocalCheckOcr,
  toFlatParsedForApi,
  type LocalOcrBestResult,
  type OcrProgress,
  type OcrProgressPhase
} from "./checkRegionOcr";
