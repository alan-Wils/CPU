import { describe, expect, it } from "vitest";
import { userDisplayName } from "./userDisplayName.js";

describe("userDisplayName", () => {
    it("prefers displayName over email local-part", () => {
        expect(
            userDisplayName({ displayName: "Mike K", email: "mike.k@budfoxsupply.com" }),
        ).toBe("Mike K");
    });

    it("falls back to email local-part when displayName is empty", () => {
        expect(userDisplayName({ displayName: "", email: "mike.k@budfoxsupply.com" })).toBe("mike.k");
        expect(userDisplayName({ displayName: null, email: "mike.k@budfoxsupply.com" })).toBe("mike.k");
    });

    it("returns User when both are missing", () => {
        expect(userDisplayName({})).toBe("User");
    });
});
