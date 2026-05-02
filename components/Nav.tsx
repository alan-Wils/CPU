"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearAuthSession, getAuthUser } from "@/lib/auth";
import { clearSelectedCompanyId } from "@/lib/api";

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const user = getAuthUser();

  function logout() {
    clearAuthSession();
    clearSelectedCompanyId();
    router.push("/login");
  }

  const isHomePage = pathname === "/";

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
    padding: "14px 16px",
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
    minWidth: 0,
    width: "100%",
    boxSizing: "border-box",
    cursor: "pointer",
  };

  const logoutButtonStyle: React.CSSProperties = {
    padding: "14px 16px",
    borderRadius: 18,
    border: "1px solid #ef4444",
    background:
      "linear-gradient(135deg, rgba(153,27,27,0.9), rgba(127,29,29,0.95))",
    color: "white",
    fontWeight: 800,
    fontSize: 16,
    cursor: "pointer",
    minWidth: 0,
    width: "100%",
    boxSizing: "border-box",
  };

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 16,
        padding: "18px 16px",
        background:
          "linear-gradient(90deg, #020617 0%, #0f172a 50%, #1e293b 100%)",
        borderRadius: 20,
        marginBottom: 20,
        flexWrap: "wrap",
        width: "100%",
        maxWidth: "100%",
        boxSizing: "border-box",
        minWidth: 0,
      }}
    >
      {!isHomePage && (
        <div
          style={{
            display: "flex",
            gap: 14,
            flexWrap: "wrap",
            minWidth: 0,
            flex: "1 1 auto",
          }}
        >
          <Link
            href="/"
            style={navButtonStyle(pathname === "/")}
          >
            Home
          </Link>

          <Link
            href="/cultivation"
            style={navButtonStyle(pathname === "/cultivation")}
          >
            Cultivation
          </Link>

          <Link
            href="/extraction"
            style={navButtonStyle(pathname === "/extraction")}
          >
            Extraction
          </Link>

          <Link
            href="/packaging"
            style={navButtonStyle(pathname === "/packaging")}
          >
            Packaging
          </Link>

          <Link
            href="/data-hub"
            style={navButtonStyle(pathname === "/data-hub")}
          >
            Data Hub
          </Link>
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))",
          gap: 12,
          alignItems: "stretch",
          marginLeft: isHomePage ? 0 : "auto",
          minWidth: 0,
          width: isHomePage ? "100%" : "auto",
          maxWidth: "100%",
          flexShrink: 1,
          boxSizing: "border-box",
        }}
      >
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
  );
}