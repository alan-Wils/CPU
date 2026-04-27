import { apiGet, apiPost } from "./api";
import { store } from "./store";

function parseTaskFromServerNote(note: string) {
  const m = String(note || "").match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (m) return m[1].trim();
  return String(note || "").split(/\s+/).slice(0, 4).join(" ") || "Task";
}

function batchIdFromServerRow(row: any) {
  const ref = String(row?.referenceId || "").trim();
  if (ref) return ref;
  const note = String(row?.note || "");
  const m = note.match(/\(([^)]+)\)\s*$/);
  return m ? m[1].trim() : "";
}

function mapServerTaskLogToUiRow(row: any) {
  const note = String(row?.note || "");
  const batchKey = batchIdFromServerRow(row);
  const fallbackUser =
    String(row?.actorUserId || "").trim().length > 0
      ? { username: String(row.actorUserId).slice(0, 8), role: "" }
      : { username: "Server log", role: "" };
  return {
    id: row.id,
    fromServer: true,
    area: row.stage === "EXTRACTION" ? "Extraction" : row.stage === "PACKAGING" ? "Packaging" : "Cultivation",
    batch: batchKey || undefined,
    task: parseTaskFromServerNote(note),
    output: note,
    minutes: row.minutes,
    time: row.createdAt ? new Date(row.createdAt).toLocaleString() : "",
    loggedAtIso: row.createdAt,
    loggedBy: row.loggedBy || fallbackUser,
  };
}

/** Merge Prisma task logs so View batch modals work after refresh. */
export async function mergeRecentTaskLogsFromApi() {
  if (typeof window === "undefined") return;
  const token = localStorage.getItem("token");
  if (!token) return;
  try {
    const res = await apiGet<any>("/tasks/logs/recent", token);
    const rows = Array.isArray(res?.rows) ? res.rows : [];
    if (rows.length === 0) return;
    const serverMapped = rows.map((r: any) => mapServerTaskLogToUiRow(r));
    const serverIds = new Set(serverMapped.map((m: any) => m.id).filter(Boolean));
    const b = (x: any) => String(x || "").trim();
    const localOnly = (store.logs || []).filter((l: any) => {
      if (l?.fromServer) return false;
      if (l?.id && serverIds.has(l.id)) return false;
      if (!l?.id) {
        const dup = serverMapped.some(
          (m: any) =>
            b(m.batch) === b(l.batch) &&
            String(m.output || "").includes(String(l.task || "").trim())
        );
        if (dup) return false;
      }
      return true;
    });
    const tsec = (x: any) => {
      const raw = x.loggedAtIso || x.time || (x as any).createdAt;
      const n = raw ? new Date(raw).getTime() : 0;
      return Number.isFinite(n) ? n : 0;
    };
    store.logs = [...localOnly, ...serverMapped].sort((a, b) => tsec(b) - tsec(a));
    store.save?.();
  } catch {
    /* ignore */
  }
}

export async function createLog(payload: any) {
  const next = { ...payload, createdAt: new Date().toISOString() };
  const minutesRaw = Number(payload?.data?.minutes || payload?.minutes || 0);
  const minutes = Number.isFinite(minutesRaw) && minutesRaw > 0 ? Math.round(minutesRaw) : 1;
  const upperArea = String(payload?.area || "").toUpperCase();
  const stage =
    upperArea.includes("EXTRACTION")
      ? "EXTRACTION"
      : upperArea.includes("PACKAGING")
      ? "PACKAGING"
      : "CULTIVATION";
  const note = `${payload?.task || "Task"} ${payload?.batch ? `(${payload.batch})` : ""}`.trim();
  const ref = String(
    payload?.data?.cultivationDbId ||
      payload?.data?.cultivationBatchDbId ||
      payload?.data?.dbId ||
      payload?.batch ||
      ""
  ).trim();
  const referenceId = ref.length > 0 ? ref : undefined;
  try {
    const row = await apiPost(
      "/tasks/logs",
      {
        stage,
        note: note.length >= 4 ? note : `${stage} task`,
        minutes,
        referenceId: referenceId as string | undefined
      },
      localStorage.getItem("token")
    );
    if (row && (row as any).id) {
      next.id = (row as any).id;
      next.fromServer = true;
    }
  } catch {
    // Fallback keeps UI stable if reference id shape mismatches.
    store.logs = [next, ...(store.logs || [])];
    store.save?.();
  }

  return next;
}

export async function deleteAllLogs() {
  const token = localStorage.getItem("token");
  const existing = await apiGet<any>("/tasks/logs/recent", token).catch(() => ({ rows: [] }));
  const deletedCount = Array.isArray(existing?.rows) ? existing.rows.length : 0;
  // No bulk-delete API exists yet; keep local clear for UI compatibility.
  store.logs = [];
  store.save?.();
  return { ok: true, deletedCount, compatibilityOnly: true };
}
