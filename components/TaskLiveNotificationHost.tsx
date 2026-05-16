"use client";

import {
  defaultPagePermissionsForRole,
  hasAppPermission,
  isOwnerOrAdminRole,
} from "@cpu/shared";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { usePathname } from "next/navigation";
import { usePeerNotifications } from "@/components/PeerNotificationsContext";
import { fetchLatestOrderLive, fetchLatestTaskLogLive } from "@/lib/api";
import { fetchCachedCompanyConfig } from "@/lib/configClient";
import { CPU_AUTH_CHANGED_EVENT, getAuthUser, isLoggedIn } from "@/lib/auth";
import {
  extractLiveOrderNotificationsEnabled,
  extractLiveTaskNotificationsEnabled,
} from "@/lib/taskNotificationsConfig";

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

function canPollOrdersApi(): boolean {
  const u = getAuthUser();
  if (!u) return false;
  const role = String(u.role || "").toUpperCase();
  if (isOwnerOrAdminRole(role)) return true;
  const perms = Array.isArray(u.permissions) ? u.permissions : defaultPagePermissionsForRole(role);
  return hasAppPermission(perms, "page.orders");
}

function formatUsd(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

/** Public label for the task actor on every device. */
function actorBroadcastLabel(actorEmail: string | null): string {
  const e = (actorEmail || "").trim();
  if (!e) return "Someone";
  const local = e.split("@")[0] || "";
  const pretty = local.replace(/[._]+/g, " ").trim();
  return pretty || "Someone";
}

function flushPending(
  pending: MutableRefObject<{ message: string; key: string } | null>,
  show: (message: string, key: string) => void,
): void {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
  const p = pending.current;
  if (!p) return;
  pending.current = null;
  show(p.message, p.key);
}

type ToastLine = { message: string; key: string };

/**
 * Polls `/api/logs/latest-live` and `/api/orders/latest-live` (JWT tenant). Task + LeafLink order popups.
 */
export default function TaskLiveNotificationHost() {
  const pathname = usePathname();
  const { emitTask, emitOrder } = usePeerNotifications();
  const [authBump, setAuthBump] = useState(0);
  const [taskToast, setTaskToast] = useState<ToastLine | null>(null);
  const [orderToast, setOrderToast] = useState<ToastLine | null>(null);

  const taskNotifEnabledRef = useRef(true);
  const orderNotifEnabledRef = useRef(true);

  const taskPrimedRef = useRef(false);
  const taskLastIdRef = useRef<string | null>(null);
  const pendingTaskRef = useRef<ToastLine | null>(null);

  const orderPrimedRef = useRef(false);
  /** Stable LeafLink order key — internal DB `id` changes meaning when “latest” is sorted wrong during sync. */
  const orderLastLeafLinkKeyRef = useRef<string | null>(null);
  const pendingOrderRef = useRef<ToastLine | null>(null);

  const hideTaskTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideOrderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function bump() {
      setAuthBump((n) => n + 1);
    }
    window.addEventListener(CPU_AUTH_CHANGED_EVENT, bump);
    return () => window.removeEventListener(CPU_AUTH_CHANGED_EVENT, bump);
  }, []);

  useEffect(() => {
    taskNotifEnabledRef.current = true;
    orderNotifEnabledRef.current = true;

    let cancelled = false;
    async function refreshSettings() {
      if (!isLoggedIn()) {
        taskNotifEnabledRef.current = true;
        orderNotifEnabledRef.current = true;
        return;
      }
      try {
        const data = await fetchCachedCompanyConfig<unknown>("/api/config/basic");
        if (!cancelled) {
          taskNotifEnabledRef.current = extractLiveTaskNotificationsEnabled(data);
          orderNotifEnabledRef.current = extractLiveOrderNotificationsEnabled(data);
        }
      } catch {
        if (!cancelled) {
          taskNotifEnabledRef.current = true;
          orderNotifEnabledRef.current = true;
        }
      }
    }

    void refreshSettings();
    const onVis = () => {
      if (document.visibilityState === "visible")
        void refreshSettings();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [authBump]);

  useEffect(() => {
    taskPrimedRef.current = false;
    taskLastIdRef.current = null;
    pendingTaskRef.current = null;
    orderPrimedRef.current = false;
    orderLastLeafLinkKeyRef.current = null;
    pendingOrderRef.current = null;

    if (!isLoggedIn() || skipListeningForPath(pathname)) return;

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    function clearTaskTimer() {
      if (hideTaskTimerRef.current) {
        clearTimeout(hideTaskTimerRef.current);
        hideTaskTimerRef.current = null;
      }
    }
    function clearOrderTimer() {
      if (hideOrderTimerRef.current) {
        clearTimeout(hideOrderTimerRef.current);
        hideOrderTimerRef.current = null;
      }
    }

    function toastTaskNow(message: string, key: string) {
      clearTaskTimer();
      setTaskToast({ message, key });
      hideTaskTimerRef.current = setTimeout(() => {
        setTaskToast(null);
        hideTaskTimerRef.current = null;
      }, 6500);
    }

    function toastOrderNow(message: string, key: string) {
      clearOrderTimer();
      setOrderToast({ message, key });
      hideOrderTimerRef.current = setTimeout(() => {
        setOrderToast(null);
        hideOrderTimerRef.current = null;
      }, 6500);
    }

    async function syncTaskPoll() {
      if (!isLoggedIn() || cancelled) return;
      if (!taskNotifEnabledRef.current) return;

      try {
        const latest = await fetchLatestTaskLogLive();
        if (!latest || cancelled) return;

        if (!taskPrimedRef.current) {
          taskPrimedRef.current = true;
          taskLastIdRef.current = latest.id;
          return;
        }

        if (latest.id === taskLastIdRef.current) return;

        taskLastIdRef.current = latest.id;

        const who = actorBroadcastLabel(latest.actorEmail);
        const area = String(latest.area || "Workspace").trim() || "Workspace";
        const task = String(latest.task || "a task").trim() || "a task";
        const message = `${who} performed "${task}" · ${area}`;
        const key = `${latest.id}:${latest.createdAt}`;

        emitTask({ logId: latest.id, message });

        if (typeof document !== "undefined" && document.visibilityState === "visible") {
          toastTaskNow(message, key);
        } else {
          pendingTaskRef.current = { message, key };
        }
      } catch {
        /* ignore */
      }
    }

    async function syncOrderPoll() {
      if (!isLoggedIn() || cancelled) return;
      if (!orderNotifEnabledRef.current) return;
      if (!canPollOrdersApi()) return;

      try {
        const latest = await fetchLatestOrderLive();
        if (cancelled) return;

        if (!latest) {
          if (!orderPrimedRef.current) {
            orderPrimedRef.current = true;
            orderLastLeafLinkKeyRef.current = null;
          }
          return;
        }

        const stableKey = String(latest.leafLinkKey || "").trim() || latest.id;

        if (!orderPrimedRef.current) {
          orderPrimedRef.current = true;
          orderLastLeafLinkKeyRef.current = stableKey;
          return;
        }

        if (stableKey === orderLastLeafLinkKeyRef.current) return;

        orderLastLeafLinkKeyRef.current = stableKey;

        const buyer = String(latest.customerName || "").trim() || "Customer";
        const amt = formatUsd(latest.totalUsd);
        const message = `New order: ${buyer} · ${amt}`;
        const key = `ord:${stableKey}`;

        emitOrder({ orderId: stableKey, message });

        if (typeof document !== "undefined" && document.visibilityState === "visible") {
          toastOrderNow(message, key);
        } else {
          pendingOrderRef.current = { message, key };
        }
      } catch {
        /* ignore */
      }
    }

    async function syncAll() {
      if (typeof document !== "undefined" && document.hidden) return;
      await syncTaskPoll();
      await syncOrderPoll();
    }

    function onVisibilityOrFocus() {
      if (cancelled) return;
      flushPending(pendingTaskRef, toastTaskNow);
      flushPending(pendingOrderRef, toastOrderNow);
      void syncAll();
    }

    void syncAll();

    intervalId = setInterval(() => {
      void syncAll();
    }, POLL_INTERVAL_MS);

    document.addEventListener("visibilitychange", onVisibilityOrFocus);
    window.addEventListener("focus", onVisibilityOrFocus);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityOrFocus);
      window.removeEventListener("focus", onVisibilityOrFocus);
      clearTaskTimer();
      clearOrderTimer();
      pendingTaskRef.current = null;
      pendingOrderRef.current = null;
    };
  }, [pathname, authBump, emitTask, emitOrder]);

  useEffect(() => {
    return () => {
      if (hideTaskTimerRef.current) clearTimeout(hideTaskTimerRef.current);
      if (hideOrderTimerRef.current) clearTimeout(hideOrderTimerRef.current);
    };
  }, []);

  const showTask = Boolean(taskToast);
  const showOrder = Boolean(orderToast);
  const orderBottom = showTask ? 118 : 28;
  const taskBottom = 28;

  if (!showTask && !showOrder) return null;

  return (
    <>
      {showOrder && orderToast ? (
        <div
          key={orderToast.key}
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            right: 20,
            bottom: orderBottom,
            zIndex: 99999,
            maxWidth: 380,
            boxSizing: "border-box",
            padding: "14px 18px",
            borderRadius: 14,
            border: "1px solid rgba(245, 158, 11, 0.55)",
            background:
              "linear-gradient(135deg, rgba(120, 53, 15, 0.92), rgba(15, 23, 42, 0.98))",
            color: "#ffedd5",
            fontWeight: 700,
            fontSize: 15,
            lineHeight: 1.45,
            boxShadow:
              "0 18px 45px rgba(0, 0, 0, 0.42), 0 0 0 1px rgba(245, 158, 11, 0.12) inset",
            animation: "cpu-task-live-toast-in 0.38s ease-out",
          }}
        >
          <div style={{ color: "#fcd34d", fontSize: 11, letterSpacing: 0.06, marginBottom: 6 }}>ORDER</div>
          {orderToast.message}
        </div>
      ) : null}
      {showTask && taskToast ? (
        <div
          key={taskToast.key}
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            right: 20,
            bottom: taskBottom,
            zIndex: 99998,
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
          {taskToast.message}
        </div>
      ) : null}
    </>
  );
}
