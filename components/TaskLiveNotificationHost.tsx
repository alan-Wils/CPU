"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { usePathname } from "next/navigation";
import { apiRequest, fetchLatestTaskLogLive } from "@/lib/api";
import { CPU_AUTH_CHANGED_EVENT, isLoggedIn } from "@/lib/auth";
import { extractLiveTaskNotificationsEnabled } from "@/lib/taskNotificationsConfig";

function skipListeningForPath(pathname: string | null): boolean {
  const p = String(pathname || "");
  return (
    p.startsWith("/login") ||
    p.startsWith("/portal") ||
    p.startsWith("/forgot-password") ||
    p.startsWith("/password-reset") ||
    p.startsWith("/accept-invite") ||
    p.startsWith("/accept-nexbatch-invite")
  );
}

const POLL_INTERVAL_MS = 4000;

/** Public label for the actor on every device (same text for the performer and everyone else). */
function actorBroadcastLabel(actorEmail: string | null): string {
  const e = (actorEmail || "").trim();
  if (!e) return "Someone";
  const local = e.split("@")[0] || "";
  const pretty = local.replace(/[._]+/g, " ").trim();
  return pretty || "Someone";
}

function flushPendingToast(
  pending: MutableRefObject<{ message: string; key: string } | null>,
  toastNow: (message: string, key: string) => void,
): void {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
  const p = pending.current;
  if (!p) return;
  pending.current = null;
  toastNow(p.message, p.key);
}

/**
 * Polls `/api/logs/latest-live`. Active tenant follows the JWT (not localStorage headers).
 * Polls while the tab is hidden so other machines / refocused tabs stay in sync; toasts queue until visible.
 */
export default function TaskLiveNotificationHost() {
  const pathname = usePathname();
  const [authBump, setAuthBump] = useState(0);
  const [toast, setToast] = useState<{ message: string; key: string } | null>(null);

  const settingsEnabledRef = useRef(true);
  const primedRef = useRef(false);
  const lastIdRef = useRef<string | null>(null);
  const hideToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingToastRef = useRef<{ message: string; key: string } | null>(null);

  useEffect(() => {
    function bump() {
      setAuthBump((n) => n + 1);
    }
    window.addEventListener(CPU_AUTH_CHANGED_EVENT, bump);
    return () => window.removeEventListener(CPU_AUTH_CHANGED_EVENT, bump);
  }, []);

  useEffect(() => {
    settingsEnabledRef.current = true;

    let cancelled = false;
    async function refreshSettings() {
      if (!isLoggedIn()) {
        settingsEnabledRef.current = true;
        return;
      }
      try {
        const data = await apiRequest<unknown>("/api/config");
        if (!cancelled) settingsEnabledRef.current = extractLiveTaskNotificationsEnabled(data);
      } catch {
        if (!cancelled) settingsEnabledRef.current = true;
      }
    }

    refreshSettings();

    const onVis = () => {
      void refreshSettings();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [pathname, authBump]);

  useEffect(() => {
    primedRef.current = false;
    lastIdRef.current = null;
    pendingToastRef.current = null;

    if (!isLoggedIn() || skipListeningForPath(pathname)) return;

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    function dismissToastTimers() {
      if (hideToastTimerRef.current) {
        clearTimeout(hideToastTimerRef.current);
        hideToastTimerRef.current = null;
      }
    }

    function toastNow(message: string, key: string) {
      dismissToastTimers();
      setToast({ message, key });
      hideToastTimerRef.current = setTimeout(() => {
        setToast(null);
        hideToastTimerRef.current = null;
      }, 6500);
    }

    /**
     * Keep polling when the tab is hidden so `lastIdRef` matches the server (other devices won’t wedge state).
     * Only show UI when visible, or enqueue for when the tab is focused again.
     */
    async function syncPoll() {
      if (!isLoggedIn() || cancelled) return;
      if (!settingsEnabledRef.current) return;

      try {
        const latest = await fetchLatestTaskLogLive();
        if (!latest || cancelled) return;

        if (!primedRef.current) {
          primedRef.current = true;
          lastIdRef.current = latest.id;
          return;
        }

        if (latest.id === lastIdRef.current) return;

        lastIdRef.current = latest.id;

        const who = actorBroadcastLabel(latest.actorEmail);
        const area = String(latest.area || "Workspace").trim() || "Workspace";
        const task = String(latest.task || "a task").trim() || "a task";
        const message = `${who} performed "${task}" · ${area}`;
        const key = `${latest.id}:${latest.createdAt}`;

        if (typeof document !== "undefined" && document.visibilityState === "visible") {
          toastNow(message, key);
        } else {
          pendingToastRef.current = { message, key };
        }
      } catch {
        /* ignore polling failures */
      }
    }

    function onVisibilityOrFocus() {
      if (cancelled) return;
      flushPendingToast(pendingToastRef, toastNow);
      void syncPoll();
    }

    void syncPoll();

    intervalId = setInterval(() => {
      void syncPoll();
    }, POLL_INTERVAL_MS);

    document.addEventListener("visibilitychange", onVisibilityOrFocus);
    window.addEventListener("focus", onVisibilityOrFocus);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityOrFocus);
      window.removeEventListener("focus", onVisibilityOrFocus);
      dismissToastTimers();
      pendingToastRef.current = null;
    };
  }, [pathname, authBump]);

  useEffect(() => {
    return () => {
      if (hideToastTimerRef.current) clearTimeout(hideToastTimerRef.current);
    };
  }, []);

  if (!toast) return null;

  return (
    <div
      key={toast.key}
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        right: 20,
        bottom: 28,
        zIndex: 99999,
        maxWidth: 380,
        boxSizing: "border-box",
        padding: "14px 18px",
        borderRadius: 14,
        border: "1px solid rgba(34, 197, 94, 0.55)",
        background:
          "linear-gradient(135deg, rgba(6, 78, 59, 0.95), rgba(15, 23, 42, 0.98))",
        color: "#dcfce7",
        fontWeight: 700,
        fontSize: 15,
        lineHeight: 1.45,
        boxShadow:
          "0 18px 45px rgba(0, 0, 0, 0.42), 0 0 0 1px rgba(34, 197, 94, 0.12) inset",
        animation: "cpu-task-live-toast-in 0.38s ease-out",
      }}
    >
      <div style={{ color: "#86efac", fontSize: 11, letterSpacing: 0.06, marginBottom: 6 }}>TASK</div>
      {toast.message}
    </div>
  );
}
