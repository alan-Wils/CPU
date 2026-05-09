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
 * On these pages the slogan needs extra bottom offset so it stays above the floating bar.
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
 * Subtle marketing slogan pinned bottom-center on authenticated platform pages.
 * z-index stays below modal layers so fullscreen dialogs cover it naturally.
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
      className={
        liftedForBottomNav
          ? "platform-footer-slogan-anchor platform-footer-slogan-anchor--lifted"
          : "platform-footer-slogan-anchor"
      }
      style={{
        position: "fixed",
        left: 0,
        right: 0,
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
          opacity: 0.92,
          transition: "color 300ms ease, opacity 300ms ease",
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
