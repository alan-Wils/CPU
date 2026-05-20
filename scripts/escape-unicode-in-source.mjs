import fs from "fs";
import path from "path";

const ROOT = process.cwd();

const TARGETS = [
  "app/extraction/page.tsx",
  "components/extraction",
  "lib/weightUnits.ts",
  "lib/freshFrozenPackageDisplay.ts",
  "lib/extractionSourceHarvestGroups.ts",
  "lib/extractionBatchDisplay.ts",
  "lib/extractionYieldHelpers.ts",
  "lib/extractionMergeHelpers.ts",
];

const MOJI_FIX = [
  ["\u00c2\u00b7", "\u00b7"],
  ["\u00e2\u2020\u2019", "\u2192"],
  ["\u00e2\u20ac\u201d", "\u2014"],
  ["\u00e2\u20ac\u00a6", "..."],
];

/** Only escape inside quoted JS strings — never in raw JSX text nodes. */
function escapeInQuotedStrings(text) {
  let out = "";
  let i = 0;
  let mode = "code"; // code | sq | dq | bt | lineComment | blockComment

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (mode === "lineComment") {
      out += ch;
      if (ch === "\n") mode = "code";
      i += 1;
      continue;
    }

    if (mode === "blockComment") {
      out += ch;
      if (ch === "*" && next === "/") {
        out += "/";
        i += 2;
        mode = "code";
      } else {
        i += 1;
      }
      continue;
    }

    if (mode === "code") {
      if (ch === "/" && next === "/") {
        out += ch + next;
        i += 2;
        mode = "lineComment";
        continue;
      }
      if (ch === "/" && next === "*") {
        out += ch + next;
        i += 2;
        mode = "blockComment";
        continue;
      }
      if (ch === "'") {
        out += ch;
        i += 1;
        mode = "sq";
        continue;
      }
      if (ch === '"') {
        out += ch;
        i += 1;
        mode = "dq";
        continue;
      }
      if (ch === "`") {
        out += ch;
        i += 1;
        mode = "bt";
        continue;
      }
      out += ch;
      i += 1;
      continue;
    }

    const stringMode = mode;
    if (ch === "\\") {
      out += ch + (next ?? "");
      i += 2;
      continue;
    }

    if (
      (stringMode === "sq" && ch === "'") ||
      (stringMode === "dq" && ch === '"') ||
      (stringMode === "bt" && ch === "`")
    ) {
      out += ch;
      i += 1;
      mode = "code";
      continue;
    }

    if (ch === "\u00b7") {
      out += "\\u00b7";
      i += 1;
      continue;
    }
    if (ch === "\u2192") {
      out += "\\u2192";
      i += 1;
      continue;
    }
    if (ch === "\u2014") {
      out += "\\u2014";
      i += 1;
      continue;
    }
    if (ch === "\u25b6") {
      out += "\\u25b6";
      i += 1;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

function collectFiles(entry) {
  const abs = path.join(ROOT, entry);
  if (!fs.existsSync(abs)) return [];
  const stat = fs.statSync(abs);
  if (stat.isFile()) return [abs];
  const out = [];
  for (const name of fs.readdirSync(abs)) {
    const child = path.join(abs, name);
    const childStat = fs.statSync(child);
    if (childStat.isDirectory()) out.push(...collectFiles(path.relative(ROOT, child)));
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(child);
  }
  return out;
}

let total = 0;
for (const entry of TARGETS) {
  for (const file of collectFiles(entry)) {
    let text = fs.readFileSync(file, "utf8");
    let changed = false;

    for (const [bad, good] of MOJI_FIX) {
      if (text.includes(bad)) {
        text = text.split(bad).join(good);
        changed = true;
      }
    }

    const escaped = escapeInQuotedStrings(text);
    if (escaped !== text) {
      text = escaped;
      changed = true;
    }

    if (changed) {
      fs.writeFileSync(file, text, "utf8");
      total += 1;
      console.log("updated", path.relative(ROOT, file));
    }
  }
}
console.log(total ? `Done. ${total} file(s) updated.` : "No changes needed.");
