/**
 * Product defaults for cash-log EOD digest (must stay aligned with `defaultCashLogEodPrefs`
 * in `apps/api/src/lib/cashLogEodPrefs.ts`). Used before GET `/api/cash-log/eod-prefs` loads.
 */
export const CASH_LOG_EOD_DEFAULT_TIMEZONE = "America/Denver" as const;
export const CASH_LOG_EOD_DEFAULT_SEND_TIME = "11:16" as const;

export function defaultCashLogEodPrefsUi(): {
  enabled: boolean;
  weekdays: number[];
  sendTime: string;
  window: "LAST_24H" | "LAST_7_DAYS";
  timezone: string;
} {
  return {
    enabled: false,
    weekdays: [1, 2, 3, 4, 5],
    sendTime: CASH_LOG_EOD_DEFAULT_SEND_TIME,
    window: "LAST_24H",
    timezone: CASH_LOG_EOD_DEFAULT_TIMEZONE,
  };
}
