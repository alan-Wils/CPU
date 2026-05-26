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

  it("reads headline total from LeafLink money object (total.amount)", () => {
    const raw = {
      id: "ord-money-obj-1",
      number: "MO-1",
      status: "accepted",
      total: { amount: 210.4, currency: "USD" },
      created_on: "2026-03-10T12:00:00Z",
      customer: { display_name: "Good Vibrations" },
      line_items: [],
    };
    expect(normalizeOrder(raw).total).toBeCloseTo(210.4, 5);
  });

  it("reads headline total from alternate keys when top-level total is zero", () => {
    const raw = {
      id: "ord-alt-total-1",
      number: "ALT-1",
      status: "accepted",
      total: 0,
      total_amount: "432.10",
      created_on: "2026-03-10T12:00:00Z",
      customer: { display_name: "Retailer A" },
      line_items: [],
    };
    expect(normalizeOrder(raw).total).toBeCloseTo(432.1, 5);
  });

  it("reads nested order totals and line_items when list payload nests under order", () => {
    const raw = {
      id: "ord-nested-1",
      number: "NST-1",
      status: "accepted",
      total: 0,
      created_on: "2026-03-11T15:30:00Z",
      customer: { display_name: "Retailer B" },
      order: {
        total_amount: "250.00",
        line_items: [
          {
            id: "li-1",
            quantity: 2,
            line_total: "125.00",
            product_name: "Widget",
          },
          {
            id: "li-2",
            quantity: 1,
            line_total: "125.00",
            product_name: "Gadget",
          },
        ],
      },
    };
    const o = normalizeOrder(raw);
    expect(o.total).toBeCloseTo(250, 5);
    expect(o.lineItems.length).toBe(2);
    expect((o.lineItems[0]?.lineTotal ?? 0) + (o.lineItems[1]?.lineTotal ?? 0)).toBeCloseTo(250, 5);
  });
});
