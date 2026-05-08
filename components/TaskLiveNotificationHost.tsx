"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { apiRequest, fetchLatestTaskLogLive, getSelectedCompanyId } from "@/lib/api";
import { CPU_AUTH_CHANGED_EVENT, getAuthCompany, getAuthUser, isLoggedIn } from "@/lib/auth";
import { extractLiveTaskNotificationsEnabled } from "@/lib/taskNotificationsConfig";

function resolveCompanyIdForPolling(): string {
  const fromStorage = getSelectedCompanyId().trim();
  if (fromStorage) return fromStorage;
  return String(getAuthCompany()?.id || "").trim();
}

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

const POLL_INTERVAL_MS = 5500;

function actorShortLabel(actorEmail: string | null): string {
  const e = (actorEmail || "").trim();
  if (!e) return "Someone";
  const local = e.split("@")[0] || "";
  const pretty = local.replace(/[._]+/g, " ").trim();
  return pretty || "Someone";
}

/**
 * Polls `/api/logs/latest-live` and shows ephemeral green banners when a teammate completes a logged task.
 * Feature flag: `company.settings.liveTaskNotifications` (default on).
 */
export default function TaskLiveNotificationHost() {
  const pathname = usePathname();
  const [authBump, setAuthBump] = useState(0);
  const [toast, setToast] = useState<{ message: string; key: string } | null>(null);

  const settingsEnabledRef = useRef(true);
  const primedRef = useRef(false);
  const lastIdRef = useRef<string | null>(null);
  const hideToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    async function tick() {
      if (!isLoggedIn() || cancelled || document.visibilityState !== "visible") return;
      if (!settingsEnabledRef.current) return;

      const companyId = resolveCompanyIdForPolling();
      if (!companyId) return;

      try {
        const latest = await fetchLatestTaskLogLive(companyId);
        if (!latest || cancelled) return;

        if (!primedRef.current) {
          primedRef.current = true;
          lastIdRef.current = latest.id;
          return;
        }

        if (latest.id === lastIdRef.current) return;

        lastIdRef.current = latest.id;

        const selfId = String(getAuthUser()?.id || "").trim();
        const who =
          selfId && latest.actorUserId === selfId ? "You" : actorShortLabel(latest.actorEmail);
        const area = String(latest.area || "Workspace").trim() || "Workspace";
        const task = String(latest.task || "a task").trim() || "a task";
        const message = `${who} completed "${task}" · ${area}`;
        toastNow(message, `${latest.id}:${latest.createdAt}`);
      } catch {
        /* ignore polling failures */
      }
    }

    void tick();

    intervalId = setInterval(() => {
      void tick();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      dismissToastTimers();
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
