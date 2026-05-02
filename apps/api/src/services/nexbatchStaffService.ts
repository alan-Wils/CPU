import crypto from "node:crypto";
import { AppError } from "../errors/AppError.js";
import { resolvePublicWebBaseUrl } from "../config/publicWebUrl.js";
import { logInfo } from "../lib/logger.js";
import { sendInviteEmail } from "../lib/mailer.js";
import {
    canCreateCompanyAsPlatform,
    nexBatchInviteTierToPlatformRole,
    nexBatchPlatformRoleInviteLabel,
    type NexBatchInviteUiTier,
} from "../lib/nexbatchRoles.js";
import { AuthRepository } from "../repositories/authRepository.js";
import { CompanyRepository } from "../repositories/companyRepository.js";

export class NexBatchStaffService {
    private authRepo = new AuthRepository();
    private companyRepo = new CompanyRepository();

    async inviteStaff(input: {
        actorUserId: string;
        actorPlatformRole: string | null | undefined;
        email: string;
        tier: NexBatchInviteUiTier;
    }) {
        if (!canCreateCompanyAsPlatform(input.actorPlatformRole)) {
            throw new AppError("Forbidden", 403);
        }
        const actorPr = String(input.actorPlatformRole || "").trim();
        const platformRole = nexBatchInviteTierToPlatformRole(input.tier);
        if (platformRole === "owner" && actorPr !== "owner") {
            throw new AppError("Only a NexBatch owner account can invite someone as Owner (full platform).", 403);
        }

        const email = String(input.email).trim().toLowerCase();
        if (await this.authRepo.findUserByEmail(email)) {
            throw new AppError("That email is already registered.", 409);
        }
        if (await this.authRepo.findPendingPlatformStaffInviteByEmail(email)) {
            throw new AppError("An invite is already pending for that email.", 409);
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

        const rawToken = crypto.randomBytes(24).toString("hex");
        const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
        const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);

        await this.authRepo.createPlatformStaffInvite({
            email,
            platformRole,
            companyIds,
            tokenHash,
            expiresAt,
            createdBy: input.actorUserId,
        });

        const baseUrl = resolvePublicWebBaseUrl().replace(/\/+$/, "");
        const inviteUrl = `${baseUrl}/accept-nexbatch-invite?token=${encodeURIComponent(rawToken)}`;
        const roleLabel = nexBatchPlatformRoleInviteLabel(platformRole);

        void sendInviteEmail({
            to: email,
            inviteUrl,
            companyName: "NexBatch portal",
            role: roleLabel,
        }).then(
            () => logInfo("nexbatch_staff_invite_email_sent", { to: email }),
            (err) => {
                console.error("[mail] Failed to send NexBatch staff invite email:", err);
            },
        );

        logInfo("nexbatch_staff_invite_created", {
            actorUserId: input.actorUserId,
            email,
            platformRole,
            companiesGranted: companyIds.length,
        });

        return {
            email,
            platformRole,
            roleLabel,
            companiesGranted: companyIds.length,
            expiresAt: expiresAt.toISOString(),
        };
    }
}
