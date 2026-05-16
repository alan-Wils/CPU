"use client";

import { useEffect } from "react";
import { fetchCachedCompanyConfig } from "@/lib/configClient";
import { syncCompanyTimezoneFromConfigPayload } from "@/lib/companyTimezone";

/**
 * Loads `/api/config/basic` once (when authenticated) and caches `company.settings.displayTimezone` for timestamp formatting app-wide.
 */
export default function CompanyTimezoneSync() {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchCachedCompanyConfig<unknown>("/api/config/basic");
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
