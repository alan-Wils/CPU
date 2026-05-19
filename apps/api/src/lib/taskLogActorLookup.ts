import type { PrismaClient } from "@prisma/client";
import { userDisplayName } from "./userDisplayName.js";

export type LoggedByDto = {
  userId: string;
  username: string;
  email: string;
  role: string;
};

function normalizeLoggedByFromNote(raw: unknown, userId = ""): LoggedByDto | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as { userId?: unknown; username?: unknown; email?: unknown; role?: unknown };
  const username = String(o.username ?? "").trim();
  const email = String(o.email ?? "").trim();
  if (!username && !email) return null;
  return {
    userId: String(o.userId ?? userId).trim(),
    username: username || userDisplayName({ displayName: "", email }),
    email,
    role: String(o.role ?? "").trim(),
  };
}

/** Read `data.loggedBy` from legacy note JSON when actor user row is missing. */
export function loggedByFromTaskLogNote(note: string, actorUserId = ""): LoggedByDto | null {
  try {
    const parsed = JSON.parse(String(note || "")) as { data?: { loggedBy?: unknown } };
    if (parsed?.data && typeof parsed.data === "object") {
      return normalizeLoggedByFromNote(parsed.data.loggedBy, actorUserId);
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function buildLoggedByMap(
  db: PrismaClient,
  companyId: string,
  actorUserIds: string[],
): Promise<Map<string, LoggedByDto>> {
  const ids = Array.from(
    new Set(actorUserIds.map((id) => String(id || "").trim()).filter(Boolean)),
  );
  const map = new Map<string, LoggedByDto>();
  if (ids.length === 0) return map;

  const users = await db.user.findMany({
    where: { companyId, id: { in: ids } },
    select: { id: true, email: true, displayName: true, role: true },
  });

  for (const u of users) {
    map.set(u.id, {
      userId: u.id,
      username: userDisplayName({ displayName: u.displayName, email: u.email }),
      email: u.email || "",
      role: String(u.role || ""),
    });
  }
  return map;
}

export function resolveLoggedByForRow(
  row: { actorUserId: string; note: string },
  usersById: Map<string, LoggedByDto>,
): LoggedByDto {
  const fromDb = usersById.get(row.actorUserId);
  if (fromDb) return fromDb;
  const fromNote = loggedByFromTaskLogNote(row.note, row.actorUserId);
  if (fromNote) return fromNote;
  return {
    userId: row.actorUserId || "",
    username: "Unknown User",
    email: "",
    role: "",
  };
}
