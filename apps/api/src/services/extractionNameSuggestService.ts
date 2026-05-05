import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../config/env.js";
import { parseModelSuggestionsJson } from "../lib/extractionNameSuggestJson.js";
import { logError, logWarn } from "../lib/logger.js";

function promptFilePath(): string {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(__dirname, "../../prompts/extraction-product-name.md");
}

export async function suggestExtractionProductNames(strains: string[]): Promise<string[]> {
    const key = env.OPENAI_API_KEY;
    if (!key) {
        throw new Error("OPENAI_API_KEY is not configured");
    }
    const model = env.OPENAI_MODEL || "gpt-4o-mini";
    const base = (env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
    const templatePath = promptFilePath();
    let template: string;
    try {
        template = fs.readFileSync(templatePath, "utf8");
    }
    catch (e) {
        logError("extraction_name_suggest_prompt_read", { error: e, templatePath });
        throw new Error("Prompt template missing");
    }
    const strainList = strains.join(", ");
    const userContent = template.replace(/\{\{STRAIN_LIST\}\}/g, strainList);

    const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model,
            temperature: 0.7,
            messages: [
                {
                    role: "system",
                    content: "You follow instructions precisely. When the user asks for JSON only, output nothing but valid JSON.",
                },
                { role: "user", content: userContent },
            ],
        }),
    });

    const rawText = await res.text();
    let data: { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
    try {
        data = rawText ? (JSON.parse(rawText) as typeof data) : {};
    }
    catch {
        data = {};
    }

    if (!res.ok) {
        logWarn("[EXTRACTION_NAME_SUGGEST] openai_http_error", {
            status: res.status,
            body: rawText.slice(0, 500),
        });
        throw new Error(data?.error?.message || `OpenAI request failed (${res.status})`);
    }

    const choice = data?.choices?.[0]?.message?.content;
    const suggestions = parseModelSuggestionsJson(String(choice || ""));
    if (suggestions.length === 0) {
        logWarn("[EXTRACTION_NAME_SUGGEST] empty_parse", { preview: String(choice || "").slice(0, 400) });
        throw new Error("Model returned no usable suggestions");
    }
    return suggestions.slice(0, 5);
}
