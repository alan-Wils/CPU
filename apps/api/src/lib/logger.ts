export function logInfo(event: string, payload: Record<string, unknown>): void {
  // Structured logs to keep cloud log ingestion straightforward.
  console.log(JSON.stringify({ level: "info", event, ts: new Date().toISOString(), ...payload }));
}

export function logError(event: string, payload: Record<string, unknown>): void {
  console.error(JSON.stringify({ level: "error", event, ts: new Date().toISOString(), ...payload }));
}
