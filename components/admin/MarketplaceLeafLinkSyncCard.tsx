"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { fetchCompanyWithServices, patchTenantLeafLinkInventorySync, type CompanyServicesDto } from "@/lib/api";

export function MarketplaceLeafLinkSyncCard() {
  const [services, setServices] = useState<CompanyServicesDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const out = await fetchCompanyWithServices();
      setServices((out.services as CompanyServicesDto) || null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not load company services.");
      setServices(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function setSyncEnabled(next: boolean) {
    if (!services?.salesSellerEnabled) return;
    setSaving(true);
    setError("");
    setOk("");
    try {
      const out = await patchTenantLeafLinkInventorySync(next);
      setServices(out.services);
      setOk(next ? "LeafLink inventory sync enabled." : "LeafLink inventory sync disabled.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not update sync setting.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div style={cardStyle}>
        <h3 style={h3}>Marketplace — LeafLink inventory sync</h3>
        <p style={{ color: "#93c5fd" }}>Loading…</p>
      </div>
    );
  }

  if (!services?.salesSellerEnabled) {
    return (
      <div style={cardStyle}>
        <h3 style={h3}>Marketplace — LeafLink inventory sync</h3>
        <p style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.55, margin: 0 }}>
          Turn on <b style={{ color: "#e2e8f0" }}>Sales Platform — Seller Side</b> for this workspace in the NexBatch
          portal (Workspace services) to import LeafLink inventory into marketplace products.
        </p>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <h3 style={h3}>Marketplace — LeafLink inventory sync</h3>
      <p style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.55, marginTop: 0 }}>
        When enabled, seller users can run <b style={{ color: "#e2e8f0" }}>Sync LeafLink inventory</b> on the Seller
        Platform. This uses the same LeafLink credentials as inventory above and does not change LeafLink orders sync.
      </p>
      {error ? <div style={errorStyle}>{error}</div> : null}
      {ok ? <div style={okStyle}>{ok}</div> : null}
      <label style={checkboxLabelStyle}>
        <input
          type="checkbox"
          checked={Boolean(services.leafLinkInventorySyncEnabled)}
          disabled={saving}
          onChange={(e) => void setSyncEnabled(e.target.checked)}
        />
        LeafLink Inventory Sync
      </label>
      <p style={{ color: "#64748b", fontSize: 12, margin: "8px 0 0" }}>
        Uses existing LeafLink config. New synced lines default to Internal until you mark them Available for buyers.
      </p>
    </div>
  );
}

const h3: CSSProperties = { marginTop: 0, marginBottom: 8, color: "#e2e8f0" };
const cardStyle: CSSProperties = {
  border: "1px solid #334155",
  borderRadius: 14,
  padding: 16,
  background: "#020617",
  marginTop: 14,
};
const checkboxLabelStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  color: "#e2e8f0",
  fontWeight: 600,
  marginTop: 8,
};
const errorStyle: CSSProperties = {
  marginBottom: 10,
  padding: 10,
  borderRadius: 10,
  background: "rgba(127,29,29,0.45)",
  border: "1px solid rgba(248,113,113,0.4)",
  color: "#fecaca",
};
const okStyle: CSSProperties = {
  marginBottom: 10,
  padding: 10,
  borderRadius: 10,
  background: "rgba(20,83,45,0.45)",
  border: "1px solid rgba(34,197,94,0.4)",
  color: "#bbf7d0",
};
