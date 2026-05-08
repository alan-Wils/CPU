"use client";

import {
  defaultPagePermissionsForRole,
  hasAppPermission,
  isElevatedManagerRole,
  isOwnerOrAdminRole,
} from "@cpu/shared";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  apiRequest,
  API_BASE_URL,
  clearSelectedCompanyId,
  fetchCompanyWithServices,
  getMe,
  getSelectedCompanyId,
  selectPortalCompany,
  setSelectedCompanyId,
  type CompanyServicesDto,
} from "@/lib/api";
import TopBrandStrip from "@/components/TopBrandStrip";
import { extractCompanyInventoryLogoUrl } from "@/lib/companyConfigLogo";
import { extractRewardsFromCompanyConfig } from "@/lib/rewardsConfig";
import {
  clearAuthSession,
  getAuthCompany,
  getAuthUser,
  getPortalCompanies,
  isLoggedIn,
  isPortalSession,
  mergeAuthSessionToken,
  saveAuthSession,
  type CpuCompany,
  type CpuUser,
} from "@/lib/auth";

function canNavToPage(permission: string): boolean {
  if (!isLoggedIn())
    return true;
  const u = getAuthUser();
  const role = String(u?.role || "").toUpperCase();
  if (isOwnerOrAdminRole(role))
    return true;
  const perms = Array.isArray(u?.permissions)
    ? u.permissions
    : defaultPagePermissionsForRole(role);
  return hasAppPermission(perms, permission);
}

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const user = getAuthUser();
  const company = getAuthCompany();
  const [portalCompanies, setPortalCompaniesState] = useState<CpuCompany[]>([]);
  const [rewardsProgramEnabled, setRewardsProgramEnabled] = useState(false);
  const [companyHeaderLogoUrl, setCompanyHeaderLogoUrl] = useState("");
  /** Bumps after `/auth/me` merges so `getAuthUser()` (e.g. rewards enrollment) re-reads. */
  const [sessionBump, setSessionBump] = useState(0);
  const [companyServices, setCompanyServices] = useState<CompanyServicesDto | null>(null);

  useEffect(() => {
    setPortalCompaniesState(getPortalCompanies());
  }, [pathname]);

  const authCompanyId = company?.id ?? "";
  useEffect(() => {
    if (!isLoggedIn()) {
      setCompanyHeaderLogoUrl("");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await apiRequest<unknown>("/api/config", {
          companyId: getSelectedCompanyId().trim() || undefined,
        });
        if (cancelled) return;
        setRewardsProgramEnabled(extractRewardsFromCompanyConfig(data).enabled);
        setCompanyHeaderLogoUrl(extractCompanyInventoryLogoUrl(data));
      } catch {
        if (!cancelled) {
          setRewardsProgramEnabled(false);
          setCompanyHeaderLogoUrl("");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname, authCompanyId]);

  useEffect(() => {
    if (!isLoggedIn())
      return;
    let cancelled = false;
    (async () => {
      try {
        const me = await getMe();
        if (cancelled || !me || typeof me !== "object")
          return;
        const raw = me as { token?: string; user?: CpuUser };
        if (raw.token)
          mergeAuthSessionToken(raw.token, raw.user);
        setSessionBump((n) => n + 1);
      }
      catch {
        /* offline / stale */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isLoggedIn() || !company?.id) {
      setCompanyServices(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const out = await fetchCompanyWithServices();
        if (cancelled) return;
        setCompanyServices(
          out.services && typeof out.services === "object"
            ? (out.services as CompanyServicesDto)
            : null,
        );
      } catch {
        if (!cancelled) setCompanyServices(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname, authCompanyId, company?.id, sessionBump]);

  useEffect(() => {
    if (!isLoggedIn()) return;
    if (
      isPortalSession() &&
      !getAuthCompany()?.id &&
      pathname !== "/login" &&
      pathname !== "/portal" &&
      !pathname?.startsWith("/accept-invite")
    ) {
      router.replace("/portal");
    }
  }, [pathname, router]);

  function logout() {
    clearAuthSession();
    clearSelectedCompanyId();
    router.push("/login");
  }

  const isHomePage = pathname === "/";

  const staffRewardsQuickLink = useMemo(() => {
    return (
      isLoggedIn() &&
      rewardsProgramEnabled &&
      Boolean(getAuthUser()?.rewardsEnrolled) &&
      !isElevatedManagerRole(String(getAuthUser()?.role || "")) &&
      !canNavToPage("page.rewards") &&
      pathname !== "/rewards"
    );
  }, [pathname, rewardsProgramEnabled, sessionBump]);

  const navButtonStyle = (active: boolean): React.CSSProperties => ({
    padding: "14px 26px",
    borderRadius: 18,
    border: active
      ? "1px solid #8b5cf6"
      : "1px solid rgba(139, 92, 246, 0.45)",
    background: active
      ? "linear-gradient(135deg, rgba(91,33,182,0.65), rgba(30,41,59,0.9))"
      : "rgba(15, 23, 42, 0.85)",
    color: "#ffffff",
    fontWeight: 700,
    fontSize: 16,
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 150,
    boxShadow: active
      ? "0 0 18px rgba(139, 92, 246, 0.25)"
      : "none",
    transition: "0.2s ease",
    cursor: "pointer",
  });

  const adminButtonStyle: React.CSSProperties = {
    padding: "14px 26px",
    borderRadius: 18,
    border: "1px solid #8b5cf6",
    background:
      "linear-gradient(135deg, rgba(91,33,182,0.8), rgba(76,29,149,0.9))",
    color: "white",
    fontWeight: 800,
    fontSize: 16,
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 120,
    cursor: "pointer",
  };

  const logoutButtonStyle: React.CSSProperties = {
    padding: "14px 26px",
    borderRadius: 18,
    border: "1px solid #ef4444",
    background:
      "linear-gradient(135deg, rgba(153,27,27,0.9), rgba(127,29,29,0.95))",
    color: "white",
    fontWeight: 800,
    fontSize: 16,
    cursor: "pointer",
    minWidth: 120,
  };

  return (
    <div style={{ marginBottom: 20, width: "100%" }}>
      <TopBrandStrip
        apiBaseUrl={API_BASE_URL}
        companyLogoConfiguredUrl={companyHeaderLogoUrl}
        companyLogoMaxHeightPx={isHomePage ? 64 : 56}
        nexbatchHeight={isHomePage ? 264 : 198}
      />
      {staffRewardsQuickLink && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginBottom: 12,
          }}
        >
          <Link
            href="/rewards"
            style={{
              padding: "12px 28px",
              borderRadius: 14,
              border: "1px solid rgba(34, 197, 94, 0.55)",
              background:
                "linear-gradient(135deg, rgba(6, 78, 59, 0.85), rgba(15, 23, 42, 0.95))",
              color: "#bbf7d0",
              fontWeight: 800,
              fontSize: 15,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              boxShadow: "0 0 20px rgba(34, 197, 94, 0.2)",
            }}
          >
            My rewards — points & progress
          </Link>
        </div>
      )}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
          padding: "18px 24px",
          background:
            "linear-gradient(90deg, #020617 0%, #0f172a 50%, #1e293b 100%)",
          borderRadius: 20,
          flexWrap: "wrap",
        }}
      >
      {!isHomePage && (
        <div
          style={{
            display: "flex",
            gap: 14,
            flexWrap: "wrap",
          }}
        >
          <Link
            href="/"
            style={navButtonStyle(pathname === "/")}
          >
            Home
          </Link>

          {canNavToPage("page.cultivation") && (
            <Link
              href="/cultivation"
              style={navButtonStyle(pathname === "/cultivation")}
            >
              Cultivation
            </Link>
          )}

          {canNavToPage("page.extraction") && (
            <Link
              href="/extraction"
              style={navButtonStyle(pathname === "/extraction")}
            >
              Extraction
            </Link>
          )}

          {canNavToPage("page.packaging") && (
            <Link
              href="/packaging"
              style={navButtonStyle(pathname === "/packaging")}
            >
              Packaging
            </Link>
          )}

          {canNavToPage("page.inventory") && (
            <Link
              href="/inventory"
              style={navButtonStyle(pathname === "/inventory")}
            >
              Inventory
            </Link>
          )}

          {canNavToPage("page.orders") && (
            <Link
              href="/orders"
              style={navButtonStyle(pathname === "/orders")}
            >
              Orders
            </Link>
          )}

          {canNavToPage("page.data-hub") && (
            <Link
              href="/data-hub"
              style={navButtonStyle(pathname === "/data-hub")}
            >
              Data Hub
            </Link>
          )}

          {canNavToPage("page.analytics") && (
            <Link
              href="/analytics"
              style={navButtonStyle(pathname === "/analytics")}
            >
              Analytics
            </Link>
          )}

          {canNavToPage("page.rewards") &&
            rewardsProgramEnabled &&
            (Boolean(getAuthUser()?.rewardsEnrolled) ||
              isElevatedManagerRole(String(getAuthUser()?.role || ""))) && (
              <Link href="/rewards" style={navButtonStyle(pathname === "/rewards")}>
                Rewards
              </Link>
            )}

          {canNavToPage("page.sales-seller") && companyServices?.salesSellerEnabled && (
            <Link href="/sales/seller" style={navButtonStyle(pathname?.startsWith("/sales/seller") ?? false)}>
              Seller Platform
            </Link>
          )}

          {canNavToPage("page.sales-marketplace") && companyServices?.salesBuyerEnabled && (
            <Link
              href="/sales/marketplace"
              style={navButtonStyle(pathname?.startsWith("/sales/marketplace") ?? false)}
            >
              Marketplace
            </Link>
          )}
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: 14,
          alignItems: "center",
          marginLeft: isHomePage ? 0 : "auto",
          flexWrap: "wrap",
        }}
      >
        {company && (
          <div
            style={{
              color: "#cbd5e1",
              fontWeight: 800,
              fontSize: 15,
              padding: "8px 12px",
              borderRadius: 12,
              border: "1px solid rgba(148, 163, 184, 0.35)",
              background: "rgba(2, 6, 23, 0.65)",
            }}
          >
            {company.name}{" "}
            <span style={{ color: "#64748b" }}>({company.code})</span>
          </div>
        )}

        {isPortalSession() && pathname !== "/portal" && (
          <Link
            href="/portal?pick=1"
            style={{
              padding: "12px 18px",
              borderRadius: 14,
              border: "1px solid rgba(56, 189, 248, 0.45)",
              background: "rgba(8, 47, 73, 0.75)",
              color: "#7dd3fc",
              fontWeight: 800,
              fontSize: 15,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            NexBatch menu
          </Link>
        )}

        {isPortalSession() && portalCompanies.length > 1 && (
          <label
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              color: "#dbeafe",
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            <span>Company</span>
            <select
              value={company?.id || ""}
              onChange={async (e) => {
                const id = e.target.value;
                if (!id) return;
                try {
                  const out = await selectPortalCompany(id);
                  saveAuthSession({
                    token: out.token,
                    user: out.user as CpuUser,
                    company: out.company,
                  });
                  setSelectedCompanyId(out.company.id);
                  setPortalCompaniesState(getPortalCompanies());
                  router.refresh();
                } catch {
                  /* ignore */
                }
              }}
              style={{
                minWidth: 200,
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid rgba(148, 163, 184, 0.35)",
                background: "#020617",
                color: "white",
                fontWeight: 700,
              }}
            >
              {portalCompanies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                  {c.lifecycleStatus === "invited" ? " — Invited" : ""}
                </option>
              ))}
            </select>
          </label>
        )}

        {(user?.role === "ADMIN" || user?.role === "OWNER") && (
          <Link href="/admin" style={adminButtonStyle}>
            Admin
          </Link>
        )}

        <button
          onClick={logout}
          style={logoutButtonStyle}
        >
          Logout
        </button>
      </div>
      </div>
    </div>
  );
}