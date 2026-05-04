"use client";

import {
  defaultPagePermissionsForRole,
  hasAppPermission,
  isElevatedManagerRole,
} from "@cpu/shared";
import { getAuthUser, isLoggedIn } from "@/lib/auth";

const dashboardCards: {
  title: string;
  description: string;
  href: string;
  accent: string;
  permission: string;
}[] = [
  {
    title: "Cultivation",
    description:
      "Create clone batches, move plants through veg and flower, harvest, dry, cure, and prepare source material.",
    href: "/cultivation",
    accent: "#22c55e",
    permission: "page.cultivation",
  },
  {
    title: "Extraction",
    description:
      "Create extraction batches from source material, track sock packing, extraction runs, purge, testing, and final oil.",
    href: "/extraction",
    accent: "#38bdf8",
    permission: "page.extraction",
  },
  {
    title: "Packaging",
    description:
      "Package approved extraction products, track units, task labor, testing, relabeling, and finished package sets.",
    href: "/packaging",
    accent: "#a855f7",
    permission: "page.packaging",
  },
  {
    title: "Data Hub",
    description:
      "Review batch chains, source material flow, production history, labor cost, yield, and company-wide batch data.",
    href: "/data-hub",
    accent: "#f59e0b",
    permission: "page.data-hub",
  },
];

export default function HomeDashboardCards() {
  const user = getAuthUser();
  const role = String(user?.role || "").toUpperCase();
  const visible = dashboardCards.filter((c) => {
    if (!isLoggedIn())
      return true;
    if (isElevatedManagerRole(role))
      return true;
    const perms = Array.isArray(user?.permissions)
      ? user.permissions
      : defaultPagePermissionsForRole(role);
    return hasAppPermission(perms, c.permission);
  });

  return (
    <section
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(245px, 1fr))",
        gap: 18,
        marginBottom: 22,
      }}
    >
      {visible.map((card) => (
        <a
          key={card.title}
          href={card.href}
          style={{
            display: "block",
            textDecoration: "none",
            color: "white",
            background: "rgba(15, 23, 42, 0.78)",
            border: "1px solid rgba(148, 163, 184, 0.2)",
            borderRadius: 22,
            padding: 22,
            minHeight: 205,
            boxShadow: "0 18px 50px rgba(0,0,0,0.28)",
            transition:
              "transform 160ms ease, border-color 160ms ease, background 160ms ease",
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              background: `${card.accent}22`,
              border: `1px solid ${card.accent}66`,
              marginBottom: 18,
              boxShadow: `0 0 30px ${card.accent}22`,
            }}
          />

          <h2
            style={{
              margin: 0,
              fontSize: 24,
              fontWeight: 900,
              letterSpacing: "-0.03em",
            }}
          >
            {card.title}
          </h2>

          <p
            style={{
              color: "#94a3b8",
              lineHeight: 1.55,
              marginTop: 10,
              marginBottom: 18,
            }}
          >
            {card.description}
          </p>

          <div
            style={{
              color: card.accent,
              fontWeight: 900,
            }}
          >
            Open {card.title} →
          </div>
        </a>
      ))}
    </section>
  );
}
