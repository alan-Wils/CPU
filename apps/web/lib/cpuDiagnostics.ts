import { getResolvedApiBaseUrl } from "./publicEnv";

/**
 * Opt-in diagnostics: set localStorage CPU_DEBUG_DIAG=1 (and reload) to log sync context.
 * Avoid enabling on shared machines if logs may contain sensitive identifiers.
 */
export function logCpuDiagnosticsIfEnabled(context: string, extra?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  try {
    if (String(window.localStorage.getItem("CPU_DEBUG_DIAG") || "") !== "1") return;
    // eslint-disable-next-line no-console
    console.info("[CPU_DIAG]", context, { apiBase: getResolvedApiBaseUrl(), ...extra });
  } catch {
    /* ignore */
  }
}
