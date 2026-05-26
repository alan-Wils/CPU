import { describe, expect, it } from "vitest";
import { parseMetrcTransferTypesPayload } from "./metrcTransferTypesParse.js";

describe("metrcTransferTypesParse", () => {
  it("parses METRC transfer types by Name field", () => {
    const rows = parseMetrcTransferTypesPayload({
      Data: [
        {
          Name: "Transfer",
          TransactionType: "Standard",
        },
        {
          Name: "Wholesale",
          TransactionType: "Wholesale",
        },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.name)).toEqual(["Transfer", "Wholesale"]);
    expect(rows[0]?.typeCode).toBe("Standard");
  });
});
