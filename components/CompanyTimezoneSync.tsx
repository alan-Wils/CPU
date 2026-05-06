"use client";

import { useEffect } from "react";
import { apiRequest } from "@/lib/api";
import { syncCompanyTimezoneFromConfigPayload } from "@/lib/companyTimezone";

/**
 * Loads `/api/config` once (when authenticated) and caches `company.settings.displayTimezone` for timestamp formatting app-wide.
 */
export default function CompanyTimezoneSync() {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiRequest("/api/config");
        if (!cancelled && data && typeof data === "object") {
          syncCompanyTimezoneFromConfigPayload(data);
        }
      } catch {
        /* offline / pre-login */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
