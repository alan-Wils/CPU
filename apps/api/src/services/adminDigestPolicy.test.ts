import { describe, expect, it } from "vitest";
import { mayAdminEnableOwnerDigestEmails } from "./adminDigestPolicy.js";

describe("mayAdminEnableOwnerDigestEmails", () => {
    it("allows non-admin or non-owner targets", () => {
        expect(
            mayAdminEnableOwnerDigestEmails({
                actorRole: "OWNER",
                targetRole: "OWNER",
                requestedEnabled: true,
                prevEnabled: false,
            }),
        ).toBe(true);
        expect(
            mayAdminEnableOwnerDigestEmails({
                actorRole: "ADMIN",
                targetRole: "ADMIN",
                requestedEnabled: true,
                prevEnabled: false,
            }),
        ).toBe(true);
    });

    it("blocks admin turning on digest for owner when it was off", () => {
        expect(
            mayAdminEnableOwnerDigestEmails({
                actorRole: "ADMIN",
                targetRole: "OWNER",
                requestedEnabled: true,
                prevEnabled: false,
            }),
        ).toBe(false);
    });

    it("allows admin to keep digest on for owner (no-op true)", () => {
        expect(
            mayAdminEnableOwnerDigestEmails({
                actorRole: "ADMIN",
                targetRole: "OWNER",
                requestedEnabled: true,
                prevEnabled: true,
            }),
        ).toBe(true);
    });

    it("allows admin to turn off digest for owner", () => {
        expect(
            mayAdminEnableOwnerDigestEmails({
                actorRole: "ADMIN",
                targetRole: "OWNER",
                requestedEnabled: false,
                prevEnabled: true,
            }),
        ).toBe(true);
    });

    it("allows PATCH that does not request digest enabled", () => {
        expect(
            mayAdminEnableOwnerDigestEmails({
                actorRole: "ADMIN",
                targetRole: "OWNER",
                requestedEnabled: undefined,
                prevEnabled: false,
            }),
        ).toBe(true);
    });
});
