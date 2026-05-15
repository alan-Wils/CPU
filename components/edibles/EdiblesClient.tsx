"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { hasAppPermission } from "@cpu/shared";
import SectionCalendarLauncher from "@/components/SectionCalendarLauncher";
import { getAuthUser } from "@/lib/auth";
import { CPU_TENANT_CHANGED_EVENT } from "@/lib/tenantEvents";
import {
  createEdibleBatch,
  deleteEdibleBatch,
  fetchEdiblesDashboard,
  fetchEdiblesOilOptions,
  patchEdibleBatch,
  postEdibleQa,
  postEdibleQaManagerReview,
  postEdibleTaskLog,
  postEdibleTransferPackaging,
  type EdibleDashboardBatch,
  type EdibleDashboardJson,
  type EdibleOilOption,
} from "@/lib/ediblesApi";
import {
  buildSnapshotFromMulti,
  buildSnapshotFromSingle,
  mergeUserNotesAndPectinPlan,
  postPectinKitchenIngredients,
  type PectinMeltFormulaSnapshot,
} from "@/lib/ediblesPectinBatchNotes";
import {
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

  const [cSku, setCSku] = useState("");
  const [cFlavor, setCFlavor] = useState("");
  const [cProduct, setCProduct] = useState<string>("Gummies");
  const [cMg, setCMg] = useState(10);
  const [cPieces, setCPieces] = useState(5000);
  const [cRunId, setCRunId] = useState("");
  const [cOilG, setCOilG] = useState(100);
  const [cPotency, setCPotency] = useState<number | "">(85);
  const [cNotes, setCNotes] = useState("");

  const [pectinMode, setPectinMode] = useState<"single" | "multi">("single");
  const [pectinBatchG, setPectinBatchG] = useState(10_000);
  const [pectinPotencySingle, setPectinPotencySingle] = useState(0.7933);
  const [pectinGPerPc, setPectinGPerPc] = useState(3.5);
  const [pectinCitricFrac, setPectinCitricFrac] = useState(0.014);
  const [pectinLineWasteFrac, setPectinLineWasteFrac] = useState(0.05);
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

  const selectedOil = useMemo(() => oilOptions.find((o) => o.extractionRunId === cRunId), [oilOptions, cRunId]);

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

  const pectinPreview = useMemo(() => {
    if (cProduct !== "Gummies") {
      return { ok: true as const, error: null as string | null, mode: "single" as const };
    }
    try {
      if (pectinBatchG <= 0 || !Number.isFinite(pectinBatchG)) {
        return { ok: false as const, error: "Pectin batch size (grams) must be a positive number.", mode: pectinMode };
      }
      if (pectinGPerPc <= 0 || !Number.isFinite(pectinGPerPc)) {
        return { ok: false as const, error: "Piece weight (grams) must be positive.", mode: pectinMode };
      }
      if (pectinCitricFrac <= 0 || pectinCitricFrac > 0.2) {
        return { ok: false as const, error: "Citric mass fraction must be between 0 and 0.2.", mode: pectinMode };
      }
      if (pectinLineWasteFrac < 0 || pectinLineWasteFrac >= 1) {
        return { ok: false as const, error: "Line waste fraction must be in [0, 1).", mode: pectinMode };
      }
      if (pectinMode === "single") {
        if (cMg <= 0) {
          return { ok: false as const, error: "Target MG / piece must be positive for the pectin plan.", mode: "single" as const };
        }
        if (pectinPotencySingle <= 0 || pectinPotencySingle > 1) {
          return { ok: false as const, error: "Additive potency fraction must be in (0, 1].", mode: "single" as const };
        }
        const singlePlan = planPectinSingleAdditiveBatch({
          batchSizeGrams: pectinBatchG,
          potencyFraction: pectinPotencySingle,
          targetMgPerPiece: cMg,
          gramsPerPiece: pectinGPerPc,
          citricMassFraction: pectinCitricFrac,
          lineWasteFraction: pectinLineWasteFrac,
        });
        if (singlePlan.partAPectinMassFraction <= 0) {
          return {
            ok: false as const,
            error: "Pectin plan is infeasible (Part A ≤ 0). Reduce citric %, mg target, or adjust inputs.",
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
        batchSizeGrams: pectinBatchG,
        gramsPerPiece: pectinGPerPc,
        additives: pectinMultiAdditivesForPlan,
        citricMassFraction: pectinCitricFrac,
        extraMassFractions: extras.length ? extras : undefined,
        lineWasteFraction: pectinLineWasteFrac,
      });
      if (multiPlan.partAPectinMassFraction <= 0) {
        return {
          ok: false as const,
          error: "Pectin plan is infeasible (Part A ≤ 0). Reduce additives, extras, or citric %.",
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
    pectinBatchG,
    pectinGPerPc,
    pectinCitricFrac,
    pectinLineWasteFrac,
    pectinPotencySingle,
    cMg,
    pectinMultiAdditivesForPlan,
    pectinExtraCsv,
  ]);

  const projected = useMemo(() => {
    const potencyNum = cPotency === "" ? 0 : Number(cPotency);
    const mg = Number.isFinite(potencyNum) && potencyNum > 0 ? cOilG * potencyNum : 0;
    const perPieceMg =
      cProduct === "Gummies" && pectinMode === "multi" ? effectiveTargetMgForBatch : cMg;
    const per = perPieceMg > 0 ? mg / perPieceMg : 0;
    return { totalMg: mg, estPieces: per > 0 ? Math.floor(per) : 0 };
  }, [cOilG, cPotency, cMg, cProduct, pectinMode, effectiveTargetMgForBatch]);

  async function onCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!cRunId.trim()) {
      setError("Select an extraction oil source.");
      return;
    }
    if (!cSku.trim() || !cFlavor.trim()) {
      setError("SKU and flavor are required.");
      return;
    }
    if (cProduct === "Gummies") {
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
    if (selectedOil && oilG > selectedOil.availableGrams + 1e-6) {
      setError(
        `Oil grams (${oilG.toFixed(4)} g) cannot exceed available on this run (${selectedOil.availableGrams.toFixed(4)} g).`,
      );
      return;
    }
    const targetPiecesInt = Math.floor(Number(cPieces));
    if (!Number.isFinite(targetPiecesInt) || targetPiecesInt < 1) {
      setError("Gummies per batch (target pieces) must be an integer ≥ 1.");
      return;
    }
    const targetMgForApi = cProduct === "Gummies" && pectinMode === "multi" ? effectiveTargetMgForBatch : cMg;
    if (!Number.isFinite(targetMgForApi) || targetMgForApi <= 0) {
      setError("Target MG / piece must be positive.");
      return;
    }

    const userKitchenNotes = [cNotes.trim(), cIngredientNotes.trim() ? `Ingredients: ${cIngredientNotes.trim()}` : ""]
      .filter(Boolean)
      .join("\n\n");

    let notesPayload: string | null = userKitchenNotes || null;
    let pectinSnapshot: PectinMeltFormulaSnapshot | null = null;
    if (cProduct === "Gummies" && pectinPreview.ok) {
      if (pectinPreview.mode === "single" && "singlePlan" in pectinPreview && pectinPreview.singlePlan) {
        pectinSnapshot = buildSnapshotFromSingle({
          input: {
            batchSizeGrams: pectinBatchG,
            potencyFraction: pectinPotencySingle,
            targetMgPerPiece: cMg,
            gramsPerPiece: pectinGPerPc,
            citricMassFraction: pectinCitricFrac,
            lineWasteFraction: pectinLineWasteFrac,
          },
          plan: pectinPreview.singlePlan,
          oilInputGrams: oilG,
          targetPieces: targetPiecesInt,
          lineWasteFraction: pectinLineWasteFrac,
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
          batchSizeGrams: pectinBatchG,
          gramsPerPiece: pectinGPerPc,
          citricMassFraction: pectinCitricFrac,
          lineWasteFraction: pectinLineWasteFrac,
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
        potencyMgPerGram: cPotency === "" ? null : Number(cPotency),
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
          await refresh();
          return;
        }
      }
      setCreateOpen(false);
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
              <button type="button" style={primaryBtn} onClick={() => setCreateOpen(true)}>
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
          <form onSubmit={onCreateSubmit} style={{ ...cardStyle, maxWidth: 640, width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
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
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
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
            <label style={{ display: "block", marginBottom: 10, fontSize: 13 }}>
              <div style={{ color: "#94a3b8", marginBottom: 4 }}>Oil source (completed extraction)</div>
              <select required value={cRunId} onChange={(e) => setCRunId(e.target.value)} style={inputFull}>
                <option value="">Select run…</option>
                {oilOptions.map((o) => (
                  <option key={o.extractionRunId} value={o.extractionRunId}>
                    {o.strainLabel} — {o.availableGrams.toFixed(2)} g avail · {o.productType}
                  </option>
                ))}
              </select>
            </label>
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
                <div>Run output: {selectedOil.outputGrams.toFixed(2)} g</div>
                <div>Available after packaging + other edibles: {selectedOil.availableGrams.toFixed(2)} g</div>
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
              <div style={{ color: "#94a3b8", marginBottom: 4 }}>Potency (mg THC per gram oil)</div>
              <input
                type="number"
                min={0}
                step={0.1}
                value={cPotency}
                onChange={(e) => setCPotency(e.target.value === "" ? "" : Number(e.target.value))}
                style={inputFull}
              />
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
                  Uses the same calculator as the Melt-to-Make workbook. The saved plan is appended to batch notes (with
                  JSON), then Part A, oil allocation, citric, and any extra masses are posted as ingredient lines.
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
                    onClick={() => setPectinMode("single")}
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
                    onClick={() => setPectinMode("multi")}
                  >
                    Multi additive
                  </button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                  <label style={{ fontSize: 13 }}>
                    <div style={{ color: "#94a3b8", marginBottom: 4 }}>Batch size (g)</div>
                    <input
                      type="number"
                      required
                      min={1}
                      step={1}
                      value={pectinBatchG}
                      onChange={(e) => setPectinBatchG(Number(e.target.value))}
                      style={inputFull}
                    />
                  </label>
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
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end", marginBottom: 10 }}>
                  <label style={{ fontSize: 13, flex: "1 1 120px" }}>
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
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                  <label style={{ fontSize: 13 }}>
                    <div style={{ color: "#94a3b8", marginBottom: 4 }}>Citric mass fraction</div>
                    <input
                      type="number"
                      min={0.001}
                      max={0.2}
                      step={0.001}
                      value={pectinCitricFrac}
                      onChange={(e) => setPectinCitricFrac(Number(e.target.value))}
                      style={inputFull}
                    />
                  </label>
                  <label style={{ fontSize: 13 }}>
                    <div style={{ color: "#94a3b8", marginBottom: 4 }}>Line waste fraction</div>
                    <input
                      type="number"
                      min={0}
                      max={0.49}
                      step={0.01}
                      value={pectinLineWasteFrac}
                      onChange={(e) => setPectinLineWasteFrac(Number(e.target.value))}
                      style={inputFull}
                    />
                  </label>
                </div>
                {pectinMode === "single" ? (
                  <label style={{ display: "block", marginBottom: 10, fontSize: 13 }}>
                    <div style={{ color: "#94a3b8", marginBottom: 4 }}>
                      Additive potency (0–1 fraction, e.g. COA 79.33% → 0.7933)
                    </div>
                    <input
                      type="number"
                      required
                      min={0.0001}
                      max={1}
                      step={0.0001}
                      value={pectinPotencySingle}
                      onChange={(e) => setPectinPotencySingle(Number(e.target.value))}
                      style={inputFull}
                    />
                  </label>
                ) : (
                  <>
                    <div style={{ fontSize: 12, color: "#fdba74", marginBottom: 6 }}>
                      Multi mode: batch <span style={{ fontWeight: 800 }}>target MG / piece</span> sent to the API is the
                      sum of additive goals ({effectiveTargetMgForBatch.toFixed(2)} mg).
                    </div>
                    {Math.abs(cMg - effectiveTargetMgForBatch) > 0.001 && (
                      <div style={{ fontSize: 12, color: "#fca5a5", marginBottom: 8 }}>
                        Note: the Target MG / piece field above ({cMg}) does not match the pectin row sum — creation uses
                        the row sum for compliance with the calculator.
                      </div>
                    )}
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
              <button type="button" style={ghostBtn} onClick={() => setCreateOpen(false)} disabled={createBusy}>
                Cancel
              </button>
              <button type="submit" style={primaryBtn} disabled={createBusy}>
                {createBusy ? "Creating…" : "Create"}
              </button>
            </div>
          </form>
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
