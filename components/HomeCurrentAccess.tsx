"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  CPU_AUTH_CHANGED_EVENT,
  getAuthCompany,
  getAuthUser,
  isLoggedIn,
  isPortalSession,
} from "@/lib/auth";

function platformRoleLabel(platformRole: string | null | undefined): string {
  const k = String(platformRole || "").trim();
  const map: Record<string, string> = {
    owner: "NexBatch Owner",
    nexbatch_admin: "NexBatch Admin",
    management: "Management",
    admin: "NexBatch Staff",
    lead_staff: "NexBatch Staff",
    grow_staff: "NexBatch Staff",
    extraction_staff: "NexBatch Staff",
    packaging_staff: "NexBatch Staff",
    trimming_staff: "NexBatch Staff",
  };
  return map[k] || (k ? `NexBatch (${k})` : "NexBatch portal");
}

export default function HomeCurrentAccess() {
  const pathname = usePathname();
  const [, setTick] = useState(0);

  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    bump();
    window.addEventListener(CPU_AUTH_CHANGED_EVENT, bump);
    window.addEventListener("storage", bump);
    return () => {
      window.removeEventListener(CPU_AUTH_CHANGED_EVENT, bump);
      window.removeEventListener("storage", bump);
    };
  }, [pathname]);

  const user = getAuthUser();
  const company = getAuthCompany();
  const portal = isPortalSession();

  let primary = "Not signed in";
  let secondary = "Sign in from the login page.";

  if (isLoggedIn()) {
    if (company) {
      primary = company.name;
      secondary = portal
        ? platformRoleLabel(user?.platformRole)
        : "Company workspace";
    } else if (portal) {
      primary = platformRoleLabel(user?.platformRole);
      secondary = "Select a company from the bar below.";
    } else {
      primary = user?.username || user?.email || "Signed in";
      secondary = "Company workspace";
    }
  }

  return (
    <div
      style={{
        minWidth: 220,
        background: "rgba(2, 6, 23, 0.74)",
        border: "1px solid rgba(148, 163, 184, 0.18)",
        borderRadius: 18,
        padding: 16,
      }}
    >
      <div
        style={{
          color: "#94a3b8",
          fontSize: 13,
          fontWeight: 800,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 8,
        }}
      >
        Current access
      </div>
      <div style={{ fontSize: 24, fontWeight: 900 }}>{primary}</div>
      <div style={{ color: "#64748b", marginTop: 4 }}>{secondary}</div>
    </div>
  );
}
