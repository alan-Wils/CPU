/** Local calendar bounds for analytics `<input type="date">` defaults. */
function toYmdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** First day of the month containing `now`, through `now` (same local calendar day). */
export function defaultAnalyticsDateRange(now: Date = new Date()): { from: string; to: string } {
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: toYmdLocal(from), to: toYmdLocal(now) };
}
