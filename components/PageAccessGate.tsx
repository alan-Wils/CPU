"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getAuthUser, isLoggedIn } from "@/lib/auth";

type PageAccessGateProps = {
  allowedRoles: string[];
  children: React.ReactNode;
};

const ROLE_LEVELS: Record<string, number> = {
  VIEW_ONLY: 1,
  CULTIVATION: 2,
  EXTRACTION: 2,
  PACKAGING: 2,
  MANAGER: 3,
  ADMIN: 4,
  OWNER: 5,
};

function normalizeRole(role: any) {
  return String(role || "").toUpperCase();
}

function hasAccess(userRole: string, allowedRoles: string[]) {
  const role = normalizeRole(userRole);
  const allowed = allowedRoles.map(normalizeRole);

  if (allowed.includes(role)) return true;

  // Higher-level users can access production pages.
  if (
    ROLE_LEVELS[role] >= ROLE_LEVELS.MANAGER &&
    allowed.some((allowedRole) =>
      ["CULTIVATION", "EXTRACTION", "PACKAGING", "VIEW_ONLY"].includes(
        allowedRole
      )
    )
  ) {
    return true;
  }

  return false;
}

export default function PageAccessGate({
  allowedRoles,
  children,
}: PageAccessGateProps) {
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [userRole, setUserRole] = useState("");

  useEffect(() => {
    const loggedIn = isLoggedIn();
    const user = getAuthUser();
    const role = normalizeRole(user?.role);

    setUserRole(role);

    if (!loggedIn) {
      setAllowed(false);
      setChecking(false);
      return;
    }

    setAllowed(hasAccess(role, allowedRoles));
    setChecking(false);
  }, [allowedRoles]);

  if (checking) {
    return (
      <main style={pageStyle}>
        <div style={cardStyle}>
          <h1 style={{ marginTop: 0 }}>Checking Access...</h1>
          <p style={mutedStyle}>Loading your permissions.</p>
        </div>
      </main>
    );
  }

  if (!isLoggedIn()) {
    return (
      <main style={pageStyle}>
        <div style={cardStyle}>
          <h1 style={{ marginTop: 0 }}>Login Required</h1>
          <p style={mutedStyle}>You need to sign in before using this page.</p>

          <Link href="/login" style={buttonStyle}>
            Go To Login
          </Link>
        </div>
      </main>
    );
  }

  if (!allowed) {
    return (
      <main style={pageStyle}>
        <div style={cardStyle}>
          <h1 style={{ marginTop: 0 }}>Access Denied</h1>

          <p style={mutedStyle}>
            Your current role does not have permission to open this page.
          </p>

          <div
            style={{
              background: "#020617",
              border: "1px solid #334155",
              borderRadius: 12,
              padding: 12,
              marginTop: 14,
              marginBottom: 18,
              color: "#cbd5e1",
            }}
          >
            <div>
              <b>Your Role:</b> {userRole || "Unknown"}
            </div>
            <div>
              <b>Allowed Roles:</b>{" "}
              {allowedRoles.map((role) => normalizeRole(role)).join(", ")}
            </div>
          </div>

          <Link href="/" style={buttonStyle}>
            Back To Home
          </Link>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background:
    "radial-gradient(circle at top, #1e293b 0, #020617 45%, #020617 100%)",
  color: "white",
  padding: 24,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const cardStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 520,
  background: "rgba(15, 23, 42, 0.92)",
  border: "1px solid rgba(148, 163, 184, 0.25)",
  borderRadius: 18,
  padding: 28,
  boxShadow: "0 30px 80px rgba(0,0,0,0.45)",
  textAlign: "center",
};

const mutedStyle: React.CSSProperties = {
  color: "#94a3b8",
  lineHeight: 1.55,
};

const buttonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  textDecoration: "none",
  background: "#22c55e",
  color: "#052e16",
  borderRadius: 12,
  padding: "11px 16px",
  fontWeight: 900,
};