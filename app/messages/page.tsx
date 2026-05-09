"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import BrandLogo from "@/components/BrandLogo";
import DocumentFullscreenButton from "@/components/DocumentFullscreenButton";
import MarketplaceBuyerBottomNav from "@/components/MarketplaceBuyerBottomNav";
import MessagingPanel from "@/components/messaging/MessagingPanel";
import { fetchCompanyWithServices, type CompanyServicesDto } from "@/lib/api";
import { isLoggedIn, isPortalSession } from "@/lib/auth";

/**
 * Unified NexBatch Messages route. Same page works for buyers and sellers; the bottom-nav only renders for the buyer
 * marketplace persona (matches the buyer mobile flow shown in the design references). Sellers reach it from the seller
 * hub header mail icon and stay inside the seller hub layout via the back link.
 */
export default function MessagesPage() {
  const [services, setServices] = useState<CompanyServicesDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [variant, setVariant] = useState<"desktop" | "mobile">("desktop");

  useEffect(() => {
    setAuthLoaded(true);
    const onResize = () => setVariant(window.innerWidth <= 720 ? "mobile" : "desktop");
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!isLoggedIn()) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const out = await fetchCompanyWithServices();
        if (cancelled) return;
        setServices((out.services as CompanyServicesDto) || null);
      } catch {
        if (!cancelled) setServices(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const profileHref = isPortalSession() ? "/portal" : "/";
  const isBuyerSurface = !!services?.salesBuyerEnabled;

  if (!authLoaded) return null;

  if (!isLoggedIn()) {
    return (
      <main style={{ padding: 32, color: "#e2e8f0", minHeight: "100vh", background: "#020617" }}>
        <Link href="/login" style={{ color: "#22d3ee" }}>
          Sign in
        </Link>{" "}
        to access NexBatch messages.
      </main>
    );
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "radial-gradient(circle at top, #1e293b 0, #020617 45%, #000 100%)",
        color: "#e2e8f0",
        padding: "16px 16px 110px",
        boxSizing: "border-box",
      }}
    >
      <header
        style={{
          maxWidth: 1240,
          margin: "0 auto 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <BrandLogo linkToHome={false} height={36} maxWidth={140} />
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>Messages</h1>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "#64748b" }}>
              Chat with companies on NexBatch — sellers, buyers, and support.
            </p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {isBuyerSurface ? (
            <DocumentFullscreenButton
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                border: "1px solid rgba(148, 163, 184, 0.25)",
                background: "rgba(15, 23, 42, 0.6)",
                color: "#e2e8f0",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            />
          ) : null}
          {isBuyerSurface ? (
            <Link
              href="/sales/marketplace"
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid rgba(34, 211, 238, 0.45)",
                color: "#7dd3fc",
                fontWeight: 800,
                fontSize: 13,
                textDecoration: "none",
              }}
            >
              ← Marketplace
            </Link>
          ) : null}
          <Link
            href="/seller/dashboard"
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid rgba(167, 139, 250, 0.45)",
              color: "#c4b5fd",
              fontWeight: 800,
              fontSize: 13,
              textDecoration: "none",
            }}
          >
            Seller hub
          </Link>
        </div>
      </header>

      <section
        style={{
          maxWidth: 1240,
          margin: "0 auto",
        }}
      >
        {loading ? (
          <div style={{ padding: 36, textAlign: "center", color: "#22d3ee" }}>Loading workspace…</div>
        ) : (
          <MessagingPanel variant={variant} maxHeight="min(78vh, 760px)" />
        )}
      </section>

      {isBuyerSurface ? (
        <MarketplaceBuyerBottomNav active="messages" profileHref={profileHref} />
      ) : null}
    </main>
  );
}
