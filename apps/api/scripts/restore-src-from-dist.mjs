// One-off recovery: copy dist .js tree into src as .ts (dist is gitignored). Run from repo root.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "..");
const distRoot = path.join(apiRoot, "dist");
const srcRoot = path.join(apiRoot, "src");

function walkJs(dir, files = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkJs(p, files);
    else if (ent.isFile() && ent.name.endsWith(".js") && !ent.name.endsWith(".map")) files.push(p);
  }
  return files;
}

if (!fs.existsSync(distRoot)) {
  console.error("Missing apps/api/dist — build or copy artifacts locally first.");
  process.exit(1);
}

const jsFiles = walkJs(distRoot);
let n = 0;
for (const jsPath of jsFiles) {
  const rel = path.relative(distRoot, jsPath);
  const tsPath = path.join(srcRoot, rel.replace(/\.js$/, ".ts"));
  fs.mkdirSync(path.dirname(tsPath), { recursive: true });
  fs.copyFileSync(jsPath, tsPath);
  n++;
}
console.log(`Restored ${n} files from dist/ → src/`);
