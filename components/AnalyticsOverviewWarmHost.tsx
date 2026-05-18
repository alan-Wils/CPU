"use client";

import { useEffect, useRef } from "react";
import { CPU_AUTH_CHANGED_EVENT, isLoggedIn } from "@/lib/auth";
import { CPU_TENANT_CHANGED_EVENT } from "@/lib/tenantEvents";
import { defaultAnalyticsDateRange } from "@/lib/analyticsDefaultDateRange";
import { warmAnalyticsOverviewCache } from "@/lib/analyticsOverviewApi";

/** Prefetch analytics overview once per session (non-blocking). */
export default function AnalyticsOverviewWarmHost() {
  const warmedRef = useRef(false);

  useEffect(() => {
    function maybeWarm() {
      if (!isLoggedIn() || warmedRef.current) return;
      warmedRef.current = true;
      const { from, to } = defaultAnalyticsDateRange();
      warmAnalyticsOverviewCache({ from, to });
    }
    maybeWarm();
    window.addEventListener(CPU_AUTH_CHANGED_EVENT, maybeWarm);
    window.addEventListener(CPU_TENANT_CHANGED_EVENT, () => {
      warmedRef.current = false;
      maybeWarm();
    });
    return () => {
      window.removeEventListener(CPU_AUTH_CHANGED_EVENT, maybeWarm);
    };
  }, []);

  return null;
}
