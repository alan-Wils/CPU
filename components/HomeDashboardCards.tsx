"use client";

import { useEffect, useState } from "react";
import {
  defaultPagePermissionsForRole,
  hasAppPermission,
  isOwnerOrAdminRole,
} from "@cpu/shared";
import { fetchCompanyWithServices, type CompanyServicesDto } from "@/lib/api";
import { getAuthUser, isLoggedIn } from "@/lib/auth";

type DashboardCard = {
  title: string;
  description: string;
  href: string;
  accent: string;
  permission: string;
  /** When set, card only appears if company has turned on this workspace service (see /api/companies/me). */
  requireService?: keyof Pick<CompanyServicesDto, "salesSellerEnabled" | "salesBuyerEnabled">;
};

const dashboardCards: DashboardCard[] = [
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
    title: "Inventory",
    description:
      "Track lots, manifests, labeling, METRC-aligned inventory snapshots, movement, and reconciliation.",
    href: "/inventory",
    accent: "#10b981",
    permission: "page.inventory",
  },
  {
    title: "Orders",
    description:
      "Stored LeafLink sales orders with customer totals, syncing, and outbound workflow context.",
    href: "/orders",
    accent: "#fbbf24",
    permission: "page.orders",
  },
  {
    title: "Seller marketplace",
    description:
      "List wholesale products on NexBatch, set availability, sync LeafLink inventory when enabled, and fulfill buyer orders.",
    href: "/sales/seller",
    accent: "#c084fc",
    permission: "page.sales-seller",
    requireService: "salesSellerEnabled",
  },
  {
    title: "Buyer marketplace",
    description:
      "Browse approved seller catalogs, build carts, and place wholesale orders with connected producers.",
    href: "/sales/marketplace",
    accent: "#2dd4bf",
    permission: "page.sales-marketplace",
    requireService: "salesBuyerEnabled",
  },
  {
    title: "Analytics",
    description:
      "Company-wide metrics, trends, and reporting across cultivation and production performance.",
    href: "/analytics",
    accent: "#6366f1",
    permission: "page.analytics",
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
  const [services, setServices] = useState<CompanyServicesDto | null>(null);

  useEffect(() => {
    if (!isLoggedIn()) {
      setServices(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const out = await fetchCompanyWithServices();
        if (cancelled) return;
        setServices((out.services as CompanyServicesDto) ?? null);
      } catch {
        if (!cancelled) setServices(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = dashboardCards.filter((c) => {
    if (c.requireService) {
      if (!isLoggedIn()) return false;
      if (!services?.[c.requireService]) return false;
    } else if (!isLoggedIn()) {
      return true;
    }
    if (isOwnerOrAdminRole(role)) return true;
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
