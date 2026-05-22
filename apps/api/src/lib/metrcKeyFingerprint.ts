/** First/last 4 chars only — never log full METRC secrets. */
export function formatMetrcKeyFingerprint(value: string): string {
  const v = String(value || "").trim();
  if (!v) return "(empty)";
  if (v.length <= 8) return "****";
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}
