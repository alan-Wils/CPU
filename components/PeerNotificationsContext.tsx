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
  fetchPeerNotifyUnreadCount,
  pushPeerNotifyItem,
  replacePeerNotifyInbox,
} from "@/lib/api";
import { CPU_AUTH_CHANGED_EVENT, isLoggedIn } from "@/lib/auth";
import { CPU_TENANT_CHANGED_EVENT } from "@/lib/tenantEvents";
import { useVisibilityPolling } from "@/lib/useVisibilityPolling";
import type { PeerNotificationKind, PeerNotificationItem } from "@/lib/peerNotificationsTypes";

export type { PeerNotificationKind, PeerNotificationItem };

const MAX_ITEMS = 60;
/** Lightweight unread badge — full inbox loads when the bell opens. */
const UNREAD_POLL_MS = 60_000;

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
  /** Fetch full inbox (dropdown open). */
  loadFullInbox: () => Promise<void>;
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
  const [unreadCount, setUnreadCount] = useState(0);
  const [authTick, setAuthTick] = useState(0);
  const serializedRef = useRef("");
  const inboxLoadedRef = useRef(false);

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

  const pollUnreadCount = useCallback(async () => {
    if (!isLoggedIn()) return;
    try {
      const out = await fetchPeerNotifyUnreadCount();
      setUnreadCount(Math.max(0, Number(out.unreadCount) || 0));
    } catch {
      /* keep last count */
    }
  }, []);

  const loadFullInbox = useCallback(async () => {
    if (!isLoggedIn()) return;
    const next = await fetchInboxOrEmpty();
    inboxLoadedRef.current = true;
    applySerializedIfDifferent(next, serializedRef, setItems);
    setUnreadCount(next.filter((x) => !x.read).length);
  }, []);

  useEffect(() => {
    if (!isLoggedIn()) {
      serializedRef.current = "";
      inboxLoadedRef.current = false;
      setItems([]);
      setUnreadCount(0);
      return;
    }
    inboxLoadedRef.current = false;
    void pollUnreadCount();
  }, [authTick, pollUnreadCount]);

  const pollingEnabled = isLoggedIn() && !skipInboxPollingPath(pathname);

  useVisibilityPolling({
    enabled: pollingEnabled,
    intervalMs: UNREAD_POLL_MS,
    refreshOnVisible: true,
    onPoll: pollUnreadCount,
  });

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

    setUnreadCount((c) => c + 1);
    if (inboxLoadedRef.current) {
      setItems((prev) => {
        if (prev.some((x) => x.id === row.id)) return prev;
        return [row, ...prev].slice(0, MAX_ITEMS);
      });
    }

    void pushPeerNotifyItem(row)
      .then((out: { items: PeerNotificationItem[] }) => {
        if (!inboxLoadedRef.current) {
          setUnreadCount(out.items.filter((x) => !x.read).length);
          return;
        }
        const next = (out.items || []).slice(0, MAX_ITEMS);
        applySerializedIfDifferent(next, serializedRef, setItems);
        setUnreadCount(next.filter((x) => !x.read).length);
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

    setUnreadCount((c) => c + 1);
    if (inboxLoadedRef.current) {
      setItems((prev) => {
        if (prev.some((x) => x.id === row.id)) return prev;
        return [row, ...prev].slice(0, MAX_ITEMS);
      });
    }

    void pushPeerNotifyItem(row)
      .then((out: { items: PeerNotificationItem[] }) => {
        if (!inboxLoadedRef.current) {
          setUnreadCount(out.items.filter((x) => !x.read).length);
          return;
        }
        const next = (out.items || []).slice(0, MAX_ITEMS);
        applySerializedIfDifferent(next, serializedRef, setItems);
        setUnreadCount(next.filter((x) => !x.read).length);
      })
      .catch(() => {});
  }, []);

  const markAllRead = useCallback(() => {
    setUnreadCount(0);
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
    setUnreadCount(0);
    serializedRef.current = JSON.stringify([]);
    void replacePeerNotifyInbox([])
      .then(() => {})
      .catch(() => {});
  }, []);

  const hasUnread = unreadCount > 0;

  const value = useMemo(
    () => ({
      items,
      hasUnread,
      unreadCount,
      loadFullInbox,
      emitTask,
      emitOrder,
      markAllRead,
      clearAll,
    }),
    [items, hasUnread, unreadCount, loadFullInbox, emitTask, emitOrder, markAllRead, clearAll],
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
