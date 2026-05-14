import { prisma } from "../../config/prisma.js";
import { AppError } from "../../errors/AppError.js";
import {
  BASELINE_ALERTS,
  BASELINE_CALENDAR_2025_05,
  BASELINE_ENVIRONMENT,
  BASELINE_KPI_SNAPSHOT,
  BASELINE_MTD_COST_SERIES,
  BASELINE_ROOM_COUNTS,
  BASELINE_SEEDED_WORK_ORDER_COUNT,
  BASELINE_SYSTEMS,
  BASELINE_WORK_ORDERS,
  CALENDAR_YEAR_MONTH,
} from "./facilityMaintenanceBaseline.js";

const ELEVATED = new Set(["OWNER", "ADMIN", "OPERATIONS_MANAGER"]);

function isElevatedRole(role: string): boolean {
  return ELEVATED.has(String(role || "").trim().toUpperCase());
}

export class FacilityMaintenanceService {
  async ensureBaseline(companyId: string): Promise<void> {
    const existing = await prisma.facilityProfile.findUnique({ where: { companyId } });
    if (existing)
      return;
    await prisma.$transaction(async (tx) => {
      await tx.facilityProfile.create({
        data: {
          companyId,
          facilityName: "Green Valley Dispensary",
          addressLine1: "420 Herbal Way",
          cityStateZip: "Denver, CO 80202",
          licenseNumber: "MED-402R-00123",
          facilitySizeSqFt: 22000,
          builtYear: 2021,
          roomCountsJson: BASELINE_ROOM_COUNTS,
          mtdTotalCost: 18420,
          mtdCostSeriesJson: BASELINE_MTD_COST_SERIES,
          kpiSnapshotJson: BASELINE_KPI_SNAPSHOT,
        },
      });
      for (const wo of BASELINE_WORK_ORDERS) {
        await tx.facilityWorkOrder.create({
          data: {
            companyId,
            externalId: wo.externalId,
            title: wo.title,
            location: wo.location,
            category: wo.category,
            priority: wo.priority,
            status: wo.status,
            assignedTo: wo.assignedTo,
            dueDate: new Date(wo.dueDate),
            dueMeta: wo.dueMeta || null,
            sortOrder: wo.sortOrder,
          },
        });
      }
      for (const a of BASELINE_ALERTS) {
        await tx.facilityAlert.create({
          data: { companyId, ...a },
        });
      }
      for (const s of BASELINE_SYSTEMS) {
        await tx.facilitySystemStatus.create({
          data: { companyId, ...s },
        });
      }
      for (const e of BASELINE_ENVIRONMENT) {
        await tx.facilityEnvironmentalReading.create({
          data: {
            companyId,
            metricKey: e.metricKey,
            label: e.label,
            valueDisplay: e.valueDisplay,
            idealRangeDisplay: e.idealRangeDisplay,
            sparklineJson: e.sparklineJson,
            statusLabel: e.statusLabel,
            sortOrder: e.sortOrder,
          },
        });
      }
      for (const c of BASELINE_CALENDAR_2025_05) {
        await tx.facilityCalendarEvent.create({
          data: {
            companyId,
            yearMonth: CALENDAR_YEAR_MONTH,
            day: c.day,
            kind: c.kind,
          },
        });
      }
    });
  }

  async getDashboard(companyId: string) {
    await this.ensureBaseline(companyId);
    const profile = await prisma.facilityProfile.findUniqueOrThrow({ where: { companyId } });
    const [
      workOrders,
      alerts,
      systems,
      environment,
      calendarEvents,
      pmTasks,
      assets,
      partRequests,
      locations,
    ] = await Promise.all([
      prisma.facilityWorkOrder.findMany({
        where: { companyId },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      }),
      prisma.facilityAlert.findMany({
        where: { companyId },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      }),
      prisma.facilitySystemStatus.findMany({
        where: { companyId },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.facilityEnvironmentalReading.findMany({
        where: { companyId },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.facilityCalendarEvent.findMany({
        where: { companyId, yearMonth: CALENDAR_YEAR_MONTH },
        orderBy: [{ day: "asc" }, { kind: "asc" }],
      }),
      prisma.facilityPreventiveMaintenanceTask.findMany({
        where: { companyId },
        orderBy: { nextDueDate: "asc" },
      }),
      prisma.facilityAsset.findMany({ where: { companyId }, orderBy: { createdAt: "desc" } }),
      prisma.facilityPartRequest.findMany({ where: { companyId }, orderBy: { createdAt: "desc" } }),
      prisma.facilityLocation.findMany({ where: { companyId }, orderBy: { createdAt: "desc" } }),
    ]);

    const kpiSnap = profile.kpiSnapshotJson as typeof BASELINE_KPI_SNAPSHOT;
    const woCount = workOrders.length;
    const totalDisplay =
      kpiSnap.kpi.totalWorkOrders + Math.max(0, woCount - BASELINE_SEEDED_WORK_ORDER_COUNT);

    return {
      profile: {
        facilityName: profile.facilityName,
        addressLine1: profile.addressLine1,
        cityStateZip: profile.cityStateZip,
        licenseNumber: profile.licenseNumber,
        facilitySizeSqFt: profile.facilitySizeSqFt,
        builtYear: profile.builtYear,
        roomCounts: profile.roomCountsJson,
        mtdTotalCost: profile.mtdTotalCost,
        mtdCostSeries: profile.mtdCostSeriesJson,
      },
      kpis: {
        ...kpiSnap.kpi,
        totalWorkOrders: totalDisplay,
      },
      kpiMeta: {
        statusChart: kpiSnap.statusChart,
        statusChartCenterTotal: kpiSnap.statusChartCenterTotal,
        priorityChart: kpiSnap.priorityChart,
        maintenanceCostSubtext: kpiSnap.maintenanceCostSubtext,
      },
      workOrders: workOrders.map((w) => ({
        id: w.id,
        externalId: w.externalId,
        title: w.title,
        location: w.location,
        category: w.category,
        priority: w.priority,
        status: w.status,
        assignedTo: w.assignedTo,
        dueDate: w.dueDate.toISOString(),
        dueMeta: w.dueMeta,
        description: w.description,
      })),
      alerts: alerts.map((a) => ({
        id: a.id,
        title: a.title,
        locationLabel: a.locationLabel,
        valueLabel: a.valueLabel,
        statusLabel: a.statusLabel,
        timeLabel: a.timeLabel,
      })),
      systems: systems.map((s) => ({ id: s.id, name: s.name, status: s.status })),
      environment: environment.map((e) => ({
        id: e.id,
        metricKey: e.metricKey,
        label: e.label,
        valueDisplay: e.valueDisplay,
        idealRangeDisplay: e.idealRangeDisplay,
        sparkline: e.sparklineJson,
        statusLabel: e.statusLabel,
      })),
      calendar: {
        yearMonth: CALENDAR_YEAR_MONTH,
        events: calendarEvents.map((c) => ({ day: c.day, kind: c.kind })),
      },
      pmTasks: pmTasks.map((t) => ({
        id: t.id,
        taskName: t.taskName,
        assetSystem: t.assetSystem,
        frequency: t.frequency,
        assignedTo: t.assignedTo,
        nextDueDate: t.nextDueDate.toISOString(),
        notes: t.notes,
      })),
      assets: assets.map((a) => ({
        id: a.id,
        assetName: a.assetName,
        category: a.category,
        location: a.location,
        serialNumber: a.serialNumber,
        installDate: a.installDate.toISOString(),
        status: a.status,
      })),
      partRequests: partRequests.map((p) => ({
        id: p.id,
        partName: p.partName,
        quantity: p.quantity,
        neededFor: p.neededFor,
        priority: p.priority,
        notes: p.notes,
      })),
      locations: locations.map((l) => ({
        id: l.id,
        locationName: l.locationName,
        locationType: l.locationType,
        parentArea: l.parentArea,
        sqFt: l.sqFt,
        notes: l.notes,
      })),
    };
  }

  async createWorkOrder(
    companyId: string,
    actorRole: string,
    body: {
      title: string;
      location: string;
      category: string;
      priority: string;
      status: string;
      assignedTo: string;
      dueDate: string;
      description?: string;
    },
  ) {
    if (!isElevatedRole(actorRole) && actorRole !== "FACILITY_MAINTENANCE_SPECIALIST") {
      throw new AppError("Forbidden", 403);
    }
    const ext = `WO-${Date.now()}`;
    const wo = await prisma.facilityWorkOrder.create({
      data: {
        companyId,
        externalId: ext,
        title: body.title.trim(),
        location: body.location.trim(),
        category: body.category.trim(),
        priority: body.priority.trim(),
        status: body.status.trim(),
        assignedTo: body.assignedTo.trim(),
        dueDate: new Date(body.dueDate),
        description: body.description?.trim() || null,
        sortOrder: 1000,
      },
    });
    return {
      id: wo.id,
      externalId: wo.externalId,
      title: wo.title,
      location: wo.location,
      category: wo.category,
      priority: wo.priority,
      status: wo.status,
      assignedTo: wo.assignedTo,
      dueDate: wo.dueDate.toISOString(),
      dueMeta: wo.dueMeta,
      description: wo.description,
    };
  }

  async patchWorkOrder(
    companyId: string,
    actorRole: string,
    workOrderId: string,
    body: Partial<{
      title: string;
      location: string;
      category: string;
      priority: string;
      status: string;
      assignedTo: string;
      dueDate: string;
      description: string | null;
      dueMeta: string | null;
    }>,
  ) {
    const wo = await prisma.facilityWorkOrder.findFirst({
      where: { id: workOrderId, companyId },
    });
    if (!wo)
      throw new AppError("Work order not found", 404);
    const keys = Object.keys(body).filter((k) => body[k as keyof typeof body] !== undefined);
    const onlyStatus =
      keys.length === 1 && keys[0] === "status" && typeof body.status === "string";
    if (!isElevatedRole(actorRole)) {
      if (actorRole !== "FACILITY_MAINTENANCE_SPECIALIST" || !onlyStatus) {
        throw new AppError("Forbidden", 403);
      }
    }
    const next: Record<string, unknown> = {};
    if (body.title !== undefined) next.title = body.title.trim();
    if (body.location !== undefined) next.location = body.location.trim();
    if (body.category !== undefined) next.category = body.category.trim();
    if (body.priority !== undefined) next.priority = body.priority.trim();
    if (body.status !== undefined) next.status = body.status.trim();
    if (body.assignedTo !== undefined) next.assignedTo = body.assignedTo.trim();
    if (body.dueDate !== undefined) next.dueDate = new Date(body.dueDate);
    if (body.description !== undefined) next.description = body.description;
    if (body.dueMeta !== undefined) next.dueMeta = body.dueMeta;
    const updated = await prisma.facilityWorkOrder.updateMany({
      where: { id: workOrderId, companyId },
      data: next as Record<string, unknown>,
    });
    if (updated.count === 0)
      throw new AppError("Work order not found", 404);
    const row = await prisma.facilityWorkOrder.findFirstOrThrow({
      where: { id: workOrderId, companyId },
    });
    return {
      id: row.id,
      externalId: row.externalId,
      title: row.title,
      location: row.location,
      category: row.category,
      priority: row.priority,
      status: row.status,
      assignedTo: row.assignedTo,
      dueDate: row.dueDate.toISOString(),
      dueMeta: row.dueMeta,
      description: row.description,
    };
  }

  async deleteWorkOrder(companyId: string, actorRole: string, workOrderId: string) {
    if (!isElevatedRole(actorRole))
      throw new AppError("Forbidden", 403);
    const wo = await prisma.facilityWorkOrder.findFirst({
      where: { id: workOrderId, companyId },
    });
    if (!wo)
      throw new AppError("Work order not found", 404);
    const del = await prisma.facilityWorkOrder.deleteMany({ where: { id: workOrderId, companyId } });
    if (del.count === 0)
      throw new AppError("Work order not found", 404);
    return { ok: true };
  }

  async createPmTask(
    companyId: string,
    actorRole: string,
    body: {
      taskName: string;
      assetSystem: string;
      frequency: string;
      assignedTo: string;
      nextDueDate: string;
      notes?: string;
    },
  ) {
    if (!isElevatedRole(actorRole) && actorRole !== "FACILITY_MAINTENANCE_SPECIALIST") {
      throw new AppError("Forbidden", 403);
    }
    const t = await prisma.facilityPreventiveMaintenanceTask.create({
      data: {
        companyId,
        taskName: body.taskName.trim(),
        assetSystem: body.assetSystem.trim(),
        frequency: body.frequency.trim(),
        assignedTo: body.assignedTo.trim(),
        nextDueDate: new Date(body.nextDueDate),
        notes: body.notes?.trim() || null,
      },
    });
    return { id: t.id, ...body, nextDueDate: t.nextDueDate.toISOString() };
  }

  async createAsset(
    companyId: string,
    actorRole: string,
    body: {
      assetName: string;
      category: string;
      location: string;
      serialNumber: string;
      installDate: string;
      status: string;
    },
  ) {
    if (!isElevatedRole(actorRole) && actorRole !== "FACILITY_MAINTENANCE_SPECIALIST") {
      throw new AppError("Forbidden", 403);
    }
    const a = await prisma.facilityAsset.create({
      data: {
        companyId,
        assetName: body.assetName.trim(),
        category: body.category.trim(),
        location: body.location.trim(),
        serialNumber: body.serialNumber.trim(),
        installDate: new Date(body.installDate),
        status: body.status.trim(),
      },
    });
    return {
      id: a.id,
      assetName: a.assetName,
      category: a.category,
      location: a.location,
      serialNumber: a.serialNumber,
      installDate: a.installDate.toISOString(),
      status: a.status,
    };
  }

  async createPartRequest(
    companyId: string,
    actorRole: string,
    body: {
      partName: string;
      quantity: number;
      neededFor: string;
      priority: string;
      notes?: string;
    },
  ) {
    if (!isElevatedRole(actorRole) && actorRole !== "FACILITY_MAINTENANCE_SPECIALIST") {
      throw new AppError("Forbidden", 403);
    }
    const p = await prisma.facilityPartRequest.create({
      data: {
        companyId,
        partName: body.partName.trim(),
        quantity: Math.floor(body.quantity),
        neededFor: body.neededFor.trim(),
        priority: body.priority.trim(),
        notes: body.notes?.trim() || null,
      },
    });
    return { id: p.id, ...body };
  }

  async createLocation(
    companyId: string,
    actorRole: string,
    body: {
      locationName: string;
      locationType: string;
      parentArea: string;
      sqFt?: number | null;
      notes?: string;
    },
  ) {
    if (!isElevatedRole(actorRole) && actorRole !== "FACILITY_MAINTENANCE_SPECIALIST") {
      throw new AppError("Forbidden", 403);
    }
    const l = await prisma.facilityLocation.create({
      data: {
        companyId,
        locationName: body.locationName.trim(),
        locationType: body.locationType.trim(),
        parentArea: body.parentArea.trim(),
        sqFt: body.sqFt == null ? null : Math.floor(body.sqFt),
        notes: body.notes?.trim() || null,
      },
    });
    return {
      id: l.id,
      locationName: l.locationName,
      locationType: l.locationType,
      parentArea: l.parentArea,
      sqFt: l.sqFt,
      notes: l.notes,
    };
  }
}
