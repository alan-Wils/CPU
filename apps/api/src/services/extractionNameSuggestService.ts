import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../config/env.js";
import { parseModelSuggestionsJson } from "../lib/extractionNameSuggestJson.js";
import { logError, logWarn } from "../lib/logger.js";

export function extractionProductNamePromptFilePath(): string {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(__dirname, "../../prompts/extraction-product-name.md");
}

/** Readable default prompt (bundled Markdown). Caller may cache; errors if file missing on disk. */
export function loadDefaultExtractionProductNamePromptMarkdown(): string {
    const templatePath = extractionProductNamePromptFilePath();
    try {
        return fs.readFileSync(templatePath, "utf8");
    }
    catch (e) {
        logError("extraction_name_suggest_prompt_read", { error: e, templatePath });
        throw new Error("Prompt template missing");
    }
}

/**
 * Builds the OpenAI **user** message from a Markdown template + strain labels.
 * If the template omits `{{STRAIN_LIST}}`, a standard strain block is appended so batch strains are always injected.
 */
export function buildExtractionProductNameUserPromptMarkdown(
    strains: string[],
    templateMarkdown: string
): string {
    const strainList = strains.map((s) => String(s || "").trim()).filter(Boolean).join(", ");
    let tpl = String(templateMarkdown || "").trimEnd();
    if (!tpl.includes("{{STRAIN_LIST}}")) {
        tpl = `${tpl}\n\n## Input strains (use only these — do not invent or assume other cultivars)\n\n{{STRAIN_LIST}}\n`;
    }
    return tpl.replace(/\{\{STRAIN_LIST\}\}/g, strainList);
}

export type SuggestExtractionProductNamesOptions = {
    /** Per-company override from Company Config; empty/whitespace uses bundled default file. */
    promptTemplateMarkdown?: string | null;
};

export async function suggestExtractionProductNames(
    strains: string[],
    options?: SuggestExtractionProductNamesOptions
): Promise<string[]> {
    const key = env.OPENAI_API_KEY;
    if (!key) {
        throw new Error("OPENAI_API_KEY is not configured");
    }
    const model = env.OPENAI_MODEL || "gpt-4o-mini";
    const base = (env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
    const custom = typeof options?.promptTemplateMarkdown === "string" ? options.promptTemplateMarkdown.trim() : "";
    const template = custom ? custom : loadDefaultExtractionProductNamePromptMarkdown();
    const userContent = buildExtractionProductNameUserPromptMarkdown(strains, template);

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
