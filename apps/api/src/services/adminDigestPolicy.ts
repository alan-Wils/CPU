/**
 * Application owners opt into digest email themselves. Company admins may turn it off
 * for the owner but must not turn it on when it was previously off.
 */
export function mayAdminEnableOwnerDigestEmails(input: {
    actorRole: string;
    targetRole: string;
    requestedEnabled: boolean | undefined;
    prevEnabled: boolean;
}): boolean {
    if (input.actorRole !== "ADMIN" || input.targetRole !== "OWNER")
        return true;
    if (input.requestedEnabled !== true)
        return true;
    return input.prevEnabled;
}
