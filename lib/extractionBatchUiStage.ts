/**
 * Maps extraction batches to UI workflow stages (mirrors task gates in app/extraction/page.tsx).
 * Safe fallbacks use `status` when task logs look empty (legacy / partial data).
 */

const OPTIONAL_REPEATABLE_TASKS = ["Whip", "Adding Terps", "Print Batch Label"];

export type ExtractionUiStageKey = "prep" | "extraction" | "post" | "testing";

export const EXTRACTION_UI_STAGE_ORDER: ExtractionUiStageKey[] = [
  "prep",
  "extraction",
  "post",
  "testing",
];

export const EXTRACTION_UI_STAGE_META: Record<
  ExtractionUiStageKey,
  { label: string; helper: string }
> = {
  prep: {
    label: "Batch Prep / Staging",
    helper: "Sock packing, staging, and steps before the extraction run.",
  },
  extraction: {
    label: "Extraction",
    helper: "Run extraction on prepared biomass.",
  },
  post: {
    label: "Post Processing",
    helper: "Purge, whip, terp separation, decarb, add terps, and end purge.",
  },
  testing: {
    label: "Testing / Finishing",
    helper: "Lab testing, finish batch, and packaging handoff.",
  },
};

function getCompletedTasks(batch: any): string[] {
  if (!batch) return [];
  if (!Array.isArray(batch.completedTasks)) batch.completedTasks = [];
  return batch.completedTasks;
}

function getTestingStatus(batch: any): string {
  return batch?.taskData?.Testing?.testingStatus || "";
}

function taskDataShowsCompleted(batch: any, task: string): boolean {
  const td = batch?.taskData?.[task];
  if (td === undefined || td === null) return false;
  if (Array.isArray(td)) return td.length > 0;
  if (typeof td === "object") return Object.keys(td).length > 0;
  return Boolean(td);
}

/** Mirrors Extraction page `hasCompletedTask` for stage routing only. */
export function hasCompletedExtractionTask(batch: any, task: string): boolean {
  if (OPTIONAL_REPEATABLE_TASKS.includes(task)) {
    return (
      getCompletedTasks(batch).includes(task) ||
      getCompletedTasks(batch).some((t: string) => t.startsWith(`${task} `))
    );
  }
  if (task === "Testing") {
    return getTestingStatus(batch) === "Test Passed";
  }
  if (getCompletedTasks(batch).includes(task)) return true;
  return taskDataShowsCompleted(batch, task);
}

function hasTaskLikeEvidence(batch: any): boolean {
  if (getCompletedTasks(batch).length > 0) return true;
  const td = batch?.taskData;
  return td != null && typeof td === "object" && Object.keys(td).length > 0;
}

function statusFallbackStage(batch: any): ExtractionUiStageKey | null {
  const st = String(batch?.status || "").toLowerCase();
  if (!st) return null;
  if (
    st.includes("finished") ||
    st.includes("complete") ||
    st.includes("sent to packaging") ||
    st.includes("ready for packaging")
  ) {
    return "testing";
  }
  if (st.includes("purge active")) return "post";
  if (
    st.includes("ready for testing") ||
    st.includes("ready for finish") ||
    st.includes("test passed") ||
    st.includes("test failed")
  ) {
    return "testing";
  }
  if (st.includes("ready for start purge") || st.includes("ready for end purge")) return "post";
  if (st.includes("ready for run extraction")) return "extraction";
  if (st.includes("ready for pack")) return "prep";
  return null;
}

export function extractionUiStageFromBatch(batch: any): ExtractionUiStageKey {
  const fromTasks = (): ExtractionUiStageKey => {
    if (!hasCompletedExtractionTask(batch, "Pack Socks Stop")) return "prep";
    if (!hasCompletedExtractionTask(batch, "Run Extraction")) return "extraction";
    if (!hasCompletedExtractionTask(batch, "End Purge")) return "post";
    return "testing";
  };

  if (!hasTaskLikeEvidence(batch)) {
    const fb = statusFallbackStage(batch);
    if (fb) return fb;
  }

  return fromTasks();
}

export function groupExtractionBatchesByUiStage(
  batches: any[],
): Record<ExtractionUiStageKey, any[]> {
  const out: Record<ExtractionUiStageKey, any[]> = {
    prep: [],
    extraction: [],
    post: [],
    testing: [],
  };
  for (const b of batches) {
    out[extractionUiStageFromBatch(b)].push(b);
  }
  return out;
}
