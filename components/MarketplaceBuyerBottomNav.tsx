"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

export type MarketplaceBuyerBottomNavTab = "home" | "marketplace" | "nexbatch_orders" | "messages" | "profile";

type Props = {
  active: MarketplaceBuyerBottomNavTab;
  profileHref: string;
};

function BottomNavItem({
  href,
  label,
  icon,
  active,
}: {
  href: string;
  label: string;
  icon: ReactNode;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      style={{
        textDecoration: "none",
        textAlign: "center",
        fontSize: 10,
        fontWeight: 800,
        color: active ? "#c4b5fd" : "#64748b",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        padding: "4px 2px",
        borderRadius: 12,
        background: active ? "rgba(124, 58, 237, 0.12)" : "transparent",
      }}
    >
      <span style={{ position: "relative", color: active ? "#a78bfa" : "#64748b" }}>{icon}</span>
      {label}
    </Link>
  );
}

function GridIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z" opacity="0.9" />
    </svg>
  );
}

function ShopIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9z" />
      <path d="M3 9 5 4h14l2 5" />
    </svg>
  );
}

function ReceiptIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M7 3h10v18l-2-1-2 1-2-1-2 1-2-1-2 1V3z" />
      <path d="M9 8h6M9 12h6" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12a8 8 0 0 1-8 8H8l-5 3v-3H5a8 8 0 1 1 16 0z" />
    </svg>
  );
}

function UserNavIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c2-4 6-6 8-6s6 2 8 6" />
    </svg>
  );
}

const navShell: CSSProperties = {
  position: "fixed",
  left: 12,
  right: 12,
  bottom: "max(12px, env(safe-area-inset-bottom, 0px))",
  zIndex: 40,
  display: "grid",
  gridTemplateColumns: "repeat(5, 1fr)",
  gap: 4,
  padding: "10px 8px",
  borderRadius: 20,
  background: "rgba(2, 6, 23, 0.88)",
  backdropFilter: "blur(14px)",
  WebkitBackdropFilter: "blur(14px)",
  border: "1px solid rgba(148, 163, 184, 0.18)",
  boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
};

/**
 * Mobile-style bottom bar for buyer marketplace flows. Orders tab points at NexBatch wholesale orders (not LeafLink `/orders`).
 */
export default function MarketplaceBuyerBottomNav({ active, profileHref }: Props) {
  return (
    <nav style={navShell}>
      <BottomNavItem href="/" label="Dashboard" icon={<GridIcon />} active={active === "home"} />
      <BottomNavItem
        href="/sales/marketplace"
        label="Marketplace"
        icon={<ShopIcon />}
        active={active === "marketplace"}
      />
      <BottomNavItem
        href="/sales/nexbatch-orders"
        label="Orders"
        icon={<ReceiptIcon />}
        active={active === "nexbatch_orders"}
      />
      <BottomNavItem href="/messages" label="Messages" icon={<ChatIcon />} active={active === "messages"} />
      <BottomNavItem href={profileHref} label="Profile" icon={<UserNavIcon />} active={active === "profile"} />
    </nav>
  );
}
