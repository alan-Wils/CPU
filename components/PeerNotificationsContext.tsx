"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getSelectedCompanyId } from "@/lib/api";
import { CPU_AUTH_CHANGED_EVENT, getAuthUser, isLoggedIn } from "@/lib/auth";
import { CPU_TENANT_CHANGED_EVENT } from "@/lib/tenantEvents";

export type PeerNotificationKind = "task" | "order";

export type PeerNotificationItem = {
  id: string;
  kind: PeerNotificationKind;
  message: string;
  at: string;
  read: boolean;
};

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

const STORAGE_PREFIX = "cpu_home_notify_v1:";
const MAX_ITEMS = 60;

function storageKeyForScope(): string {
  const u = getAuthUser();
  if (!u || !isLoggedIn()) return "";
  const uid = String(u.id || "").trim();
  if (!uid) return "";
  const cid =
    String(getSelectedCompanyId() || "").trim() || String(u.companyId || "").trim() || "_";
  return `${STORAGE_PREFIX}${uid}:${cid}`;
}

function loadItems(key: string): PeerNotificationItem[] {
  if (typeof window === "undefined" || !key) return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { items?: unknown }).items))
      return [];
    const items = (parsed as { items: PeerNotificationItem[] }).items;
    return items.filter(
      (x) =>
        x &&
        typeof x.id === "string" &&
        (x.kind === "task" || x.kind === "order") &&
        typeof x.message === "string" &&
        typeof x.at === "string" &&
        typeof x.read === "boolean",
    );
  } catch {
    return [];
  }
}

function saveItems(key: string, items: PeerNotificationItem[]) {
  if (typeof window === "undefined" || !key) return;
  try {
    window.localStorage.setItem(key, JSON.stringify({ items }));
  } catch {
    /* ignore quota */
  }
}

export function PeerNotificationsProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<PeerNotificationItem[]>([]);
  const [authTick, setAuthTick] = useState(0);
  const scopeKeyRef = useRef("");

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

  useEffect(() => {
    const key = storageKeyForScope();
    scopeKeyRef.current = key;
    if (!key) {
      setItems([]);
      return;
    }
    setItems(loadItems(key));
  }, [authTick]);

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      const key = scopeKeyRef.current;
      if (!key || e.key !== key) return;
      setItems(loadItems(key));
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const persist = useCallback((key: string, next: PeerNotificationItem[]) => {
    if (!key) return;
    scopeKeyRef.current = key;
    saveItems(key, next);
  }, []);

  const emitTask = useCallback(
    (payload: { logId: string; message: string }) => {
      const key = storageKeyForScope();
      if (!key) return;
      const id = `task:${String(payload.logId || "").trim()}`;
      if (!id || id === "task:") return;
      setItems((prev) => {
        if (prev.some((x) => x.id === id)) return prev;
        const row: PeerNotificationItem = {
          id,
          kind: "task",
          message: payload.message,
          at: new Date().toISOString(),
          read: false,
        };
        const next = [row, ...prev].slice(0, MAX_ITEMS);
        persist(key, next);
        return next;
      });
    },
    [persist],
  );

  const emitOrder = useCallback(
    (payload: { orderId: string; message: string }) => {
      const key = storageKeyForScope();
      if (!key) return;
      const id = `order:${String(payload.orderId || "").trim()}`;
      if (!id || id === "order:") return;
      setItems((prev) => {
        if (prev.some((x) => x.id === id)) return prev;
        const row: PeerNotificationItem = {
          id,
          kind: "order",
          message: payload.message,
          at: new Date().toISOString(),
          read: false,
        };
        const next = [row, ...prev].slice(0, MAX_ITEMS);
        persist(key, next);
        return next;
      });
    },
    [persist],
  );

  const markAllRead = useCallback(() => {
    const key = storageKeyForScope();
    if (!key) return;
    setItems((prev) => {
      if (!prev.some((x) => !x.read)) return prev;
      const next = prev.map((x) => ({ ...x, read: true }));
      persist(key, next);
      return next;
    });
  }, [persist]);

  const clearAll = useCallback(() => {
    const key = storageKeyForScope();
    if (!key) {
      setItems([]);
      return;
    }
    setItems([]);
    persist(key, []);
  }, [persist]);

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
