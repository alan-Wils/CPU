"use client";

import { useEffect, useRef, useState } from "react";
import { isLoggedIn } from "@/lib/auth";
import { usePeerNotifications } from "@/components/PeerNotificationsContext";

function formatShortTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    return sameDay
      ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
      : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

/** Home header: inbox for peer task/order live events (paired with {@link TaskLiveNotificationHost}). */
export default function HomeNotificationBell() {
  const { items, hasUnread, unreadCount, markAllRead, clearAll } = usePeerNotifications();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    markAllRead();
  }, [open, markAllRead]);

  useEffect(() => {
    if (!open) return;
    function onDoc(ev: MouseEvent) {
      const el = wrapRef.current;
      if (!el?.contains(ev.target as Node)) setOpen(false);
    }
    function onEscape(ev: KeyboardEvent) {
      if (ev.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  if (!isLoggedIn()) return null;

  return (
    <div ref={wrapRef} style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        aria-label={hasUnread ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          position: "relative",
          width: 46,
          height: 46,
          borderRadius: 14,
          border: `1px solid ${hasUnread ? "rgba(34, 197, 94, 0.55)" : "rgba(148, 163, 184, 0.35)"}`,
          background: hasUnread
            ? "linear-gradient(145deg, rgba(6, 78, 59, 0.55), rgba(15, 23, 42, 0.95))"
            : "rgba(15, 23, 42, 0.75)",
          color: hasUnread ? "#bbf7d0" : "#94a3b8",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: hasUnread
            ? "0 0 20px rgba(34, 197, 94, 0.2), inset 0 1px 0 rgba(255,255,255,0.06)"
            : "inset 0 1px 0 rgba(255,255,255,0.04)",
        }}
        className={hasUnread ? "home-notify-bell--pulse" : undefined}
      >
        <BellIcon />

        {unreadCount > 0 ? (
          <span
            style={{
              position: "absolute",
              top: 4,
              right: 4,
              minWidth: 18,
              height: 18,
              padding: "0 5px",
              borderRadius: 999,
              background: "#22c55e",
              color: "#022c22",
              fontSize: 11,
              fontWeight: 900,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              lineHeight: 1,
              boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
            }}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Workspace notifications"
          style={{
            position: "absolute",
            top: "calc(100% + 10px)",
            right: 0,
            width: "min(400px, calc(100vw - 48px))",
            maxWidth: 400,
            zIndex: 50,
            borderRadius: 16,
            border: "1px solid rgba(148, 163, 184, 0.28)",
            background: "linear-gradient(180deg, rgba(15,23,42,0.98), rgba(2,6,23,0.99))",
            boxShadow:
              "0 24px 60px rgba(0,0,0,0.45), 0 0 0 1px rgba(34, 197, 94, 0.08) inset",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "14px 16px",
              borderBottom: "1px solid rgba(148, 163, 184, 0.15)",
            }}
          >
            <div style={{ fontWeight: 900, fontSize: 16, color: "#f1f5f9" }}>Notifications</div>
            {items.length > 0 ? (
              <button
                type="button"
                onClick={() => clearAll()}
                style={{
                  fontSize: 13,
                  fontWeight: 800,
                  color: "#86efac",
                  background: "rgba(34, 197, 94, 0.12)",
                  border: "1px solid rgba(34, 197, 94, 0.35)",
                  borderRadius: 10,
                  padding: "6px 12px",
                  cursor: "pointer",
                }}
              >
                Clear all
              </button>
            ) : null}
          </div>

          <div
            style={{
              maxHeight: 320,
              overflowY: "auto",
              padding: items.length === 0 ? "28px 16px" : "8px 0",
            }}
          >
            {items.length === 0 ? (
              <p style={{ margin: 0, color: "#64748b", fontSize: 14, textAlign: "center", lineHeight: 1.5 }}>
                No notifications yet. When teammates complete tasks or new orders arrive, they will show here.
              </p>
            ) : (
              <ul
                role="list"
                style={{ listStyle: "none", margin: 0, padding: 0 }}
              >
                {items.map((row) => (
                  <li
                    key={row.id}
                    style={{
                      padding: "11px 16px",
                      borderBottom: "1px solid rgba(30, 41, 59, 0.6)",
                      opacity: row.read ? 0.72 : 1,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 900,
                        letterSpacing: "0.08em",
                        color: row.kind === "order" ? "#fcd34d" : "#86efac",
                        marginBottom: 4,
                      }}
                    >
                      {row.kind === "order" ? "ORDER" : "TASK"}
                    </div>
                    <div style={{ color: "#e2e8f0", fontSize: 14, lineHeight: 1.45, fontWeight: 600 }}>
                      {row.message}
                    </div>
                    <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>{formatShortTime(row.at)}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BellIcon() {
  return (
    <svg
      width={22}
      height={22}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}
