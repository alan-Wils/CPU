/**
 * Minimal list-row shape for GET /api/logs?compact=1 (detail via GET /api/logs/:id).
 */

import type { LoggedByDto } from "./taskLogActorLookup.js";

const MAX_FIELD_LEN = 160;

function capStr(value: unknown, max = MAX_FIELD_LEN): string {
  const s = String(value ?? "").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

function compactDataForList(data: Record<string, unknown>): Record<string, unknown> {
  const pick: Record<string, unknown> = {};
  for (const k of [
    "loggedAt",
    "loggedAtIso",
    "source",
    "linkedBatch",
    "people",
    "minutes",
    "strain",
    "room",
    "stage",
  ]) {
    const v = data[k];
    if (v === undefined || v === null || v === "") continue;
    if (typeof v === "string") pick[k] = capStr(v, 80);
    else if (typeof v === "number" || typeof v === "boolean") pick[k] = v;
    else continue;
  }
  return pick;
}

export type TaskLogListRow = {
  id: string;
  area: string;
  batch: string;
  task: string;
  people: string;
  minutes: string;
  source?: string;
  linkedBatch?: string;
  loggedAtIso: string;
  loggedBy: Pick<LoggedByDto, "username" | "email" | "role"> & { userId?: string };
};

/** @param row Prisma TaskLog row */
export function taskLogToListRow(
  row: {
    id: string;
    actorUserId: string;
    stage: string;
    note: string;
    minutes: number;
    referenceId: string | null;
    createdAt: Date;
  },
  loggedBy: LoggedByDto,
): TaskLogListRow {
  const loggedAtIso = row.createdAt.toISOString();
  const raw = String(row.note || "");
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed && typeof parsed === "object" && "task" in parsed) {
      const dataRaw =
        typeof parsed.data === "object" && parsed.data && !Array.isArray(parsed.data)
          ? (parsed.data as Record<string, unknown>)
          : {};
      const data = compactDataForList(dataRaw);
      const src =
        parsed.source ??
        (typeof data.source === "string" && data.source ? data.source : undefined);
      const linked =
        parsed.linkedBatch ??
        (typeof data.linkedBatch === "string" && data.linkedBatch ? data.linkedBatch : undefined);
      const out: TaskLogListRow = {
        id: row.id,
        area: capStr(parsed.area ?? "System", 40),
        batch: capStr(parsed.batch ?? row.referenceId ?? "", 80),
        task: capStr(parsed.task ?? "Log", 120),
        people: capStr(data.people ?? "", 80),
        minutes: String(data.minutes ?? row.minutes ?? ""),
        loggedAtIso,
        loggedBy: {
          userId: loggedBy.userId,
          username: loggedBy.username,
          email: loggedBy.email,
          role: loggedBy.role,
        },
      };
      if (src) out.source = capStr(src, 80);
      if (linked) out.linkedBatch = capStr(linked, 80);
      return out;
    }
  } catch {
    /* fall through */
  }
  const stage = String(row.stage || "");
  const area =
    stage === "EXTRACTION" ? "Extraction" : stage === "PACKAGING" ? "Packaging" : "Cultivation";
  return {
    id: row.id,
    area,
    batch: capStr(row.referenceId ?? "", 80),
    task: "Task",
    people: "",
    minutes: String(row.minutes ?? ""),
    loggedAtIso,
    loggedBy: {
      userId: loggedBy.userId,
      username: loggedBy.username,
      email: loggedBy.email,
      role: loggedBy.role,
    },
  };
}
