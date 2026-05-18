"use client";

import { useEffect, useRef } from "react";

export type VisibilityPollingOptions = {
  /** Poll callback — skipped when tab is hidden unless `runWhenHidden` is true. */
  onPoll: () => void | Promise<void>;
  /** Interval in ms. Set 0 to disable interval (focus-only). */
  intervalMs: number;
  /** Run once when tab becomes visible. Default true. */
  refreshOnVisible?: boolean;
  /** Run once shortly after mount when visible. Default false. */
  bootDelayMs?: number;
  enabled?: boolean;
};

/**
 * Interval polling that pauses while the document is hidden (saves Neon/API load).
 */
export function useVisibilityPolling({
  onPoll,
  intervalMs,
  refreshOnVisible = true,
  bootDelayMs = 0,
  enabled = true,
}: VisibilityPollingOptions): void {
  const onPollRef = useRef(onPoll);
  onPollRef.current = onPoll;

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    let cancelled = false;
    let inFlight = false;

    const tick = async () => {
      if (cancelled || inFlight) return;
      if (document.hidden) return;
      inFlight = true;
      try {
        await onPollRef.current();
      } finally {
        inFlight = false;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible" && refreshOnVisible) {
        void tick();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);

    let intervalId: ReturnType<typeof setInterval> | null = null;
    if (intervalMs > 0) {
      intervalId = setInterval(() => {
        void tick();
      }, intervalMs);
    }

    let bootId: ReturnType<typeof setTimeout> | null = null;
    if (bootDelayMs > 0) {
      bootId = setTimeout(() => {
        void tick();
      }, bootDelayMs);
    }

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (intervalId) clearInterval(intervalId);
      if (bootId) clearTimeout(bootId);
    };
  }, [enabled, intervalMs, refreshOnVisible, bootDelayMs]);
}
