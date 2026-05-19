/**
 * Chain naming: clone → flower (cultivation batch), harvest → extraction source,
 * extraction run → market lot code. All use `ACRONYM.MMDDYY` with `.N.` when duplicated same day.
 */

export function makeDateCode(date: string): string {
  const value = date || new Date().toISOString().slice(0, 10);
  const parts = value.split("-");

  if (parts.length === 3) {
    const yyyy = parts[0] || "";
    const mm = parts[1] || "";
    const dd = parts[2] || "";
    return `${mm}${dd}${yyyy.slice(-2)}`;
  }

  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) {
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const yy = String(d.getFullYear()).slice(-2);
    return `${mm}${dd}${yy}`;
  }

  return value.replaceAll("-", "").slice(-6);
}

function normalizeAcronym(acronym: string): string {
  return String(acronym || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .trim()
    .toUpperCase() || "BATCH";
}

/** Cultivation clone/flower batch id, harvest source package id, or market-style code. */
export function makeChainBatchCode(
  acronym: string,
  date: string,
  existingIds: Array<string | { id?: unknown }> = [],
): string {
  const cleanAcronym = normalizeAcronym(acronym);
  const dateCode = makeDateCode(date);

  const sameStrainSameDay = existingIds.filter((row) => {
    const id = String(typeof row === "string" ? row : row?.id || "");
    return (
      id === `${cleanAcronym}.${dateCode}` ||
      (id.startsWith(`${cleanAcronym}.`) && id.endsWith(`.${dateCode}`))
    );
  });

  if (sameStrainSameDay.length === 0) {
    return `${cleanAcronym}.${dateCode}`;
  }

  return `${cleanAcronym}.${sameStrainSameDay.length + 1}.${dateCode}`;
}

export function parseChainBatchDateCode(id: unknown): string | null {
  const s = String(id || "").trim();
  if (!s) return null;
  const m = s.match(/\.(\d{6})$/);
  return m ? m[1] : null;
}

export function parseChainBatchAcronym(id: unknown): string | null {
  const s = String(id || "").trim();
  if (!s) return null;
  const head = s.split(".")[0] || "";
  const cleaned = normalizeAcronym(head);
  return cleaned === "BATCH" && !head ? null : cleaned;
}

/** Market lot code at extraction: strain acronym(s) + extraction date (MMDDYY). */
export function makeExtractionMarketBatchCode(
  acronyms: string[],
  extractionDate?: string,
): string {
  const unique = [
    ...new Set(acronyms.map((a) => normalizeAcronym(a)).filter((a) => a && a !== "BATCH")),
  ];

  const dateCode = makeDateCode(extractionDate || new Date().toISOString().slice(0, 10));

  if (unique.length === 1) {
    return `${unique[0]}.${dateCode}`;
  }

  let core = "MIXX";
  if (unique.length === 2) {
    const a = unique[0];
    const b = unique[1];
    core = `${(a + "XX").slice(0, 2)}${(b + "XX").slice(0, 2)}`.toUpperCase().slice(0, 4);
  } else if (unique.length > 2) {
    core = unique
      .map((u) => (u.charAt(0) || "X").toUpperCase())
      .join("")
      .concat("XXXX")
      .slice(0, 4);
  }

  return `${core}.${dateCode}`;
}
