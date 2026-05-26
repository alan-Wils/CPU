"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Nav from "@/components/Nav";
import PageAccessGate from "@/components/PageAccessGate";
import {
  API_BASE_URL,
  appendCompanyIdQuery,
  getSelectedCompanyId,
} from "@/lib/api";
import { getAuthToken, getAuthUser } from "@/lib/auth";
import { formatCompanyTimestamp } from "@/lib/companyTimezone";
import {
  METRC_EVALUATION_TASKS,
  buildEvaluationCreateRequestBody,
  clearEvaluationState,
  downloadEvaluationJson,
  loadEvaluationState,
  newHistoryId,
  reconcileEvaluationState,
  saveEvaluationState,
  taskStatusColor,
  taskStatusLabel,
  type MetrcEvaluationState,
  type MetrcEvaluationTaskId,
  type MetrcEvaluationTaskRecord,
  type MetrcEvaluationTaskStatus,
  type MetrcRequestHistoryEntry,
} from "@/lib/metrcEvaluation";
import { downloadEvaluationSpreadsheet } from "@/lib/metrcEvaluationExport";

const RUNNABLE_SYNC_TASKS: MetrcEvaluationTaskId[] = [
  "facilities_sync",
  "locations_sync",
  "strains_sync",
  "packages_sync",
  "plant_batches_sync",
  "harvests_sync",
  "transfers_sync",
];

const styles = {
  page: {
    minHeight: "100vh",
    background: "linear-gradient(180deg, #0f172a 0%, #020617 100%)",
    color: "#e2e8f0",
    padding: "24px 20px 48px",
  },
  header: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 16,
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 24,
  },
  title: { margin: "8px 0 0", fontSize: 28, fontWeight: 800, color: "#f8fafc" },
  subtitle: { margin: "8px 0 0", color: "#94a3b8", maxWidth: 720, lineHeight: 1.5 },
  card: {
    background: "rgba(15, 23, 42, 0.85)",
    border: "1px solid #334155",
    borderRadius: 14,
    padding: 20,
    marginBottom: 20,
  },
  row: { display: "flex", flexWrap: "wrap" as const, gap: 10, alignItems: "center" },
  btn: {
    border: "1px solid #475569",
    background: "rgba(30, 41, 59, 0.9)",
    color: "#e2e8f0",
    borderRadius: 10,
    padding: "8px 14px",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
  },
  btnPrimary: {
    border: "1px solid rgba(56, 189, 248, 0.55)",
    background: "rgba(8, 47, 73, 0.65)",
    color: "#7dd3fc",
  },
  btnDanger: {
    border: "1px solid rgba(248, 113, 113, 0.45)",
    color: "#fecaca",
  },
  table: { width: "100%", borderCollapse: "collapse" as const, fontSize: 13, marginTop: 12 },
  th: {
    textAlign: "left" as const,
    padding: "10px 8px",
    borderBottom: "1px solid #334155",
    color: "#94a3b8",
    fontSize: 11,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  },
  td: { padding: "10px 8px", borderBottom: "1px solid #1e293b", verticalAlign: "top" as const },
  mono: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: 11,
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
    background: "rgba(2, 6, 23, 0.65)",
    border: "1px solid #1e293b",
    borderRadius: 8,
    padding: 10,
    maxHeight: 220,
    overflow: "auto",
    color: "#cbd5e1",
  },
  badge: (color: string) => ({
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 800,
    color: "#0f172a",
    background: color,
  }),
  taskCard: {
    border: "1px solid #334155",
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    background: "rgba(2, 6, 23, 0.35)",
  },
};

async function authFetch(path: string, init?: RequestInit) {
  const token = getAuthToken();
  const companyId = getSelectedCompanyId();
  const url = `${API_BASE_URL}${appendCompanyIdQuery(path, companyId)}`;
  return fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
  });
}

function formatJson(value: unknown): string {
  if (value === null || value === undefined) return "—";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function displayUser(): string {
  const user = getAuthUser();
  if (!user) return "Unknown user";
  return user.email || user.username || user.id;
}

function extractMetrcStatus(responsePayload: unknown, httpStatus: number): number | null {
  if (responsePayload && typeof responsePayload === "object" && "status" in responsePayload) {
    const s = (responsePayload as { status?: unknown }).status;
    if (typeof s === "number") return s;
  }
  return httpStatus >= 400 ? httpStatus : null;
}

function extractMetrcEndpoint(responsePayload: unknown): string | null {
  if (responsePayload && typeof responsePayload === "object" && "endpoint" in responsePayload) {
    const ep = (responsePayload as { endpoint?: unknown }).endpoint;
    return typeof ep === "string" ? ep : null;
  }
  return null;
}

function isSuccessResponse(httpStatus: number, responsePayload: unknown): boolean {
  if (httpStatus < 200 || httpStatus >= 300) return false;
  if (responsePayload && typeof responsePayload === "object" && "ok" in responsePayload) {
    return Boolean((responsePayload as { ok?: boolean }).ok);
  }
  return true;
}

export default function MetrcEvaluationPage() {
  const companyId = getSelectedCompanyId() || "";
  const [state, setState] = useState<MetrcEvaluationState | null>(null);
  const [expandedTask, setExpandedTask] = useState<MetrcEvaluationTaskId | null>(null);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [runningTask, setRunningTask] = useState<MetrcEvaluationTaskId | null>(null);
  const [toast, setToast] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const persist = useCallback(
    (next: MetrcEvaluationState) => {
      saveEvaluationState(next);
      setState(next);
    },
    [],
  );

  useEffect(() => {
    if (!companyId) return;
    setState(reconcileEvaluationState(loadEvaluationState(companyId)));
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== `metrc_evaluation_v1:${companyId}`) return;
      setState(reconcileEvaluationState(loadEvaluationState(companyId)));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [companyId]);

  const summary = useMemo(() => {
    if (!state) return { passed: 0, failed: 0, pending: 0, notAvailable: 0 };
    const tasks = Object.values(state.tasks);
    return {
      passed: tasks.filter((t) => t.status === "passed").length,
      failed: tasks.filter((t) => t.status === "failed").length,
      pending: tasks.filter((t) => t.status === "pending").length,
      notAvailable: tasks.filter((t) => t.status === "not_available").length,
    };
  }, [state]);

  const runTask = useCallback(
    async (taskId: MetrcEvaluationTaskId) => {
      if (!companyId) return;
      const current = loadEvaluationState(companyId);
      const def = METRC_EVALUATION_TASKS.find((t) => t.id === taskId);
      if (!def) return;

      setRunningTask(taskId);
      setToast(null);

      let requestPayload: Record<string, unknown> = {
        method: def.method,
        path: def.nexbatchPath,
        companyId,
        initiatedAt: new Date().toISOString(),
      };

      if (!def.runnable || !def.nexbatchPath) {
        const updatedAt = new Date().toISOString();
        const taskRecord: MetrcEvaluationTaskRecord = {
          ...current.tasks[taskId],
          status: "not_available",
          updatedAt,
          requestPayload,
          responsePayload: { message: def.notAvailableReason },
          metrcStatusCode: null,
          httpStatus: null,
          durationMs: 0,
          errorMessage: def.notAvailableReason ?? "Not available",
          nexbatchPath: def.nexbatchPath,
          metrcEndpoint: null,
        };
        const historyEntry: MetrcRequestHistoryEntry = {
          id: newHistoryId(),
          taskId,
          endpoint: def.nexbatchPath || `(planned) ${def.label}`,
          method: def.method,
          status: "failed",
          durationMs: 0,
          user: displayUser(),
          timestamp: updatedAt,
          httpStatus: null,
          metrcStatusCode: null,
          requestPayload,
          responsePayload: taskRecord.responsePayload,
          errorMessage: taskRecord.errorMessage,
        };
        persist({
          ...current,
          tasks: { ...current.tasks, [taskId]: taskRecord },
          requestHistory: [historyEntry, ...current.requestHistory].slice(0, 200),
        });
        setRunningTask(null);
        return;
      }

      const runningRecord: MetrcEvaluationTaskRecord = {
        ...current.tasks[taskId],
        status: "running",
        updatedAt: new Date().toISOString(),
        requestPayload,
        responsePayload: null,
        errorMessage: null,
      };
      persist({ ...current, tasks: { ...current.tasks, [taskId]: runningRecord } });

      const started = performance.now();
      let httpStatus = 0;
      let responsePayload: unknown = null;
      let errorMessage: string | null = null;

      let fetchInit: RequestInit = { method: def.method };
      if (def.method === "POST") {
        const body =
          taskId === "create_strain" ||
          taskId === "create_plant_batch" ||
          taskId === "create_harvest" ||
          taskId === "create_package" ||
          taskId === "transfers"
            ? buildEvaluationCreateRequestBody(taskId, current.tasks[taskId])
            : {};
        requestPayload = {
          ...requestPayload,
          body,
          source: "metrc_evaluation",
        };
        fetchInit = { method: "POST", body: JSON.stringify(body) };
      }

      try {
        const res = await authFetch(def.nexbatchPath, fetchInit);
        httpStatus = res.status;
        try {
          responsePayload = await res.json();
        } catch {
          responsePayload = { parseError: "Response was not JSON" };
        }
        const ok = isSuccessResponse(httpStatus, responsePayload);
        if (!ok) {
          let messageFromPayload: string | undefined;
          if (
            responsePayload &&
            typeof responsePayload === "object" &&
            "message" in responsePayload
          ) {
            const raw = (responsePayload as { message?: unknown }).message;
            if (raw != null) messageFromPayload = String(raw);
          }
          errorMessage = messageFromPayload ?? `Request failed (HTTP ${httpStatus})`;
        }
      } catch (err) {
        httpStatus = 0;
        errorMessage = err instanceof Error ? err.message : "Network error";
        responsePayload = { error: errorMessage };
      }

      const durationMs = Math.round(performance.now() - started);
      const metrcStatusCode = extractMetrcStatus(responsePayload, httpStatus);
      const metrcEndpoint = extractMetrcEndpoint(responsePayload);
      const passed = isSuccessResponse(httpStatus, responsePayload);
      const status: MetrcEvaluationTaskStatus = passed ? "passed" : "failed";
      const updatedAt = new Date().toISOString();

      const taskRecord: MetrcEvaluationTaskRecord = {
        ...current.tasks[taskId],
        status,
        updatedAt,
        requestPayload,
        responsePayload,
        metrcStatusCode,
        httpStatus: httpStatus || null,
        durationMs,
        errorMessage,
        nexbatchPath: def.nexbatchPath,
        metrcEndpoint,
      };

      const historyEntry: MetrcRequestHistoryEntry = {
        id: newHistoryId(),
        taskId,
        endpoint: def.nexbatchPath,
        method: def.method,
        status: passed ? "success" : httpStatus ? "failed" : "error",
        durationMs,
        user: displayUser(),
        timestamp: updatedAt,
        httpStatus: httpStatus || null,
        metrcStatusCode,
        requestPayload,
        responsePayload,
        errorMessage,
      };

      const latest = loadEvaluationState(companyId);
      persist({
        ...latest,
        tasks: { ...latest.tasks, [taskId]: taskRecord },
        requestHistory: [historyEntry, ...latest.requestHistory].slice(0, 200),
      });

      setRunningTask(null);
      setToast({
        tone: passed ? "ok" : "error",
        text: passed
          ? `${def.label} completed (${durationMs} ms).`
          : `${def.label} failed: ${errorMessage || "Unknown error"}`,
      });
    },
    [companyId, persist],
  );

  async function runAllSyncTasks() {
    for (const id of RUNNABLE_SYNC_TASKS) {
      await runTask(id);
    }
  }

  function handleResetChecklist() {
    if (!companyId) return;
    if (!window.confirm("Reset evaluation checklist and request history for this company?")) return;
    const empty = clearEvaluationState(companyId);
    setState(empty);
    setToast({ tone: "ok", text: "Evaluation state cleared." });
  }

  function handleExport() {
    if (!state) return;
    downloadEvaluationJson(state);
    setToast({ tone: "ok", text: "Evaluation JSON downloaded." });
  }

  async function handleExportSpreadsheet() {
    if (!state) return;
    try {
      let environment: string | null = null;
      let activeFacilityLicense: string | null = null;
      try {
        const res = await authFetch("/api/config/integrations");
        if (res.ok) {
          const json = (await res.json()) as {
            metrcEnvironment?: string;
            metrcLicenseNumberDisplay?: string;
          };
          environment = json.metrcEnvironment ?? null;
          activeFacilityLicense = json.metrcLicenseNumberDisplay ?? null;
        }
      } catch {
        // Metadata is optional; export still succeeds without config.
      }
      downloadEvaluationSpreadsheet(state, { environment, activeFacilityLicense });
      setToast({ tone: "ok", text: "Evaluation spreadsheet downloaded." });
    } catch {
      setToast({ tone: "error", text: "Failed to export evaluation spreadsheet" });
    }
  }

  if (!companyId) {
    return (
      <PageAccessGate allowedRoles={["OWNER", "ADMIN", "OPERATIONS_MANAGER"]}>
        <main style={styles.page}>
          <Nav />
          <p style={{ color: "#fbbf24" }}>Select a company workspace before using METRC Evaluation Mode.</p>
        </main>
      </PageAccessGate>
    );
  }

  return (
    <PageAccessGate allowedRoles={["OWNER", "ADMIN", "OPERATIONS_MANAGER"]}>
      <main style={styles.page}>
        <Nav />
        <header style={styles.header}>
          <div>
            <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
              <Link href="/admin" style={{ color: "#93c5fd", textDecoration: "none" }}>
                Admin
              </Link>
              {" / "}
              <Link href="/admin/config" style={{ color: "#93c5fd", textDecoration: "none" }}>
                Integrations
              </Link>
              {" / METRC Evaluation"}
            </p>
            <h1 style={styles.title}>METRC Evaluation Mode</h1>
            <p style={styles.subtitle}>
              Track certification and testing progress inside NexBatch. Results are stored in this browser per
              company (request payloads, responses, and METRC HTTP status). Export JSON or spreadsheet for
              auditors.
            </p>
          </div>
          <div style={{ ...styles.row, alignItems: "flex-start" }}>
            <Link
              href="/admin/integrations/metrc-sandbox"
              style={{ ...styles.btn, textDecoration: "none" }}
            >
              METRC Sandbox
            </Link>
            <Link href="/admin/config" style={{ ...styles.btn, textDecoration: "none" }}>
              Company Config
            </Link>
          </div>
        </header>

        {toast && (
          <div
            style={{
              marginBottom: 16,
              padding: 12,
              borderRadius: 10,
              border:
                toast.tone === "ok"
                  ? "1px solid rgba(34, 197, 94, 0.4)"
                  : "1px solid rgba(248, 113, 113, 0.45)",
              background:
                toast.tone === "ok" ? "rgba(6, 78, 59, 0.3)" : "rgba(69, 10, 10, 0.35)",
              color: toast.tone === "ok" ? "#bbf7d0" : "#fecaca",
            }}
          >
            {toast.text}
          </div>
        )}

        <section style={styles.card}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Progress summary</h2>
          <div style={{ ...styles.row, marginTop: 14, gap: 20 }}>
            <span>
              <strong style={{ color: "#4ade80" }}>{summary.passed}</strong> passed
            </span>
            <span>
              <strong style={{ color: "#f87171" }}>{summary.failed}</strong> failed
            </span>
            <span>
              <strong style={{ color: "#fbbf24" }}>{summary.pending}</strong> pending
            </span>
            <span>
              <strong style={{ color: "#94a3b8" }}>{summary.notAvailable}</strong> not available
            </span>
          </div>
          <div style={{ ...styles.row, marginTop: 16 }}>
            <button
              type="button"
              style={{ ...styles.btn, ...styles.btnPrimary }}
              disabled={!!runningTask}
              onClick={() => void runAllSyncTasks()}
            >
              Run all sync tasks
            </button>
            <button type="button" style={styles.btn} disabled={!state} onClick={handleExport}>
              Export JSON
            </button>
            <button
              type="button"
              style={styles.btn}
              disabled={!state}
              onClick={() => void handleExportSpreadsheet()}
            >
              Export spreadsheet
            </button>
            <button type="button" style={{ ...styles.btn, ...styles.btnDanger }} onClick={handleResetChecklist}>
              Reset all
            </button>
          </div>
        </section>

        <section style={styles.card}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Evaluation checklist</h2>
          <p style={{ color: "#94a3b8", fontSize: 13, marginTop: 8 }}>
            Each task records status, timestamp, NexBatch request summary, full API response, and METRC status
            code when returned by the server.
          </p>

          {!state ? (
            <p style={{ color: "#94a3b8" }}>Loading…</p>
          ) : (
            METRC_EVALUATION_TASKS.map((def) => {
              const task = state.tasks[def.id];
              const expanded = expandedTask === def.id;
              const isRunning = runningTask === def.id || task.status === "running";
              const canRetry = task.status === "failed" && def.runnable;
              const canRun = def.runnable && task.status !== "running";

              return (
                <div key={def.id} style={styles.taskCard}>
                  <div style={{ ...styles.row, justifyContent: "space-between" }}>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 15 }}>{def.label}</div>
                      <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>{def.description}</div>
                    </div>
                    <span style={styles.badge(taskStatusColor(task.status))}>
                      {taskStatusLabel(task.status)}
                    </span>
                  </div>

                  <div style={{ ...styles.row, marginTop: 10, fontSize: 12, color: "#94a3b8" }}>
                    {task.updatedAt && (
                      <span>
                        Updated:{" "}
                        {formatCompanyTimestamp(task.updatedAt)}
                      </span>
                    )}
                    {task.durationMs != null && <span>{task.durationMs} ms</span>}
                    {task.httpStatus != null && <span>HTTP {task.httpStatus}</span>}
                    {task.metrcStatusCode != null && <span>METRC {task.metrcStatusCode}</span>}
                    {task.metrcEndpoint && <span>METRC path: {task.metrcEndpoint}</span>}
                  </div>

                  {task.errorMessage && (
                    <p style={{ margin: "8px 0 0", fontSize: 12, color: "#fca5a5" }}>{task.errorMessage}</p>
                  )}

                  <div style={{ ...styles.row, marginTop: 12 }}>
                    {canRun && (
                      <button
                        type="button"
                        style={{ ...styles.btn, ...styles.btnPrimary }}
                        disabled={!!runningTask}
                        onClick={() => void runTask(def.id)}
                      >
                        {task.status === "pending" ? "Run" : "Run again"}
                      </button>
                    )}
                    {canRetry && (
                      <button
                        type="button"
                        style={styles.btn}
                        disabled={!!runningTask}
                        onClick={() => void runTask(def.id)}
                      >
                        Retry
                      </button>
                    )}
                    {isRunning && (
                      <span style={{ fontSize: 12, color: "#38bdf8" }}>Running…</span>
                    )}
                    <button
                      type="button"
                      style={{ ...styles.btn, marginLeft: "auto" }}
                      onClick={() => setExpandedTask(expanded ? null : def.id)}
                    >
                      {expanded ? "Hide details" : "Show details"}
                    </button>
                  </div>

                  {expanded && (
                    <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                      <div>
                        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Request payload</div>
                        <pre style={styles.mono}>{formatJson(task.requestPayload)}</pre>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Response payload</div>
                        <pre style={styles.mono}>{formatJson(task.responsePayload)}</pre>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </section>

        <section style={styles.card}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>METRC request history</h2>
          <p style={{ color: "#94a3b8", fontSize: 13, marginTop: 8 }}>
            Chronological log of evaluation and METRC Sandbox create-test runs (newest first). Retry failed
            operations from the checklist above.
          </p>

          {!state || state.requestHistory.length === 0 ? (
            <p style={{ color: "#64748b", marginTop: 12 }}>No requests recorded yet.</p>
          ) : (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Timestamp</th>
                  <th style={styles.th}>Endpoint</th>
                  <th style={styles.th}>Method</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Duration</th>
                  <th style={styles.th}>User</th>
                  <th style={styles.th}>METRC</th>
                  <th style={styles.th} />
                </tr>
              </thead>
              <tbody>
                {state.requestHistory.map((entry) => (
                  <Fragment key={entry.id}>
                    <tr>
                      <td style={styles.td}>
                        {formatCompanyTimestamp(entry.timestamp)}
                      </td>
                      <td style={styles.td}>
                        <code style={{ fontSize: 11 }}>{entry.endpoint}</code>
                        {entry.taskId && (
                          <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>{entry.taskId}</div>
                        )}
                      </td>
                      <td style={styles.td}>{entry.method}</td>
                      <td style={styles.td}>
                        <span
                          style={styles.badge(
                            entry.status === "success"
                              ? "#4ade80"
                              : entry.status === "failed"
                                ? "#f87171"
                                : "#fbbf24",
                          )}
                        >
                          {entry.status}
                        </span>
                        {entry.httpStatus != null && (
                          <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
                            HTTP {entry.httpStatus}
                          </div>
                        )}
                      </td>
                      <td style={styles.td}>{entry.durationMs} ms</td>
                      <td style={styles.td}>{entry.user}</td>
                      <td style={styles.td}>{entry.metrcStatusCode ?? "—"}</td>
                      <td style={styles.td}>
                        <button
                          type="button"
                          style={{ ...styles.btn, padding: "4px 8px", fontSize: 11 }}
                          onClick={() =>
                            setExpandedHistoryId(expandedHistoryId === entry.id ? null : entry.id)
                          }
                        >
                          {expandedHistoryId === entry.id ? "Hide" : "Payloads"}
                        </button>
                        {entry.status !== "success" && entry.taskId && (
                          <button
                            type="button"
                            style={{
                              ...styles.btn,
                              ...styles.btnPrimary,
                              padding: "4px 8px",
                              fontSize: 11,
                              marginLeft: 6,
                            }}
                            disabled={!!runningTask}
                            onClick={() => entry.taskId && void runTask(entry.taskId)}
                          >
                            Retry
                          </button>
                        )}
                      </td>
                    </tr>
                    {expandedHistoryId === entry.id && (
                      <tr>
                        <td colSpan={8} style={styles.td}>
                          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                            <div>
                              <div style={{ fontSize: 11, color: "#64748b" }}>Request</div>
                              <pre style={styles.mono}>{formatJson(entry.requestPayload)}</pre>
                            </div>
                            <div>
                              <div style={{ fontSize: 11, color: "#64748b" }}>Response</div>
                              <pre style={styles.mono}>{formatJson(entry.responsePayload)}</pre>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </PageAccessGate>
  );
}
