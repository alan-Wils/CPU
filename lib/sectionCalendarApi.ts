import { apiRequest } from "@/lib/api";

export type SectionCalendarSection = "cultivation" | "extraction" | "packaging" | "edibles";

export type SectionCalendarEventDto = {
  id: string;
  companyId: string;
  section: string;
  dateYmd: string;
  title: string;
  notes: string | null;
  batchRef: string | null;
  templateDedupeKey?: string | null;
  templateManaged?: boolean;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
};

export async function listSectionCalendarEvents(params: {
  section: SectionCalendarSection;
  /** YYYY-MM */
  month: string;
}): Promise<{ events: SectionCalendarEventDto[]; fromYmd: string; toYmd: string }> {
  const q = new URLSearchParams({
    section: params.section,
    month: params.month,
  });
  return apiRequest(`/api/section-calendar/events?${q.toString()}`);
}

export async function createSectionCalendarEvent(body: {
  section: SectionCalendarSection;
  dateYmd: string;
  title: string;
  notes?: string | null;
  batchRef?: string | null;
}): Promise<SectionCalendarEventDto> {
  return apiRequest("/api/section-calendar/events", {
    method: "POST",
    body,
  });
}

export async function patchSectionCalendarEvent(
  id: string,
  body: Partial<
    Pick<
      SectionCalendarEventDto,
      "dateYmd" | "title" | "notes" | "batchRef" | "templateDedupeKey" | "templateManaged"
    >
  >,
): Promise<SectionCalendarEventDto> {
  return apiRequest(`/api/section-calendar/events/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body,
  });
}

export async function deleteSectionCalendarEvent(id: string): Promise<{ ok: boolean }> {
  return apiRequest(`/api/section-calendar/events/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export type CultivationTemplateSyncResult = {
  upserted: number;
  deletedOrphans: number;
  skipped?: boolean;
  reason?: string;
  fingerprint?: string;
};

/** Upserts cultivation section calendar rows from Admin schedule templates + batch anchors + store logs. */
export async function syncCultivationSectionScheduleTemplates(opts?: {
  force?: boolean;
  templateFingerprint?: string;
}): Promise<CultivationTemplateSyncResult> {
  return apiRequest("/api/section-calendar/cultivation/sync-templates", {
    method: "POST",
    body: {
      force: Boolean(opts?.force),
      templateFingerprint: opts?.templateFingerprint ?? undefined,
    },
  });
}
