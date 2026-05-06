/**
 * OpenAI vision extraction for handwritten harvest sheets.
 * Requires OPENAI_API_KEY on the backend process.
 */

const { parseHarvestSheetJsonResponse } = require("./harvestSheetJsonParse.cjs");

const OPENAI_JSON_INSTRUCTION = `You are reading a handwritten cannabis harvest log sheet photo.
Extract every filled row from the tag/weight table. Ignore printed headers and empty rows.

Reply with ONLY a single JSON object (no markdown fences, no commentary), exactly this shape:
{
  "rows": [
    { "tag": "string or empty", "weightValue": <number or null>, "unitGuess": "lbs"|"g"|"grams"|"oz"|"unknown" }
  ],
  "bundles": <number or null if not visible>,
  "totalGrams": <number or null if not visible>,
  "notes": "short optional note about illegible cells"
}

Rules:
- tag = plant/tag identifier as written (digits ok).
- weightValue = numeric weight only (no units in the number).
- If unit is unclear use unitGuess "unknown".
- Do not invent rows; blank lines are omitted.
- totalGrams only if explicitly written as total/sum grams on sheet.`;

/**
 * @param {Buffer} imageBuffer
 * @param {string} mimeType e.g. image/jpeg
 * @param {{ plantsHarvested?: number }} [opts]
 */
async function extractHarvestSheetFromImageBuffer(imageBuffer, mimeType, opts = {}) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    const err = new Error("OPENAI_API_KEY is not configured");
    err.code = "OPENAI_MISSING";
    throw err;
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const b64 = imageBuffer.toString("base64");
  const dataUrl = `data:${mimeType};base64,${b64}`;

  let extra = "";
  const n = opts.plantsHarvested;
  if (n != null && Number.isFinite(n) && n > 0) {
    extra = `\nOperator said about ${Math.floor(n)} plants were harvested — row count may be near this but handwritten rows may differ.`;
  }

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: `${OPENAI_JSON_INSTRUCTION}${extra}` },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `OpenAI request failed (${res.status})`;
    const err = new Error(msg);
    err.code = "OPENAI_HTTP";
    throw err;
  }

  const choice = data?.choices?.[0]?.message?.content;
  const content = typeof choice === "string" ? choice : "";
  return parseHarvestSheetJsonResponse(content);
}

module.exports = {
  extractHarvestSheetFromImageBuffer,
};
