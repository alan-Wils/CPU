"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { isLoggedIn } from "@/lib/auth";

/** Pre-auth and locked-account flows where the marketing slogan should NOT render. */
const HIDE_PATH_PREFIXES = [
  "/login",
  "/forgot-password",
  "/password-reset",
  "/accept-invite",
  "/accept-nexbatch-invite",
];

/**
 * Routes that render the buyer marketplace floating bottom nav (`MarketplaceBuyerBottomNav`).
 * On these pages the slogan needs extra bottom offset so it stays *above* the floating bar
 * (matches the requirement to stay visible above mobile navigation bars / safe areas).
 */
const BUYER_BOTTOM_NAV_PREFIXES = [
  "/sales/marketplace",
  "/sales/nexbatch-orders",
  "/messages",
];

function pathMatchesAny(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Subtle marketing slogan anchored to the bottom-center of every authenticated platform page.
 * Mounted from `app/layout.tsx` so it inherits across Dashboard, Marketplace, Orders, Seller hub,
 * Admin, etc. Uses `pointer-events-none` so it never interferes with scroll, modals, or nav bars.
 */
export default function PlatformFooterSlogan() {
  const pathname = usePathname() || "/";
  const [authed, setAuthed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setAuthed(isLoggedIn());
  }, [pathname]);

  if (!mounted) return null;
  if (!authed) return null;
  if (pathMatchesAny(pathname, HIDE_PATH_PREFIXES)) return null;

  const liftedForBottomNav = pathMatchesAny(pathname, BUYER_BOTTOM_NAV_PREFIXES);

  return (
    <div
      aria-hidden={false}
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        // Keep the slogan above the iOS home indicator and (when present) the buyer floating nav.
        bottom: liftedForBottomNav
          ? "calc(env(safe-area-inset-bottom, 0px) + 90px)"
          : "calc(env(safe-area-inset-bottom, 0px) + 4px)",
        zIndex: 5,
        pointerEvents: "none",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <p
        className="platform-footer-slogan"
        style={{
          margin: 0,
          paddingTop: 6,
          paddingBottom: 0,
          textAlign: "center",
          fontFamily: "var(--font-space-grotesk), 'Space Grotesk', system-ui, sans-serif",
          fontWeight: 400,
          letterSpacing: "1px",
          textTransform: "uppercase",
          lineHeight: 1.4,
          color: "rgba(255, 255, 255, 0.28)",
          transition: "color 300ms ease, opacity 300ms ease",
          // Allow the hover state to actually trigger even though the wrapper is non-interactive.
          pointerEvents: "auto",
          userSelect: "none",
          whiteSpace: "nowrap",
          maxWidth: "calc(100vw - 24px)",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        Built for Cannabis Operations From Start to Finish
      </p>
    </div>
  );
}
