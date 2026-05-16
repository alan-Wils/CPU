/**
 * Cash/check digest email cannot be enabled for the application owner (OWNER).
 * Any role may turn it off or leave it unset; enabling is blocked for that membership.
 */
export function mayAdminEnableOwnerDigestEmails(input: {
    targetRole: string;
    requestedEnabled: boolean | undefined;
}): boolean {
    if (input.targetRole !== "OWNER") return true;
    if (input.requestedEnabled !== true) return true;
    return false;
}
