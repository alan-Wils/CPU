"use client";

import {
  defaultPagePermissionsForRole,
  hasAppPermission,
  isElevatedManagerRole,
} from "@cpu/shared";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getAuthUser, isLoggedIn } from "@/lib/auth";

type PageAccessGateProps =
  | {
      /** e.g. `page.cultivation` — checked against JWT `user.permissions`. */
      permission: string;
      children: React.ReactNode;
    }
  | {
      /** Legacy admin gate: exact role match (OWNER / ADMIN). */
      allowedRoles: string[];
      children: React.ReactNode;
    };

function normalizeRole(role: unknown) {
  return String(role || "").toUpperCase();
}

function effectivePermissionList(userRole: string, rawFromUser: unknown): string[] {
  if (Array.isArray(rawFromUser))
    return rawFromUser.map((x) => String(x));
  return defaultPagePermissionsForRole(userRole);
}

function hasAdminRoleAccess(userRole: string, allowedRoles: string[]) {
  const role = normalizeRole(userRole);
  const allowed = allowedRoles.map(normalizeRole);
  return allowed.includes(role);
}

function hasPageAccess(userRole: string, permissions: string[], permission: string) {
  const role = normalizeRole(userRole);
  if (isElevatedManagerRole(role))
    return true;
  return hasAppPermission(permissions, permission);
}

export default function PageAccessGate(props: PageAccessGateProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [userRole, setUserRole] = useState("");
  const [detail, setDetail] = useState("");

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated)
      return;

    const loggedIn = isLoggedIn();
    const user = getAuthUser();
    const role = normalizeRole(user?.role);

    setUserRole(role);

    if (!loggedIn) {
      setAllowed(false);
      setChecking(false);
      const path = pathname || "/";
      const search =
        typeof window !== "undefined" ? window.location.search || "" : "";
      const next = encodeURIComponent(`${path}${search}`);
      router.replace(`/login?next=${next}`);
      return;
    }

    if ("allowedRoles" in props) {
      setAllowed(hasAdminRoleAccess(role, props.allowedRoles));
      setDetail(props.allowedRoles.map(normalizeRole).join(", "));
    }
    else {
      const perms = effectivePermissionList(role, user?.permissions);
      setAllowed(hasPageAccess(role, perms, props.permission));
      setDetail(props.permission);
    }
    setChecking(false);
  }, [hydrated, props, pathname, router]);

  if (!hydrated || checking) {
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
          <h1 style={{ marginTop: 0 }}>Redirecting to sign in…</h1>
          <p style={mutedStyle}>
            If you are not redirected,{" "}
            <Link href="/login" style={{ color: "#93c5fd" }}>
              open the login page
            </Link>
            .
          </p>
        </div>
      </main>
    );
  }

  if (!allowed) {
    const isAdminGate = "allowedRoles" in props;
    return (
      <main style={pageStyle}>
        <div style={cardStyle}>
          <h1 style={{ marginTop: 0 }}>Access Denied</h1>

          <p style={mutedStyle}>
            {isAdminGate
              ? "Your current role does not have permission to open this page."
              : "You do not have access to this page. Ask a company admin to grant the matching permission."}
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
              <b>{isAdminGate ? "Allowed Roles:" : "Required:"}</b> {detail}
            </div>
            {!isAdminGate && (
              <div style={{ marginTop: 8, fontSize: 13 }}>
                Admins can set page access under <b>Admin → Users → Edit</b>.
              </div>
            )}
          </div>

          <Link href="/" style={buttonStyle}>
            Back To Home
          </Link>
        </div>
      </main>
    );
  }

  return <>{props.children}</>;
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
