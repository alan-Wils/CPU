import fs from "fs";

const p = "app/extraction/page.tsx";
let t = fs.readFileSync(p, "utf8");
const reps = [
  ["\u00e2\u20ac\u201d", "\u2014"],
  ["\u00e2\u20ac\u2122", "'"],
  ["\u00e2\u20ac\u00a6", "..."],
  ["\u00e2\u2020\u2019", "\u2192"],
  ["\u00c2\u00b7", "\u00b7"],
];
for (const [a, b] of reps) {
  if (t.includes(a)) {
    t = t.split(a).join(b);
    console.log("replaced", JSON.stringify(a), "->", b);
  }
}
fs.writeFileSync(p, t, "utf8");
console.log("done");
