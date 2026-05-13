import { describe, expect, it } from "vitest";
import type { SectionCalendarEventDto } from "@/lib/sectionCalendarApi";
import { groupMonthEventsIntoBatchCards } from "@/lib/sectionCalendarMonthBatchCards";

function ev(p: Partial<SectionCalendarEventDto> & Pick<SectionCalendarEventDto, "id" | "dateYmd" | "title">): SectionCalendarEventDto {
  return {
    companyId: "c1",
    section: "cultivation",
    notes: null,
    batchRef: null,
    createdByUserId: "u1",
    createdAt: "",
    updatedAt: "",
    ...p,
  };
}

describe("groupMonthEventsIntoBatchCards", () => {
  it("groups by batchRef and picks next by todayYmd", () => {
    const labels = new Map([["B1", "Clone: Test · 10 plants · B1"]]);
    const rows = [
      ev({ id: "1", dateYmd: "2026-05-01", title: "Early", batchRef: "B1" }),
      ev({ id: "2", dateYmd: "2026-05-10", title: "Later", batchRef: "B1" }),
    ];
    const cards = groupMonthEventsIntoBatchCards(rows, labels, "2026-05-05");
    expect(cards).toHaveLength(1);
    expect(cards[0]!.next.id).toBe("2");
    expect(cards[0]!.next.title).toBe("Later");
  });

  it("uses earliest in month when all dates are before today", () => {
    const labels = new Map<string, string>();
    const rows = [ev({ id: "a", dateYmd: "2026-05-01", title: "A", batchRef: "X" })];
    const cards = groupMonthEventsIntoBatchCards(rows, labels, "2026-06-01");
    expect(cards[0]!.next.title).toBe("A");
  });

  it("merges tasks without batch into one unlinked group", () => {
    const labels = new Map<string, string>();
    const rows = [
      ev({ id: "1", dateYmd: "2026-05-02", title: "T1", batchRef: null }),
      ev({ id: "2", dateYmd: "2026-05-03", title: "T2", batchRef: "" }),
    ];
    const cards = groupMonthEventsIntoBatchCards(rows, labels, "2026-05-01");
    expect(cards).toHaveLength(1);
    expect(cards[0]!.events).toHaveLength(2);
    expect(cards[0]!.batchRef).toBeNull();
  });
});
