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

const UNICODE_TO_ESCAPE = [
  ["\u00b7", "\\u00b7"],
  ["\u2192", "\\u2192"],
  ["\u2014", "\\u2014"],
  ["\u25b6", "\\u25b6"],
];

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

function escapeFile(filePath) {
  let text = fs.readFileSync(filePath, "utf8");
  let changed = false;

  for (const [bad, good] of MOJI_FIX) {
    if (text.includes(bad)) {
      text = text.split(bad).join(good);
      changed = true;
      console.log(`  fixed mojibake ${JSON.stringify(bad)} in ${path.relative(ROOT, filePath)}`);
    }
  }

  for (const [ch, esc] of UNICODE_TO_ESCAPE) {
    if (!text.includes(ch)) continue;
    // Skip if already escaped (preceded by backslash)
    const parts = text.split(ch);
    if (parts.length <= 1) continue;
    let rebuilt = parts[0];
    for (let i = 1; i < parts.length; i++) {
      const prev = rebuilt;
      const endsWithEscape = /\\u[0-9a-fA-F]{4}$/.test(prev.slice(-6)) || prev.endsWith("\\");
      rebuilt += endsWithEscape ? ch : esc;
      rebuilt += parts[i];
    }
    if (rebuilt !== text) {
      text = rebuilt;
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(filePath, text, "utf8");
  }
  return changed;
}

let total = 0;
for (const entry of TARGETS) {
  for (const file of collectFiles(entry)) {
    if (escapeFile(file)) {
      total += 1;
      console.log("updated", path.relative(ROOT, file));
    }
  }
}
console.log(total ? `Done. ${total} file(s) updated.` : "No changes needed.");
