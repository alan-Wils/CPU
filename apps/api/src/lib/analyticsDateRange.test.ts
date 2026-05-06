import { describe, expect, it } from "vitest";
import { parseYmdEndUtc, parseYmdStartUtc } from "./analyticsDateRange.js";

describe("parseYmdStartUtc", () => {
    it("returns UTC midnight", () => {
        const t = parseYmdStartUtc("2026-05-05");
        expect(Number.isFinite(t)).toBe(true);
        expect(new Date(t).toISOString().startsWith("2026-05-05T")).toBe(true);
    });
    it("rejects bad input", () => {
        expect(Number.isFinite(parseYmdStartUtc("nope"))).toBe(false);
    });
});

describe("parseYmdEndUtc", () => {
    it("ends inclusive end-of-day UTC", () => {
        const t = parseYmdEndUtc("2026-05-05");
        const d = new Date(t);
        expect(d.getUTCHours()).toBe(23);
        expect(d.getUTCMinutes()).toBe(59);
    });
});
