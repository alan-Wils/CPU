import { env } from "../config/env.js";
import { parseHarvestSheetJsonResponse } from "../lib/harvestSheetJsonParse.js";

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

export async function extractHarvestSheetFromImageBuffer(
    imageBuffer: Buffer,
    mimeType: string,
    opts: { plantsHarvested?: number } = {},
): Promise<ReturnType<typeof parseHarvestSheetJsonResponse>> {
    const key = env.OPENAI_API_KEY;
    if (!key) {
        throw new Error("OPENAI_API_KEY is not configured");
    }

    const model = env.OPENAI_MODEL || "gpt-4o-mini";
    const base = (env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
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

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
        const msg =
            typeof data?.error === "object" && data.error !== null && "message" in data.error
                ? String((data.error as { message?: unknown }).message)
                : `OpenAI request failed (${res.status})`;
        throw new Error(msg);
    }

    const choices = data?.choices as unknown;
    const choice =
        Array.isArray(choices) && choices[0] && typeof choices[0] === "object"
            ? (choices[0] as { message?: { content?: unknown } }).message?.content
            : undefined;
    const content = typeof choice === "string" ? choice : "";
    return parseHarvestSheetJsonResponse(content);
}
