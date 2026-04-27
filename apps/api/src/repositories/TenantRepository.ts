import { prisma } from "../config/prisma.js";
export class TenantRepository {
    db = prisma;
    scopedWhere(companyId, where) {
        return { ...(where ?? {}), companyId };
    }
}
