import { logInfo } from "./logger.js";

export type SlowRequestParts = {
  label: string;
  companyId?: string;
  dbMs?: number;
  serializeMs?: number;
  payloadBytes?: number;
  cacheHit?: boolean;
  inflightJoined?: boolean;
  rowCount?: number;
  extra?: Record<string, unknown>;
};

const SLOW_MS = 500;

export function logSlowRequestIfNeeded(parts: SlowRequestParts): void {
  const total =
    (parts.dbMs ?? 0) + (parts.serializeMs ?? 0);
  if (total < SLOW_MS && (parts.payloadBytes ?? 0) < 75_000) return;

  logInfo("[API] slow_request", {
    label: parts.label,
    companyId: parts.companyId ? `${parts.companyId.slice(0, 8)}…` : undefined,
    dbMs: parts.dbMs,
    serializeMs: parts.serializeMs,
    payloadBytes: parts.payloadBytes,
    cacheHit: parts.cacheHit,
    inflightJoined: parts.inflightJoined,
    rowCount: parts.rowCount,
    ...parts.extra,
  });
}
