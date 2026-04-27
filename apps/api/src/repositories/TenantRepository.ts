import { prisma } from "../config/prisma.js";

export class TenantRepository {
  protected readonly db = prisma;

  protected scopedWhere<T extends { companyId?: string }>(companyId: string, where?: T): T {
    return { ...(where ?? {}), companyId } as T;
  }
}
