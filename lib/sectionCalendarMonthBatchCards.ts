import type { SectionCalendarEventDto } from "@/lib/sectionCalendarApi";

export type MonthBatchScheduleCard = {
  groupKey: string;
  batchRef: string | null;
  label: string;
  events: SectionCalendarEventDto[];
  /** Next by `todayYmd` within the month, else earliest in month. */
  next: SectionCalendarEventDto;
};

/** One summary row per batch ref (or one group for tasks with no batch). */
export function groupMonthEventsIntoBatchCards(
  monthEvents: SectionCalendarEventDto[],
  batchLabelById: Map<string, string>,
  todayYmd: string,
): MonthBatchScheduleCard[] {
  const byKey = new Map<string, SectionCalendarEventDto[]>();
  for (const ev of monthEvents) {
    const ref = String(ev.batchRef || "").trim();
    const key = ref || "__unlinked__";
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(ev);
  }
  const out: MonthBatchScheduleCard[] = [];
  for (const [groupKey, raw] of byKey) {
    const sorted = [...raw].sort((a, b) => a.dateYmd.localeCompare(b.dateYmd) || a.id.localeCompare(b.id));
    const upcoming = sorted.find((e) => e.dateYmd >= todayYmd);
    const next = upcoming ?? sorted[0]!;
    const batchRef = groupKey === "__unlinked__" ? null : groupKey;
    const label =
      batchRef && batchLabelById.has(batchRef)
        ? batchLabelById.get(batchRef)!
        : batchRef
          ? `Ref: ${batchRef}`
          : "Tasks without batch link";
    out.push({ groupKey, batchRef, label, events: sorted, next });
  }
  out.sort((a, b) => {
    const ua = a.batchRef == null ? 1 : 0;
    const ub = b.batchRef == null ? 1 : 0;
    if (ua !== ub) return ua - ub;
    return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
  });
  return out;
}
