"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getAuthUser, isLoggedIn } from "@/lib/auth";
import {
  computeEffectiveAppPermissions,
  hasAppPermission,
  isElevatedManagerRole,
} from "@cpu/shared";

/** Either legacy role list (floor pages) or a single workflow page permission id. */
export type PageAccessGateProps =
  | {
      allowedRoles: string[];
      permission?: undefined;
      children: React.ReactNode;
    }
  | {
      permission: string;
      allowedRoles?: undefined;
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

function isProductionGateToken(r: string): boolean {
  return (
    r === "CULTIVATION" ||
    r === "EXTRACTION" ||
    r === "PACKAGING" ||
    r === "VIEW_ONLY"
  );
}

function normalizeRole(role: any) {
  return String(role || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

/** JWT uses e.g. EXTRACTION_SPECIALIST; page gates still list legacy EXTRACTION. */
function roleMatchesAreaGateToken(role: string, gateToken: string): boolean {
  if (gateToken === "CULTIVATION")
    return role === "CULTIVATION" || role === "CULTIVATION_SPECIALIST";
  if (gateToken === "EXTRACTION")
    return role === "EXTRACTION" || role === "EXTRACTION_SPECIALIST";
  if (gateToken === "PACKAGING")
    return role === "PACKAGING" || role === "PACKAGING_SPECIALIST";
  return false;
}

function hasRoleListAccess(userRole: string, allowedRoles: string[]) {
  const role = normalizeRole(userRole);
  const allowed = allowedRoles.map(normalizeRole);

  if (allowed.includes(role)) return true;

  const isProductionGate = allowed.some(isProductionGateToken);
  if (!isProductionGate) return false;

  if (allowed.some((gateToken) => roleMatchesAreaGateToken(role, gateToken))) {
    return true;
  }

  const tier = ROLE_LEVELS[role];
  const legacyManagerUp =
    typeof tier === "number" && tier >= ROLE_LEVELS.MANAGER;

  if (isElevatedManagerRole(role) || legacyManagerUp) return true;

  return false;
}

function hasPagePermissionAccess(
  user: ReturnType<typeof getAuthUser>,
  required: string
): boolean {
  if (!user) return false;
  const role = normalizeRole(user.role);
  const fromJwt = Array.isArray(user.permissions) ? user.permissions : undefined;
  const granted =
    fromJwt && fromJwt.length > 0
      ? fromJwt
      : computeEffectiveAppPermissions(role, null);
  return hasAppPermission(granted, required);
}

export default function PageAccessGate(props: PageAccessGateProps) {
  const { children } = props;
  const allowedRoles =
    "allowedRoles" in props && props.allowedRoles ? props.allowedRoles : undefined;
  const permission =
    "permission" in props && props.permission ? props.permission : undefined;

  const pathname = usePathname();
  const router = useRouter();
  /** Avoid SSR/client mismatch: token only exists in `localStorage` after hydration. */
  const [hydrated, setHydrated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [userRole, setUserRole] = useState("");

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;

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

    if (permission) {
      setAllowed(hasPagePermissionAccess(user, permission));
    } else if (allowedRoles && allowedRoles.length > 0) {
      setAllowed(hasRoleListAccess(role, allowedRoles));
    } else {
      setAllowed(false);
    }
    setChecking(false);
  }, [hydrated, allowedRoles, permission, pathname, router]);

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
    const accessDetail = permission
      ? String(permission)
      : (allowedRoles || [])
          .map((r) => normalizeRole(r))
          .join(", ");

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
              <b>{permission ? "Required:" : "Allowed Roles:"}</b> {accessDetail}
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
