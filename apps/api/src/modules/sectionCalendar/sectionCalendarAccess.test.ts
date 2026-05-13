import { describe, expect, it } from "vitest";
import {
    canReadSectionCalendar,
    canWriteSectionCalendar,
    monthYmdBounds,
} from "./sectionCalendarAccess.js";

describe("sectionCalendarAccess monthYmdBounds", () => {
    it("matches web helper for May 2026", () => {
        expect(monthYmdBounds("2026-05")).toEqual({ fromYmd: "2026-05-01", toYmd: "2026-05-31" });
    });
});

describe("sectionCalendarAccess RBAC", () => {
    it("allows VIEW_ONLY to read extraction but not write", () => {
        expect(
            canReadSectionCalendar({
                role: "VIEW_ONLY",
                permissions: ["page.data-hub"],
                section: "extraction",
            }),
        ).toBe(true);
        expect(
            canWriteSectionCalendar({
                role: "VIEW_ONLY",
                permissions: ["page.data-hub"],
                section: "extraction",
            }),
        ).toBe(false);
    });

    it("allows cultivation specialist to read/write cultivation", () => {
        expect(
            canReadSectionCalendar({
                role: "CULTIVATION_SPECIALIST",
                permissions: ["page.cultivation", "page.data-hub"],
                section: "cultivation",
            }),
        ).toBe(true);
        expect(
            canWriteSectionCalendar({
                role: "CULTIVATION_SPECIALIST",
                permissions: ["page.cultivation", "page.data-hub"],
                section: "cultivation",
            }),
        ).toBe(true);
    });
});
