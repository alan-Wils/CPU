import { prisma } from "../../config/prisma.js";
import { parseYmdEndUtc, parseYmdStartUtc } from "../../lib/analyticsDateRange.js";
import { userDisplayName } from "../../lib/userDisplayName.js";

function ymdFromUtcMs(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export type LiveOperationsCard = {
  id: "task_logs" | "extraction" | "packaging" | "labor";
  title: string;
  summary: string;
  href: string;
  items: Record<string, unknown>[];
};

export type LiveOperationsDetailJson = {
  generatedAt: string;
  cards: LiveOperationsCard[];
};

export async function buildLiveOperationsDetail(companyId: string): Promise<LiveOperationsDetailJson> {
  const nowMs = Date.now();
  const fourteenAgo = new Date(nowMs - 14 * 86_400_000);
  const todayYmd = ymdFromUtcMs(nowMs);
  const dayStart = new Date(parseYmdStartUtc(todayYmd));
  const dayEnd = new Date(parseYmdEndUtc(todayYmd));

  const [taskRows, taskLinkedCount, extractionRows, packagingRows, laborRows, extractionActiveCount, packagingActiveCount, laborTodayCount, laborUserGroups] =
    await Promise.all([
    prisma.taskLog.findMany({
      where: {
        companyId,
        referenceId: { not: null },
        createdAt: { gte: fourteenAgo },
      },
      orderBy: { createdAt: "desc" },
      take: 250,
    }),
    prisma.taskLog.count({
      where: {
        companyId,
        referenceId: { not: null },
        createdAt: { gte: fourteenAgo },
      },
    }),
    prisma.extractionRun.findMany({
      where: {
        companyId,
        phase: { not: "COMPLETED" },
        finishedAt: null,
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: {
        id: true,
        phase: true,
        updatedAt: true,
        cultivationBatchId: true,
      },
    }),
    prisma.packagingLot.findMany({
      where: {
        companyId,
        status: "IN_PROGRESS",
        finishedAt: null,
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: {
        id: true,
        sku: true,
        units: true,
        updatedAt: true,
        extractionRunId: true,
      },
    }),
    prisma.laborEntry.findMany({
      where: {
        companyId,
        createdAt: { gte: dayStart, lte: dayEnd },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        user: { select: { email: true } },
      },
    }),
    prisma.extractionRun.count({
      where: {
        companyId,
        phase: { not: "COMPLETED" },
        finishedAt: null,
      },
    }),
    prisma.packagingLot.count({
      where: {
        companyId,
        status: "IN_PROGRESS",
        finishedAt: null,
      },
    }),
    prisma.laborEntry.count({
      where: {
        companyId,
        createdAt: { gte: dayStart, lte: dayEnd },
      },
    }),
    prisma.laborEntry.groupBy({
      by: ["userId"],
      where: {
        companyId,
        createdAt: { gte: dayStart, lte: dayEnd },
      },
      _count: { _all: true },
    }),
  ]);

  const actorIds = Array.from(new Set(taskRows.map((r) => String(r.actorUserId || "").trim()).filter(Boolean)));
  const usersById = new Map<string, { username: string; email: string }>();
  if (actorIds.length > 0) {
    const users = await prisma.user.findMany({
      where: { companyId, id: { in: actorIds } },
      select: { id: true, email: true, displayName: true },
    });
    for (const u of users) {
      const email = String(u.email || "");
      usersById.set(u.id, {
        username: userDisplayName({ displayName: u.displayName, email }),
        email,
      });
    }
  }

  const taskItems = taskRows.map((t) => {
    const who = usersById.get(t.actorUserId);
    return {
      id: t.id,
      stage: t.stage,
      minutes: t.minutes,
      note: t.note,
      referenceId: t.referenceId,
      at: t.createdAt.toISOString(),
      loggedBy: who?.username ?? "Unknown",
      loggedByEmail: who?.email ?? "",
    };
  });

  const extractionItems = extractionRows.map((r) => ({
    id: r.id,
    phase: r.phase,
    cultivationBatchId: r.cultivationBatchId,
    updatedAt: r.updatedAt.toISOString(),
  }));

  const packagingItems = packagingRows.map((p) => ({
    id: p.id,
    sku: p.sku,
    units: p.units,
    extractionRunId: p.extractionRunId,
    updatedAt: p.updatedAt.toISOString(),
  }));

  const laborItems = laborRows.map((e) => ({
    id: e.id,
    stage: e.stage,
    hours: e.hours,
    hourlyRate: e.hourlyRate,
    totalCost: e.totalCost,
    taskType: e.taskType,
    referenceId: e.referenceId,
    cultivationBatchId: e.cultivationBatchId,
    at: e.createdAt.toISOString(),
    userEmail: e.user?.email ?? "",
  }));

  const distinctLaborUsers = laborUserGroups.length;

  const cards: LiveOperationsCard[] = [
    {
      id: "task_logs",
      title: "Task logs with reference (14d)",
      summary: `${taskLinkedCount} entries${taskLinkedCount > taskRows.length ? ` (showing ${taskRows.length})` : ""}`,
      href: "/cultivation",
      items: taskItems,
    },
    {
      id: "extraction",
      title: "Extraction runs in progress",
      summary: `${extractionActiveCount} active${extractionActiveCount > extractionRows.length ? ` (showing ${extractionRows.length})` : ""}`,
      href: "/extraction",
      items: extractionItems,
    },
    {
      id: "packaging",
      title: "Packaging lots in progress",
      summary: `${packagingActiveCount} active${packagingActiveCount > packagingRows.length ? ` (showing ${packagingRows.length})` : ""}`,
      href: "/packaging",
      items: packagingItems,
    },
    {
      id: "labor",
      title: "Labor entries today (UTC)",
      summary: `${laborTodayCount} rows · ${distinctLaborUsers} contributors${laborTodayCount > laborRows.length ? ` (showing ${laborRows.length})` : ""}`,
      href: "/cultivation",
      items: laborItems,
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    cards,
  };
}
