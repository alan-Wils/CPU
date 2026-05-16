"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { hasAppPermission } from "@cpu/shared";
import SectionCalendarLauncher from "@/components/SectionCalendarLauncher";
import { getAuthUser } from "@/lib/auth";
import { CPU_TENANT_CHANGED_EVENT } from "@/lib/tenantEvents";
import {
  createEdibleBatch,
  deleteEdibleBatch,
  fetchEdibleOilOptionByRunId,
  fetchEdiblesDashboard,
  fetchEdiblesOilOptions,
  patchEdibleBatch,
  postEdibleQa,
  postEdibleQaManagerReview,
  postEdibleTaskLog,
  postEdibleTransferPackaging,
  type EdibleBatchCreated,
  type EdibleDashboardBatch,
  type EdibleDashboardJson,
  type EdibleOilOption,
} from "@/lib/ediblesApi";
import {
  buildSnapshotFromMulti,
  buildSnapshotFromSingle,
  formatPectinReadableHeader,
  mergeUserNotesAndPectinPlan,
  postPectinKitchenIngredients,
  type PectinMeltFormulaSnapshot,
} from "@/lib/ediblesPectinBatchNotes";
import {
  additiveMassFractionFromGoals,
  estimatedGummyWeightGramsFromMoldMl,
  planPectinMultiAdditiveBatch,
  planPectinSingleAdditiveBatch,
} from "@/lib/ediblesPectinFormula";

const EDIBLE_STAGES = [
  "OIL_INTAKE",
  "RECIPE",
  "KITCHEN_PREP",
  "PRODUCTION",
  "CURE",
  "QA",
  "PACKAGING_TRANSFER",
  "COMPLETED",
] as const;

const STAGE_LABELS: Record<string, string> = {
  OIL_INTAKE: "Oil Intake",
  RECIPE: "Recipe",
  KITCHEN_PREP: "Kitchen Prep",
  PRODUCTION: "Production",
  CURE: "Cure",
  QA: "QA",
  PACKAGING_TRANSFER: "Packaging Transfer",
  COMPLETED: "Completed",
};

const PRODUCT_TYPES = ["Gummies", "Chocolates", "Syrups", "Capsules", "Tinctures"] as const;

/** Melt-to-Make workbook Part B — citric as % of total formula (not editable in UI). */
const WORKBOOK_CITRIC_PCT = 1.4 as const;
const WORKBOOK_CITRIC_MASS_FRAC = WORKBOOK_CITRIC_PCT / 100;

/** Line loss on nominal piece count — workbook default 5%. */
const WORKBOOK_LINE_WASTE_FRAC = 0.05 as const;

/** COA THC as mass fraction of oil (0–1) → mg THC per gram oil for batch records (same oil used in kitchen + melt math). */
function mgThcPerGramOilFromCoaMassFraction(frac: number): number {
  if (!Number.isFinite(frac) || frac <= 0) return 0;
  return frac * 1000;
}

function pctOfFormula(frac: number): string {
  if (!Number.isFinite(frac)) return "—";
  return `${(frac * 100).toFixed(2)}%`;
}

const KITCHEN_PREP_TASKS = [
  "Ingredient Staging",
  "Oil Prep",
  "Mold Prep",
  "Kitchen Sanitation",
  "Scale Verification",
] as const;

const PRODUCTION_TASKS = [
  "Mixing",
  "Infusion",
  "Heating/Cooking",
  "Depositing",
  "Tray Filling",
  "Mold Filling",
  "Cooling",
] as const;

const CURE_TASKS = ["Cure Start", "Cure Complete", "Drying", "Demolding"] as const;

const QA_TASKS = [
  "Potency Submitted",
  "Homogeneity Submitted",
  "Microbial Submitted",
  "Passed",
  "Failed",
] as const;

const PACK_TRANSFER_TASKS = ["Transfer To Packaging", "Create Packaging Batch", "Finalize Edible Batch"] as const;

const CALENDAR_TASK_SUGGESTIONS = [
  ...KITCHEN_PREP_TASKS,
  ...PRODUCTION_TASKS,
  ...CURE_TASKS,
  ...QA_TASKS,
  ...PACK_TRANSFER_TASKS,
];

type PectinMultiRow = { goalMg: number; potencyFrac: number };

/** Drive total formula mass from target pieces × weight, or from grams of Part A on hand (inverted workbook math). */
type GummyBatchDriveMode = "pieces" | "partA";

type GummyFormulaSizingResult =
  | { ok: true; batchG: number; nominalPiecesDisplay: number }
  | { ok: false; error: string };

type EdibleCreatePrintSummary = {
  created: EdibleBatchCreated;
  sku: string;
  flavor: string;
  productType: string;
  targetMgPerPiece: number;
  targetPieces: number;
  oilInputGrams: number;
  potencyMgPerGram: number | null;
  /** THC mass fraction in oil (0–1) used to derive potencyMgPerGram. */
  oilPotencyMassFraction: number | null;
  extractionRunLabel: string | null;
  projectedTotalMg: number;
  projectedEstPieces: number;
  pectinMode: "single" | "multi" | null;
  pectinSnapshot: PectinMeltFormulaSnapshot | null;
  ingredientNotes: string;
  productionNotes: string;
};

function parseExtraMassFractionsCsv(raw: string): number[] {
  if (!raw.trim()) return [];
  const parts = raw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
  const out: number[] = [];
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isFinite(v) || v < 0 || v > 0.5) {
      throw new Error(`Extra mass fraction must be between 0 and 0.5 (invalid token: "${p}")`);
    }
    out.push(v);
  }
  return out;
}

const cardStyle: React.CSSProperties = {
  background: "linear-gradient(145deg, rgba(15,23,42,0.92), rgba(2,6,23,0.96))",
  border: "1px solid rgba(148, 163, 184, 0.22)",
  borderRadius: 18,
  padding: 20,
  boxShadow: "0 18px 48px rgba(0,0,0,0.35)",
};

const glassKpi: React.CSSProperties = {
  minWidth: 140,
  flex: "1 1 140px",
  borderRadius: 16,
  padding: "14px 16px",
  border: "1px solid rgba(251, 146, 60, 0.35)",
  background: "linear-gradient(160deg, rgba(30,20,10,0.75), rgba(15,23,42,0.92))",
  boxShadow: "0 0 24px rgba(251, 146, 60, 0.12)",
};

const primaryBtn: React.CSSProperties = {
  padding: "10px 18px",
  borderRadius: 12,
  border: "1px solid rgba(251, 146, 60, 0.55)",
  background: "linear-gradient(135deg, rgba(234, 88, 12, 0.9), rgba(180, 83, 9, 0.85))",
  color: "#fffbeb",
  fontWeight: 800,
  cursor: "pointer",
};

const ghostBtn: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 10,
  border: "1px solid #334155",
  background: "#0f172a",
  color: "#e2e8f0",
  fontWeight: 700,
  cursor: "pointer",
  fontSize: 13,
};

const dangerBtn: React.CSSProperties = {
  ...ghostBtn,
  border: "1px solid rgba(248,113,113,0.55)",
  color: "#fecaca",
};

function normRole(r: unknown) {
  return String(r || "")
    .trim()
    .toUpperCase();
}

function isEdiblesManagerRole(): boolean {
  const r = normRole(getAuthUser()?.role);
  return r === "EDIBLES_MANAGER" || r === "OWNER" || r === "ADMIN" || r === "OPERATIONS_MANAGER";
}

function canWriteEdiblesOperations(): boolean {
  const u = getAuthUser();
  const r = normRole(u?.role);
  if (r === "VIEW_ONLY") return false;
  if (["OWNER", "ADMIN", "OPERATIONS_MANAGER", "EDIBLES", "EDIBLES_MANAGER"].includes(r)) return true;
  return hasAppPermission(u?.permissions, "page.edibles");
}

function statusTone(status: string, stage: string): { border: string; glow: string; label: string } {
  const s = String(status || "").toUpperCase();
  if (s === "QA_FAILED" || s === "FAILED") {
    return { border: "rgba(248,113,113,0.55)", glow: "rgba(248,113,113,0.15)", label: "Failed" };
  }
  if (s === "QA_PASSED" || s === "COMPLETED") {
    return { border: "rgba(34,197,94,0.45)", glow: "rgba(34,197,94,0.12)", label: "Passed / Done" };
  }
  if (s === "QA_PENDING" || stage === "QA") {
    return { border: "rgba(251,191,36,0.55)", glow: "rgba(251,191,36,0.12)", label: "QA" };
  }
  if (s === "ACTIVE" || ["OIL_INTAKE", "RECIPE", "KITCHEN_PREP", "PRODUCTION", "CURE"].includes(stage)) {
    return { border: "rgba(59,130,246,0.45)", glow: "rgba(59,130,246,0.12)", label: "Active" };
  }
  if (s === "PENDING") {
    return { border: "rgba(251,191,36,0.45)", glow: "rgba(251,191,36,0.1)", label: "Pending" };
  }
  return { border: "rgba(148,163,184,0.35)", glow: "rgba(148,163,184,0.08)", label: status || "—" };
}

function stageTaskSuggestions(stage: string): string[] {
  switch (stage) {
    case "KITCHEN_PREP":
      return [...KITCHEN_PREP_TASKS];
    case "PRODUCTION":
      return [...PRODUCTION_TASKS];
    case "CURE":
      return [...CURE_TASKS];
    case "QA":
      return [...QA_TASKS];
    case "PACKAGING_TRANSFER":
      return [...PACK_TRANSFER_TASKS];
    default:
      return [...KITCHEN_PREP_TASKS, ...PRODUCTION_TASKS];
  }
}

export default function EdiblesClient() {
  const [tenantEpoch, setTenantEpoch] = useState(0);
  const [dash, setDash] = useState<EdibleDashboardJson | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<string | "ALL">("ALL");
  const [createOpen, setCreateOpen] = useState(false);
  const [oilOptions, setOilOptions] = useState<EdibleOilOption[]>([]);
  /** Runs added by id (includes depleted runs not returned by the default list). */
  const [manualOilExtras, setManualOilExtras] = useState<EdibleOilOption[]>([]);
  const [addRunIdDraft, setAddRunIdDraft] = useState("");
  const [addRunBusy, setAddRunBusy] = useState(false);

  const [cSku, setCSku] = useState("");
  const [cFlavor, setCFlavor] = useState("");
  const [cProduct, setCProduct] = useState<string>("Gummies");
  const [cMg, setCMg] = useState(10);
  const [cPieces, setCPieces] = useState(5000);
  const [cRunId, setCRunId] = useState("");
  const [cOilG, setCOilG] = useState(100);
  /** Lab / COA: THC mass fraction in this oil (0–1). Drives mg/g on the batch (= ×1000) and single-additive pectin math. */
  const [cOilPotencyFrac, setCOilPotencyFrac] = useState(0.7933);
  const [cNotes, setCNotes] = useState("");

  const [pectinMode, setPectinMode] = useState<"single" | "multi">("single");
  const [gummyBatchDrive, setGummyBatchDrive] = useState<GummyBatchDriveMode>("partA");
  const [pectinPartAGrams, setPectinPartAGrams] = useState(10_000);
  const [createPrintSummary, setCreatePrintSummary] = useState<EdibleCreatePrintSummary | null>(null);
  const [pectinGPerPc, setPectinGPerPc] = useState(3.5);
  const [pectinMoldMl, setPectinMoldMl] = useState("");
  const [pectinExtraCsv, setPectinExtraCsv] = useState("");
  const [pectinMultiRows, setPectinMultiRows] = useState<PectinMultiRow[]>([
    { goalMg: 10, potencyFrac: 0.7933 },
    { goalMg: 0, potencyFrac: 1 },
    { goalMg: 0, potencyFrac: 1 },
    { goalMg: 0, potencyFrac: 1 },
  ]);
  const [createBusy, setCreateBusy] = useState(false);
  const [cIngredientNotes, setCIngredientNotes] = useState("");

  const [taskModal, setTaskModal] = useState<EdibleDashboardBatch | null>(null);
  const [taskPick, setTaskPick] = useState("");
  const [taskEmployees, setTaskEmployees] = useState("");
  const [taskNotes, setTaskNotes] = useState("");
  const [taskTemp, setTaskTemp] = useState("");
  const [taskWeight, setTaskWeight] = useState("");
  const [taskDur, setTaskDur] = useState("");

  const [qaModal, setQaModal] = useState<EdibleDashboardBatch | null>(null);
  const [qaPot, setQaPot] = useState<"PENDING" | "PASSED" | "FAILED">("PASSED");
  const [qaHom, setQaHom] = useState<"PENDING" | "PASSED" | "FAILED">("PASSED");
  const [qaMic, setQaMic] = useState<"PENDING" | "PASSED" | "FAILED">("PASSED");
  const [qaFail, setQaFail] = useState("");
  const [qaNotes, setQaNotes] = useState("");

  const [xferModal, setXferModal] = useState<EdibleDashboardBatch | null>(null);
  const [xferGPerUnit, setXferGPerUnit] = useState("");

  const [mgrModal, setMgrModal] = useState<{ batch: EdibleDashboardBatch; qaTestId: string } | null>(null);
  const [mgrApprove, setMgrApprove] = useState(true);
  const [mgrNotes, setMgrNotes] = useState("");
  const [mgrFail, setMgrFail] = useState("");

  useEffect(() => {
    const bump = () => setTenantEpoch((n) => n + 1);
    window.addEventListener(CPU_TENANT_CHANGED_EVENT, bump);
    return () => window.removeEventListener(CPU_TENANT_CHANGED_EVENT, bump);
  }, []);

  const refresh = useCallback(async () => {
    if (typeof document !== "undefined" && document.hidden) return;
    try {
      setError(null);
      const d = await fetchEdiblesDashboard();
      setDash(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load edibles");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, tenantEpoch]);

  useEffect(() => {
    let cancelled = false;
    let busy = false;
    const tick = async () => {
      if (cancelled || busy || (typeof document !== "undefined" && document.hidden)) return;
      busy = true;
      try {
        await refresh();
      } finally {
        busy = false;
      }
    };
    const id = window.setInterval(() => void tick(), 12_000);
    const boot = window.setTimeout(() => void tick(), 900);
    const vis = () => void tick();
    document.addEventListener("visibilitychange", vis);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.clearTimeout(boot);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [refresh]);

  useEffect(() => {
    if (!createOpen) return;
    let cancelled = false;
    void (async () => {
      try {
        const o = await fetchEdiblesOilOptions();
        if (!cancelled) setOilOptions(o.options || []);
      } catch {
        if (!cancelled) setOilOptions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [createOpen]);

  const mergedOilOptions = useMemo(() => {
    const byId = new Map<string, EdibleOilOption>();
    for (const o of oilOptions) byId.set(o.extractionRunId, o);
    for (const o of manualOilExtras) byId.set(o.extractionRunId, o);
    return Array.from(byId.values()).sort((a, b) => {
      const ta = a.finishedAt ? Date.parse(a.finishedAt) : 0;
      const tb = b.finishedAt ? Date.parse(b.finishedAt) : 0;
      return tb - ta;
    });
  }, [oilOptions, manualOilExtras]);

  useEffect(() => {
    if (!createOpen) {
      setManualOilExtras([]);
      setAddRunIdDraft("");
    }
  }, [createOpen]);

  const stageCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of EDIBLE_STAGES) m.set(s, 0);
    for (const b of dash?.batches || []) {
      if (String(b.status).toUpperCase() === "CANCELLED") continue;
      m.set(b.stage, (m.get(b.stage) || 0) + 1);
    }
    return m;
  }, [dash]);

  const filteredBatches = useMemo(() => {
    const rows = dash?.batches || [];
    if (stageFilter === "ALL") return rows;
    return rows.filter((b) => b.stage === stageFilter);
  }, [dash, stageFilter]);

  const selectedOil = useMemo(
    () => mergedOilOptions.find((o) => o.extractionRunId === cRunId),
    [mergedOilOptions, cRunId],
  );

  const derivedPotencyMgPerGram = useMemo(
    () => mgThcPerGramOilFromCoaMassFraction(cOilPotencyFrac),
    [cOilPotencyFrac],
  );

  const pectinMultiAdditivesForPlan = useMemo(
    () =>
      pectinMultiRows
        .map((r) => ({ goalMgPerPiece: r.goalMg, potencyFraction: r.potencyFrac }))
        .filter((r) => r.goalMgPerPiece > 0),
    [pectinMultiRows],
  );

  const effectiveTargetMgForBatch = useMemo(() => {
    if (cProduct !== "Gummies" || pectinMode !== "multi") return cMg;
    const sum = pectinMultiAdditivesForPlan.reduce((s, r) => s + r.goalMgPerPiece, 0);
    return sum > 0 ? sum : cMg;
  }, [cProduct, pectinMode, pectinMultiAdditivesForPlan, cMg]);

  const gummyFormulaSizing = useMemo((): GummyFormulaSizingResult => {
    if (cProduct !== "Gummies") {
      const pcs = Math.floor(Number(cPieces));
      return { ok: true, batchG: 0, nominalPiecesDisplay: Number.isFinite(pcs) && pcs > 0 ? pcs : 0 };
    }
    if (!Number.isFinite(pectinGPerPc) || pectinGPerPc <= 0) {
      return { ok: false, error: "Piece weight (grams) must be positive." };
    }
    if (gummyBatchDrive === "pieces") {
      const pcs = Math.floor(Number(cPieces));
      if (!Number.isFinite(pcs) || pcs < 1) {
        return { ok: false, error: "Gummies per batch (target pieces) must be an integer ≥ 1." };
      }
      return { ok: true, batchG: pcs * pectinGPerPc, nominalPiecesDisplay: pcs };
    }
    const partAG = Number(pectinPartAGrams);
    if (!Number.isFinite(partAG) || partAG <= 0) {
      return {
        ok: false,
        error: "Part A — Melt-to-Make™ pectin base on hand (grams) must be a positive number.",
      };
    }
    const citric = WORKBOOK_CITRIC_MASS_FRAC;
    try {
      if (pectinMode === "single") {
        if (cMg <= 0) {
          return { ok: false, error: "Target MG / piece must be positive for the pectin plan." };
        }
        if (cOilPotencyFrac <= 0 || cOilPotencyFrac > 1) {
          return {
            ok: false,
            error: "Oil COA potency (mass fraction) must be in (0, 1] for the pectin plan.",
          };
        }
        const fAdd = additiveMassFractionFromGoals({
          targetMgPerPiece: cMg,
          potencyFraction: cOilPotencyFrac,
          gramsPerPiece: pectinGPerPc,
        });
        const fPartA = Number((1 - fAdd - citric).toFixed(8));
        if (fPartA <= 0 || !Number.isFinite(fPartA)) {
          return {
            ok: false,
            error:
              "Part A share of formula is zero or negative. Lower target mg/piece, raise piece weight or oil COA fraction, or check inputs.",
          };
        }
        const batchG = partAG / fPartA;
        return { ok: true, batchG, nominalPiecesDisplay: batchG / pectinGPerPc };
      }
      let extras: number[] = [];
      try {
        extras = parseExtraMassFractionsCsv(pectinExtraCsv);
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Invalid extra mass fractions." };
      }
      if (pectinMultiAdditivesForPlan.length === 0) {
        return {
          ok: false,
          error: "Multi-additive mode requires at least one additive row with goal mg > 0.",
        };
      }
      for (const row of pectinMultiAdditivesForPlan) {
        if (row.potencyFraction <= 0 || row.potencyFraction > 1) {
          return { ok: false, error: "Each additive potency fraction must be in (0, 1]." };
        }
      }
      const addFracs = pectinMultiAdditivesForPlan.map((line) =>
        additiveMassFractionFromGoals({
          targetMgPerPiece: line.goalMgPerPiece,
          potencyFraction: line.potencyFraction,
          gramsPerPiece: pectinGPerPc,
        }),
      );
      const addSum = addFracs.reduce((a, b) => a + b, 0);
      const extraSum = extras.reduce((a, b) => a + b, 0);
      const fPartA = Number((1 - addSum - extraSum - citric).toFixed(8));
      if (fPartA <= 0 || !Number.isFinite(fPartA)) {
        return {
          ok: false,
          error:
            "Part A share of formula is zero or negative. Reduce additive goals or extra mass fractions, or adjust piece weight.",
        };
      }
      const batchG = partAG / fPartA;
      return { ok: true, batchG, nominalPiecesDisplay: batchG / pectinGPerPc };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Invalid sizing inputs." };
    }
  }, [
    cProduct,
    gummyBatchDrive,
    pectinGPerPc,
    cPieces,
    pectinPartAGrams,
    pectinMode,
    cMg,
    cOilPotencyFrac,
    pectinMultiAdditivesForPlan,
    pectinExtraCsv,
  ]);

  const pectinPreview = useMemo(() => {
    if (cProduct !== "Gummies") {
      return { ok: true as const, error: null as string | null, mode: "single" as const };
    }
    try {
      if (!gummyFormulaSizing.ok) {
        return { ok: false as const, error: gummyFormulaSizing.error, mode: pectinMode };
      }
      const batchG = gummyFormulaSizing.batchG;
      if (batchG <= 0 || !Number.isFinite(batchG)) {
        return {
          ok: false as const,
          error: "Formula batch size must be positive — adjust batch sizing inputs.",
          mode: pectinMode,
        };
      }
      if (pectinGPerPc <= 0 || !Number.isFinite(pectinGPerPc)) {
        return { ok: false as const, error: "Piece weight (grams) must be positive.", mode: pectinMode };
      }
      const citricMassFraction = WORKBOOK_CITRIC_MASS_FRAC;
      if (pectinMode === "single") {
        if (cMg <= 0) {
          return { ok: false as const, error: "Target MG / piece must be positive for the pectin plan.", mode: "single" as const };
        }
        if (cOilPotencyFrac <= 0 || cOilPotencyFrac > 1) {
          return {
            ok: false as const,
            error: "Oil COA potency (mass fraction) must be in (0, 1] for the pectin plan.",
            mode: "single" as const,
          };
        }
        const singlePlan = planPectinSingleAdditiveBatch({
          batchSizeGrams: batchG,
          potencyFraction: cOilPotencyFrac,
          targetMgPerPiece: cMg,
          gramsPerPiece: pectinGPerPc,
          citricMassFraction,
          lineWasteFraction: WORKBOOK_LINE_WASTE_FRAC,
        });
        if (singlePlan.partAPectinMassFraction <= 0) {
          return {
            ok: false as const,
            error:
              "Pectin plan is infeasible (Part A ≤ 0). Lower target mg/piece, raise additive potency, increase piece weight, or reduce batch size.",
            mode: "single" as const,
          };
        }
        return { ok: true as const, error: null as string | null, singlePlan, mode: "single" as const };
      }
      const extras = parseExtraMassFractionsCsv(pectinExtraCsv);
      if (pectinMultiAdditivesForPlan.length === 0) {
        return {
          ok: false as const,
          error: "Multi-additive mode requires at least one additive row with goal mg > 0.",
          mode: "multi" as const,
        };
      }
      for (const row of pectinMultiAdditivesForPlan) {
        if (row.potencyFraction <= 0 || row.potencyFraction > 1) {
          return { ok: false as const, error: "Each additive potency fraction must be in (0, 1].", mode: "multi" as const };
        }
      }
      const multiPlan = planPectinMultiAdditiveBatch({
        batchSizeGrams: batchG,
        gramsPerPiece: pectinGPerPc,
        additives: pectinMultiAdditivesForPlan,
        citricMassFraction,
        extraMassFractions: extras.length ? extras : undefined,
        lineWasteFraction: WORKBOOK_LINE_WASTE_FRAC,
      });
      if (multiPlan.partAPectinMassFraction <= 0) {
        return {
          ok: false as const,
          error:
            "Pectin plan is infeasible (Part A ≤ 0). Reduce additive goals or extra mass fractions, or adjust piece weight / batch size.",
          mode: "multi" as const,
        };
      }
      return { ok: true as const, error: null as string | null, multiPlan, mode: "multi" as const };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Invalid pectin calculator inputs.";
      return { ok: false as const, error: msg, mode: pectinMode };
    }
  }, [
    cProduct,
    pectinMode,
    gummyFormulaSizing,
    pectinGPerPc,
    cOilPotencyFrac,
    cMg,
    pectinMultiAdditivesForPlan,
    pectinExtraCsv,
  ]);

  const projected = useMemo(() => {
    const mg = derivedPotencyMgPerGram > 0 ? cOilG * derivedPotencyMgPerGram : 0;
    const perPieceMg =
      cProduct === "Gummies" && pectinMode === "multi" ? effectiveTargetMgForBatch : cMg;
    const per = perPieceMg > 0 ? mg / perPieceMg : 0;
    return { totalMg: mg, estPieces: per > 0 ? Math.floor(per) : 0 };
  }, [cOilG, derivedPotencyMgPerGram, cMg, cProduct, pectinMode, effectiveTargetMgForBatch]);

  async function onCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!cRunId.trim()) {
      setError("Select an extraction oil source.");
      return;
    }
    if (!selectedOil) {
      setError("Choose a Live Resin oil run from the list or add the extraction run id first.");
      return;
    }
    if (!cSku.trim() || !cFlavor.trim()) {
      setError("SKU and flavor are required.");
      return;
    }
    if (cProduct === "Gummies") {
      if (!gummyFormulaSizing.ok) {
        setError(gummyFormulaSizing.error);
        return;
      }
      if (!pectinPreview.ok) {
        setError(pectinPreview.error || "Complete the pectin formula calculator before creating a gummy batch.");
        return;
      }
    }
    const oilG = Number(cOilG);
    if (!Number.isFinite(oilG) || oilG <= 0) {
      setError("Oil allocated (grams) must be a positive number.");
      return;
    }
    if (oilG > selectedOil.availableGrams + 1e-6) {
      setError(
        `Oil grams (${oilG.toFixed(4)} g) cannot exceed available on this run (${selectedOil.availableGrams.toFixed(4)} g).`,
      );
      return;
    }
    let targetPiecesInt: number;
    if (cProduct === "Gummies") {
      if (gummyBatchDrive === "partA") {
        const sizing: GummyFormulaSizingResult = gummyFormulaSizing;
        if (sizing.ok === false) {
          setError(sizing.error);
          return;
        }
        targetPiecesInt = Math.max(1, Math.floor(sizing.nominalPiecesDisplay));
      } else {
        targetPiecesInt = Math.floor(Number(cPieces));
      }
    } else {
      targetPiecesInt = Math.floor(Number(cPieces));
    }
    if (!Number.isFinite(targetPiecesInt) || targetPiecesInt < 1) {
      setError("Gummies per batch (target pieces) must be an integer ≥ 1.");
      return;
    }
    const targetMgForApi = cProduct === "Gummies" && pectinMode === "multi" ? effectiveTargetMgForBatch : cMg;
    if (!Number.isFinite(targetMgForApi) || targetMgForApi <= 0) {
      setError(
        cProduct === "Gummies" && pectinMode === "multi"
          ? "Combined additive goals (mg/pc) must sum to a positive number."
          : "Target MG / piece must be positive.",
      );
      return;
    }
    if (!Number.isFinite(cOilPotencyFrac) || cOilPotencyFrac <= 0 || cOilPotencyFrac > 1) {
      setError("Enter oil COA potency as a THC mass fraction between 0 and 1 (e.g. 79.33% → 0.7933).");
      return;
    }
    const potencyMgPerGramApi = derivedPotencyMgPerGram;

    const userKitchenNotes = [cNotes.trim(), cIngredientNotes.trim() ? `Ingredients: ${cIngredientNotes.trim()}` : ""]
      .filter(Boolean)
      .join("\n\n");

    const pectinBatchGrams =
      cProduct === "Gummies" && gummyFormulaSizing.ok ? gummyFormulaSizing.batchG : 0;

    let notesPayload: string | null = userKitchenNotes || null;
    let pectinSnapshot: PectinMeltFormulaSnapshot | null = null;
    if (cProduct === "Gummies" && pectinPreview.ok) {
      if (pectinPreview.mode === "single" && "singlePlan" in pectinPreview && pectinPreview.singlePlan) {
        pectinSnapshot = buildSnapshotFromSingle({
          input: {
            batchSizeGrams: pectinBatchGrams,
            potencyFraction: cOilPotencyFrac,
            targetMgPerPiece: cMg,
            gramsPerPiece: pectinGPerPc,
            citricMassFraction: WORKBOOK_CITRIC_MASS_FRAC,
            lineWasteFraction: WORKBOOK_LINE_WASTE_FRAC,
          },
          plan: pectinPreview.singlePlan,
          oilInputGrams: oilG,
          targetPieces: targetPiecesInt,
          lineWasteFraction: WORKBOOK_LINE_WASTE_FRAC,
        });
      } else if (pectinPreview.mode === "multi" && "multiPlan" in pectinPreview && pectinPreview.multiPlan) {
        let extras: number[] = [];
        try {
          extras = parseExtraMassFractionsCsv(pectinExtraCsv);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Invalid extra mass fractions.");
          return;
        }
        pectinSnapshot = buildSnapshotFromMulti({
          batchSizeGrams: pectinBatchGrams,
          gramsPerPiece: pectinGPerPc,
          citricMassFraction: WORKBOOK_CITRIC_MASS_FRAC,
          lineWasteFraction: WORKBOOK_LINE_WASTE_FRAC,
          plan: pectinPreview.multiPlan,
          inputAdditives: pectinMultiAdditivesForPlan,
          extraMassFractions: extras,
          oilInputGrams: oilG,
          targetPieces: targetPiecesInt,
        });
      }
      if (pectinSnapshot) {
        try {
          notesPayload = mergeUserNotesAndPectinPlan(userKitchenNotes, pectinSnapshot);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not build batch notes.");
          return;
        }
      }
    }

    setCreateBusy(true);
    try {
      const created = await createEdibleBatch({
        sku: cSku,
        flavor: cFlavor,
        productType: cProduct,
        targetMgPerPiece: targetMgForApi,
        targetPieces: targetPiecesInt,
        extractionRunId: cRunId,
        oilInputGrams: oilG,
        potencyMgPerGram: potencyMgPerGramApi,
        notes: notesPayload,
        expectedYield: projected.estPieces > 0 ? projected.estPieces : null,
      });
      if (pectinSnapshot && created?.id) {
        try {
          await postPectinKitchenIngredients(created.id, pectinSnapshot);
        } catch (ingErr) {
          setError(
            `Batch ${created.batchNumber ?? created.id} was created, but ingredient lines failed: ${
              ingErr instanceof Error ? ingErr.message : String(ingErr)
            }`,
          );
          setCreateOpen(false);
          setCreatePrintSummary(null);
          await refresh();
          return;
        }
      }
      const runLabel = selectedOil
        ? `${selectedOil.strainLabel} — ${selectedOil.availableGrams.toFixed(2)} g avail · pkg ${selectedOil.packagingGrams.toFixed(
            2,
          )} g · kitchen ${selectedOil.ediblesGrams.toFixed(2)} g · ${selectedOil.productType}`
        : null;
      setCreatePrintSummary({
        created,
        sku: cSku,
        flavor: cFlavor,
        productType: cProduct,
        targetMgPerPiece: targetMgForApi,
        targetPieces: targetPiecesInt,
        oilInputGrams: oilG,
        potencyMgPerGram: potencyMgPerGramApi,
        oilPotencyMassFraction: cOilPotencyFrac,
        extractionRunLabel: runLabel,
        projectedTotalMg: projected.totalMg,
        projectedEstPieces: projected.estPieces,
        pectinMode: cProduct === "Gummies" ? pectinMode : null,
        pectinSnapshot,
        ingredientNotes: cIngredientNotes.trim(),
        productionNotes: cNotes.trim(),
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create edible batch.");
    } finally {
      setCreateBusy(false);
    }
  }

  async function onLogTask(e: React.FormEvent) {
    e.preventDefault();
    if (!taskModal || !taskPick.trim()) return;
    await postEdibleTaskLog(taskModal.id, {
      taskType: taskPick,
      employees: taskEmployees.trim() || null,
      notes: taskNotes.trim() || null,
      temperature: taskTemp.trim() ? Number(taskTemp) : null,
      weight: taskWeight.trim() ? Number(taskWeight) : null,
      durationMinutes: taskDur.trim() ? Math.floor(Number(taskDur)) : null,
    });
    setTaskModal(null);
    setTaskPick("");
    setTaskEmployees("");
    setTaskNotes("");
    setTaskTemp("");
    setTaskWeight("");
    setTaskDur("");
    await refresh();
  }

  async function onSubmitQa(e: React.FormEvent) {
    e.preventDefault();
    if (!qaModal) return;
    await postEdibleQa(qaModal.id, {
      potencyStatus: qaPot,
      homogeneityStatus: qaHom,
      microbialStatus: qaMic,
      failedReason: qaFail.trim() || null,
      notes: qaNotes.trim() || null,
    });
    setQaModal(null);
    await refresh();
  }

  async function onMgrReview(e: React.FormEvent) {
    e.preventDefault();
    if (!mgrModal) return;
    await postEdibleQaManagerReview(mgrModal.batch.id, {
      qaTestId: mgrModal.qaTestId,
      approve: mgrApprove,
      notes: mgrNotes.trim() || null,
      failedReason: mgrFail.trim() || null,
    });
    setMgrModal(null);
    await refresh();
  }

  async function onTransfer(e: React.FormEvent) {
    e.preventDefault();
    if (!xferModal) return;
    const g = Number(xferGPerUnit);
    if (!Number.isFinite(g) || g <= 0) return;
    await postEdibleTransferPackaging(xferModal.id, { gramsPerUnit: g });
    setXferModal(null);
    await refresh();
  }

  async function onAddSourceRunById() {
    const id = addRunIdDraft.trim();
    if (!/^c[a-z0-9]{24}$/i.test(id)) {
      setError("Enter a valid extraction run id (CUID).");
      return;
    }
    if (mergedOilOptions.some((o) => o.extractionRunId === id)) {
      setError("That run is already in the oil source list.");
      return;
    }
    setAddRunBusy(true);
    try {
      const { option } = await fetchEdibleOilOptionByRunId(id);
      setManualOilExtras((prev) => {
        const m = new Map(prev.map((x) => [x.extractionRunId, x]));
        m.set(option.extractionRunId, option);
        return Array.from(m.values());
      });
      setCRunId(id);
      setAddRunIdDraft("");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load extraction run.");
    } finally {
      setAddRunBusy(false);
    }
  }

  const write = canWriteEdiblesOperations();
  const mgr = isEdiblesManagerRole();

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "radial-gradient(ellipse at top, #1e293b 0%, #020617 55%, #020617 100%)",
        color: "#f8fafc",
        padding: "20px 20px 48px",
      }}
    >
      <div style={{ maxWidth: 1480, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 16,
            marginBottom: 22,
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: 30, fontWeight: 900, letterSpacing: "-0.03em" }}>EDIBLES</h1>
            <p style={{ color: "#94a3b8", marginTop: 8, maxWidth: 640, lineHeight: 1.55 }}>
              Cannabis infused product manufacturing and kitchen operations — oil-linked batches, QA gates, and
              packaging transfers on the same relational spine as extraction and packaging.
            </p>
          </div>
          <SectionCalendarLauncher section="edibles" taskSuggestions={CALENDAR_TASK_SUGGESTIONS} readOnly={!write} />
        </div>

        {error && (
          <div style={{ ...cardStyle, border: "1px solid rgba(248,113,113,0.45)", color: "#fecaca", marginBottom: 16 }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 18 }}>
          {[
            ["Active Batches", dash?.kpis.activeBatches ?? "—"],
            ["Gummies In Production", dash?.kpis.gummiesInProduction ?? "—"],
            ["Total MG Scheduled", dash != null ? Math.round(dash.kpis.totalMgScheduled) : "—"],
            ["Pending QA", dash?.kpis.pendingQa ?? "—"],
            ["Ready For Packaging", dash?.kpis.readyForPackaging ?? "—"],
          ].map(([k, v]) => (
            <div key={k} style={glassKpi}>
              <div style={{ color: "#fdba74", fontSize: 11, fontWeight: 800, letterSpacing: "0.06em" }}>{k}</div>
              <div style={{ fontSize: 26, fontWeight: 900, marginTop: 8 }}>{v}</div>
            </div>
          ))}
        </div>

        <div style={{ ...cardStyle, marginBottom: 18 }}>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
            <h2 style={{ margin: 0 }}>Workflow stage</h2>
            {write && (
              <button
                type="button"
                style={primaryBtn}
                onClick={() => {
                  setCreatePrintSummary(null);
                  setManualOilExtras([]);
                  setAddRunIdDraft("");
                  setCreateOpen(true);
                }}
              >
                Create Edible Batch
              </button>
            )}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            <button
              type="button"
              style={{
                ...ghostBtn,
                border:
                  stageFilter === "ALL" ? "1px solid rgba(251, 146, 60, 0.65)" : ghostBtn.border,
                boxShadow: stageFilter === "ALL" ? "0 0 18px rgba(251,146,60,0.2)" : "none",
              }}
              onClick={() => setStageFilter("ALL")}
            >
              All ({dash?.batches.filter((b) => String(b.status).toUpperCase() !== "CANCELLED").length ?? 0})
            </button>
            {EDIBLE_STAGES.map((st) => (
              <button
                key={st}
                type="button"
                style={{
                  ...ghostBtn,
                  border: stageFilter === st ? "1px solid rgba(251, 146, 60, 0.65)" : ghostBtn.border,
                  boxShadow: stageFilter === st ? "0 0 18px rgba(251,146,60,0.2)" : "none",
                }}
                onClick={() => setStageFilter(st)}
              >
                {STAGE_LABELS[st] || st} ({stageCounts.get(st) || 0})
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
          {filteredBatches.map((b) => {
            const tone = statusTone(b.status, b.stage);
            return (
              <div
                key={b.id}
                style={{
                  ...cardStyle,
                  border: `1px solid ${tone.border}`,
                  boxShadow: `0 16px 40px rgba(0,0,0,0.35), 0 0 28px ${tone.glow}`,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700 }}>{b.batchNumber}</div>
                    <div style={{ fontSize: 20, fontWeight: 900, marginTop: 4 }}>{b.sku}</div>
                    <div style={{ color: "#fdba74", marginTop: 4 }}>{b.flavor}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 12, color: "#94a3b8" }}>{b.productType}</div>
                    <div style={{ fontWeight: 800, marginTop: 6 }}>{STAGE_LABELS[b.stage] || b.stage}</div>
                    <div style={{ fontSize: 12, color: "#cbd5e1", marginTop: 4 }}>{tone.label}</div>
                  </div>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 8,
                    marginTop: 14,
                    fontSize: 13,
                    color: "#cbd5e1",
                  }}
                >
                  <div>
                    <span style={{ color: "#64748b" }}>Target MG / pc</span>
                    <div style={{ fontWeight: 700 }}>{b.targetMgPerPiece}</div>
                  </div>
                  <div>
                    <span style={{ color: "#64748b" }}>Pieces</span>
                    <div style={{ fontWeight: 700 }}>{b.targetPieces}</div>
                  </div>
                  <div>
                    <span style={{ color: "#64748b" }}>Oil in</span>
                    <div style={{ fontWeight: 700 }}>{Number(b.oilInputGrams).toFixed(2)} g</div>
                  </div>
                  <div>
                    <span style={{ color: "#64748b" }}>Total MG</span>
                    <div style={{ fontWeight: 700 }}>{Math.round(b.totalMgInput)}</div>
                  </div>
                  <div>
                    <span style={{ color: "#64748b" }}>Yield %</span>
                    <div style={{ fontWeight: 700 }}>{b.yieldPct != null ? `${b.yieldPct.toFixed(1)}%` : "—"}</div>
                  </div>
                  <div>
                    <span style={{ color: "#64748b" }}>QA</span>
                    <div style={{ fontWeight: 700 }}>
                      {b.latestQa
                        ? `${b.latestQa.potencyStatus}/${b.latestQa.homogeneityStatus}/${b.latestQa.microbialStatus}`
                        : "—"}
                    </div>
                  </div>
                  <div style={{ gridColumn: "span 2" }}>
                    <span style={{ color: "#64748b" }}>Operators (last log)</span>
                    <div style={{ fontWeight: 600 }}>{b.lastTaskEmployees || "—"}</div>
                  </div>
                  <div style={{ gridColumn: "span 2", fontSize: 12, color: "#64748b" }}>
                    Updated {new Date(b.updatedAt).toLocaleString()}
                  </div>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
                  {write && (
                    <>
                      <button type="button" style={ghostBtn} onClick={() => setTaskModal(b)}>
                        Log task
                      </button>
                      <button type="button" style={ghostBtn} onClick={() => setQaModal(b)}>
                        Submit QA
                      </button>
                    </>
                  )}
                  {mgr && b.latestQa?.id && b.status === "QA_PENDING" && (
                    <button
                      type="button"
                      style={ghostBtn}
                      onClick={() =>
                        setMgrModal({
                          batch: b,
                          qaTestId: b.latestQa!.id,
                        })
                      }
                    >
                      Manager QA
                    </button>
                  )}
                  {mgr && b.status === "QA_PASSED" && b.stage === "PACKAGING_TRANSFER" && !b.packagingLotId && (
                    <button type="button" style={primaryBtn} onClick={() => setXferModal(b)}>
                      Transfer to packaging
                    </button>
                  )}
                  {b.packagingLotId && (
                    <span style={{ fontSize: 12, color: "#86efac", alignSelf: "center" }}>Linked packaging lot</span>
                  )}
                  {write && (
                    <select
                      style={{ ...ghostBtn, maxWidth: 160 }}
                      value={b.stage}
                      onChange={async (e) => {
                        await patchEdibleBatch(b.id, { stage: e.target.value });
                        await refresh();
                      }}
                    >
                      {EDIBLE_STAGES.map((st) => (
                        <option key={st} value={st}>
                          {STAGE_LABELS[st]}
                        </option>
                      ))}
                    </select>
                  )}
                  {mgr && !b.packagingLotId && (
                    <button
                      type="button"
                      style={dangerBtn}
                      onClick={async () => {
                        if (!window.confirm(`Delete edible batch ${b.batchNumber}?`)) return;
                        await deleteEdibleBatch(b.id);
                        await refresh();
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {filteredBatches.length === 0 && (
          <p style={{ color: "#94a3b8", textAlign: "center", marginTop: 24 }}>
            No batches in this stage. Create a batch or adjust the stage filter.
          </p>
        )}
      </div>

      {createOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.75)",
            zIndex: 10000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          {createPrintSummary ? (
            <>
              <style>{`@media print {
                body * { visibility: hidden !important; }
                #edible-batch-print-root,
                #edible-batch-print-root * { visibility: visible !important; }
                #edible-batch-print-root {
                  position: absolute !important;
                  left: 0 !important;
                  top: 0 !important;
                  width: 100% !important;
                  box-sizing: border-box !important;
                  padding: 20px !important;
                  background: #fff !important;
                  color: #0f172a !important;
                  font-family: system-ui, -apple-system, Segoe UI, sans-serif !important;
                }
                #edible-batch-print-root .print-muted { color: #475569 !important; }
                #edible-batch-print-root table { width: 100%; border-collapse: collapse; margin-top: 8px; }
                #edible-batch-print-root th,
                #edible-batch-print-root td {
                  border: 1px solid #cbd5e1 !important;
                  padding: 6px 8px !important;
                  font-size: 12px !important;
                  color: #0f172a !important;
                  vertical-align: top;
                }
              }`}</style>
              <div
                style={{
                  ...cardStyle,
                  maxWidth: 720,
                  width: "100%",
                  maxHeight: "90vh",
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    style={ghostBtn}
                    onClick={() => {
                      setCreateOpen(false);
                      setCreatePrintSummary(null);
                    }}
                  >
                    Close
                  </button>
                  <button type="button" style={primaryBtn} onClick={() => window.print()}>
                    Print summary
                  </button>
                </div>
                <div
                  id="edible-batch-print-root"
                  style={{
                    border: "1px solid #334155",
                    borderRadius: 12,
                    padding: 16,
                    background: "#0f172a",
                    color: "#f8fafc",
                    flex: 1,
                    overflow: "auto",
                  }}
                >
                  <h2 style={{ marginTop: 0, fontSize: 22, fontWeight: 900 }}>Edible batch summary</h2>
                  <p className="print-muted" style={{ color: "#94a3b8", fontSize: 13, marginTop: 0 }}>
                    Printable sheet (system print dialog). Content stays in this overlay — not a separate browser tab.
                  </p>
                  <table>
                    <tbody>
                      <tr>
                        <th>Batch #</th>
                        <td>{createPrintSummary.created.batchNumber ?? "—"}</td>
                      </tr>
                      <tr>
                        <th>Batch id</th>
                        <td style={{ wordBreak: "break-all" }}>{createPrintSummary.created.id}</td>
                      </tr>
                      <tr>
                        <th>SKU</th>
                        <td>{createPrintSummary.sku}</td>
                      </tr>
                      <tr>
                        <th>Flavor</th>
                        <td>{createPrintSummary.flavor}</td>
                      </tr>
                      <tr>
                        <th>Product</th>
                        <td>{createPrintSummary.productType}</td>
                      </tr>
                      <tr>
                        <th>Target MG / piece (saved)</th>
                        <td>{createPrintSummary.targetMgPerPiece}</td>
                      </tr>
                      <tr>
                        <th>Target pieces</th>
                        <td>{createPrintSummary.targetPieces}</td>
                      </tr>
                      <tr>
                        <th>Oil allocated</th>
                        <td>{createPrintSummary.oilInputGrams.toFixed(4)} g</td>
                      </tr>
                      <tr>
                        <th>Oil COA mass fraction</th>
                        <td>
                          {createPrintSummary.oilPotencyMassFraction != null &&
                          Number.isFinite(createPrintSummary.oilPotencyMassFraction)
                            ? createPrintSummary.oilPotencyMassFraction.toFixed(4)
                            : "—"}
                        </td>
                      </tr>
                      <tr>
                        <th>Potency (saved mg/g)</th>
                        <td>
                          {createPrintSummary.potencyMgPerGram != null && Number.isFinite(createPrintSummary.potencyMgPerGram)
                            ? `${createPrintSummary.potencyMgPerGram} mg/g`
                            : "—"}
                        </td>
                      </tr>
                      <tr>
                        <th>Oil source</th>
                        <td>{createPrintSummary.extractionRunLabel ?? "—"}</td>
                      </tr>
                      <tr>
                        <th>Projected total MG</th>
                        <td>{Math.round(createPrintSummary.projectedTotalMg)}</td>
                      </tr>
                      <tr>
                        <th>Est. pieces @ target MG</th>
                        <td>{createPrintSummary.projectedEstPieces}</td>
                      </tr>
                    </tbody>
                  </table>
                  {createPrintSummary.pectinSnapshot ? (
                    <>
                      <h3 style={{ marginTop: 18, fontSize: 16, fontWeight: 800 }}>Pectin (Melt-to-Make)</h3>
                      <p className="print-muted" style={{ color: "#94a3b8", fontSize: 12, whiteSpace: "pre-wrap", marginTop: 0 }}>
                        {formatPectinReadableHeader(createPrintSummary.pectinSnapshot)}
                      </p>
                      <p className="print-muted" style={{ color: "#94a3b8", fontSize: 12, marginTop: 0 }}>
                        Workbook defaults: Part B citric {WORKBOOK_CITRIC_PCT}% of formula · line loss on nominal pieces{" "}
                        {(WORKBOOK_LINE_WASTE_FRAC * 100).toFixed(0)}%.
                      </p>
                      <table>
                        <tbody>
                          <tr>
                            <th>Formula batch size</th>
                            <td>{createPrintSummary.pectinSnapshot.batchSizeGrams.toFixed(2)} g</td>
                          </tr>
                          <tr>
                            <th>Piece weight</th>
                            <td>{createPrintSummary.pectinSnapshot.gramsPerPiece} g</td>
                          </tr>
                          <tr>
                            <th>Mode</th>
                            <td>{createPrintSummary.pectinMode}</td>
                          </tr>
                          <tr>
                            <th>Part A (pectin base)</th>
                            <td>{createPrintSummary.pectinSnapshot.gramsPartA.toFixed(2)} g</td>
                          </tr>
                          <tr>
                            <th>Additive mass (calc)</th>
                            <td>{createPrintSummary.pectinSnapshot.gramsAdditive.toFixed(2)} g</td>
                          </tr>
                          <tr>
                            <th>Citric solution (Part B)</th>
                            <td>{createPrintSummary.pectinSnapshot.gramsCitric.toFixed(2)} g</td>
                          </tr>
                          <tr>
                            <th>Pieces after line loss</th>
                            <td>{createPrintSummary.pectinSnapshot.piecesAfterLineWaste.toFixed(1)}</td>
                          </tr>
                        </tbody>
                      </table>
                      {createPrintSummary.pectinSnapshot.kind === "multi" &&
                      createPrintSummary.pectinSnapshot.additivesLines?.length ? (
                        <table style={{ marginTop: 10 }}>
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>Goal mg/pc</th>
                              <th>Potency frac</th>
                              <th>Grams</th>
                            </tr>
                          </thead>
                          <tbody>
                            {createPrintSummary.pectinSnapshot.additivesLines.map((row) => (
                              <tr key={row.index}>
                                <td>{row.index}</td>
                                <td>{row.goalMgPerPiece}</td>
                                <td>{row.potencyFraction}</td>
                                <td>{row.grams.toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : null}
                    </>
                  ) : null}
                  {(createPrintSummary.ingredientNotes || createPrintSummary.productionNotes) && (
                    <>
                      <h3 style={{ marginTop: 18, fontSize: 16, fontWeight: 800 }}>Notes (entered)</h3>
                      {createPrintSummary.ingredientNotes ? (
                        <p style={{ fontSize: 12, whiteSpace: "pre-wrap", margin: "4px 0" }}>
                          <strong>Ingredient notes:</strong> {createPrintSummary.ingredientNotes}
                        </p>
                      ) : null}
                      {createPrintSummary.productionNotes ? (
                        <p style={{ fontSize: 12, whiteSpace: "pre-wrap", margin: "4px 0" }}>
                          <strong>Production notes:</strong> {createPrintSummary.productionNotes}
                        </p>
                      ) : null}
                    </>
                  )}
                  <p className="print-muted" style={{ color: "#64748b", fontSize: 11, marginTop: 16 }}>
                    Full calculator JSON and readable plan are also stored on the batch production notes in the system.
                  </p>
                </div>
              </div>
            </>
          ) : (
          <form onSubmit={onCreateSubmit} style={{ ...cardStyle, maxWidth: 880, width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
            <h3 style={{ marginTop: 0 }}>Create Edible Batch</h3>
            <label style={{ display: "block", marginBottom: 10, fontSize: 13 }}>
              <div style={{ color: "#94a3b8", marginBottom: 4 }}>SKU</div>
              <input required value={cSku} onChange={(e) => setCSku(e.target.value)} style={inputFull} />
            </label>
            <label style={{ display: "block", marginBottom: 10, fontSize: 13 }}>
              <div style={{ color: "#94a3b8", marginBottom: 4 }}>Flavor</div>
              <input required value={cFlavor} onChange={(e) => setCFlavor(e.target.value)} style={inputFull} />
            </label>
            <label style={{ display: "block", marginBottom: 10, fontSize: 13 }}>
              <div style={{ color: "#94a3b8", marginBottom: 4 }}>Product type</div>
              <select value={cProduct} onChange={(e) => setCProduct(e.target.value)} style={inputFull}>
                {PRODUCT_TYPES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            {cProduct === "Gummies" ? (
              <div
                style={{
                  border: "1px solid rgba(59, 130, 246, 0.35)",
                  borderRadius: 12,
                  padding: 12,
                  marginBottom: 12,
                  background: "rgba(15, 23, 42, 0.65)",
                }}
              >
                <div style={{ fontWeight: 800, marginBottom: 8, color: "#93c5fd", fontSize: 13 }}>Gummy batch size</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                  <button
                    type="button"
                    style={{
                      ...ghostBtn,
                      border:
                        gummyBatchDrive === "partA" ? "1px solid rgba(251, 146, 60, 0.75)" : ghostBtn.border,
                      boxShadow: gummyBatchDrive === "partA" ? "0 0 14px rgba(251,146,60,0.2)" : "none",
                    }}
                    onClick={() => setGummyBatchDrive("partA")}
                  >
                    From Part A on hand
                  </button>
                  <button
                    type="button"
                    style={{
                      ...ghostBtn,
                      border:
                        gummyBatchDrive === "pieces" ? "1px solid rgba(251, 146, 60, 0.75)" : ghostBtn.border,
                      boxShadow: gummyBatchDrive === "pieces" ? "0 0 14px rgba(251,146,60,0.2)" : "none",
                    }}
                    onClick={() => setGummyBatchDrive("pieces")}
                  >
                    From target piece count
                  </button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
                  {pectinMode === "single" ? (
                    <label style={{ fontSize: 13 }}>
                      <div style={{ color: "#94a3b8", marginBottom: 4 }}>Target MG / piece</div>
                      <input
                        type="number"
                        required
                        min={0.1}
                        step={0.1}
                        value={cMg}
                        onChange={(e) => setCMg(Number(e.target.value))}
                        style={inputFull}
                      />
                    </label>
                  ) : (
                    <div style={{ fontSize: 13, padding: "8px 0", color: "#fdba74" }}>
                      <div style={{ color: "#94a3b8", marginBottom: 4 }}>Combined target MG / piece</div>
                      <div style={{ fontWeight: 800 }}>{effectiveTargetMgForBatch.toFixed(2)} mg</div>
                      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>Sum of additive goals below.</div>
                    </div>
                  )}
                  {gummyBatchDrive === "pieces" ? (
                    <label style={{ fontSize: 13 }}>
                      <div style={{ color: "#94a3b8", marginBottom: 4 }}>Gummies per batch (target)</div>
                      <input
                        type="number"
                        required
                        min={1}
                        value={cPieces}
                        onChange={(e) => setCPieces(Number(e.target.value))}
                        style={inputFull}
                      />
                    </label>
                  ) : (
                    <label style={{ fontSize: 13 }}>
                      <div style={{ color: "#94a3b8", marginBottom: 4 }}>Part A on hand (g)</div>
                      <input
                        type="number"
                        required
                        min={0.01}
                        step={0.01}
                        value={pectinPartAGrams}
                        onChange={(e) => setPectinPartAGrams(Number(e.target.value))}
                        style={inputFull}
                      />
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                        Melt-to-Make™ pectin base you are using; total formula and piece count are derived from this.
                      </div>
                    </label>
                  )}
                  <label style={{ fontSize: 13 }}>
                    <div style={{ color: "#94a3b8", marginBottom: 4 }}>Piece weight (g)</div>
                    <input
                      type="number"
                      required
                      min={0.01}
                      step={0.01}
                      value={pectinGPerPc}
                      onChange={(e) => setPectinGPerPc(Number(e.target.value))}
                      style={inputFull}
                    />
                  </label>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end", marginTop: 10 }}>
                  <label style={{ fontSize: 13, flex: "1 1 140px" }}>
                    <div style={{ color: "#94a3b8", marginBottom: 4 }}>Mold cavity (mL)</div>
                    <input
                      type="number"
                      min={0.1}
                      step={0.1}
                      value={pectinMoldMl}
                      onChange={(e) => setPectinMoldMl(e.target.value)}
                      style={inputFull}
                      placeholder="Optional"
                    />
                  </label>
                  <button
                    type="button"
                    style={ghostBtn}
                    onClick={() => {
                      const v = Number(pectinMoldMl);
                      if (!Number.isFinite(v) || v <= 0) {
                        setError("Enter a valid mold cavity volume in mL to apply piece weight.");
                        return;
                      }
                      try {
                        setPectinGPerPc(estimatedGummyWeightGramsFromMoldMl(v));
                        setError(null);
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Could not estimate piece weight.");
                      }
                    }}
                  >
                    Apply mL → g
                  </button>
                </div>
                <div style={{ fontSize: 12, color: "#fdba74", marginTop: 10 }}>
                  {gummyBatchDrive === "pieces" ? (
                    <>
                      Melt-to-Make formula batch size:{" "}
                      <strong>
                        {gummyFormulaSizing.ok ? `${gummyFormulaSizing.batchG.toFixed(2)} g` : "—"}
                      </strong>{" "}
                      (= pieces × piece weight).
                    </>
                  ) : (
                    <>
                      Total formula mass:{" "}
                      <strong>
                        {gummyFormulaSizing.ok ? `${gummyFormulaSizing.batchG.toFixed(2)} g` : "—"}
                      </strong>{" "}
                      (from Part A ÷ Part A % of formula). Nominal pieces:{" "}
                      <strong>
                        {gummyFormulaSizing.ok ? gummyFormulaSizing.nominalPiecesDisplay.toFixed(1) : "—"}
                      </strong>{" "}
                      (batch record uses floor).{" "}
                    </>
                  )}
                </div>
                {!gummyFormulaSizing.ok && (
                  <div style={{ fontSize: 12, color: "#fecaca", marginTop: 8 }}>{gummyFormulaSizing.error}</div>
                )}
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                <label style={{ fontSize: 13 }}>
                  <div style={{ color: "#94a3b8", marginBottom: 4 }}>Target MG / piece</div>
                  <input
                    type="number"
                    required
                    min={0.1}
                    step={0.1}
                    value={cMg}
                    onChange={(e) => setCMg(Number(e.target.value))}
                    style={inputFull}
                  />
                </label>
                <label style={{ fontSize: 13 }}>
                  <div style={{ color: "#94a3b8", marginBottom: 4 }}>Gummies per batch (target)</div>
                  <input
                    type="number"
                    required
                    min={1}
                    value={cPieces}
                    onChange={(e) => setCPieces(Number(e.target.value))}
                    style={inputFull}
                  />
                </label>
              </div>
            )}
            <label style={{ display: "block", marginBottom: 10, fontSize: 13 }}>
              <div style={{ color: "#94a3b8", marginBottom: 4 }}>Oil source (Live Resin oil — completed extraction)</div>
              <select required value={cRunId} onChange={(e) => setCRunId(e.target.value)} style={inputFull}>
                <option value="">Select run…</option>
                {mergedOilOptions.map((o) => (
                  <option key={o.extractionRunId} value={o.extractionRunId}>
                    {o.strainLabel} — {o.availableGrams.toFixed(2)} g avail · pkg {o.packagingGrams.toFixed(2)} g · kitchen{" "}
                    {o.ediblesGrams.toFixed(2)} g · {o.productType}
                  </option>
                ))}
              </select>
            </label>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                alignItems: "flex-end",
                marginBottom: 12,
                fontSize: 13,
              }}
            >
              <label style={{ flex: "1 1 220px", marginBottom: 0 }}>
                <div style={{ color: "#94a3b8", marginBottom: 4 }}>Add source by extraction run id</div>
                <input
                  type="text"
                  value={addRunIdDraft}
                  onChange={(e) => setAddRunIdDraft(e.target.value)}
                  placeholder="Paste CUID…"
                  style={inputFull}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <button
                type="button"
                style={ghostBtn}
                disabled={addRunBusy}
                onClick={() => void onAddSourceRunById()}
              >
                {addRunBusy ? "Loading…" : "Add run"}
              </button>
            </div>
            {selectedOil && (
              <div
                style={{
                  fontSize: 12,
                  color: "#cbd5e1",
                  border: "1px solid #334155",
                  borderRadius: 10,
                  padding: 10,
                  marginBottom: 10,
                }}
              >
                <div>Extraction output: {selectedOil.outputGrams.toFixed(2)} g</div>
                <div>Packaging weighed (all lots): {selectedOil.packagingGrams.toFixed(2)} g</div>
                <div>Edible kitchen allocated (non-cancelled batches): {selectedOil.ediblesGrams.toFixed(2)} g</div>
                <div style={{ color: "#fdba74", fontWeight: 700, marginTop: 6 }}>
                  Remaining for new pulls: {selectedOil.availableGrams.toFixed(2)} g
                </div>
              </div>
            )}
            <label style={{ display: "block", marginBottom: 10, fontSize: 13 }}>
              <div style={{ color: "#94a3b8", marginBottom: 4 }}>Oil allocated (grams)</div>
              <input
                type="number"
                required
                min={0.01}
                step={0.01}
                value={cOilG}
                onChange={(e) => setCOilG(Number(e.target.value))}
                style={inputFull}
              />
            </label>
            <label style={{ display: "block", marginBottom: 10, fontSize: 13 }}>
              <div style={{ color: "#94a3b8", marginBottom: 4 }}>
                Oil COA — THC mass fraction in oil (0–1, e.g. 79.33% → 0.7933)
              </div>
              <input
                type="number"
                required
                min={0.0001}
                max={1}
                step={0.0001}
                value={cOilPotencyFrac}
                onChange={(e) => setCOilPotencyFrac(Number(e.target.value))}
                style={inputFull}
              />
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>
                Stored on batch as{" "}
                <span style={{ color: "#fdba74", fontWeight: 700 }}>
                  {derivedPotencyMgPerGram > 0 ? `${derivedPotencyMgPerGram.toFixed(2)} mg THC / g oil` : "—"}
                </span>{" "}
                (fraction × 1000). Gummies single-additive melt math uses this same value.
              </div>
            </label>
            <div style={{ fontSize: 12, color: "#fdba74", marginBottom: 10 }}>
              Projected total MG: {Math.round(projected.totalMg)} · Estimated pieces @ target MG: {projected.estPieces}
            </div>
            {cProduct === "Gummies" && (
              <div
                style={{
                  border: "1px solid rgba(251, 146, 60, 0.45)",
                  borderRadius: 14,
                  padding: 14,
                  marginBottom: 12,
                  background: "linear-gradient(160deg, rgba(30,20,10,0.5), rgba(15,23,42,0.88))",
                  boxShadow: "0 0 22px rgba(251, 146, 60, 0.12)",
                }}
              >
                <div style={{ fontWeight: 900, marginBottom: 6, color: "#fdba74" }}>Pectin (Melt-to-Make) formula</div>
                <p style={{ fontSize: 12, color: "#94a3b8", margin: "0 0 10px", lineHeight: 1.45 }}>
                  Uses the same calculator as the Melt-to-Make workbook. Total formula mass comes from{" "}
                  <strong style={{ color: "#e2e8f0" }}>Gummy batch size</strong> above — either{" "}
                  <strong style={{ color: "#e2e8f0" }}>Part A on hand</strong> (inverted math) or{" "}
                  <strong style={{ color: "#e2e8f0" }}>target piece count</strong> × piece weight. Part B citric ({WORKBOOK_CITRIC_PCT}% of formula) and line-loss on piece count (
                  {(WORKBOOK_LINE_WASTE_FRAC * 100).toFixed(0)}%) match the sheet defaults and are not editable here. The
                  saved plan is appended to batch notes (with JSON); Part A, oil, citric, and extras post as ingredient
                  lines.
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                  <button
                    type="button"
                    style={{
                      ...ghostBtn,
                      border:
                        pectinMode === "single" ? "1px solid rgba(251, 146, 60, 0.75)" : ghostBtn.border,
                      boxShadow: pectinMode === "single" ? "0 0 14px rgba(251,146,60,0.2)" : "none",
                    }}
                    onClick={() => {
                      if (pectinMode !== "single") {
                        const sum = pectinMultiRows.reduce((acc, r) => acc + (r.goalMg > 0 ? r.goalMg : 0), 0);
                        if (sum > 0) setCMg(sum);
                      }
                      setPectinMode("single");
                    }}
                  >
                    Single additive
                  </button>
                  <button
                    type="button"
                    style={{
                      ...ghostBtn,
                      border: pectinMode === "multi" ? "1px solid rgba(251, 146, 60, 0.75)" : ghostBtn.border,
                      boxShadow: pectinMode === "multi" ? "0 0 14px rgba(251,146,60,0.2)" : "none",
                    }}
                    onClick={() => {
                      if (pectinMode !== "multi") {
                        setPectinMultiRows((rows) => {
                          const next = rows.map((r) => ({ ...r }));
                          next[0] = { ...next[0]!, goalMg: cMg };
                          return next;
                        });
                      }
                      setPectinMode("multi");
                    }}
                  >
                    Multi additive
                  </button>
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "#64748b",
                    marginBottom: 10,
                    lineHeight: 1.45,
                    borderLeft: "3px solid rgba(52, 211, 153, 0.45)",
                    paddingLeft: 10,
                  }}
                >
                  Locked workbook defaults: Part B citric = {WORKBOOK_CITRIC_PCT}% of total formula · line loss on nominal
                  pieces = {(WORKBOOK_LINE_WASTE_FRAC * 100).toFixed(0)}%.
                </div>
                <div
                  style={{
                    border: "1px solid rgba(52, 211, 153, 0.35)",
                    borderRadius: 10,
                    padding: 10,
                    marginBottom: 12,
                    background: "rgba(6, 78, 59, 0.12)",
                  }}
                >
                  <div style={{ fontWeight: 800, marginBottom: 8, color: "#6ee7b7", fontSize: 13 }}>
                    Percent of formula (read-only, updates from inputs)
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 72px 88px",
                      gap: 6,
                      fontSize: 11,
                      color: "#64748b",
                      marginBottom: 4,
                    }}
                  >
                    <div>Ingredient</div>
                    <div style={{ textAlign: "right" }}>% of formula</div>
                    <div style={{ textAlign: "right" }}>Grams</div>
                  </div>
                  {pectinPreview.ok && "singlePlan" in pectinPreview && pectinPreview.singlePlan ? (
                    <>
                      {(
                        [
                          {
                            label: "Melt-to-Make™ Pectin Base (Part A)",
                            frac: pectinPreview.singlePlan.partAPectinMassFraction,
                            g: pectinPreview.singlePlan.gramsPartAPectin,
                          },
                          {
                            label: "Additive",
                            frac: pectinPreview.singlePlan.additiveMassFraction,
                            g: pectinPreview.singlePlan.gramsAdditive,
                          },
                          {
                            label: "Citric acid solution (Part B)",
                            frac: pectinPreview.singlePlan.citricMassFraction,
                            g: pectinPreview.singlePlan.gramsCitricSolution,
                          },
                        ] as const
                      ).map((r) => (
                        <div
                          key={r.label}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 72px 88px",
                            gap: 6,
                            fontSize: 12,
                            color: "#e2e8f0",
                            padding: "4px 0",
                            borderBottom: "1px solid rgba(51,65,85,0.6)",
                          }}
                        >
                          <div>{r.label}</div>
                          <div style={{ textAlign: "right", fontWeight: 700 }}>{pctOfFormula(r.frac)}</div>
                          <div style={{ textAlign: "right" }}>{r.g.toFixed(2)}</div>
                        </div>
                      ))}
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 72px 88px",
                          gap: 6,
                          fontSize: 12,
                          color: "#a7f3d0",
                          paddingTop: 6,
                          fontWeight: 800,
                        }}
                      >
                        <div>Totals</div>
                        <div style={{ textAlign: "right" }}>100.00%</div>
                        <div style={{ textAlign: "right" }}>{pectinPreview.singlePlan.gramsTotalCheck.toFixed(2)}</div>
                      </div>
                    </>
                  ) : pectinPreview.ok && "multiPlan" in pectinPreview && pectinPreview.multiPlan ? (
                    <>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 72px 88px",
                          gap: 6,
                          fontSize: 12,
                          color: "#e2e8f0",
                          padding: "4px 0",
                          borderBottom: "1px solid rgba(51,65,85,0.6)",
                        }}
                      >
                        <div>Melt-to-Make™ Pectin Base (Part A)</div>
                        <div style={{ textAlign: "right", fontWeight: 700 }}>
                          {pctOfFormula(pectinPreview.multiPlan.partAPectinMassFraction)}
                        </div>
                        <div style={{ textAlign: "right" }}>{pectinPreview.multiPlan.gramsByLine.partAPectin.toFixed(2)}</div>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 72px 88px",
                          gap: 6,
                          fontSize: 12,
                          color: "#e2e8f0",
                          padding: "4px 0",
                          borderBottom: "1px solid rgba(51,65,85,0.6)",
                        }}
                      >
                        <div>Additives (combined)</div>
                        <div style={{ textAlign: "right", fontWeight: 700 }}>
                          {pctOfFormula(
                            pectinPreview.multiPlan.additiveMassFractions.reduce((a, b) => a + b, 0),
                          )}
                        </div>
                        <div style={{ textAlign: "right" }}>
                          {pectinPreview.multiPlan.gramsByLine.additives.reduce((a, b) => a + b, 0).toFixed(2)}
                        </div>
                      </div>
                      {pectinPreview.multiPlan.extraMassFraction > 1e-9 ? (
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 72px 88px",
                            gap: 6,
                            fontSize: 12,
                            color: "#e2e8f0",
                            padding: "4px 0",
                            borderBottom: "1px solid rgba(51,65,85,0.6)",
                          }}
                        >
                          <div>Extras (flavor / MCT / etc.)</div>
                          <div style={{ textAlign: "right", fontWeight: 700 }}>
                            {pctOfFormula(pectinPreview.multiPlan.extraMassFraction)}
                          </div>
                          <div style={{ textAlign: "right" }}>
                            {pectinPreview.multiPlan.gramsByLine.extras.reduce((a, b) => a + b, 0).toFixed(2)}
                          </div>
                        </div>
                      ) : null}
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 72px 88px",
                          gap: 6,
                          fontSize: 12,
                          color: "#e2e8f0",
                          padding: "4px 0",
                          borderBottom: "1px solid rgba(51,65,85,0.6)",
                        }}
                      >
                        <div>Citric acid solution (Part B)</div>
                        <div style={{ textAlign: "right", fontWeight: 700 }}>
                          {pctOfFormula(pectinPreview.multiPlan.citricMassFraction)}
                        </div>
                        <div style={{ textAlign: "right" }}>{pectinPreview.multiPlan.gramsByLine.citric.toFixed(2)}</div>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 72px 88px",
                          gap: 6,
                          fontSize: 12,
                          color: "#a7f3d0",
                          paddingTop: 6,
                          fontWeight: 800,
                        }}
                      >
                        <div>Totals</div>
                        <div style={{ textAlign: "right" }}>100.00%</div>
                        <div style={{ textAlign: "right" }}>{pectinPreview.multiPlan.gramsByLine.total.toFixed(2)}</div>
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: 12, color: "#94a3b8" }}>
                      Enter gummy batch sizing (Part A on hand or piece count), piece weight, and mg targets to populate
                      the workbook-style split.
                    </div>
                  )}
                </div>
                {pectinMode === "single" ? (
                  <div
                    style={{
                      fontSize: 12,
                      color: "#94a3b8",
                      marginBottom: 10,
                      lineHeight: 1.5,
                      borderLeft: "3px solid rgba(251, 146, 60, 0.45)",
                      paddingLeft: 10,
                    }}
                  >
                    <strong style={{ color: "#fdba74" }}>Single additive:</strong> the oil COA mass fraction above is used
                    for both batch THC accounting and the Melt-to-Make additive line (same field as the old separate
                    inputs).
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 12, color: "#fdba74", marginBottom: 6 }}>
                      Multi mode: the batch target MG / piece is the sum of additive goals (
                      {effectiveTargetMgForBatch.toFixed(2)} mg), shown under Gummy batch size above.
                    </div>
                    {[0, 1, 2, 3].map((idx) => (
                      <div
                        key={idx}
                        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 8 }}
                      >
                        <label style={{ fontSize: 12 }}>
                          <div style={{ color: "#94a3b8", marginBottom: 4 }}>Additive #{idx + 1} goal (mg/pc)</div>
                          <input
                            type="number"
                            min={0}
                            step={0.1}
                            value={pectinMultiRows[idx]!.goalMg}
                            onChange={(e) => {
                              const next = [...pectinMultiRows];
                              next[idx] = { ...next[idx]!, goalMg: Number(e.target.value) };
                              setPectinMultiRows(next);
                            }}
                            style={inputFull}
                          />
                        </label>
                        <label style={{ fontSize: 12 }}>
                          <div style={{ color: "#94a3b8", marginBottom: 4 }}>Potency fraction (0–1)</div>
                          <input
                            type="number"
                            min={0.0001}
                            max={1}
                            step={0.0001}
                            value={pectinMultiRows[idx]!.potencyFrac}
                            onChange={(e) => {
                              const next = [...pectinMultiRows];
                              next[idx] = { ...next[idx]!, potencyFrac: Number(e.target.value) };
                              setPectinMultiRows(next);
                            }}
                            style={inputFull}
                          />
                        </label>
                      </div>
                    ))}
                    <label style={{ display: "block", marginBottom: 10, fontSize: 13 }}>
                      <div style={{ color: "#94a3b8", marginBottom: 4 }}>
                        Extra mass fractions (optional, comma-separated, e.g. 0.02,0.01)
                      </div>
                      <input value={pectinExtraCsv} onChange={(e) => setPectinExtraCsv(e.target.value)} style={inputFull} />
                    </label>
                  </>
                )}
                {pectinPreview.ok && "singlePlan" in pectinPreview && pectinPreview.singlePlan && (
                  <div style={{ fontSize: 12, color: "#86efac", marginBottom: 8, lineHeight: 1.5 }}>
                    Preview — Part A: {pectinPreview.singlePlan.gramsPartAPectin.toFixed(2)} g · Additive (calc):{" "}
                    {pectinPreview.singlePlan.gramsAdditive.toFixed(2)} g · Citric:{" "}
                    {pectinPreview.singlePlan.gramsCitricSolution.toFixed(2)} g · Pieces after waste:{" "}
                    {pectinPreview.singlePlan.piecesAfterLineWaste.toFixed(1)}
                  </div>
                )}
                {pectinPreview.ok && "multiPlan" in pectinPreview && pectinPreview.multiPlan && (
                  <div style={{ fontSize: 12, color: "#86efac", marginBottom: 8, lineHeight: 1.5 }}>
                    Preview — Part A: {pectinPreview.multiPlan.gramsByLine.partAPectin.toFixed(2)} g · Additives (calc):{" "}
                    {pectinPreview.multiPlan.gramsByLine.additives
                      .map((x) => x.toFixed(2))
                      .join(", ")}{" "}
                    g · Citric: {pectinPreview.multiPlan.gramsByLine.citric.toFixed(2)} g · Pieces after waste:{" "}
                    {pectinPreview.multiPlan.piecesAfterLineWaste.toFixed(1)}
                  </div>
                )}
                {cProduct === "Gummies" && !pectinPreview.ok && pectinPreview.error && (
                  <div style={{ fontSize: 12, color: "#fecaca", marginTop: 4 }}>{pectinPreview.error}</div>
                )}
              </div>
            )}
            <label style={{ display: "block", marginBottom: 10, fontSize: 13 }}>
              <div style={{ color: "#94a3b8", marginBottom: 4 }}>Ingredient notes</div>
              <textarea
                value={cIngredientNotes}
                onChange={(e) => setCIngredientNotes(e.target.value)}
                rows={2}
                style={inputFull}
              />
            </label>
            <label style={{ display: "block", marginBottom: 12, fontSize: 13 }}>
              <div style={{ color: "#94a3b8", marginBottom: 4 }}>Production notes</div>
              <textarea value={cNotes} onChange={(e) => setCNotes(e.target.value)} rows={3} style={inputFull} />
            </label>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                style={ghostBtn}
                onClick={() => {
                  setCreateOpen(false);
                  setCreatePrintSummary(null);
                }}
                disabled={createBusy}
              >
                Cancel
              </button>
              <button type="submit" style={primaryBtn} disabled={createBusy}>
                {createBusy ? "Creating…" : "Create"}
              </button>
            </div>
          </form>
          )}
        </div>
      )}

      {taskModal && (
        <div style={overlay}>
          <form onSubmit={onLogTask} style={{ ...cardStyle, maxWidth: 480, width: "100%" }}>
            <h3 style={{ marginTop: 0 }}>Log production task</h3>
            <p style={{ color: "#94a3b8", fontSize: 13 }}>{taskModal.batchNumber}</p>
            <label style={{ display: "block", marginBottom: 10 }}>
              <div style={{ color: "#94a3b8", fontSize: 12 }}>Task</div>
              <select required value={taskPick} onChange={(e) => setTaskPick(e.target.value)} style={inputFull}>
                <option value="">Select…</option>
                {stageTaskSuggestions(taskModal.stage).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "block", marginBottom: 10 }}>
              <div style={{ color: "#94a3b8", fontSize: 12 }}>Employees</div>
              <input value={taskEmployees} onChange={(e) => setTaskEmployees(e.target.value)} style={inputFull} />
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <label>
                <div style={{ color: "#94a3b8", fontSize: 11 }}>Temp °C</div>
                <input value={taskTemp} onChange={(e) => setTaskTemp(e.target.value)} style={inputFull} />
              </label>
              <label>
                <div style={{ color: "#94a3b8", fontSize: 11 }}>Weight</div>
                <input value={taskWeight} onChange={(e) => setTaskWeight(e.target.value)} style={inputFull} />
              </label>
              <label>
                <div style={{ color: "#94a3b8", fontSize: 11 }}>Minutes</div>
                <input value={taskDur} onChange={(e) => setTaskDur(e.target.value)} style={inputFull} />
              </label>
            </div>
            <label style={{ display: "block", marginTop: 10 }}>
              <div style={{ color: "#94a3b8", fontSize: 12 }}>Notes</div>
              <textarea value={taskNotes} onChange={(e) => setTaskNotes(e.target.value)} rows={2} style={inputFull} />
            </label>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 12 }}>
              <button type="button" style={ghostBtn} onClick={() => setTaskModal(null)}>
                Cancel
              </button>
              <button type="submit" style={primaryBtn}>
                Save
              </button>
            </div>
          </form>
        </div>
      )}

      {qaModal && (
        <div style={overlay}>
          <form onSubmit={onSubmitQa} style={{ ...cardStyle, maxWidth: 480, width: "100%" }}>
            <h3 style={{ marginTop: 0 }}>Submit QA</h3>
            <p style={{ color: "#94a3b8", fontSize: 13 }}>{qaModal.batchNumber}</p>
            {(["potency", "homogeneity", "microbial"] as const).map((k) => {
              const val = k === "potency" ? qaPot : k === "homogeneity" ? qaHom : qaMic;
              const set = k === "potency" ? setQaPot : k === "homogeneity" ? setQaHom : setQaMic;
              return (
                <label key={k} style={{ display: "block", marginBottom: 8 }}>
                  <div style={{ color: "#94a3b8", fontSize: 12 }}>{k}</div>
                  <select value={val} onChange={(e) => set(e.target.value as "PENDING" | "PASSED" | "FAILED")} style={inputFull}>
                    {(["PENDING", "PASSED", "FAILED"] as const).map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
            <label style={{ display: "block", marginBottom: 8 }}>
              <div style={{ color: "#94a3b8", fontSize: 12 }}>Failure reason (if any failed)</div>
              <input value={qaFail} onChange={(e) => setQaFail(e.target.value)} style={inputFull} />
            </label>
            <label style={{ display: "block", marginBottom: 8 }}>
              <div style={{ color: "#94a3b8", fontSize: 12 }}>Notes</div>
              <textarea value={qaNotes} onChange={(e) => setQaNotes(e.target.value)} rows={2} style={inputFull} />
            </label>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" style={ghostBtn} onClick={() => setQaModal(null)}>
                Cancel
              </button>
              <button type="submit" style={primaryBtn}>
                Submit
              </button>
            </div>
          </form>
        </div>
      )}

      {mgrModal && (
        <div style={overlay}>
          <form onSubmit={onMgrReview} style={{ ...cardStyle, maxWidth: 480, width: "100%" }}>
            <h3 style={{ marginTop: 0 }}>Manager QA review</h3>
            <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
              <input type="checkbox" checked={mgrApprove} onChange={(e) => setMgrApprove(e.target.checked)} />
              Approve (unlock packaging transfer)
            </label>
            {!mgrApprove && (
              <label style={{ display: "block", marginBottom: 8 }}>
                <div style={{ color: "#94a3b8", fontSize: 12 }}>Reject reason</div>
                <input value={mgrFail} onChange={(e) => setMgrFail(e.target.value)} style={inputFull} />
              </label>
            )}
            <label style={{ display: "block", marginBottom: 8 }}>
              <div style={{ color: "#94a3b8", fontSize: 12 }}>Manager notes</div>
              <textarea value={mgrNotes} onChange={(e) => setMgrNotes(e.target.value)} rows={2} style={inputFull} />
            </label>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" style={ghostBtn} onClick={() => setMgrModal(null)}>
                Cancel
              </button>
              <button type="submit" style={primaryBtn}>
                Save
              </button>
            </div>
          </form>
        </div>
      )}

      {xferModal && (
        <div style={overlay}>
          <form onSubmit={onTransfer} style={{ ...cardStyle, maxWidth: 440, width: "100%" }}>
            <h3 style={{ marginTop: 0 }}>Transfer to packaging</h3>
            <p style={{ color: "#94a3b8", fontSize: 13 }}>
              Creates a real packaging lot from the same extraction run, links traceability to this edible batch, and
              completes the kitchen record.
            </p>
            <label style={{ display: "block", marginBottom: 12 }}>
              <div style={{ color: "#94a3b8", fontSize: 12 }}>Grams per unit (package line)</div>
              <input
                required
                min={0.01}
                step={0.01}
                value={xferGPerUnit}
                onChange={(e) => setXferGPerUnit(e.target.value)}
                style={inputFull}
                placeholder="e.g. 1.0"
              />
            </label>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" style={ghostBtn} onClick={() => setXferModal(null)}>
                Cancel
              </button>
              <button type="submit" style={primaryBtn}>
                Create packaging lot
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

const inputFull: React.CSSProperties = {
  width: "100%",
  borderRadius: 10,
  border: "1px solid #334155",
  background: "#0f172a",
  color: "white",
  padding: "9px 11px",
  boxSizing: "border-box",
};

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.78)",
  zIndex: 10000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
};
