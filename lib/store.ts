export const store = {
  cultivationBatches: [
    { id: "GG-042326", strain: "Golden Goat", stage: "Flower", plants: 92 },
    { id: "CL-041526", strain: "Cherry Lac", stage: "Dry", plants: 84 },
    { id: "GMO-040926", strain: "GMO", stage: "Veg", plants: 128 },
  ],

  sourceBatches: [
    {
      id: "FF-CL-041526",
      name: "Cherry Lac Fresh Frozen",
      type: "Fresh Frozen",
      amount: "18 bundles",
      source: "CL-041526",
    },
    {
      id: "TRIM-GMO-001",
      name: "GMO Dry Trim",
      type: "Dry Trim",
      amount: "22.4 lbs",
      source: "GMO-040926",
    },
  ],

  extractionBatches: [],

  packagingBatches: [
    {
      id: "DRY-GG-001",
      name: "Golden Goat A-Grade Flower",
      type: "Dry Flower",
      source: "GG-042326",
      status: "Passed",
    },
  ],

  logs: [],
};