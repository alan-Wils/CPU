import { describe, expect, it } from "vitest";
import { buildMarketplaceOrderInvoiceHtml, type MarketplaceOrderInvoiceDto } from "./marketplaceOrderInvoice";

const sample: MarketplaceOrderInvoiceDto = {
  invoiceLabel: "NB-ABC123",
  order: {
    id: "ord1",
    status: "PENDING",
    subtotal: 100,
    total: 100,
    notes: "Handle with care",
    createdAt: "2026-05-01T12:00:00.000Z",
    updatedAt: "2026-05-01T12:00:00.000Z",
  },
  buyer: {
    id: "b1",
    name: "Buyer Co",
    slug: "buyer-co",
    sales: {
      primaryContactName: "B Contact",
      primaryContactEmail: "b@example.com",
      primaryContactPhone: "555",
      defaultPaymentTerms: "Net 30",
      fulfillmentNotes: "",
    },
  },
  seller: {
    id: "s1",
    name: "Seller Co",
    slug: "seller-co",
    sales: null,
  },
  lineItems: [
    {
      id: "li1",
      productNameSnapshot: "Widget",
      skuSnapshot: "W-1",
      unitSizeSnapshot: "1g",
      quantity: 2,
      unitPrice: 50,
      lineTotal: 100,
    },
  ],
  platformNotice: "Test notice.",
};

describe("buildMarketplaceOrderInvoiceHtml", () => {
  it("includes invoice label, parties, line item, and escapes HTML in notes", () => {
    const html = buildMarketplaceOrderInvoiceHtml({
      ...sample,
      order: { ...sample.order, notes: "<script>x</script>" },
    });
    expect(html).toContain("NB-ABC123");
    expect(html).toContain("Buyer Co");
    expect(html).toContain("Seller Co");
    expect(html).toContain("Widget");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>x</script>");
  });
});
