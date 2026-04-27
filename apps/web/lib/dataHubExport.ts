import * as XLSX from "xlsx";

import { computeChainExportSummary } from "./dataHubChainMetrics";

export type DataHubChainExportRow = {
  "Batch ID": string;
  Strain: string;
  Stage: string;
  Status: string;
  Room: string;
  Bay: string;
  Plants: string | number;
  "Source #": number;
  "Flower #": number;
  "Extraction #": number;
  "Packaging #": number;
  "A Grade flower (lbs)": number | string;
  "Popcorn (lbs)": number | string;
  "Trim (lbs)": number | string;
  "Extraction products": string;
  "Packaging products": string;
};

const EMPTY_SUMMARY_ROW: DataHubChainExportRow = {
  "Batch ID": "",
  Strain: "",
  Stage: "",
  Status: "",
  Room: "",
  Bay: "",
  Plants: "",
  "Source #": 0,
  "Flower #": 0,
  "Extraction #": 0,
  "Packaging #": 0,
  "A Grade flower (lbs)": "",
  "Popcorn (lbs)": "",
  "Trim (lbs)": "",
  "Extraction products": "",
  "Packaging products": "",
};

function stampFilename(base: string) {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${base}-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function safeSheetName(name: string) {
  return name.replace(/[:\\/?*[\]]/g, "-").slice(0, 31) || "Sheet";
}

function cell(v: any): string | number {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return JSON.stringify(v);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Flatten nested objects for tabular export; shallow objects one level, deeper as JSON. */
function flattenObject(obj: any, prefix = ""): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v === null || v === undefined) {
      out[key] = "";
    } else if (Array.isArray(v)) {
      out[key] = cell(v);
    } else if (v instanceof Date) {
      out[key] = v.toISOString();
    } else if (typeof v === "object") {
      const flat = flattenObject(v, key);
      if (Object.keys(flat).length <= 12) {
        Object.assign(out, flat);
      } else {
        out[key] = cell(v);
      }
    } else {
      out[key] = cell(v);
    }
  }
  return out;
}

function unionKeys(rows: Record<string, string | number>[]): string[] {
  const s = new Set<string>();
  for (const r of rows) {
    Object.keys(r).forEach((k) => s.add(k));
  }
  const first = ["Chain batch ID", "Strain"];
  const rest = Array.from(s)
    .filter((k) => !first.includes(k))
    .sort();
  return [...first.filter((k) => s.has(k)), ...rest];
}

function alignRows(
  rows: Record<string, string | number>[],
  preferredFirst: string[]
): Record<string, string | number>[] {
  if (rows.length === 0) return [];
  const keys = unionKeys(rows);
  const ordered = [...preferredFirst.filter((k) => keys.includes(k)), ...keys.filter((k) => !preferredFirst.includes(k))];
  return rows.map((r) => {
    const o: Record<string, string | number> = {};
    for (const k of ordered) {
      o[k] = r[k] ?? "";
    }
    return o;
  });
}

function chainsToRows(chains: any[]): DataHubChainExportRow[] {
  return chains.map((ch) => {
    const s = computeChainExportSummary(ch);
    return {
      "Batch ID": String(ch.cultivation?.id ?? ""),
      Strain: String(ch.cultivation?.strain ?? ""),
      Stage: String(ch.cultivation?.stage ?? ""),
      Status: String(ch.cultivation?.status ?? ""),
      Room: String(ch.cultivation?.flowerRoom ?? ch.cultivation?.room ?? ""),
      Bay: String(ch.cultivation?.flowerBay ?? ch.cultivation?.bay ?? ""),
      Plants: ch.cultivation?.plants ?? "",
      "Source #": ch.source?.length ?? 0,
      "Flower #": ch.flowerOutput?.length ?? 0,
      "Extraction #": ch.extraction?.length ?? 0,
      "Packaging #": ch.packaging?.length ?? 0,
      "A Grade flower (lbs)": s.aGradeLbs,
      "Popcorn (lbs)": s.popcornLbs,
      "Trim (lbs)": s.trimLbs,
      "Extraction products": s.extractionProductSummary,
      "Packaging products": s.packagingProductSummary,
    };
  });
}

function chainHeader(ch: any) {
  return {
    "Chain batch ID": String(ch.cultivation?.id ?? ""),
    Strain: String(ch.cultivation?.strain ?? ""),
  };
}

/** Full pipeline export: one workbook, multiple tables (sheets) for selected chains. */
export function downloadDataHubFullXlsx(chains: any[], baseName = "data-hub-full") {
  if (!chains || chains.length === 0) {
    return;
  }

  const summaryRows = chainsToRows(chains);
  const cultivationRows: Record<string, string | number>[] = [];
  const sourceRows: Record<string, string | number>[] = [];
  const flowerRows: Record<string, string | number>[] = [];
  const extractionRows: Record<string, string | number>[] = [];
  const packagingRows: Record<string, string | number>[] = [];

  for (const ch of chains) {
    const h = chainHeader(ch);
    cultivationRows.push({
      ...h,
      ...flattenObject(ch.cultivation || {}),
      "Cultivation dbId": String(ch.cultivation?.dbId || "")
    });

    for (const s of ch.source || []) {
      sourceRows.push({ ...h, ...flattenObject(s) });
    }
    for (const f of ch.flowerOutput || []) {
      flowerRows.push({ ...h, ...flattenObject(f) });
    }
    for (const e of ch.extraction || []) {
      extractionRows.push({ ...h, ...flattenObject(e) });
    }
    for (const p of ch.packaging || []) {
      packagingRows.push({ ...h, ...flattenObject(p) });
    }
  }

  const wb = XLSX.utils.book_new();

  const mk = (name: string, raw: Record<string, string | number>[]) => {
    if (raw.length === 0) {
      const ws = XLSX.utils.aoa_to_sheet([["No rows for the selected chain(s) in this section."]]);
      XLSX.utils.book_append_sheet(wb, ws, safeSheetName(name));
      return;
    }
    const aligned = alignRows(raw, ["Chain batch ID", "Strain"]);
    const ws = XLSX.utils.json_to_sheet(aligned);
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(name));
  };

  {
    const ws = XLSX.utils.json_to_sheet(summaryRows);
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName("00-Summary"));
  }
  mk("01-Cultivation", cultivationRows);
  mk("02-Source", sourceRows);
  mk("03-Flower output", flowerRows);
  mk("04-Extraction", extractionRows);
  mk("05-Packaging", packagingRows);

  XLSX.writeFile(wb, `${stampFilename(baseName)}.xlsx`);
}

export function downloadDataHubXlsx(chains: any[], baseName = "data-hub-chains") {
  const rows = chainsToRows(chains);
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [EMPTY_SUMMARY_ROW]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Summary");
  XLSX.writeFile(wb, `${stampFilename(baseName)}.xlsx`);
}

export function downloadDataHubCsv(chains: any[], baseName = "data-hub-chains") {
  const rows = chainsToRows(chains);
  if (rows.length === 0) {
    const h: (keyof DataHubChainExportRow)[] = [
      "Batch ID",
      "Strain",
      "Stage",
      "Status",
      "Room",
      "Bay",
      "Plants",
      "Source #",
      "Flower #",
      "Extraction #",
      "Packaging #",
      "A Grade flower (lbs)",
      "Popcorn (lbs)",
      "Trim (lbs)",
      "Extraction products",
      "Packaging products",
    ];
    const empty = h.join(",") + "\n";
    const blob = new Blob(["\uFEFF" + empty], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${stampFilename(baseName)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  const headers = Object.keys(rows[0]) as (keyof DataHubChainExportRow)[];
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))];
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${stampFilename(baseName)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadDataHubFullCsv(chains: any[], baseName = "data-hub-full") {
  if (!chains || chains.length === 0) return;
  const sections: string[] = [];
  const esc = (v: any) => {
    const s = String(v ?? "");
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const tableToCsv = (title: string, rows: Record<string, string | number>[]) => {
    if (rows.length === 0) {
      sections.push(`"${title}"`, "No rows", "");
      return;
    }
    const keys = unionKeys(rows);
    sections.push(`"${title}"`, keys.map(esc).join(","));
    for (const r of rows) {
      sections.push(keys.map((k) => esc(r[k])).join(","));
    }
    sections.push("");
  };

  for (const ch of chains) {
    const h = chainHeader(ch);
    sections.push(`"CHAIN ${h["Chain batch ID"]} — ${h.Strain}"`, "");
    const cultivationRows: Record<string, string | number>[] = [
      { ...h, ...flattenObject(ch.cultivation || {}), "Cultivation dbId": String(ch.cultivation?.dbId || "") }
    ];
    const sourceRows: Record<string, string | number>[] = (ch.source || []).map((s: any) => ({
      ...h,
      ...flattenObject(s)
    }));
    const flowerRows: Record<string, string | number>[] = (ch.flowerOutput || []).map((f: any) => ({
      ...h,
      ...flattenObject(f)
    }));
    const extractionRows: Record<string, string | number>[] = (ch.extraction || []).map((e: any) => ({
      ...h,
      ...flattenObject(e)
    }));
    const packagingRows: Record<string, string | number>[] = (ch.packaging || []).map((p: any) => ({
      ...h,
      ...flattenObject(p)
    }));
    tableToCsv("Cultivation", alignRows(cultivationRows, ["Chain batch ID", "Strain"]));
    tableToCsv("Source material", alignRows(sourceRows, ["Chain batch ID", "Strain"]));
    tableToCsv("Flower output", alignRows(flowerRows, ["Chain batch ID", "Strain"]));
    tableToCsv("Extraction", alignRows(extractionRows, ["Chain batch ID", "Strain"]));
    tableToCsv("Packaging", alignRows(packagingRows, ["Chain batch ID", "Strain"]));
  }

  const blob = new Blob(["\uFEFF" + sections.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${stampFilename(baseName)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
