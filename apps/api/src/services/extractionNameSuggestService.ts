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
/** Core naming rules + JSON contract (same intent as bundled Markdown). */
const EXTRACTION_NAME_RULES_BLOCK = `## Naming rules

- Suggest **3 to 5** short, professional product names suitable for a regulated market.
- Names may reflect the **blend** of strains when multiple are listed (e.g. combine or hybrid-style wording).
- Do **not** include medical claims, THC/CBD potency numbers, or geographic origin unless already implied by the strain list.
- Avoid profanity and slang unsuitable for B2B packaging.`;

const EXTRACTION_NAME_OUTPUT_BLOCK = `## Output format (required)

Reply with **only** a single JSON object (no markdown, no commentary), exactly:

{ "suggestions": ["Name One", "Name Two", "Name Three"] }

Use 3 to 5 strings. Each must be non-empty and under 80 characters.`;

/**
 * Build a full user prompt without raw Markdown editing: strains + optional company wording + fixed rules/output.
 */
export function buildGuidedExtractionProductNamePromptMarkdown(guidedIntro: string, guidedExtraRules: string): string {
    const intro = String(guidedIntro || "").trim();
    const extra = String(guidedExtraRules || "").trim();
    const parts: string[] = [
        `# Extraction product naming`,
        ``,
        `You help a licensed cannabis operator name a **finished extraction product** for labeling and packaging.`,
        ``,
    ];
    if (intro) {
        parts.push(`## What we want`, ``, intro, ``);
    }
    parts.push(
        `## Strains in this batch (use only these — do not invent or assume other cultivars)`,
        ``,
        `{{STRAIN_LIST}}`,
        ``,
        EXTRACTION_NAME_RULES_BLOCK
    );
    if (extra) {
        parts.push(``, `## Extra preferences from our team`, ``, extra);
    }
    parts.push(``, EXTRACTION_NAME_OUTPUT_BLOCK);
    return parts.join("\n");
}

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
    /** Full Markdown override (advanced); takes precedence when non-empty over guided fields and file default. */
    promptTemplateMarkdown?: string | null;
    /** Plain-language introduction (guided); used when no Markdown override is set and at least one guided field is set. */
    guidedIntro?: string | null;
    /** Plain-language extra preferences (guided). */
    guidedExtraRules?: string | null;
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
    const rawOverride =
        typeof options?.promptTemplateMarkdown === "string" ? options.promptTemplateMarkdown.trim() : "";
    const gIntro =
        typeof options?.guidedIntro === "string" ? options.guidedIntro.trim() : "";
    const gExtra =
        typeof options?.guidedExtraRules === "string" ? options.guidedExtraRules.trim() : "";

    let template: string;
    if (rawOverride) {
        template = rawOverride;
    }
    else if (gIntro || gExtra) {
        template = buildGuidedExtractionProductNamePromptMarkdown(gIntro, gExtra);
    }
    else {
        template = loadDefaultExtractionProductNamePromptMarkdown();
    }
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
