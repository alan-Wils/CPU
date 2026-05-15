"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { apiRequest, appendCompanyIdQuery, getSelectedCompanyId } from "@/lib/api";
import {
  COLORADO_EMPLOYEE_SAMPLE_MEDICAL_CONCENTRATE_GRAMS_PER_MONTH,
  COLORADO_EMPLOYEE_SAMPLE_RETAIL_CONCENTRATE_GRAMS_PER_MONTH,
  COLORADO_EMPLOYEE_SAMPLE_SERVINGS_OR_PRODUCTS_PER_MONTH,
  DEFAULT_FLOWER_GRAMS_MONTHLY_LIMIT,
} from "@/lib/coloradoEmployeeSampleLimits";

type EligibleEmployee = { id: string; email: string; displayName: string; active: boolean };

type SampleRow = {
  id: string;
  transferDate: string;
  employeeNameSnapshot: string;
  employeeEmail?: string;
  productName: string;
  productCategory: string;
  quantity: number;
  unit: string;
  batchNumber: string;
  metrcPackageTag: string;
  purpose: string;
  createdByEmail?: string;
};

type SampleDetail = SampleRow & {
  companyId: string;
  employeeId: string;
  employeeIdentifierSnapshot?: string | null;
  licenseType: string;
  sourceType: string;
  thcMgPerServing?: number | null;
  calendarMonth: string;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string;
  compliance?: Record<string, boolean>;
};

type UsagePanel = {
  used: { concentrateGrams: number; productsOrServings: number; flowerGrams: number };
  caps: { concentrateGrams: number; productsOrServings: number; flowerGrams: number };
  remaining: { concentrateGrams: number; productsOrServings: number; flowerGrams: number };
  remainingAfter?: { concentrateGrams: number; productsOrServings: number; flowerGrams: number };
  after?: { concentrateGrams: number; productsOrServings: number; flowerGrams: number };
  ok?: boolean;
  violations?: string[];
};

function monthKeyFromYmd(ymd: string): string {
  const s = String(ymd || "").trim();
  return s.length >= 7 ? s.slice(0, 7) : "";
}

function csvEscape(v: string): string {
  const needs = /[",\n]/.test(v);
  const t = v.replace(/"/g, '""');
  return needs ? `"${t}"` : t;
}

function InfoCircleGlyph({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9.25" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="12" cy="8" r="1.1" fill="currentColor" />
      <path d="M12 11v6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

export type EmployeeSamplesAdminProps = {
  enabled: boolean;
  companyId: string;
  panelStyle: CSSProperties;
  sectionTitleStyle: CSSProperties;
  labelStyle: CSSProperties;
  inputStyle: CSSProperties;
  smallButtonStyle: CSSProperties;
  modalOverlayStyle: CSSProperties;
  modalStyle: CSSProperties;
};

export default function EmployeeSamplesAdmin({
  enabled,
  companyId,
  panelStyle,
  sectionTitleStyle,
  labelStyle,
  inputStyle,
  smallButtonStyle,
  modalOverlayStyle,
  modalStyle,
}: EmployeeSamplesAdminProps) {
  const cid = String(companyId || "").trim() || String(getSelectedCompanyId() || "").trim();

  const [newOpen, setNewOpen] = useState(false);
  const [medRuleInfoOpen, setMedRuleInfoOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [detail, setDetail] = useState<SampleDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [eligible, setEligible] = useState<EligibleEmployee[]>([]);

  const [fEmployeeId, setFEmployeeId] = useState("");
  const [fLicense, setFLicense] = useState<"MEDICAL" | "RETAIL">("MEDICAL");
  const [fSource, setFSource] = useState<"CULTIVATION" | "MANUFACTURING" | "PACKAGING" | "OTHER">("MANUFACTURING");
  const [fCategory, setFCategory] = useState<"FLOWER" | "CONCENTRATE" | "EDIBLE" | "NON_EDIBLE_PRODUCT">("FLOWER");
  const [fName, setFName] = useState("");
  const [fBatch, setFBatch] = useState("");
  const [fTag, setFTag] = useState("");
  const [fQty, setFQty] = useState("1");
  const [fUnit, setFUnit] = useState<"GRAMS" | "SERVINGS" | "EACH">("GRAMS");
  const [fThc, setFThc] = useState("");
  const [fTransfer, setFTransfer] = useState(() => new Date().toISOString().slice(0, 10));
  const [fPurpose, setFPurpose] = useState<"QUALITY_CONTROL" | "PRODUCT_DEVELOPMENT">("QUALITY_CONTROL");
  const [fNotes, setFNotes] = useState("");
  const [fIdSnap, setFIdSnap] = useState("");

  const [ackVoluntary, setAckVoluntary] = useState(false);
  const [ackLimit, setAckLimit] = useState(false);
  const [ackNoResale, setAckNoResale] = useState(false);
  const [ackNoPrem, setAckNoPrem] = useState(false);
  const [ackNotComp, setAckNotComp] = useState(false);

  const [usage, setUsage] = useState<UsagePanel | null>(null);

  const qtyNum = useMemo(() => Number(String(fQty).replace(/,/g, "")), [fQty]);
  const monthKey = useMemo(() => monthKeyFromYmd(fTransfer), [fTransfer]);

  const loadEligible = useCallback(async () => {
    if (!cid || !enabled) return;
    const raw = await apiRequest<{ employees: EligibleEmployee[] }>(
      appendCompanyIdQuery("/api/admin/employee-samples/eligible-employees", cid),
      { companyId: cid },
    );
    setEligible(Array.isArray(raw.employees) ? raw.employees : []);
  }, [cid, enabled]);

  useEffect(() => {
    if (!newOpen || !enabled) return;
    void loadEligible().catch(() => setEligible([]));
  }, [newOpen, enabled, loadEligible]);

  useEffect(() => {
    if (!newOpen) setMedRuleInfoOpen(false);
  }, [newOpen]);

  const refreshUsage = useCallback(async () => {
    if (!cid || !enabled || !fEmployeeId || !monthKey) {
      setUsage(null);
      return;
    }
    const qs = new URLSearchParams({
      employeeId: fEmployeeId,
      month: monthKey,
      licenseType: fLicense,
    });
    if (Number.isFinite(qtyNum) && qtyNum > 0) {
      qs.set("previewProductCategory", fCategory);
      qs.set("previewUnit", fUnit);
      qs.set("previewQuantity", String(qtyNum));
    }
    const path = appendCompanyIdQuery(`/api/admin/employee-samples/monthly-usage?${qs.toString()}`, cid);
    try {
      const u = await apiRequest<UsagePanel>(path, { companyId: cid });
      setUsage(u);
    } catch {
      setUsage(null);
    }
  }, [cid, enabled, fEmployeeId, monthKey, fLicense, fCategory, fUnit, qtyNum]);

  useEffect(() => {
    if (!newOpen) return;
    void refreshUsage();
  }, [newOpen, refreshUsage]);

  async function submitNew(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!cid) {
      setError("Select a company first.");
      return;
    }
    if (!fEmployeeId) {
      setError("Choose an employee.");
      return;
    }
    if (!ackVoluntary || !ackLimit || !ackNoResale || !ackNoPrem || !ackNotComp) {
      setError("All compliance checkboxes must be checked.");
      return;
    }
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      setError("Enter a valid quantity.");
      return;
    }
    setBusy(true);
    try {
      await apiRequest("/api/admin/employee-samples", {
        method: "POST",
        companyId: cid,
        body: {
          employeeId: fEmployeeId,
          employeeIdentifierSnapshot: fIdSnap.trim() || null,
          licenseType: fLicense,
          sourceType: fSource,
          productCategory: fCategory,
          productName: fName.trim(),
          batchNumber: fBatch.trim(),
          metrcPackageTag: fTag.trim(),
          quantity: qtyNum,
          unit: fUnit,
          thcMgPerServing: fThc.trim() ? Number(fThc) : null,
          transferDate: fTransfer,
          purpose: fPurpose,
          notes: fNotes.trim() || null,
          sopAcknowledged: true,
          employeeConfirmedMonthlyLimit: true,
          notCompensationAcknowledged: true,
          noOnPremConsumptionAcknowledged: true,
          noResaleOrTransferAcknowledged: true,
        },
      });
      setNewOpen(false);
      setAckVoluntary(false);
      setAckLimit(false);
      setAckNoResale(false);
      setAckNoPrem(false);
      setAckNotComp(false);
      setFName("");
      setFBatch("");
      setFTag("");
      setFNotes("");
      setFIdSnap("");
    } catch (err: unknown) {
      const m = err && typeof err === "object" && "message" in err ? String((err as { message?: string }).message) : "";
      setError(m || "Could not save sample record.");
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) return null;

  return (
    <>
      <section style={{ ...panelStyle, marginTop: 22 }}>
        <h2 style={sectionTitleStyle}>Employee Samples</h2>
        <p style={{ color: "#94a3b8", marginTop: 0, marginBottom: 14, lineHeight: 1.55, fontSize: 14 }}>
          Colorado MED designated R&amp;D sampling employees (Metrc role effective Jan. 5, 2026). Track transfers,
          monthly limits, and inspection-ready records. On-premises consumption and compensation uses are prohibited.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <button
            type="button"
            onClick={() => {
              setError("");
              setNewOpen(true);
            }}
            style={{
              ...smallButtonStyle,
              background: "rgba(168, 85, 247, 0.22)",
              border: "1px solid rgba(168, 85, 247, 0.45)",
              color: "#e9d5ff",
              cursor: "pointer",
            }}
          >
            New Employee Sample
          </button>
          <button
            type="button"
            onClick={() => {
              setError("");
              setSearchOpen(true);
            }}
            style={{
              ...smallButtonStyle,
              background: "rgba(56, 189, 248, 0.18)",
              border: "1px solid rgba(56, 189, 248, 0.45)",
              color: "#bae6fd",
              cursor: "pointer",
            }}
          >
            Search Employee Samples
          </button>
        </div>
        <p style={{ color: "#64748b", fontSize: 12, marginTop: 12, marginBottom: 0, lineHeight: 1.45 }}>
          Medical concentrate cap {COLORADO_EMPLOYEE_SAMPLE_MEDICAL_CONCENTRATE_GRAMS_PER_MONTH}g/mo; retail concentrate{" "}
          {COLORADO_EMPLOYEE_SAMPLE_RETAIL_CONCENTRATE_GRAMS_PER_MONTH}g/mo; servings/products{" "}
          {COLORADO_EMPLOYEE_SAMPLE_SERVINGS_OR_PRODUCTS_PER_MONTH}/mo. Flower default {DEFAULT_FLOWER_GRAMS_MONTHLY_LIMIT}
          g/mo unless configured per company (Admin → Company Config key <code style={{ color: "#94a3b8" }}>employeeSamples</code>
          ).
        </p>
      </section>

      {newOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            style={{ ...modalOverlayStyle, zIndex: 2147482640 }}
            onClick={(e) => {
              if (e.target === e.currentTarget) setNewOpen(false);
            }}
          >
            <div style={{ ...modalStyle, maxWidth: 720 }} onClick={(ev) => ev.stopPropagation()}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginTop: 0,
                  marginBottom: 4,
                }}
              >
                <h2 style={{ ...sectionTitleStyle, margin: 0, flex: 1, fontSize: 22 }}>New employee sample</h2>
                <button
                  type="button"
                  title="Colorado MED sample rule"
                  aria-label="Colorado MED sample rule"
                  onClick={() => setMedRuleInfoOpen(true)}
                  style={{
                    flexShrink: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 36,
                    height: 36,
                    borderRadius: 999,
                    border: "1px solid rgba(56, 189, 248, 0.45)",
                    background: "rgba(56, 189, 248, 0.12)",
                    color: "#7dd3fc",
                    cursor: "pointer",
                  }}
                >
                  <InfoCircleGlyph size={20} />
                </button>
              </div>
              {error ? (
                <div
                  style={{
                    marginBottom: 12,
                    padding: 12,
                    borderRadius: 12,
                    background: "rgba(127, 29, 29, 0.45)",
                    border: "1px solid rgba(248, 113, 113, 0.5)",
                    color: "#fecaca",
                    fontSize: 14,
                  }}
                >
                  {error}
                </div>
              ) : null}
              <form onSubmit={(e) => void submitNew(e)} style={{ display: "grid", gap: 12 }}>
                <label style={labelStyle}>
                  Employee (designated R&amp;D sampling only)
                  <select
                    value={fEmployeeId}
                    onChange={(e) => setFEmployeeId(e.target.value)}
                    required
                    style={inputStyle}
                  >
                    <option value="">Select…</option>
                    {eligible.map((em) => (
                      <option key={em.id} value={em.id}>
                        {em.displayName} ({em.email})
                      </option>
                    ))}
                  </select>
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <label style={labelStyle}>
                    License type
                    <select
                      value={fLicense}
                      onChange={(e) => setFLicense(e.target.value as "MEDICAL" | "RETAIL")}
                      style={inputStyle}
                    >
                      <option value="MEDICAL">Medical</option>
                      <option value="RETAIL">Retail</option>
                    </select>
                  </label>
                  <label style={labelStyle}>
                    Source type
                    <select
                      value={fSource}
                      onChange={(e) =>
                        setFSource(e.target.value as "CULTIVATION" | "MANUFACTURING" | "PACKAGING" | "OTHER")
                      }
                      style={inputStyle}
                    >
                      <option value="CULTIVATION">Cultivation</option>
                      <option value="MANUFACTURING">Manufacturing</option>
                      <option value="PACKAGING">Packaging</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </label>
                </div>
                <label style={labelStyle}>
                  Product category
                  <select
                    value={fCategory}
                    onChange={(e) =>
                      setFCategory(
                        e.target.value as "FLOWER" | "CONCENTRATE" | "EDIBLE" | "NON_EDIBLE_PRODUCT",
                      )
                    }
                    style={inputStyle}
                  >
                    <option value="FLOWER">Flower</option>
                    <option value="CONCENTRATE">Concentrate</option>
                    <option value="EDIBLE">Edible</option>
                    <option value="NON_EDIBLE_PRODUCT">Non-edible product</option>
                  </select>
                </label>
                <label style={labelStyle}>
                  Product name
                  <input value={fName} onChange={(e) => setFName(e.target.value)} required style={inputStyle} />
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <label style={labelStyle}>
                    Batch number
                    <input value={fBatch} onChange={(e) => setFBatch(e.target.value)} required style={inputStyle} />
                  </label>
                  <label style={labelStyle}>
                    METRC package / inventory tag
                    <input value={fTag} onChange={(e) => setFTag(e.target.value)} required style={inputStyle} />
                  </label>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                  <label style={labelStyle}>
                    Quantity
                    <input value={fQty} onChange={(e) => setFQty(e.target.value)} required style={inputStyle} />
                  </label>
                  <label style={labelStyle}>
                    Unit
                    <select
                      value={fUnit}
                      onChange={(e) => setFUnit(e.target.value as "GRAMS" | "SERVINGS" | "EACH")}
                      style={inputStyle}
                    >
                      <option value="GRAMS">Grams</option>
                      <option value="SERVINGS">Servings</option>
                      <option value="EACH">Each</option>
                    </select>
                  </label>
                  <label style={labelStyle}>
                    THC mg/serving (optional)
                    <input value={fThc} onChange={(e) => setFThc(e.target.value)} style={inputStyle} />
                  </label>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <label style={labelStyle}>
                    Transfer date
                    <input
                      type="date"
                      value={fTransfer}
                      onChange={(e) => setFTransfer(e.target.value)}
                      required
                      style={inputStyle}
                    />
                  </label>
                  <label style={labelStyle}>
                    Purpose
                    <select
                      value={fPurpose}
                      onChange={(e) =>
                        setFPurpose(e.target.value as "QUALITY_CONTROL" | "PRODUCT_DEVELOPMENT")
                      }
                      style={inputStyle}
                    >
                      <option value="QUALITY_CONTROL">Quality control</option>
                      <option value="PRODUCT_DEVELOPMENT">Product development</option>
                    </select>
                  </label>
                </div>
                <label style={labelStyle}>
                  Badge / MED ID snapshot (optional)
                  <input value={fIdSnap} onChange={(e) => setFIdSnap(e.target.value)} style={inputStyle} />
                </label>
                <label style={labelStyle}>
                  Notes
                  <textarea value={fNotes} onChange={(e) => setFNotes(e.target.value)} rows={3} style={inputStyle} />
                </label>

                {usage && usage.used && usage.caps ? (
                  <div
                    style={{
                      borderRadius: 14,
                      border: "1px solid rgba(148, 163, 184, 0.25)",
                      background: "rgba(2, 6, 23, 0.55)",
                      padding: 14,
                      fontSize: 13,
                      color: "#cbd5e1",
                      lineHeight: 1.55,
                    }}
                  >
                    <div style={{ fontWeight: 900, marginBottom: 8, color: "#e2e8f0" }}>Monthly usage (Denver month)</div>
                    <div>
                      <strong>Current month used</strong> — concentrate: {usage.used.concentrateGrams.toFixed(2)}g ·
                      products/servings: {usage.used.productsOrServings.toFixed(2)} · flower: {usage.used.flowerGrams.toFixed(2)}g
                    </div>
                    <div>
                      <strong>Remaining</strong> — concentrate: {(usage.remaining?.concentrateGrams ?? 0).toFixed(2)}g ·
                      products/servings: {(usage.remaining?.productsOrServings ?? 0).toFixed(2)} · flower:{" "}
                      {(usage.remaining?.flowerGrams ?? 0).toFixed(2)}g
                    </div>
                    {usage.remainingAfter ? (
                      <div style={{ marginTop: 6 }}>
                        <strong>After this transfer</strong> — concentrate:{" "}
                        {usage.remainingAfter.concentrateGrams.toFixed(2)}g · products/servings:{" "}
                        {usage.remainingAfter.productsOrServings.toFixed(2)} · flower:{" "}
                        {usage.remainingAfter.flowerGrams.toFixed(2)}g
                        {usage.ok === false && usage.violations?.length ? (
                          <span style={{ display: "block", color: "#fecaca", marginTop: 8 }}>
                            {usage.violations.join(" ")}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div style={{ display: "grid", gap: 10 }}>
                  {[
                    {
                      k: "v",
                      checked: ackVoluntary,
                      set: setAckVoluntary,
                      label:
                        "Employee voluntarily accepts tracking for R&D / sample records (SOP / recordkeeping).",
                    },
                    {
                      k: "l",
                      checked: ackLimit,
                      set: setAckLimit,
                      label: "Employee confirmed this transfer does not exceed their monthly MED limit for this license type.",
                    },
                    {
                      k: "r",
                      checked: ackNoResale,
                      set: setAckNoResale,
                      label: "Employee understands the sample cannot be resold or transferred.",
                    },
                    {
                      k: "p",
                      checked: ackNoPrem,
                      set: setAckNoPrem,
                      label: "Employee understands no on-premises consumption.",
                    },
                    {
                      k: "c",
                      checked: ackNotComp,
                      set: setAckNotComp,
                      label: "Company confirms this is not compensation.",
                    },
                  ].map((x) => (
                    <label
                      key={x.k}
                      style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer", fontSize: 14 }}
                    >
                      <input
                        type="checkbox"
                        checked={x.checked}
                        onChange={(e) => x.set(e.target.checked)}
                        style={{ marginTop: 3 }}
                      />
                      <span style={{ color: "#e2e8f0", lineHeight: 1.45 }}>{x.label}</span>
                    </label>
                  ))}
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => setNewOpen(false)}
                    style={{ ...smallButtonStyle, background: "#334155", border: "1px solid #475569", color: "#e2e8f0" }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={
                      busy ||
                      !ackVoluntary ||
                      !ackLimit ||
                      !ackNoResale ||
                      !ackNoPrem ||
                      !ackNotComp ||
                      usage?.ok === false
                    }
                    style={{
                      ...smallButtonStyle,
                      background: busy || usage?.ok === false ? "#475569" : "#a855f7",
                      border: "1px solid rgba(168,85,247,0.7)",
                      color: "white",
                      cursor: busy ? "wait" : "pointer",
                    }}
                  >
                    {busy ? "Saving…" : "Save record"}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body,
        )}

      {newOpen &&
        medRuleInfoOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="med-employee-sample-rule-title"
            style={{ ...modalOverlayStyle, zIndex: 2147482650 }}
            onClick={(e) => {
              if (e.target === e.currentTarget) setMedRuleInfoOpen(false);
            }}
          >
            <div style={{ ...modalStyle, maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
              <h2
                id="med-employee-sample-rule-title"
                style={{ marginTop: 0, marginBottom: 0, fontSize: 18, fontWeight: 950, color: "#e2e8f0" }}
              >
                Colorado MED Employee Sample Rule
              </h2>
              <div style={{ color: "#cbd5e1", fontSize: 14, lineHeight: 1.65, marginTop: 14 }}>
                <p style={{ margin: "0 0 14px" }}>
                  Colorado MED employee samples / R-and-D units may only be transferred to a designated eligible
                  employee for quality control, product development, or R-and-D purposes.
                </p>
                <p style={{ margin: "0 0 14px" }}>
                  Before transfer, the business must verify the employee will not exceed the monthly limit.
                </p>
                <p style={{ margin: "0 0 6px", fontWeight: 800, color: "#e2e8f0" }}>Monthly limits:</p>
                <ul style={{ margin: "0 0 14px", paddingLeft: 22, color: "#cbd5e1" }}>
                  <li style={{ marginBottom: 6 }}>Medical marijuana concentrate: 15 grams per calendar month</li>
                  <li style={{ marginBottom: 6 }}>Retail marijuana concentrate: 8 grams per calendar month</li>
                  <li style={{ marginBottom: 6 }}>
                    Edible marijuana product: 14 individual serving-size units per calendar month
                  </li>
                  <li style={{ marginBottom: 6 }}>
                    Non-edible marijuana product: applicable equivalent limit
                  </li>
                </ul>
                <p style={{ margin: "0 0 6px", fontWeight: 800, color: "#e2e8f0" }}>Samples may not be:</p>
                <ul style={{ margin: "0 0 14px", paddingLeft: 22, color: "#cbd5e1" }}>
                  <li style={{ marginBottom: 6 }}>used as compensation</li>
                  <li style={{ marginBottom: 6 }}>consumed on licensed premises</li>
                  <li style={{ marginBottom: 6 }}>resold</li>
                  <li style={{ marginBottom: 6 }}>transferred to another person</li>
                  <li style={{ marginBottom: 6 }}>issued to a non-designated employee</li>
                </ul>
                <p style={{ margin: 0 }}>
                  Each transfer must be tracked with employee, date, product, quantity, source batch/package, and
                  monthly total.
                </p>
              </div>
              <p
                style={{
                  marginTop: 16,
                  marginBottom: 0,
                  fontSize: 12,
                  lineHeight: 1.55,
                  color: "#94a3b8",
                  borderTop: "1px solid rgba(148, 163, 184, 0.22)",
                  paddingTop: 14,
                }}
              >
                Based on Colorado HB25-1209 and 1 CCR 212-3 Rule 5-320 / related MED R-and-D unit rules. Confirm
                against current MED rules before production use.
              </p>
              <button
                type="button"
                onClick={() => setMedRuleInfoOpen(false)}
                style={{
                  ...smallButtonStyle,
                  marginTop: 16,
                  background: "#334155",
                  border: "1px solid #475569",
                  color: "#e2e8f0",
                }}
              >
                Close
              </button>
            </div>
          </div>,
          document.body,
        )}

      {searchOpen ? (
        <EmployeeSamplesSearchModal
          cid={cid}
          enabled={enabled}
          onClose={() => setSearchOpen(false)}
          onOpenDetail={(row) => setDetail(row)}
          labelStyle={labelStyle}
          inputStyle={inputStyle}
          smallButtonStyle={smallButtonStyle}
          modalOverlayStyle={modalOverlayStyle}
          modalStyle={modalStyle}
        />
      ) : null}

      {detail &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            style={{ ...modalOverlayStyle, zIndex: 2147482660 }}
            onClick={(e) => {
              if (e.target === e.currentTarget) setDetail(null);
            }}
          >
            <div style={{ ...modalStyle, maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
              <h2 style={{ marginTop: 0, fontSize: 20, fontWeight: 950 }}>Sample record</h2>
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  fontSize: 13,
                  color: "#cbd5e1",
                  background: "rgba(2,6,23,0.6)",
                  padding: 14,
                  borderRadius: 12,
                  border: "1px solid rgba(148,163,184,0.2)",
                }}
              >
                {JSON.stringify(detail, null, 2)}
              </pre>
              <button
                type="button"
                onClick={() => setDetail(null)}
                style={{ ...smallButtonStyle, background: "#334155", border: "1px solid #475569", color: "#e2e8f0" }}
              >
                Close
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function EmployeeSamplesSearchModal({
  cid,
  enabled,
  onClose,
  onOpenDetail,
  labelStyle,
  inputStyle,
  smallButtonStyle,
  modalOverlayStyle,
  modalStyle,
}: {
  cid: string;
  enabled: boolean;
  onClose: () => void;
  onOpenDetail: (row: SampleDetail) => void;
  labelStyle: CSSProperties;
  inputStyle: CSSProperties;
  smallButtonStyle: CSSProperties;
  modalOverlayStyle: CSSProperties;
  modalStyle: CSSProperties;
}) {
  const [pickUsers, setPickUsers] = useState<Array<{ id: string; label: string }>>([]);
  const [rows, setRows] = useState<SampleRow[]>([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const [sEmployee, setSEmployee] = useState("");
  const [sMonth, setSMonth] = useState("");
  const [sFrom, setSFrom] = useState("");
  const [sTo, setSTo] = useState("");
  const [sCat, setSCat] = useState("");
  const [sBatch, setSBatch] = useState("");
  const [sTag, setSTag] = useState("");

  const loadPickUsers = useCallback(async () => {
    if (!cid || !enabled) return;
    const raw = await apiRequest<{ users?: unknown[] } | unknown[]>(
      appendCompanyIdQuery("/api/admin/users", cid),
      { companyId: cid },
    );
    const arr = Array.isArray(raw) ? raw : raw.users ?? [];
    setPickUsers(
      (Array.isArray(arr) ? arr : []).map((u: unknown) => {
        const row = u as { id?: string; username?: string; email?: string };
        return {
          id: String(row.id || ""),
          label: String(row.username || row.email || row.id || "").trim() || String(row.id),
        };
      }),
    );
  }, [cid, enabled]);

  const runSearch = useCallback(async () => {
    if (!cid) return;
    setLoading(true);
    setErr("");
    try {
      const qs = new URLSearchParams();
      if (sEmployee) qs.set("employeeId", sEmployee);
      if (sMonth) qs.set("month", sMonth);
      if (sFrom) qs.set("dateFrom", sFrom);
      if (sTo) qs.set("dateTo", sTo);
      if (sCat) qs.set("productCategory", sCat);
      if (sBatch) qs.set("batchNumber", sBatch);
      if (sTag) qs.set("metrcTag", sTag);
      qs.set("take", "2000");
      const path = appendCompanyIdQuery(`/api/admin/employee-samples?${qs.toString()}`, cid);
      const raw = await apiRequest<{ samples: SampleRow[] }>(path, { companyId: cid });
      setRows(Array.isArray(raw.samples) ? raw.samples : []);
    } catch (e: unknown) {
      const m = e && typeof e === "object" && "message" in e ? String((e as { message?: string }).message) : "";
      setErr(m || "Search failed.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [cid, sEmployee, sMonth, sFrom, sTo, sCat, sBatch, sTag]);

  useEffect(() => {
    void loadPickUsers().catch(() => setPickUsers([]));
  }, [loadPickUsers]);

  useEffect(() => {
    void (async () => {
      if (!cid) return;
      setLoading(true);
      setErr("");
      try {
        const qs = new URLSearchParams();
        qs.set("take", "2000");
        const path = appendCompanyIdQuery(`/api/admin/employee-samples?${qs.toString()}`, cid);
        const raw = await apiRequest<{ samples: SampleRow[] }>(path, { companyId: cid });
        setRows(Array.isArray(raw.samples) ? raw.samples : []);
      } catch (e: unknown) {
        const m = e && typeof e === "object" && "message" in e ? String((e as { message?: string }).message) : "";
        setErr(m || "Search failed.");
        setRows([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [cid, enabled]);

  function exportCsv() {
    const header = [
      "transferDate",
      "employee",
      "product",
      "category",
      "quantity",
      "unit",
      "batch",
      "metrcTag",
      "purpose",
      "createdBy",
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(
        [
          csvEscape(String(r.transferDate || "")),
          csvEscape(String(r.employeeNameSnapshot || "")),
          csvEscape(String(r.productName || "")),
          csvEscape(String(r.productCategory || "")),
          csvEscape(String(r.quantity ?? "")),
          csvEscape(String(r.unit || "")),
          csvEscape(String(r.batchNumber || "")),
          csvEscape(String(r.metrcPackageTag || "")),
          csvEscape(String(r.purpose || "")),
          csvEscape(String(r.createdByEmail || "")),
        ].join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `employee-samples-${cid.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      style={{ ...modalOverlayStyle, zIndex: 2147482650 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={{ ...modalStyle, maxWidth: 1100 }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0, fontSize: 22, fontWeight: 950 }}>Search employee samples</h2>
        {err ? (
          <div style={{ color: "#fecaca", marginBottom: 10, fontSize: 14 }}>{err}</div>
        ) : null}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 10,
            marginBottom: 12,
          }}
        >
          <label style={labelStyle}>
            Employee
            <select value={sEmployee} onChange={(e) => setSEmployee(e.target.value)} style={inputStyle}>
              <option value="">All employees</option>
              {pickUsers.map((em) => (
                <option key={em.id} value={em.id}>
                  {em.label}
                </option>
              ))}
            </select>
          </label>
          <label style={labelStyle}>
            Month (YYYY-MM)
            <input value={sMonth} onChange={(e) => setSMonth(e.target.value)} placeholder="2026-01" style={inputStyle} />
          </label>
          <label style={labelStyle}>
            From
            <input type="date" value={sFrom} onChange={(e) => setSFrom(e.target.value)} style={inputStyle} />
          </label>
          <label style={labelStyle}>
            To
            <input type="date" value={sTo} onChange={(e) => setSTo(e.target.value)} style={inputStyle} />
          </label>
          <label style={labelStyle}>
            Category
            <select value={sCat} onChange={(e) => setSCat(e.target.value)} style={inputStyle}>
              <option value="">Any</option>
              <option value="FLOWER">Flower</option>
              <option value="CONCENTRATE">Concentrate</option>
              <option value="EDIBLE">Edible</option>
              <option value="NON_EDIBLE_PRODUCT">Non-edible</option>
            </select>
          </label>
          <label style={labelStyle}>
            Batch contains
            <input value={sBatch} onChange={(e) => setSBatch(e.target.value)} style={inputStyle} />
          </label>
          <label style={labelStyle}>
            METRC tag contains
            <input value={sTag} onChange={(e) => setSTag(e.target.value)} style={inputStyle} />
          </label>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <button
            type="button"
            onClick={() => void runSearch()}
            style={{
              ...smallButtonStyle,
              background: "rgba(56, 189, 248, 0.2)",
              border: "1px solid rgba(56, 189, 248, 0.45)",
              color: "#bae6fd",
              cursor: "pointer",
            }}
          >
            {loading ? "Searching…" : "Apply filters"}
          </button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={!rows.length}
            style={{
              ...smallButtonStyle,
              background: rows.length ? "rgba(34, 197, 94, 0.18)" : "#475569",
              border: "1px solid rgba(34, 197, 94, 0.45)",
              color: "#bbf7d0",
              cursor: rows.length ? "pointer" : "not-allowed",
            }}
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{ ...smallButtonStyle, background: "#334155", border: "1px solid #475569", color: "#e2e8f0" }}
          >
            Close
          </button>
        </div>
        <div style={{ overflowX: "auto", maxHeight: "52vh" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ color: "#94a3b8", textAlign: "left" }}>
                <th style={{ padding: 8 }}>Date</th>
                <th style={{ padding: 8 }}>Employee</th>
                <th style={{ padding: 8 }}>Product</th>
                <th style={{ padding: 8 }}>Category</th>
                <th style={{ padding: 8 }}>Qty</th>
                <th style={{ padding: 8 }}>Batch</th>
                <th style={{ padding: 8 }}>METRC</th>
                <th style={{ padding: 8 }}>Purpose</th>
                <th style={{ padding: 8 }}>Created by</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  onClick={async () => {
                    try {
                      const path = appendCompanyIdQuery(`/api/admin/employee-samples/${encodeURIComponent(r.id)}`, cid);
                      const d = await apiRequest<SampleDetail>(path, { companyId: cid });
                      onOpenDetail(d);
                    } catch {
                      /* ignore */
                    }
                  }}
                  style={{
                    borderTop: "1px solid rgba(51,65,85,0.6)",
                    cursor: "pointer",
                    color: "#e2e8f0",
                  }}
                >
                  <td style={{ padding: 8 }}>{String(r.transferDate || "").slice(0, 10)}</td>
                  <td style={{ padding: 8 }}>{r.employeeNameSnapshot}</td>
                  <td style={{ padding: 8 }}>{r.productName}</td>
                  <td style={{ padding: 8 }}>{r.productCategory}</td>
                  <td style={{ padding: 8 }}>
                    {r.quantity} {r.unit}
                  </td>
                  <td style={{ padding: 8 }}>{r.batchNumber}</td>
                  <td style={{ padding: 8 }}>{r.metrcPackageTag}</td>
                  <td style={{ padding: 8 }}>{r.purpose}</td>
                  <td style={{ padding: 8 }}>{r.createdByEmail || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && !loading ? (
            <div style={{ color: "#64748b", padding: 16 }}>No records match these filters.</div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
