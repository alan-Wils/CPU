import { describe, expect, it } from "vitest";
import { normalizeOrder, parseLeafLinkOrdersListEnvelope } from "./leafLinkOrdersService.js";

function hasMoreFromEnvelope(
  body: unknown,
  pageNum: number,
  pageSize: number,
  rowsOnPage: number,
): boolean {
  const { totalCount, next } = parseLeafLinkOrdersListEnvelope(body);
  const nextUrl = next?.trim() ?? "";
  const ps = pageSize;
  const pn = pageNum;
  if (nextUrl.length > 0) return true;
  const agg = totalCount;
  if (agg > 0 && pn * ps < agg) return true;
  const r = rowsOnPage;
  if (agg <= 0 && r > 0 && r >= Math.min(ps, 50))
    return true;
  return false;
}

describe("parseLeafLinkOrdersListEnvelope", () => {
  it("reads totals from alternate keys without inheriting catalogue size from page length alone", () => {
    const body = {
      total: 250,
      results: [{ id: "1" }],
      next: null,
      previous: null,
    };
    const env = parseLeafLinkOrdersListEnvelope(body);
    expect(env.totalCount).toBe(250);
    expect(env.list.length).toBe(1);
  });

  it("reports zero aggregate when envelope omits count fields (caller uses next/heuristics)", () => {
    const body = {
      results: Array.from({ length: 47 }, (_, i) => ({ id: String(i) })),
    };
    const env = parseLeafLinkOrdersListEnvelope(body);
    expect(env.totalCount).toBe(0);
    expect(env.list.length).toBe(47);
  });

  it("inherits next from nested links bag", () => {
    const body = {
      results: [{ id: "a" }],
      links: { next: "https://app.leaflink.com/api/v2/orders-received/?page=2" },
    };
    expect(parseLeafLinkOrdersListEnvelope(body).next).toContain("page=2");
  });

  it("pagination continues when capped below requested page_size and aggregate is absent", () => {
    const bodyNoMeta = {
      results: Array.from({ length: 50 }, (_, i) => ({ id: `o-${i}` })),
      next: null,
    };
    expect(
      hasMoreFromEnvelope(bodyNoMeta, 1, 100, parseLeafLinkOrdersListEnvelope(bodyNoMeta).list.length),
    ).toBe(true);

    const bodyTail = {
      results: Array.from({ length: 28 }, (_, i) => ({ id: `t-${i}` })),
      next: null,
    };
    expect(
      hasMoreFromEnvelope(bodyTail, 7, 100, parseLeafLinkOrdersListEnvelope(bodyTail).list.length),
    ).toBe(false);
  });
});

describe("normalizeOrder (analytics prerequisites)", () => {
  it("can leave buyerCustomerId empty while still exposing ids for fallback keys", () => {
    const raw = {
      id: "ord-fallback-001",
      number: "N-FF-1",
      status: "accepted",
      total: "120.50",
      created_on: "2026-03-02T17:05:22Z",
      customer: { display_name: "Smoke Test Boutique" },
      line_items: [],
    };
    expect(normalizeOrder(raw).buyerCustomerId.trim()).toBe("");
    expect(normalizeOrder(raw).id.trim().length > 0).toBe(true);
  });
});
