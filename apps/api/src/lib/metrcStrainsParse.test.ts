import { describe, expect, it } from "vitest";
import { parseMetrcStrainsPayload } from "./metrcStrainsParse.js";

describe("parseMetrcStrainsPayload", () => {
  it("parses strain fields and dedupes by METRC id", () => {
    const rows = parseMetrcStrainsPayload({
      Data: [
        {
          Id: 10,
          Name: "Blue Dream",
          TestingStatus: "None",
          IsActive: true,
          IsArchived: false,
          LastModified: "2026-05-26T10:00:00Z",
        },
        {
          Id: 10,
          Name: "Blue Dream (duplicate)",
          TestingStatus: "None",
        },
        {
          Id: 11,
          Name: "OG Kush",
          TestingStatus: "InHouse",
          Active: false,
          Archived: true,
          LastModified: "2026-05-26T10:00:00Z",
        },
      ],
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]?.metrcStrainId).toBe("10");
    expect(rows[0]?.name).toBe("Blue Dream (duplicate)");
    expect(rows[0]?.testingStatus).toBe("None");
    expect(rows[0]?.active).toBe(true);
    expect(rows[0]?.archived).toBe(false);
    expect(rows[0]?.lastModified).toBeNull();

    expect(rows[1]?.metrcStrainId).toBe("11");
    expect(rows[1]?.active).toBe(false);
    expect(rows[1]?.archived).toBe(true);
    expect(rows[1]?.lastModified?.toISOString()).toBe("2026-05-26T10:00:00.000Z");
  });

  it("returns empty array for empty payload", () => {
    expect(parseMetrcStrainsPayload({ Data: [] })).toEqual([]);
  });
});
