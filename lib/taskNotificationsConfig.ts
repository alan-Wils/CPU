/**
 * `company.settings.liveTaskNotifications` — green peer task banners across the SPA.
 * When explicitly `false`, disabled; default is on (omit or unknown → true).
 */
export function extractLiveTaskNotificationsEnabled(config: unknown): boolean {
  const o = config && typeof config === "object" ? (config as Record<string, unknown>) : null;
  const company = o?.company && typeof o.company === "object" ? (o.company as Record<string, unknown>) : null;
  const settings =
    company?.settings && typeof company.settings === "object"
      ? (company.settings as Record<string, unknown>)
      : null;
  if (!settings || settings.liveTaskNotifications === undefined) return true;
  return settings.liveTaskNotifications !== false;
}
