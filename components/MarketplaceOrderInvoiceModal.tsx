"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { salesBuyerOrderInvoice, salesSellerOrderInvoice } from "@/lib/api";
import type { MarketplaceOrderInvoiceDto } from "@/lib/marketplaceOrderInvoice";
import {
  buildMarketplaceOrderInvoiceHtml,
  downloadMarketplaceOrderInvoiceHtml,
  printMarketplaceOrderInvoice,
} from "@/lib/marketplaceOrderInvoice";

type Role = "buyer" | "seller";

export type MarketplaceOrderInvoiceModalProps = {
  open: boolean;
  onClose: () => void;
  orderId: string | null;
  role: Role;
};

export default function MarketplaceOrderInvoiceModal({
  open,
  onClose,
  orderId,
  role,
}: MarketplaceOrderInvoiceModalProps) {
  const [data, setData] = useState<MarketplaceOrderInvoiceDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (!orderId) return;
    setErr("");
    setLoading(true);
    setData(null);
    try {
      const out = role === "buyer" ? await salesBuyerOrderInvoice(orderId) : await salesSellerOrderInvoice(orderId);
      setData(out);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Could not load invoice.");
    } finally {
      setLoading(false);
    }
  }, [orderId, role]);

  useEffect(() => {
    if (!open || !orderId) {
      setData(null);
      setErr("");
      return;
    }
    void load();
  }, [open, orderId, load]);

  if (!open) return null;

  return (
    <div
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1200,
        background: "rgba(2,6,23,0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="nb-invoice-title"
        style={{
          width: "100%",
          maxWidth: 720,
          maxHeight: "90vh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          borderRadius: 16,
          border: "1px solid rgba(34,211,238,0.35)",
          background: "rgba(15,23,42,0.98)",
          color: "#e2e8f0",
          boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "16px 18px",
            borderBottom: "1px solid rgba(51,65,85,0.65)",
          }}
        >
          <h2 id="nb-invoice-title" style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>
            Order invoice
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              borderRadius: 10,
              border: "1px solid rgba(148,163,184,0.4)",
              background: "rgba(2,6,23,0.6)",
              color: "#e2e8f0",
              fontWeight: 700,
              padding: "8px 12px",
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>

        <div style={{ padding: "14px 18px", overflowY: "auto", flex: 1 }}>
          {loading ? (
            <p style={{ margin: 0, color: "#22d3ee" }}>Loading invoice…</p>
          ) : err ? (
            <p style={{ margin: 0, color: "#fecaca", fontWeight: 600 }}>{err}</p>
          ) : data ? (
            <>
              <p style={{ margin: "0 0 12px", fontSize: 13, color: "#94a3b8", lineHeight: 1.5 }}>
                Invoice <strong style={{ color: "#f0f9ff" }}>{data.invoiceLabel}</strong> — {data.seller.name} →{" "}
                {data.buyer.name}. Print opens your browser print dialog (save as PDF). Export downloads a standalone HTML
                file you can archive or open later.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
                <button
                  type="button"
                  onClick={() => printMarketplaceOrderInvoice(data)}
                  style={btnPrimary}
                >
                  Print / PDF
                </button>
                <button
                  type="button"
                  onClick={() => downloadMarketplaceOrderInvoiceHtml(data)}
                  style={btnSecondary}
                >
                  Export HTML
                </button>
              </div>
              <iframe
                title="Invoice preview"
                style={{
                  width: "100%",
                  minHeight: 360,
                  borderRadius: 12,
                  border: "1px solid rgba(51,65,85,0.65)",
                  background: "#fff",
                }}
                srcDoc={buildMarketplaceOrderInvoiceHtml(data)}
                sandbox="allow-modals allow-same-origin"
              />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const btnPrimary: CSSProperties = {
  padding: "10px 16px",
  borderRadius: 12,
  border: "1px solid rgba(34,211,238,0.55)",
  background: "rgba(8,47,73,0.75)",
  color: "#e0f2fe",
  fontWeight: 800,
  cursor: "pointer",
  fontSize: 14,
};

const btnSecondary: CSSProperties = {
  padding: "10px 16px",
  borderRadius: 12,
  border: "1px solid rgba(148,163,184,0.45)",
  background: "rgba(15,23,42,0.85)",
  color: "#e2e8f0",
  fontWeight: 700,
  cursor: "pointer",
  fontSize: 14,
};
