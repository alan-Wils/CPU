import { describe, expect, it } from "vitest";
import { mayAdminEnableOwnerDigestEmails } from "./adminDigestPolicy.js";

describe("mayAdminEnableOwnerDigestEmails", () => {
    it("allows digest toggle for non-owner targets", () => {
        expect(
            mayAdminEnableOwnerDigestEmails({
                targetRole: "ADMIN",
                requestedEnabled: true,
            }),
        ).toBe(true);
        expect(
            mayAdminEnableOwnerDigestEmails({
                targetRole: "OPERATIONS_MANAGER",
                requestedEnabled: true,
            }),
        ).toBe(true);
    });

    it("blocks enabling digest for application owner", () => {
        expect(
            mayAdminEnableOwnerDigestEmails({
                targetRole: "OWNER",
                requestedEnabled: true,
            }),
        ).toBe(false);
    });

    it("allows turning off digest for application owner", () => {
        expect(
            mayAdminEnableOwnerDigestEmails({
                targetRole: "OWNER",
                requestedEnabled: false,
            }),
        ).toBe(true);
    });

    it("allows PATCH that does not request digest enabled", () => {
        expect(
            mayAdminEnableOwnerDigestEmails({
                targetRole: "OWNER",
                requestedEnabled: undefined,
            }),
        ).toBe(true);
    });
});
