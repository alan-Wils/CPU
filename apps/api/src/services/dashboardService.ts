import { prisma } from "../config/prisma.js";
import { WorkflowService } from "./workflowService.js";

const workflow = new WorkflowService();

export class DashboardService {
  async getOverview(companyId: string) {
    const [list, company, laborAggregate, latestCpu, audits, users, openBatches] = await Promise.all([
      workflow.listActive(companyId),
      prisma.company.findUnique({ where: { id: companyId } }),
      prisma.laborEntry.aggregate({ where: { companyId }, _sum: { hours: true, totalCost: true } }),
      prisma.cpuSnapshot.findFirst({ where: { companyId }, orderBy: { createdAt: "desc" } }),
      prisma.auditLog.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: 20 }),
      prisma.user.count({ where: { companyId, isActive: true } }),
      prisma.cultivationBatch.findMany({ where: { companyId, autoStatus: "OPEN" }, take: 15 })
    ]);

    const availableFromChains = (list.sourceMaterial ?? []).reduce(
      (sum, s) => sum + s.availableA + s.availablePop,
      0
    );

    return {
      company,
      cards: {
        activeCultivation: openBatches.length,
        activeExtraction: list.extraction.length,
        activePackaging: list.packaging.length + (list.cultivationPacks?.length ?? 0),
        availableSourceMaterial: availableFromChains,
        laborHours: laborAggregate._sum.hours ?? 0,
        laborCost: laborAggregate._sum.totalCost ?? 0,
        cpuPerGram: latestCpu?.cpuPerGram ?? null,
        activeUsers: users
      },
      cultivationBatches: openBatches,
      activeWorkflow: {
        extractions: list.extraction,
        extractionPackaging: list.packaging,
        cultivationSidePackaging: list.cultivationPacks,
        sourceMaterial: list.sourceMaterial
      },
      recentActivityLogs: audits
    };
  }
}
