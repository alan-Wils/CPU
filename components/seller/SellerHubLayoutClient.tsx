"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import PageAccessGate from "@/components/PageAccessGate";
import BrandLogo from "@/components/BrandLogo";
import {
  fetchCompanyWithServices,
  messagingGetUnreadTotal,
  salesSellerOrders,
  type CompanyServicesDto,
} from "@/lib/api";
import { getAuthUser, isLoggedIn } from "@/lib/auth";
const shellBg =
  "linear-gradient(145deg, rgba(15,23,42,0.98), rgba(2,6,23,1))";

type NavItem = { href: string; label: string; badge?: number; external?: boolean };

function navSections(pendingOrders: number): Array<{ title: string; items: NavItem[] }> {
  return [
    {
      title: "MAIN",
      items: [
        { href: "/seller/dashboard", label: "Dashboard" },
        { href: "/seller/orders", label: "Orders", badge: pendingOrders > 0 ? pendingOrders : undefined },
        { href: "/sales/seller", label: "Products" },
        { href: "/seller/inventory", label: "Inventory" },
        { href: "/seller/transactions", label: "Transactions" },
        { href: "/seller/customers", label: "Customers" },
        { href: "/seller/crm", label: "CRM" },
      ],
    },
    {
      title: "ANALYTICS",
      items: [
        { href: "/seller/total-sales", label: "Total Sales" },
        { href: "/seller/reports", label: "Reports" },
        { href: "/seller/analytics", label: "Analytics" },
      ],
    },
    {
      title: "MARKETING",
      items: [
        { href: "/seller/campaigns", label: "Campaigns" },
        { href: "/seller/promotions", label: "Promotions" },
        { href: "/seller/announcements", label: "Announcements" },
      ],
    },
    {
      title: "OPERATIONS",
      items: [
        { href: "/seller/batch-management", label: "Batch Management" },
        { href: "/seller/cultivation", label: "Cultivation" },
        { href: "/seller/production", label: "Production" },
        { href: "/seller/packaging", label: "Packaging" },
        { href: "/seller/quality-control", label: "Quality Control" },
        { href: "/seller/lab-results", label: "Lab Results" },
      ],
    },
    {
      title: "SETTINGS",
      items: [
        { href: "/seller/company-profile", label: "Company Profile" },
        { href: "/seller/team", label: "Team" },
        { href: "/seller/integrations", label: "Integrations" },
        { href: "/seller/settings", label: "Settings" },
      ],
    },
  ];
}

function muted(minPx = 768): CSSProperties {
  return {
    color: "#94a3b8",
    fontSize: minPx <= 640 ? 11 : 12,
    fontWeight: 700,
    letterSpacing: "0.08em",
    margin: "18px 0 10px",
    textTransform: "uppercase",
  };
}

export default function SellerHubLayoutClient({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [services, setServices] = useState<CompanyServicesDto | null>(null);
  const [servicesErr, setServicesErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingOrders, setPendingOrders] = useState(0);
  const [msgUnread, setMsgUnread] = useState(0);
  const [companyName, setCompanyName] = useState("");
  const [companyInitials, setCompanyInitials] = useState("NB");
  const [headerSearch, setHeaderSearch] = useState("");

  const loadShell = useCallback(async () => {
    setServicesErr("");
    try {
      const out = await fetchCompanyWithServices();
      const s = (out.services as CompanyServicesDto) || null;
      setServices(s);
      const c = out.company as { name?: string } | null;
      const nm = typeof c?.name === "string" ? c.name : "";
      setCompanyName(nm);
      setCompanyInitials(
        nm
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((x) => x[0])
          .join("")
          .toUpperCase() || "NB",
      );
      if (s?.salesSellerEnabled && isLoggedIn()) {
        try {
          const [ordRes, msgRes] = await Promise.all([
            salesSellerOrders("PENDING"),
            messagingGetUnreadTotal(),
          ]);
          const orders = (ordRes.orders || []) as unknown[];
          setPendingOrders(orders.length);
          setMsgUnread(typeof msgRes.unread === "number" ? msgRes.unread : 0);
        } catch {
          setPendingOrders(0);
          setMsgUnread(0);
        }
      }
    } catch (e: unknown) {
      setServicesErr(e instanceof Error ? e.message : "Could not load workspace.");
      setServices(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadShell();
  }, [loadShell]);

  const sections = useMemo(() => navSections(pendingOrders), [pendingOrders]);

  const isActive = (href: string) => {
    if (href === "/seller/dashboard") return pathname === "/seller" || pathname === "/seller/dashboard";
    if (href === "/sales/seller") return pathname?.startsWith("/sales/seller") ?? false;
    return pathname === href || pathname?.startsWith(`${href}/`);
  };

  const user = getAuthUser();
  const emailShort = user?.email ? user.email.split("@")[0] : "";

  if (loading && !services) {
    return (
      <main style={{ padding: 48, color: "#93c5fd", textAlign: "center", background: "#020617", minHeight: "100vh" }}>
        Loading Seller Platform…
      </main>
    );
  }

  if (servicesErr && !services) {
    return (
      <main style={{ padding: 32, maxWidth: 560, margin: "0 auto", color: "#fecaca", background: "#020617", minHeight: "100vh" }}>
        <h1 style={{ color: "#e2e8f0" }}>Seller Platform</h1>
        <p>{servicesErr}</p>
        <Link href="/" style={{ color: "#a78bfa" }}>
          Back to home
        </Link>
      </main>
    );
  }

  if (services && !services.salesSellerEnabled) {
    return (
      <main
        style={{
          minHeight: "70vh",
          padding: 32,
          maxWidth: 640,
          margin: "0 auto",
          color: "#e2e8f0",
          background: "#020617",
        }}
      >
        <h1 style={{ fontSize: 28, fontWeight: 900 }}>Seller Platform</h1>
        <p style={{ color: "#94a3b8", lineHeight: 1.6 }}>
          Seller Side is not enabled for this workspace. A NexBatch platform admin can turn it on from the portal under
          Workspace services.
        </p>
        <Link href="/" style={{ color: "#a78bfa", fontWeight: 700 }}>
          Back to home
        </Link>
      </main>
    );
  }

  return (
    <PageAccessGate permission="page.sales-seller">
      <div style={{ display: "flex", minHeight: "100vh", background: shellBg, color: "#e2e8f0" }}>
        {/* Mobile drawer backdrop */}
        {sidebarOpen ? (
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setSidebarOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 40,
              border: "none",
              margin: 0,
              padding: 0,
              background: "rgba(2,6,23,0.72)",
              cursor: "pointer",
            }}
          />
        ) : null}

        {/* Sidebar */}
        <aside
          className={
            sidebarOpen ? "seller-shell-aside seller-shell-aside--open" : "seller-shell-aside"
          }
          style={{
            flexShrink: 0,
            borderRight: "1px solid rgba(51,65,85,0.65)",
            background: "rgba(15,23,42,0.92)",
            padding: "20px 16px 28px",
            flexDirection: "column",
            gap: 8,
            overflowY: "auto",
          }}
        >

          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
            <BrandLogo linkToHome={false} height={36} />
            <span style={{ fontWeight: 900, fontSize: 18, color: "#f8fafc", letterSpacing: "-0.02em" }}>NexBatch</span>
          </Link>

          <div
            style={{
              marginTop: 18,
              padding: 14,
              borderRadius: 16,
              border: "1px solid rgba(99,102,241,0.35)",
              background: "linear-gradient(135deg, rgba(49,46,129,0.45), rgba(15,23,42,0.95))",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  background: "linear-gradient(135deg, #a855f7, #6366f1)",
                  display: "grid",
                  placeItems: "center",
                  fontWeight: 900,
                  fontSize: 15,
                  color: "#fff",
                }}
              >
                {companyInitials}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 15, color: "#f8fafc", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {companyName || "Your company"}
                </div>
                <div style={{ fontSize: 12, color: "#94a3b8" }}>Seller workspace</div>
                <div
                  style={{
                    marginTop: 6,
                    display: "inline-block",
                    fontSize: 11,
                    fontWeight: 800,
                    padding: "3px 8px",
                    borderRadius: 999,
                    background: "rgba(129,140,248,0.25)",
                    color: "#c4b5fd",
                    border: "1px solid rgba(139,92,246,0.45)",
                  }}
                >
                  Verified Seller
                </div>
              </div>
            </div>
          </div>

          <nav style={{ flex: 1, marginTop: 8 }}>
            {sections.map((sec) => (
              <div key={sec.title}>
                <div style={muted()}>{sec.title}</div>
                {sec.items.map((item) => {
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setSidebarOpen(false)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                        padding: "10px 12px",
                        marginBottom: 4,
                        borderRadius: 12,
                        textDecoration: "none",
                        color: active ? "#fff" : "#cbd5e1",
                        fontWeight: active ? 800 : 600,
                        fontSize: 14,
                        background: active ? "linear-gradient(90deg, rgba(109,40,217,0.55), rgba(30,27,75,0.4))" : "transparent",
                        border: active ? "1px solid rgba(167,139,250,0.45)" : "1px solid transparent",
                      }}
                    >
                      <span>{item.label}</span>
                      {item.badge ? (
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 900,
                            padding: "2px 7px",
                            borderRadius: 999,
                            background: "rgba(139,92,246,0.5)",
                            color: "#f5f3ff",
                          }}
                        >
                          {item.badge > 99 ? "99+" : item.badge}
                        </span>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>

          <div
            style={{
              marginTop: 12,
              padding: 14,
              borderRadius: 16,
              border: "1px solid rgba(56,189,248,0.35)",
              background: "rgba(8,47,73,0.55)",
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 15, color: "#f8fafc" }}>Need Help?</div>
            <p style={{ margin: "8px 0 12px", fontSize: 13, color: "#94a3b8", lineHeight: 1.45 }}>
              Visit our help center or contact support.
            </p>
            <Link
              href="/"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 14px",
                borderRadius: 12,
                background: "linear-gradient(135deg, rgba(34,211,238,0.35), rgba(59,130,246,0.25))",
                border: "1px solid rgba(34,211,238,0.45)",
                color: "#67e8f9",
                fontWeight: 800,
                fontSize: 13,
                textDecoration: "none",
              }}
            >
              Help Center →
            </Link>
          </div>

          <Link href="/" style={{ marginTop: 14, fontSize: 13, color: "#64748b", textDecoration: "none", fontWeight: 600 }}>
            ← Back to NexBatch home
          </Link>
        </aside>

        {/* Main column */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <header
            style={{
              position: "sticky",
              top: 0,
              zIndex: 30,
              borderBottom: "1px solid rgba(51,65,85,0.55)",
              background: "rgba(2,6,23,0.88)",
              backdropFilter: "blur(12px)",
              padding: "12px 18px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <button
                type="button"
                aria-label="Open menu"
                onClick={() => setSidebarOpen(true)}
                style={{
                  display: "inline-flex",
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(148,163,184,0.35)",
                  background: "rgba(15,23,42,0.9)",
                  color: "#e2e8f0",
                  cursor: "pointer",
                  fontWeight: 800,
                }}
                className="seller-shell-hamburger"
              >
                ☰
              </button>

              <div style={{ flex: 1, minWidth: 200 }}>
                <label style={{ display: "block", width: "100%" }}>
                  <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden" }}>Search</span>
                  <input
                    value={headerSearch}
                    onChange={(e) => setHeaderSearch(e.target.value)}
                    placeholder="Search anything…"
                    style={{
                      width: "100%",
                      padding: "12px 16px 12px 44px",
                      borderRadius: 14,
                      border: "1px solid rgba(51,65,85,0.65)",
                      background: "rgba(15,23,42,0.85)",
                      color: "#f8fafc",
                      fontSize: 14,
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                </label>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <Link
                  href="/"
                  title="Notifications"
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 12,
                    border: "1px solid rgba(148,163,184,0.35)",
                    display: "grid",
                    placeItems: "center",
                    textDecoration: "none",
                    position: "relative",
                    color: "#e2e8f0",
                    background: "rgba(15,23,42,0.75)",
                  }}
                >
                  🔔
                  <span
                    style={{
                      position: "absolute",
                      top: 8,
                      right: 8,
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: "#ef4444",
                    }}
                  />
                </Link>
                <Link
                  href="/messages"
                  title={msgUnread > 0 ? `Messages (${msgUnread} unread)` : "Messages"}
                  aria-label={msgUnread > 0 ? `Messages, ${msgUnread} unread` : "Messages"}
                  className={msgUnread > 0 ? "messages-icon--pulse" : undefined}
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 12,
                    border: msgUnread > 0
                      ? "1px solid rgba(34, 197, 94, 0.55)"
                      : "1px solid rgba(148,163,184,0.35)",
                    display: "grid",
                    placeItems: "center",
                    textDecoration: "none",
                    position: "relative",
                    color: msgUnread > 0 ? "#bbf7d0" : "#e2e8f0",
                    background: msgUnread > 0
                      ? "linear-gradient(145deg, rgba(6, 78, 59, 0.55), rgba(15, 23, 42, 0.95))"
                      : "rgba(15,23,42,0.75)",
                  }}
                >
                  ✉
                  {msgUnread > 0 ? (
                    <span
                      style={{
                        position: "absolute",
                        top: -4,
                        right: -4,
                        fontSize: 11,
                        fontWeight: 900,
                        padding: "2px 6px",
                        borderRadius: 999,
                        background: "#22c55e",
                        color: "#022c22",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
                      }}
                    >
                      {msgUnread > 99 ? "99+" : msgUnread}
                    </span>
                  ) : null}
                </Link>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 12px",
                    borderRadius: 14,
                    border: "1px solid rgba(99,102,241,0.35)",
                    background: "rgba(30,27,75,0.35)",
                  }}
                >
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: "50%",
                      background: "linear-gradient(135deg,#a855f7,#6366f1)",
                      display: "grid",
                      placeItems: "center",
                      fontWeight: 900,
                      fontSize: 14,
                      color: "#fff",
                    }}
                  >
                    {companyInitials}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 14, color: "#f8fafc", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 160 }}>
                      {companyName || "Seller"}
                    </div>
                    <div style={{ fontSize: 12, color: "#94a3b8" }}>{emailShort ? `${emailShort} · ` : ""}Seller Account</div>
                  </div>
                  <span style={{ color: "#64748b", fontSize: 12 }}>▾</span>
                </div>
              </div>
            </div>
          </header>

          <main style={{ flex: 1, padding: "20px 18px 48px", maxWidth: 1480, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
            {children}
          </main>

          <footer
            style={{
              borderTop: "1px solid rgba(51,65,85,0.45)",
              padding: "18px 22px",
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              justifyContent: "space-between",
              color: "#64748b",
              fontSize: 13,
              background: "rgba(2,6,23,0.95)",
            }}
          >
            <span>NexBatch Seller Platform · © {new Date().getFullYear()} NexBatch. All rights reserved.</span>
            <span style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <Link href="/" style={{ color: "#64748b", textDecoration: "none" }}>
                Privacy Policy
              </Link>
              <Link href="/" style={{ color: "#64748b", textDecoration: "none" }}>
                Terms of Service
              </Link>
              <Link href="/" style={{ color: "#64748b", textDecoration: "none" }}>
                Help Center
              </Link>
            </span>
          </footer>
        </div>
      </div>
    </PageAccessGate>
  );
}
