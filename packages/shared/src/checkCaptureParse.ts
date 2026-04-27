/**
 * Shared US-style check OCR text parsing with per-field confidence heuristics.
 * Used by API (OCR.space) and web (browser OCR). Does not perform OCR itself.
 */

export type CheckFieldKey =
  | "checkDate"
  | "amount"
  | "checkNumber"
  | "payerName"
  | "drawerName"
  | "payeeName"
  | "routingNumber"
  | "accountNumber"
  | "bankName"
  | "memo"
  | "writtenAmount";

export type CheckParsedFlat = {
  checkDate?: string;
  amount?: number;
  checkNumber?: string;
  payerName?: string;
  routingNumber?: string;
  accountNumber?: string;
  bankName?: string;
  memo?: string;
  /** Optional: legal line / written dollars if detected */
  writtenAmount?: string;
  /** Drawer / customer name (header), distinct from payee when detectable */
  drawerName?: string;
  /** Same as payee line when labeled separately */
  payeeName?: string;
};

export type CheckParseResult = CheckParsedFlat & {
  confidenceByField: Partial<Record<CheckFieldKey, number>>;
  /** Concatenated OCR used for parsing */
  rawText: string;
  /** Optional map of region id → raw snippet (filled by client region OCR) */
  croppedRegionText?: Record<string, string>;
  parseQuality: "strong" | "weak" | "empty";
  warnings: string[];
};

const MONTH_NAME =
  /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/i;
const MONTH_MAP: Record<string, string> = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12"
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Prefer largest plausible amount from OCR noise. */
export function extractPrimaryCheckAmount(raw: string): number | undefined {
  const text = String(raw || "").replace(/\r/g, "");
  const candidates: number[] = [];

  const pushAmount = (intPart: string, cents: string) => {
    const left = String(intPart || "").replace(/,/g, "");
    if (!/^\d+$/.test(left)) return;
    if (!/^\d{2}$/.test(cents)) return;
    const n = Number(`${left}.${cents}`);
    if (!Number.isFinite(n) || n < 0.01 || n > 99_000_000) return;
    candidates.push(n);
  };

  const dollarRe = /\$\s*([\d,]+)\.(\d{2})\b/g;
  let m: RegExpExecArray | null;
  while ((m = dollarRe.exec(text)) !== null) {
    pushAmount(m[1], m[2]);
  }

  const commaGroupRe = /\b([\d]{1,3}(?:,[\d]{3})+)\.(\d{2})\b/g;
  while ((m = commaGroupRe.exec(text)) !== null) {
    pushAmount(m[1], m[2]);
  }

  const wideIntRe = /\b(\d{4,})\.(\d{2})\b/g;
  while ((m = wideIntRe.exec(text)) !== null) {
    pushAmount(m[1], m[2]);
  }

  if (!candidates.length) return undefined;
  return Math.max(...candidates);
}

function amountConfidence(raw: string, amount?: number): number {
  if (amount == null) return 0;
  const text = String(raw || "");
  const dollarMatches = (text.match(/\$\s*[\d,]+\.\d{2}\b/g) || []).length;
  const strong = /\$\s*[\d,]{1,12}\.\d{2}\b/.test(text);
  if (strong) return 0.92;
  if (dollarMatches >= 2) return 0.75;
  if (dollarMatches === 1) return 0.7;
  return 0.45;
}

/** Tolerant date: O/0 confusion in month/day, optional separators */
function parseCheckDateLoose(raw: string): { iso?: string; confidence: number } {
  const d1 = raw.match(/\b(0?[1-9]|1[0-2])[\/\-.](0?[1-9]|[12]\d|3[01])[\/\-.](\d{2,4})\b/);
  if (d1) {
    const [mm, dd, yyyy] = [d1[1], d1[2], d1[3]];
    const year = yyyy.length === 2 ? `20${yyyy}` : yyyy;
    const iso = `${year}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
    return { iso, confidence: 0.88 };
  }
  const d2 = raw.match(MONTH_NAME);
  if (d2) {
    const mon = MONTH_MAP[d2[1].toLowerCase()];
    if (mon) {
      const iso = `${d2[3]}-${mon}-${d2[2].padStart(2, "0")}`;
      return { iso, confidence: 0.85 };
    }
  }
  const d3 = raw.match(/\b(20\d{2})[\/\-.](0?[1-9]|1[0-2])[\/\-.](0?[1-9]|[12]\d|3[01])\b/);
  if (d3) {
    const iso = `${d3[1]}-${d3[2].padStart(2, "0")}-${d3[3].padStart(2, "0")}`;
    return { iso, confidence: 0.72 };
  }
  return { confidence: 0 };
}

function parseWrittenAmountLine(raw: string): { text?: string; confidence: number } {
  const m = raw.match(
    /\b(?:ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN|ELEVEN|TWELVE|THIRTEEN|FOURTEEN|FIFTEEN|SIXTEEN|SEVENTEEN|EIGHTEEN|NINETEEN|TWENTY|THIRTY|FORTY|FIFTY|SIXTY|SEVENTY|EIGHTY|NINETY|HUNDRED|THOUSAND|MILLION|AND|ONLY|DOLLARS|CENTS|\s|\d|,|-)+\s*(?:DOLLARS|dollars)?\s*(?:AND\s+)?(?:\d{2}\/\d{2})?\s*(?:CENTS|cents)?/i
  );
  if (m) {
    const t = m[0].replace(/\s+/g, " ").trim().slice(0, 220);
    if (t.length > 6) return { text: t, confidence: 0.55 };
  }
  return { confidence: 0 };
}

/**
 * Parse concatenated OCR text (optionally with region snippets in `croppedRegionText`).
 */
export function parseCheckOcrTextWithConfidence(
  raw: string,
  croppedRegionText?: Record<string, string>
): CheckParseResult {
  const text = String(raw || "").replace(/\r/g, "");
  const warnings: string[] = [];
  const confidenceByField: Partial<Record<CheckFieldKey, number>> = {};

  if (!text.trim()) {
    return {
      confidenceByField: {},
      rawText: text,
      croppedRegionText,
      parseQuality: "empty",
      warnings: ["No OCR text"]
    };
  }

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const { iso: checkDate, confidence: dateConf } = parseCheckDateLoose(text);
  if (checkDate) confidenceByField.checkDate = dateConf;

  const amount = extractPrimaryCheckAmount(text);
  if (amount != null) {
    confidenceByField.amount = amountConfidence(text, amount);
  }

  let payerName: string | undefined;
  const payeeBlock = text.match(/PAY\s+TO\s+THE\s+ORDER\s+OF\s*\n?\s*(.+?)(?:\n{2,}|$)/is);
  if (payeeBlock) {
    payerName = payeeBlock[1]
      .split("\n")[0]
      ?.trim()
      .replace(/\s+/g, " ")
      .slice(0, 200);
  }
  if (!payerName) {
    const payee2 = text.match(/PAY\s+TO\s+THE\s+ORDER\s+OF\s+(.+)/i);
    if (payee2) payerName = payee2[1].trim().replace(/\s+/g, " ").slice(0, 200);
  }
  if (payerName) {
    const noise = /[^a-zA-Z0-9\s,.&'-]/.test(payerName) ? 0.1 : 0;
    confidenceByField.payerName = clamp01(0.82 - noise);
    confidenceByField.payeeName = confidenceByField.payerName;
  }

  let drawerName: string | undefined;
  const headerLine = lines.find(
    (l) =>
      /(llc|inc\.?|corp|company|co\.|ltd)/i.test(l) &&
      !/pay\s+to/i.test(l) &&
      l.length > 3 &&
      l.length < 120
  );
  if (headerLine && headerLine !== payerName) {
    drawerName = headerLine;
    confidenceByField.drawerName = 0.55;
  }

  let checkNumber: string | undefined;
  const cn1 = text.match(/(?:CHECK|CHK)\s*#?\s*[:]?\s*(\d{2,12})/i);
  const cn2 = text.match(/\bNo\.?\s*#?\s*(\d{2,12})\b/i);
  if (cn1) checkNumber = cn1[1];
  else if (cn2) checkNumber = cn2[1];
  if (checkNumber) confidenceByField.checkNumber = 0.75;

  let routingNumber: string | undefined;
  let accountNumber: string | undefined;
  const micr = text.replace(/\s+/g, " ").match(/(\d{9})\D+(\d{4,17})\D+(\d{2,10})\b/);
  if (micr) {
    routingNumber = micr[1];
    accountNumber = micr[2];
    if (!checkNumber) checkNumber = micr[3];
    confidenceByField.routingNumber = 0.9;
    confidenceByField.accountNumber = 0.88;
    if (checkNumber === micr[3]) confidenceByField.checkNumber = Math.max(confidenceByField.checkNumber ?? 0, 0.85);
  } else {
    const rt = text.match(/\b(\d{9})\b/);
    if (rt) {
      routingNumber = rt[1];
      confidenceByField.routingNumber = 0.45;
      warnings.push("Routing detected without full MICR context");
    }
    const accts = text.match(/\b(\d{10,17})\b/g);
    if (accts) {
      accountNumber = accts.find((a) => a !== routingNumber);
      if (accountNumber) confidenceByField.accountNumber = 0.42;
    }
  }

  const memoLine = lines.find((line) => /^memo[:\s]/i.test(line)) || "";
  let memo = memoLine ? memoLine.replace(/^memo[:\s]*/i, "").trim() : undefined;
  if (!memo) {
    const memoLabelIdx = lines.findIndex((line) => /^memo[:\s]*$/i.test(line));
    if (memoLabelIdx >= 0) {
      memo = String(lines[memoLabelIdx + 1] || "").trim() || undefined;
    }
  }
  if (!memo) {
    memo =
      lines.find((line) => /\b\d{3,}\s+[A-Z]{1,4}\s+\d{3,}\b/i.test(line) && line.length <= 60) || undefined;
  }
  if (memo) confidenceByField.memo = /^memo/i.test(memoLine) ? 0.72 : 0.48;

  const bankName =
    lines.find((line) => /(bank|credit union|financial|N\.A\.|N\.A\b)/i.test(line) && line.length <= 120) ||
    undefined;
  if (bankName) confidenceByField.bankName = 0.65;

  if (!payerName) {
    payerName =
      lines.find(
        (line) =>
          /(llc|inc|corp|company|healthcare|holdings|enterprises|group|services)/i.test(line) &&
          !/(bank|credit union|financial)/i.test(line) &&
          line.length <= 200
      ) || undefined;
    if (payerName) confidenceByField.payerName = 0.38;
  }

  const written = parseWrittenAmountLine(text);
  let writtenAmount = written.text;
  if (writtenAmount) confidenceByField.writtenAmount = written.confidence;

  const filled = Object.values(confidenceByField).filter((v) => v > 0).length;
  const strongFields = Object.values(confidenceByField).filter((v) => v >= 0.72).length;
  const parseQuality: CheckParseResult["parseQuality"] =
    strongFields >= 3 ? "strong" : filled >= 2 ? "weak" : "empty";

  if (parseQuality === "weak" || parseQuality === "empty") {
    warnings.push("Some fields have low confidence — please review before saving.");
  }

  return {
    checkDate,
    amount,
    checkNumber,
    payerName,
    routingNumber,
    accountNumber,
    bankName,
    memo,
    writtenAmount,
    drawerName,
    payeeName: payerName,
    confidenceByField,
    rawText: text,
    croppedRegionText,
    parseQuality,
    warnings
  };
}

function fieldScore(v: unknown): number {
  if (v === undefined || v === null) return 0;
  if (typeof v === "string") return v.trim() ? v.trim().length : 0;
  if (typeof v === "number") return Number.isFinite(v) ? 1 : 0;
  return 1;
}

/**
 * Merge `incoming` into `base`, only overwriting when incoming confidence is better
 * or base field is empty (with optional minimum gain to avoid noise).
 */
export function mergeCheckParsedPreferBetter(
  base: CheckParseResult,
  incoming: CheckParseResult,
  minGain = 0.08
): CheckParseResult {
  const keys: CheckFieldKey[] = [
    "checkDate",
    "amount",
    "checkNumber",
    "payerName",
    "routingNumber",
    "accountNumber",
    "bankName",
    "memo",
    "writtenAmount",
    "drawerName"
  ];

  const out: CheckParseResult = {
    ...base,
    confidenceByField: { ...base.confidenceByField },
    warnings: [...(base.warnings || []), ...(incoming.warnings || [])],
    rawText: [base.rawText, incoming.rawText].filter(Boolean).join("\n---\n"),
    croppedRegionText: { ...base.croppedRegionText, ...incoming.croppedRegionText },
    parseQuality: base.parseQuality
  };

  const flatKey = (k: CheckFieldKey): keyof CheckParsedFlat | null => {
    if (k === "payeeName") return "payerName";
    return k as keyof CheckParsedFlat;
  };

  for (const k of keys) {
    const confIn = incoming.confidenceByField[k];
    if (confIn == null) continue;
    const confBase = out.confidenceByField[k] ?? 0;
    const fk = flatKey(k);
    if (!fk) continue;
    const vIn = incoming[fk] as unknown;
    const vBase = out[fk] as unknown;

    const baseEmpty = vBase === undefined || vBase === null || (typeof vBase === "string" && !String(vBase).trim());
    const better = confIn >= confBase + minGain || (baseEmpty && confIn >= 0.35 && fieldScore(vIn) > 0);

    if (better && vIn !== undefined && vIn !== null && (typeof vIn !== "string" || vIn.trim())) {
      (out as Record<string, unknown>)[fk] = vIn;
      out.confidenceByField[k] = confIn;
    }
  }

  const strong = Object.values(out.confidenceByField).filter((c) => c >= 0.72).length;
  out.parseQuality = strong >= 3 ? "strong" : Object.keys(out.confidenceByField).length >= 2 ? "weak" : "empty";
  return out;
}

/** Flatten to API `parsed` shape (no extra keys) */
export function toFlatParsedForApi(r: CheckParseResult): CheckParsedFlat {
  return {
    checkDate: r.checkDate,
    amount: r.amount,
    checkNumber: r.checkNumber,
    payerName: r.payerName ?? r.payeeName,
    routingNumber: r.routingNumber,
    accountNumber: r.accountNumber,
    bankName: r.bankName,
    memo: r.memo,
    writtenAmount: r.writtenAmount,
    drawerName: r.drawerName,
    payeeName: r.payeeName
  };
}
