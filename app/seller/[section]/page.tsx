"use client";

import { useParams } from "next/navigation";
import SellerStub from "@/components/seller/SellerStub";

type StubCfg = {
  title: string;
  description?: string;
  primaryAction?: { href: string; label: string };
  secondaryAction?: { href: string; label: string };
};

const CONFIG: Record<string, StubCfg> = {
  transactions: {
    title: "Transactions",
    description:
      "Payments, invoices, credits, and refunds will appear here as accounting integrations expand. Export tools follow existing platform utilities when enabled.",
    secondaryAction: { href: "/seller/dashboard", label: "Back to dashboard" },
  },
  customers: {
    title: "Customers",
    description:
      "Buyer companies that have placed NexBatch marketplace orders with your workspace appear in analytics and recent orders. Detailed CRM workflows ship incrementally.",
    primaryAction: { href: "/seller/dashboard", label: "View dashboard insights" },
  },
  crm: {
    title: "CRM",
    description:
      "Relationship timelines are scaffolded from marketplace orders and synced LeafLink activity. Full CRM messaging ships in a future iteration.",
    secondaryAction: { href: "/seller/dashboard", label: "Dashboard activity" },
  },
  "total-sales": {
    title: "Total Sales",
    description:
      "Aggregate NexBatch, LeafLink, and combined revenue lives on the Seller dashboard with date filters. Use Reports for CSV exports when available.",
    primaryAction: { href: "/seller/dashboard", label: "Open dashboard totals" },
  },
  reports: {
    title: "Reports",
    description:
      "Sales, inventory, customer, product performance, and P&L summaries route here. Hook into existing export endpoints as they are enabled for your tenant.",
    secondaryAction: { href: "/orders", label: "LeafLink orders pool" },
  },
  analytics: {
    title: "Analytics",
    description:
      "Revenue, order, AOV, repeat rate, and category trends extend dashboard KPIs. Connect Datadog or internal BI using existing NexBatch APIs.",
    primaryAction: { href: "/seller/dashboard", label: "Dashboard analytics" },
  },
  campaigns: {
    title: "Campaigns",
    description: "Create buyer-facing campaigns, attach products, and measure performance. Implementation hooks into marketing tables as they are introduced.",
    secondaryAction: { href: "/sales/seller", label: "Manage listings" },
  },
  promotions: {
    title: "Promotions",
    description: "Configure discounts, bulk pricing, and expirations. Guardrails respect marketplace pricing rules and LeafLink sync when enabled.",
    secondaryAction: { href: "/portal", label: "Workspace services" },
  },
  announcements: {
    title: "Announcements",
    description: "Post drops, inventory warnings, and pricing updates to marketplace buyers. Uses NexBatch communications when connected.",
    secondaryAction: { href: "/sales/marketplace", label: "Preview marketplace" },
  },
  "batch-management": {
    title: "Batch Management",
    description: "Source chains, batches, and packaging runs live in the production workspace.",
    primaryAction: { href: "/", label: "Open production home" },
  },
  cultivation: {
    title: "Cultivation",
    description: "Cultivation batches and climate monitoring continue to run from the main NexBatch floor.",
    primaryAction: { href: "/", label: "Open production home" },
  },
  production: {
    title: "Production",
    description: "Extraction, packaging, and operational tasks remain on the production dashboard.",
    primaryAction: { href: "/", label: "Open production home" },
  },
  packaging: {
    title: "Packaging",
    description: "Packaging lots and QA checkpoints are managed from the packaging workflows.",
    primaryAction: { href: "/", label: "Open production home" },
  },
  "quality-control": {
    title: "Quality Control",
    description: "QC holds and release steps align with existing packaging QA surfaces.",
    primaryAction: { href: "/", label: "Open production home" },
  },
  "lab-results": {
    title: "Lab Results",
    description: "COA attachments continue to flow through batch and product metadata.",
    secondaryAction: { href: "/data-hub", label: "Data Hub" },
  },
  "company-profile": {
    title: "Company Profile",
    description: "Company identity, licensing, and verified seller badge settings are managed through the NexBatch portal and company configuration.",
    primaryAction: { href: "/portal", label: "Open portal" },
  },
  team: {
    title: "Team",
    description: "Invite users, assign roles, and manage permissions from the portal and membership tools.",
    primaryAction: { href: "/portal", label: "Manage team" },
  },
  integrations: {
    title: "Integrations",
    description:
      "LeafLink inventory sync, API tokens, and integration health are configured per workspace. Enable LeafLink sync under Workspace services, then run sync from Seller listings.",
    primaryAction: { href: "/portal", label: "Workspace services & LeafLink" },
    secondaryAction: { href: "/sales/seller", label: "Seller listings & sync" },
  },
  settings: {
    title: "Settings",
    description: "Notification preferences, order rules, and low-stock thresholds will consolidate here alongside portal-level defaults.",
    secondaryAction: { href: "/portal", label: "Portal settings" },
  },
};

export default function SellerDynamicSectionPage() {
  const params = useParams();
  const section = String(params.section || "").toLowerCase();
  const cfg: StubCfg =
    CONFIG[section] ??
    ({
      title: section.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      description: "This Seller Platform section is scaffolded for upcoming workflows. Use the dashboard for live seller metrics.",
      secondaryAction: { href: "/seller/dashboard", label: "Seller dashboard" },
    } satisfies StubCfg);

  return (
    <SellerStub
      title={cfg.title}
      description={cfg.description}
      primaryAction={cfg.primaryAction}
      secondaryAction={cfg.secondaryAction}
    />
  );
}
