import bcrypt from "bcryptjs";
import type { NexBatchPlatformRole } from "@prisma/client";
import { AppError } from "../errors/AppError.js";
import { logInfo } from "../lib/logger.js";
import { canCreateCompanyAsPlatform } from "../lib/nexbatchRoles.js";
import { AuthRepository } from "../repositories/authRepository.js";
import { CompanyRepository } from "../repositories/companyRepository.js";

export class NexBatchStaffService {
    private authRepo = new AuthRepository();
    private companyRepo = new CompanyRepository();

    async createStaff(input: {
        actorUserId: string;
        actorPlatformRole: string | null | undefined;
        email: string;
        password: string;
        platformRole: NexBatchPlatformRole;
    }) {
        if (!canCreateCompanyAsPlatform(input.actorPlatformRole)) {
            throw new AppError("Forbidden", 403);
        }
        const actorPr = String(input.actorPlatformRole || "").trim();
        if (input.platformRole === "owner" && actorPr !== "owner") {
            throw new AppError("Only a NexBatch owner account can grant the owner platform role.", 403);
        }

        const email = String(input.email).trim().toLowerCase();
        if (await this.authRepo.findUserByEmail(email)) {
            throw new AppError("That email is already registered.", 409);
        }

        const accessible = await this.companyRepo.listAccessibleCompaniesForUser(input.actorUserId, {
            includeBootstrapInvites: true,
        });
        const companyIds = accessible.map((c) => c.id);
        if (!companyIds.length) {
            throw new AppError(
                "You have no company workspaces to attach. Open a tenant from the list above first, or create a company.",
                400,
            );
        }

        const passwordHash = await bcrypt.hash(input.password, 12);
        const user = await this.authRepo.createPlatformStaffUser({
            email,
            passwordHash,
            platformRole: input.platformRole,
            companyIds,
        });

        logInfo("nexbatch_staff_created", {
            actorUserId: input.actorUserId,
            newUserId: user.id,
            platformRole: input.platformRole,
            companiesGranted: companyIds.length,
        });

        return {
            id: user.id,
            email: user.email,
            platformRole: user.platformRole,
            companiesGranted: companyIds.length,
        };
    }
}
