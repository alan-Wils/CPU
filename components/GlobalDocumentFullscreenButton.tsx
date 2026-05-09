"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import DocumentFullscreenButton from "@/components/DocumentFullscreenButton";
import {
  getWantsFullscreen,
  isDocumentFullscreen,
  setWantsFullscreen,
  tryRequestDocumentFullscreen,
} from "@/lib/documentFullscreen";

const BUYER_FLOATING_NAV_PREFIXES = ["/sales/marketplace", "/sales/nexbatch-orders", "/messages"];

function pathHasBuyerBottomNav(pathname: string): boolean {
  return BUYER_FLOATING_NAV_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * One fullscreen control for all routes. Fixed **bottom-left** so it does not sit under Windows window
 * controls (top-right). On buyer surfaces with the floating bottom nav, inset is raised so it clears the bar.
 *
 * Re-applies fullscreen after in-app route changes when the user chose fullscreen (session intent), because
 * many browsers exit fullscreen on navigation even for SPAs.
 */
export default function GlobalDocumentFullscreenButton() {
  const pathname = usePathname() || "";
  const liftForBuyerNav = pathHasBuyerBottomNav(pathname);
  const prevPathRef = useRef<string | null>(null);

  /** Clear intent when the user explicitly leaves fullscreen via Escape (not via our button). */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!getWantsFullscreen()) return;
      if (!isDocumentFullscreen()) return;
      setWantsFullscreen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  /** After pathname changes, try to re-enter fullscreen if the user wanted it (best-effort). */
  useEffect(() => {
    if (prevPathRef.current === null) {
      prevPathRef.current = pathname;
      return;
    }
    if (prevPathRef.current === pathname) return;
    prevPathRef.current = pathname;

    if (!getWantsFullscreen()) return;
    if (isDocumentFullscreen()) return;

    tryRequestDocumentFullscreen();
    requestAnimationFrame(() => {
      tryRequestDocumentFullscreen();
      requestAnimationFrame(() => tryRequestDocumentFullscreen());
    });
    window.setTimeout(() => tryRequestDocumentFullscreen(), 0);
    window.setTimeout(() => tryRequestDocumentFullscreen(), 80);
  }, [pathname]);

  /**
   * Same as pathname effect: internal link clicks may still carry user activation briefly; schedule retries
   * immediately so Chromium/Edge can re-enter fullscreen after dropping it on navigation.
   */
  useEffect(() => {
    const bump = () => {
      if (!getWantsFullscreen()) return;
      tryRequestDocumentFullscreen();
      window.setTimeout(() => tryRequestDocumentFullscreen(), 0);
      window.setTimeout(() => tryRequestDocumentFullscreen(), 100);
    };
    const onClickCapture = (e: MouseEvent) => {
      if (!getWantsFullscreen()) return;
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!a) return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("http") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      if (!href.startsWith("/") || href.startsWith("//")) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (e.button !== 0) return;
      bump();
    };
    document.addEventListener("click", onClickCapture, true);
    return () => document.removeEventListener("click", onClickCapture, true);
  }, []);

  return (
    <div
      className="global-fullscreen-btn-wrap"
      style={{
        position: "fixed",
        left: "max(10px, env(safe-area-inset-left, 0px))",
        bottom: liftForBuyerNav
          ? "max(100px, calc(env(safe-area-inset-bottom, 0px) + 88px))"
          : "max(16px, env(safe-area-inset-bottom, 0px))",
        zIndex: 9000,
        pointerEvents: "none",
      }}
    >
      <DocumentFullscreenButton
        style={{
          pointerEvents: "auto",
          width: 44,
          height: 44,
          borderRadius: 12,
          border: "1px solid rgba(148, 163, 184, 0.28)",
          background: "rgba(2, 6, 23, 0.88)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          color: "#e2e8f0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          boxShadow: "0 8px 28px rgba(0,0,0,0.35)",
        }}
      />
    </div>
  );
}
