import { prisma } from "../config/prisma.js";
import { logInfo, logWarn } from "../lib/logger.js";
import { LeafLinkOrdersService } from "./leafLinkOrdersService.js";

export type LeafLinkOrdersWarmSyncJobResult = {
  companiesExamined: number;
  companiesEligible: number;
  totalPagesPulled: number;
  totalOrdersSeen: number;
  errors: string[];
};

/**
 * Cron job: pull LeafLink orders-received into `leafLinkStoredOrder` for every company so the Orders UI stays warm
 * without a browser on `/orders`. Uses the same path as `POST /api/orders/sync`.
 */
export async function runLeafLinkOrdersWarmSyncJob(): Promise<LeafLinkOrdersWarmSyncJobResult> {
  const errors: string[] = [];
  let companiesExamined = 0;
  let companiesEligible = 0;
  let totalPagesPulled = 0;
  let totalOrdersSeen = 0;

  const svc = new LeafLinkOrdersService();
  const companies = await prisma.company.findMany({ select: { id: true } });

  for (const { id: companyId } of companies) {
    companiesExamined += 1;
    try {
      const r = await svc.syncOrdersWarm(companyId);
      if (r.integrationEnabled && r.configured)
        companiesEligible += 1;
      totalPagesPulled += r.pagesPulled;
      totalOrdersSeen += r.ordersSeen;
    }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${companyId}: ${msg}`);
      logWarn("leaflink_orders_warm_sync_company_failed", { companyId, error: msg });
    }
  }

  logInfo("leaflink_orders_warm_sync_job_done", {
    companiesExamined,
    companiesEligible,
    totalPagesPulled,
    totalOrdersSeen,
    errorCount: errors.length,
  });

  return {
    companiesExamined,
    companiesEligible,
    totalPagesPulled,
    totalOrdersSeen,
    errors,
  };
}
