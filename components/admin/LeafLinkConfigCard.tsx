"use client";

import { useEffect, useState } from "react";
import { fetchLeafLinkConfig, saveLeafLinkConfig } from "@/lib/api";
import {
  defaultLeafLinkCompanyConfig,
  type LeafLinkCompanyConfig,
} from "@/lib/leaflinkCompanyConfig";

export function LeafLinkConfigCard() {
  const [cfg, setCfg] = useState<LeafLinkCompanyConfig>(defaultLeafLinkCompanyConfig);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const out = await fetchLeafLinkConfig();
        if (cancelled) return;
        setCfg({
          integrationEnabled: Boolean(out.integrationEnabled),
          companySlug: String(out.companySlug || ""),
          companyId: String(out.companyId || ""),
          username: String(out.username || ""),
          baseUrl: String(out.baseUrl || defaultLeafLinkCompanyConfig.baseUrl),
          apiKey: "",
          recordedByStaffId:
            typeof out.recordedByStaffId === "number" && Number.isFinite(out.recordedByStaffId)
              ? out.recordedByStaffId
              : null,
        });
        setHasApiKey(Boolean(out.hasApiKey));
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load LeafLink settings.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSave() {
    setSaving(true);
    setError("");
    setOk("");
    try {
      const out = await saveLeafLinkConfig({
        integrationEnabled: cfg.integrationEnabled,
        companySlug: cfg.companySlug,
        companyId: cfg.companyId,
        username: cfg.username,
        baseUrl: cfg.baseUrl || defaultLeafLinkCompanyConfig.baseUrl,
        apiKey: cfg.apiKey?.trim() || undefined,
        recordedByStaffId: cfg.recordedByStaffId,
      });
      setCfg((prev) => ({ ...prev, apiKey: "" }));
      setHasApiKey(Boolean(out.hasApiKey || cfg.apiKey));
      setOk("LeafLink settings saved.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not save LeafLink settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={cardStyle}>
      <h3 style={{ marginTop: 0, marginBottom: 8, color: "#e2e8f0" }}>LeafLink Inventory</h3>
      <p style={{ color: "#94a3b8", fontSize: 13, marginTop: 0, lineHeight: 1.55 }}>
        Company-scoped LeafLink credentials are saved server-side. The API key is write-only in this UI and never
        returned to the browser. Check/cash “mark paid” uses LeafLink{" "}
        <code style={{ color: "#bae6fd" }}>POST /v2/order-payments/</code> — set a payment recorder staff id if
        auto-detect from <code style={{ color: "#bae6fd" }}>company-staff</code> is not available for your token.
      </p>

      {loading ? <p style={{ color: "#93c5fd", fontWeight: 700 }}>Loading LeafLink settings...</p> : null}
      {error ? <div style={errorStyle}>{error}</div> : null}
      {ok ? <div style={okStyle}>{ok}</div> : null}

      <label style={checkboxLabelStyle}>
        <input
          type="checkbox"
          checked={cfg.integrationEnabled}
          onChange={(e) => setCfg((prev) => ({ ...prev, integrationEnabled: e.target.checked }))}
        />
        Enable LeafLink Sync
      </label>

      <div style={gridStyle}>
        <label style={labelStyle}>
          Company Slug
          <input
            style={inputStyle}
            value={cfg.companySlug}
            onChange={(e) => setCfg((prev) => ({ ...prev, companySlug: e.target.value }))}
            placeholder="sun-truth-llc"
          />
        </label>
        <label style={labelStyle}>
          Company ID
          <input
            style={inputStyle}
            value={cfg.companyId}
            onChange={(e) => setCfg((prev) => ({ ...prev, companyId: e.target.value }))}
            placeholder="17763"
          />
        </label>
        <label style={labelStyle}>
          Username
          <input
            style={inputStyle}
            value={cfg.username}
            onChange={(e) => setCfg((prev) => ({ ...prev, username: e.target.value }))}
            placeholder="alan.w@budfoxsupply.com"
          />
        </label>
        <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>
          Base URL
          <input
            style={inputStyle}
            value={cfg.baseUrl}
            onChange={(e) => setCfg((prev) => ({ ...prev, baseUrl: e.target.value }))}
            placeholder="https://app.leaflink.com/api"
          />
        </label>
        <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>
          Payment recorder (LeafLink staff id)
          <input
            style={inputStyle}
            type="number"
            min={1}
            step={1}
            value={cfg.recordedByStaffId ?? ""}
            onChange={(e) => {
              const v = e.target.value.trim();
              if (!v) {
                setCfg((prev) => ({ ...prev, recordedByStaffId: null }));
                return;
              }
              const n = Number.parseInt(v, 10);
              setCfg((prev) => ({
                ...prev,
                recordedByStaffId: Number.isFinite(n) && n > 0 ? n : null,
              }));
            }}
            placeholder="Leave blank to auto-pick an active admin from company-staff"
          />
        </label>
      </div>

      <label style={{ ...checkboxLabelStyle, marginTop: 6 }}>
        <input type="checkbox" checked={showApiKey} onChange={(e) => setShowApiKey(e.target.checked)} />
        Show API Key field text
      </label>

      <label style={labelStyle}>
        API Key {hasApiKey ? <span style={{ color: "#86efac" }}>(currently configured)</span> : null}
        <input
          style={inputStyle}
          type={showApiKey ? "text" : "password"}
          value={cfg.apiKey || ""}
          onChange={(e) => setCfg((prev) => ({ ...prev, apiKey: e.target.value }))}
          placeholder={hasApiKey ? "Leave blank to keep existing key" : "Paste generated API key"}
          autoComplete="off"
        />
      </label>

      <button style={saveButtonStyle} onClick={() => void onSave()} disabled={saving || loading}>
        {saving ? "Saving..." : "Save LeafLink Settings"}
      </button>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  border: "1px solid #334155",
  borderRadius: 14,
  padding: 16,
  background: "#020617",
  marginTop: 14,
};
const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(220px, 1fr))",
  gap: 10,
};
const labelStyle: React.CSSProperties = {
  display: "block",
  color: "#cbd5e1",
  fontWeight: 700,
  fontSize: 13,
  marginBottom: 8,
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  marginTop: 6,
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #334155",
  background: "#0f172a",
  color: "white",
  boxSizing: "border-box",
};
const checkboxLabelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  color: "#e2e8f0",
  fontWeight: 600,
  marginBottom: 10,
};
const saveButtonStyle: React.CSSProperties = {
  marginTop: 6,
  border: "1px solid rgba(56,189,248,0.45)",
  borderRadius: 10,
  padding: "10px 14px",
  background: "rgba(8,47,73,0.7)",
  color: "#bae6fd",
  fontWeight: 800,
  cursor: "pointer",
};
const errorStyle: React.CSSProperties = {
  marginBottom: 10,
  padding: 10,
  borderRadius: 10,
  background: "rgba(127,29,29,0.45)",
  border: "1px solid rgba(248,113,113,0.4)",
  color: "#fecaca",
};
const okStyle: React.CSSProperties = {
  marginBottom: 10,
  padding: 10,
  borderRadius: 10,
  background: "rgba(20,83,45,0.45)",
  border: "1px solid rgba(34,197,94,0.4)",
  color: "#bbf7d0",
};

