"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import {
  fetchPeerNotifyInbox,
  pushPeerNotifyItem,
  replacePeerNotifyInbox,
} from "@/lib/api";
import { CPU_AUTH_CHANGED_EVENT, isLoggedIn } from "@/lib/auth";
import { CPU_TENANT_CHANGED_EVENT } from "@/lib/tenantEvents";
import type { PeerNotificationKind, PeerNotificationItem } from "@/lib/peerNotificationsTypes";

export type { PeerNotificationKind, PeerNotificationItem };

const MAX_ITEMS = 60;
const INBOX_POLL_MS = 5500;

function skipInboxPollingPath(pathname: string | null): boolean {
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

type PeerNotificationsContextValue = {
  items: PeerNotificationItem[];
  hasUnread: boolean;
  unreadCount: number;
  emitTask: (payload: { logId: string; message: string }) => void;
  emitOrder: (payload: { orderId: string; message: string }) => void;
  markAllRead: () => void;
  clearAll: () => void;
};

const PeerNotificationsContext = createContext<PeerNotificationsContextValue | null>(null);

async function fetchInboxOrEmpty(): Promise<PeerNotificationItem[]> {
  try {
    const out = await fetchPeerNotifyInbox();
    return (out.items || []).slice(0, MAX_ITEMS);
  } catch {
    return [];
  }
}

function applySerializedIfDifferent(
  next: PeerNotificationItem[],
  ref: React.MutableRefObject<string>,
  setItems: (v: PeerNotificationItem[]) => void,
): void {
  const ser = JSON.stringify(next);
  if (ref.current === ser) return;
  ref.current = ser;
  setItems(next);
}

export function PeerNotificationsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [items, setItems] = useState<PeerNotificationItem[]>([]);
  const [authTick, setAuthTick] = useState(0);
  const serializedRef = useRef("");

  useEffect(() => {
    function bump() {
      setAuthTick((n) => n + 1);
    }
    window.addEventListener(CPU_AUTH_CHANGED_EVENT, bump);
    window.addEventListener(CPU_TENANT_CHANGED_EVENT, bump);
    return () => {
      window.removeEventListener(CPU_AUTH_CHANGED_EVENT, bump);
      window.removeEventListener(CPU_TENANT_CHANGED_EVENT, bump);
    };
  }, []);

  const pullFromServer = useCallback(async () => {
    if (!isLoggedIn()) return;
    const next = await fetchInboxOrEmpty();
    applySerializedIfDifferent(next, serializedRef, setItems);
  }, []);

  /** Auth / tenant switch: reload immediately. */
  useEffect(() => {
    if (!isLoggedIn()) {
      serializedRef.current = "";
      setItems([]);
      return;
    }
    void pullFromServer();
  }, [authTick, pullFromServer]);

  /** Periodic + tab-focus sync so other devices see updates quickly. */
  useEffect(() => {
    if (!isLoggedIn()) return;
    if (skipInboxPollingPath(pathname)) return;

    let cancelled = false;

    async function poll() {
      if (cancelled) return;
      if (!isLoggedIn()) return;
      if (typeof document !== "undefined" && document.hidden) return;
      const next = await fetchInboxOrEmpty();
      if (cancelled) return;
      applySerializedIfDifferent(next, serializedRef, setItems);
    }

    const intervalId = setInterval(() => void poll(), INBOX_POLL_MS);
    function onVisibility() {
      if (document.visibilityState === "visible")
        void poll();
    }
    document.addEventListener("visibilitychange", onVisibility);
    void poll();

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [pathname, authTick]);

  const emitTask = useCallback((payload: { logId: string; message: string }) => {
    if (!isLoggedIn()) return;
    const id = `task:${String(payload.logId || "").trim()}`;
    if (!id || id === "task:") return;

    const row: PeerNotificationItem = {
      id,
      kind: "task",
      message: payload.message,
      at: new Date().toISOString(),
      read: false,
    };

    setItems((prev) => {
      if (prev.some((x) => x.id === row.id)) return prev;
      return [row, ...prev].slice(0, MAX_ITEMS);
    });

    void pushPeerNotifyItem(row)
      .then((out: { items: PeerNotificationItem[] }) => {
        const next = (out.items || []).slice(0, MAX_ITEMS);
        applySerializedIfDifferent(next, serializedRef, setItems);
      })
      .catch(() => {});
  }, []);

  const emitOrder = useCallback((payload: { orderId: string; message: string }) => {
    if (!isLoggedIn()) return;
    const id = `order:${String(payload.orderId || "").trim()}`;
    if (!id || id === "order:") return;

    const row: PeerNotificationItem = {
      id,
      kind: "order",
      message: payload.message,
      at: new Date().toISOString(),
      read: false,
    };

    setItems((prev) => {
      if (prev.some((x) => x.id === row.id)) return prev;
      return [row, ...prev].slice(0, MAX_ITEMS);
    });

    void pushPeerNotifyItem(row)
      .then((out: { items: PeerNotificationItem[] }) => {
        const next = (out.items || []).slice(0, MAX_ITEMS);
        applySerializedIfDifferent(next, serializedRef, setItems);
      })
      .catch(() => {});
  }, []);

  const markAllRead = useCallback(() => {
    setItems((prev) => {
      if (!prev.some((x) => !x.read)) return prev;
      const next = prev.map((x) => ({ ...x, read: true }));
      void replacePeerNotifyInbox(next)
        .then((out: { items: PeerNotificationItem[] }) => {
          const n = (out.items || []).slice(0, MAX_ITEMS);
          applySerializedIfDifferent(n, serializedRef, setItems);
        })
        .catch(() => {});
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setItems([]);
    serializedRef.current = JSON.stringify([]);
    void replacePeerNotifyInbox([])
      .then(() => {})
      .catch(() => {});
  }, []);

  const hasUnread = useMemo(() => items.some((x) => !x.read), [items]);
  const unreadCount = useMemo(() => items.filter((x) => !x.read).length, [items]);

  const value = useMemo(
    () => ({
      items,
      hasUnread,
      unreadCount,
      emitTask,
      emitOrder,
      markAllRead,
      clearAll,
    }),
    [items, hasUnread, unreadCount, emitTask, emitOrder, markAllRead, clearAll],
  );

  return (
    <PeerNotificationsContext.Provider value={value}>{children}</PeerNotificationsContext.Provider>
  );
}

export function usePeerNotifications(): PeerNotificationsContextValue {
  const ctx = useContext(PeerNotificationsContext);
  if (!ctx) {
    throw new Error("usePeerNotifications must be used within PeerNotificationsProvider");
  }
  return ctx;
}
