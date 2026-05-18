import { prisma } from "../config/prisma.js";
import { logInfo } from "../lib/logger.js";

export const LEAFLINK_ORDERS_SYNC_PROVIDER = "leaflink";
export const LEAFLINK_ORDERS_SYNC_RESOURCE = "orders";
const LOCK_TTL_MS = 15 * 60 * 1000;

export type LeafLinkOrdersSyncCursor = {
  lastLeafLinkOrderCreatedAt?: string | null;
  lastLeafLinkOrderUpdatedAt?: string | null;
};

export type LeafLinkOrdersSyncStateDto = {
  lastSuccessfulLeafLinkOrderSyncAt: string | null;
  lastSyncMode: string | null;
  lastSyncPagesPulled: number | null;
  lastSyncRowsPersisted: number | null;
  lastSyncError: string | null;
  cursor: LeafLinkOrdersSyncCursor | null;
  syncInProgress: boolean;
};

function syncStateWhere(companyId: string) {
  return {
    companyId_provider_resource: {
      companyId,
      provider: LEAFLINK_ORDERS_SYNC_PROVIDER,
      resource: LEAFLINK_ORDERS_SYNC_RESOURCE,
    },
  };
}

export function parseLeafLinkOrdersSyncCursor(raw: string | null | undefined): LeafLinkOrdersSyncCursor | null {
  if (!raw?.trim()) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    return {
      lastLeafLinkOrderCreatedAt:
        typeof o.lastLeafLinkOrderCreatedAt === "string" ? o.lastLeafLinkOrderCreatedAt : null,
      lastLeafLinkOrderUpdatedAt:
        typeof o.lastLeafLinkOrderUpdatedAt === "string" ? o.lastLeafLinkOrderUpdatedAt : null,
    };
  } catch {
    return null;
  }
}

export async function getLeafLinkOrdersSyncState(companyId: string): Promise<LeafLinkOrdersSyncStateDto> {
  const cid = String(companyId ?? "").trim();
  if (!cid) {
    return {
      lastSuccessfulLeafLinkOrderSyncAt: null,
      lastSyncMode: null,
      lastSyncPagesPulled: null,
      lastSyncRowsPersisted: null,
      lastSyncError: null,
      cursor: null,
      syncInProgress: false,
    };
  }
  const row = await prisma.integrationSyncState.findUnique({ where: syncStateWhere(cid) });
  if (!row) {
    return {
      lastSuccessfulLeafLinkOrderSyncAt: null,
      lastSyncMode: null,
      lastSyncPagesPulled: null,
      lastSyncRowsPersisted: null,
      lastSyncError: null,
      cursor: null,
      syncInProgress: false,
    };
  }
  const lockActive =
  row.lockStartedAt != null
  && Date.now() - row.lockStartedAt.getTime() < LOCK_TTL_MS;
  return {
    lastSuccessfulLeafLinkOrderSyncAt: row.lastSuccessAt?.toISOString() ?? null,
    lastSyncMode: row.lastMode ?? null,
    lastSyncPagesPulled: row.lastPagesPulled ?? null,
    lastSyncRowsPersisted: row.lastRowsPersisted ?? null,
    lastSyncError: row.lastError ?? null,
    cursor: parseLeafLinkOrdersSyncCursor(row.cursorJson),
    syncInProgress: lockActive,
  };
}

export type AcquireLeafLinkSyncLockResult =
  | { acquired: true; lockOwner: string }
  | { acquired: false; reason: "sync_already_running" };

export async function acquireLeafLinkOrdersSyncLock(
  companyId: string,
  lockOwner: string,
): Promise<AcquireLeafLinkSyncLockResult> {
  const cid = String(companyId ?? "").trim();
  const owner = String(lockOwner ?? "").trim() || "unknown";
  const now = new Date();
  const staleBefore = new Date(now.getTime() - LOCK_TTL_MS);

  const existing = await prisma.integrationSyncState.findUnique({ where: syncStateWhere(cid) });
  if (
    existing?.lockStartedAt
    && existing.lockStartedAt.getTime() > staleBefore.getTime()
  ) {
    logInfo("[LEAFLINK] sync_lock_skipped", { companyId: cid, lockOwner: existing.lockOwner });
    return { acquired: false, reason: "sync_already_running" };
  }

  await prisma.integrationSyncState.upsert({
    where: syncStateWhere(cid),
    create: {
      companyId: cid,
      provider: LEAFLINK_ORDERS_SYNC_PROVIDER,
      resource: LEAFLINK_ORDERS_SYNC_RESOURCE,
      lockStartedAt: now,
      lockOwner: owner,
    },
    update: {
      lockStartedAt: now,
      lockOwner: owner,
    },
  });

  logInfo("[LEAFLINK] sync_lock_acquired", { companyId: cid, lockOwner: owner });
  return { acquired: true, lockOwner: owner };
}

export async function releaseLeafLinkOrdersSyncLock(companyId: string): Promise<void> {
  const cid = String(companyId ?? "").trim();
  if (!cid) return;
  await prisma.integrationSyncState.updateMany({
    where: {
      companyId: cid,
      provider: LEAFLINK_ORDERS_SYNC_PROVIDER,
      resource: LEAFLINK_ORDERS_SYNC_RESOURCE,
    },
    data: {
      lockStartedAt: null,
      lockOwner: null,
    },
  });
  logInfo("[LEAFLINK] sync_lock_released", { companyId: cid });
}

export async function recordLeafLinkOrdersSyncRun(input: {
  companyId: string;
  mode: "incremental" | "manual_full_rebuild";
  pagesPulled: number;
  rowsPersisted: number;
  error?: string | null;
  cursor?: LeafLinkOrdersSyncCursor | null;
  success: boolean;
}): Promise<void> {
  const cid = String(input.companyId ?? "").trim();
  if (!cid) return;
  const cursorJson = input.cursor ? JSON.stringify(input.cursor) : undefined;
  await prisma.integrationSyncState.upsert({
    where: syncStateWhere(cid),
    create: {
      companyId: cid,
      provider: LEAFLINK_ORDERS_SYNC_PROVIDER,
      resource: LEAFLINK_ORDERS_SYNC_RESOURCE,
      lastMode: input.mode,
      lastPagesPulled: input.pagesPulled,
      lastRowsPersisted: input.rowsPersisted,
      lastError: input.error ?? null,
      lastSuccessAt: input.success ? new Date() : null,
      cursorJson: cursorJson ?? null,
    },
    update: {
      lastMode: input.mode,
      lastPagesPulled: input.pagesPulled,
      lastRowsPersisted: input.rowsPersisted,
      lastError: input.error ?? null,
      ...(input.success ? { lastSuccessAt: new Date() } : {}),
      ...(cursorJson !== undefined ? { cursorJson } : {}),
    },
  });
}
