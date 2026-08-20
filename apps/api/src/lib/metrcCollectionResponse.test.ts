import { describe, expect, it } from "vitest";
import {
  METRC_COLLECTION_MAX_PAGES,
  METRC_COLLECTION_PAGE_SIZE,
  dedupeMetrcRecordsById,
  fetchAllMetrcCollectionPages,
  metrcCollectionReportedTotal,
  normalizeMetrcCollectionRecords,
  normalizeMetrcCollectionResponse,
  shouldFetchNextMetrcCollectionPage,
  withMetrcCollectionPageQuery,
} from "./metrcCollectionResponse.js";

function fourteenLocations(): { Id: number; Name: string }[] {
  return Array.from({ length: 14 }, (_, i) => ({
    Id: i + 1,
    Name: `Location ${i + 1}`,
  }));
}

describe("normalizeMetrcCollectionResponse", () => {
  it("reads a direct array response", () => {
    const rows = [{ Id: 1, Name: "A" }, { Id: 2, Name: "B" }];
    const normalized = normalizeMetrcCollectionResponse(rows);
    expect(normalized.records).toEqual(rows);
    expect(metrcCollectionReportedTotal(normalized)).toBe(2);
  });

  it("reads a PascalCase Data response containing 14 locations", () => {
    const data = fourteenLocations();
    const payload = {
      Data: data,
      Total: 14,
      TotalRecords: 14,
      PageSize: 20,
      RecordsOnPage: 14,
      Page: 1,
      CurrentPage: 1,
      TotalPages: 1,
    };
    const normalized = normalizeMetrcCollectionResponse(payload);
    expect(normalized.records).toHaveLength(14);
    expect(normalized.records[0]).toEqual({ Id: 1, Name: "Location 1" });
    expect(normalized.totalRecords).toBe(14);
    expect(normalized.total).toBe(14);
    expect(normalized.recordsOnPage).toBe(14);
    expect(normalized.page).toBe(1);
    expect(normalized.currentPage).toBe(1);
    expect(normalized.totalPages).toBe(1);
    expect(metrcCollectionReportedTotal(payload)).toBe(14);
    expect(metrcCollectionReportedTotal(normalized)).toBe(14);
  });

  it("reads a lowercase data response", () => {
    const payload = { data: [{ Id: 9, Name: "Vault" }], totalRecords: 1, totalPages: 1 };
    const normalized = normalizeMetrcCollectionResponse(payload);
    expect(normalized.records).toEqual([{ Id: 9, Name: "Vault" }]);
    expect(normalized.totalRecords).toBe(1);
    expect(metrcCollectionReportedTotal(normalized)).toBe(1);
  });

  it("handles an empty paginated response", () => {
    const payload = {
      Data: [],
      Total: 0,
      TotalRecords: 0,
      PageSize: 20,
      RecordsOnPage: 0,
      Page: 1,
      CurrentPage: 1,
      TotalPages: 1,
    };
    const normalized = normalizeMetrcCollectionResponse(payload);
    expect(normalized.records).toEqual([]);
    expect(metrcCollectionReportedTotal(normalized)).toBe(0);
  });

  it("handles malformed responses without crashing", () => {
    expect(normalizeMetrcCollectionRecords(null)).toEqual([]);
    expect(normalizeMetrcCollectionRecords(undefined)).toEqual([]);
    expect(normalizeMetrcCollectionRecords("oops")).toEqual([]);
    expect(normalizeMetrcCollectionRecords(42)).toEqual([]);
    expect(normalizeMetrcCollectionRecords({ Data: "not-an-array" })).toEqual([]);
    expect(normalizeMetrcCollectionResponse({}).records).toEqual([]);
    expect(metrcCollectionReportedTotal({})).toBe(0);
  });

  it("prefers TotalRecords over Total and array length", () => {
    expect(
      metrcCollectionReportedTotal({
        Data: [{ Id: 1 }],
        Total: 3,
        TotalRecords: 14,
      }),
    ).toBe(14);
    expect(metrcCollectionReportedTotal({ Data: [{ Id: 1 }, { Id: 2 }], Total: 7 })).toBe(7);
    expect(metrcCollectionReportedTotal([{ Id: 1 }, { Id: 2 }])).toBe(2);
  });
});

describe("fetchAllMetrcCollectionPages", () => {
  it("fetches sequential pages until TotalPages and dedupes by Id", async () => {
    const page1 = {
      Data: Array.from({ length: 20 }, (_, i) => ({ Id: i + 1, Name: `A${i + 1}` })),
      TotalRecords: 25,
      TotalPages: 2,
      PageSize: 20,
      Page: 1,
    };
    const page2 = {
      Data: [
        { Id: 20, Name: "A20-updated" },
        { Id: 21, Name: "B1" },
        { Id: 22, Name: "B2" },
        { Id: 23, Name: "B3" },
        { Id: 24, Name: "B4" },
        { Id: 25, Name: "B5" },
      ],
      TotalRecords: 25,
      TotalPages: 2,
      PageSize: 20,
      Page: 2,
    };
    const fetchedPages: number[] = [];
    const out = await fetchAllMetrcCollectionPages({
      pageSize: METRC_COLLECTION_PAGE_SIZE,
      fetchPage: async (pageNumber) => {
        fetchedPages.push(pageNumber);
        return pageNumber === 1 ? page1 : page2;
      },
    });
    expect(fetchedPages).toEqual([1, 2]);
    expect(out.pagesFetched).toBe(2);
    expect(out.reportedTotal).toBe(25);
    expect(out.records).toHaveLength(25);
    expect((out.records[19] as { Name: string }).Name).toBe("A20-updated");
  });

  it("stops at the safety page limit", async () => {
    const out = await fetchAllMetrcCollectionPages({
      maxPages: 3,
      pageSize: 20,
      fetchPage: async (pageNumber) => ({
        Data: Array.from({ length: 20 }, (_, i) => ({ Id: (pageNumber - 1) * 20 + i + 1 })),
        TotalPages: 99,
        TotalRecords: 1980,
      }),
    });
    expect(out.pagesFetched).toBe(3);
    expect(out.records).toHaveLength(60);
  });

  it("uses pageSize 20 in query helpers", () => {
    expect(METRC_COLLECTION_PAGE_SIZE).toBe(20);
    expect(METRC_COLLECTION_MAX_PAGES).toBeGreaterThan(1);
    expect(withMetrcCollectionPageQuery("/locations/v2/active?licenseNumber=LIC-1", 1)).toBe(
      "/locations/v2/active?licenseNumber=LIC-1&pageNumber=1&pageSize=20",
    );
  });
});

describe("shouldFetchNextMetrcCollectionPage", () => {
  it("continues until TotalPages is reached", () => {
    expect(
      shouldFetchNextMetrcCollectionPage({
        pageNumber: 1,
        totalPages: 2,
        recordsOnPage: 20,
        pageSize: 20,
      }),
    ).toBe(true);
    expect(
      shouldFetchNextMetrcCollectionPage({
        pageNumber: 2,
        totalPages: 2,
        recordsOnPage: 5,
        pageSize: 20,
      }),
    ).toBe(false);
  });

  it("falls back to a short page when TotalPages is absent", () => {
    expect(
      shouldFetchNextMetrcCollectionPage({
        pageNumber: 1,
        recordsOnPage: 20,
        pageSize: 20,
      }),
    ).toBe(true);
    expect(
      shouldFetchNextMetrcCollectionPage({
        pageNumber: 1,
        recordsOnPage: 3,
        pageSize: 20,
      }),
    ).toBe(false);
  });
});

describe("dedupeMetrcRecordsById", () => {
  it("keeps the last row for a repeated METRC Id", () => {
    const rows = dedupeMetrcRecordsById([
      { Id: 1, Name: "First" },
      { Id: 1, Name: "Second" },
      { Name: "NoId" },
    ]);
    expect(rows).toEqual([
      { Id: 1, Name: "Second" },
      { Name: "NoId" },
    ]);
  });
});
