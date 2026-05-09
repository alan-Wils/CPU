import type { MarketplaceProductDto } from "@/lib/api";

/** Showcase order + labels for company selector (match UX mockup). */
export const MARKETPLACE_SHOWCASE_COMPANY_NAMES = [
  "BudFox",
  "LeafLife Farms",
  "Green Peak",
  "TrueNorth",
  "Solvent Labs",
  "Peak Extracts",
  "GreenBite",
  "Solventless Labs",
] as const;

export type MarketplaceCategoryId =
  | "all"
  | "flower"
  | "popcorn"
  | "preRolls"
  | "concentrates"
  | "liveResin"
  | "rosin"
  | "vapes"
  | "edibles"
  | "tinctures"
  | "topicals"
  | "more";

export type MarketplaceSortId =
  | "newest"
  | "priceAsc"
  | "priceDesc"
  | "name"
  | "company"
  | "rating";

export type QuickFilterId = "flavors" | "topShelf" | "indoor" | "organic" | "smallBatch";

export type CompanyFilter =
  | { kind: "all" }
  | { kind: "seller"; id: string; name: string }
  | { kind: "name"; name: string };

export type BuyerMarketplaceRow = {
  raw: MarketplaceProductDto;
  isDemo: boolean;
  haystack: string;
  sellerCompanyId: string;
  sellerCompanyName: string;
  productName: string;
  categoryLabel: string;
  displayCategoryBadge: string;
  priceUnit: string;
  minOrderQty: number;
  minOrderUnit: string;
  tags: string[];
  strainType: "Hybrid" | "Indica" | "Sativa" | "";
  state: string;
  rating: number;
  reviewCount: number;
  coaAvailable: boolean;
  labTested: boolean;
  updatedAtMs: number;
  thcBadge: string | null;
};

const DEMO_PREFIX = "demo-";

function hashTo01(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
}

export function inferStrainType(text: string): "Hybrid" | "Indica" | "Sativa" | "" {
  const t = text.toLowerCase();
  const hasIndica = /\bindica\b/.test(t);
  const hasSativa = /\bsativa\b/.test(t);
  const hasHybrid = /\bhybrid\b/.test(t);
  if (hasHybrid || (hasIndica && hasSativa)) return "Hybrid";
  if (hasIndica && !hasSativa) return "Indica";
  if (hasSativa && !hasIndica) return "Sativa";
  return "";
}

export function stableRating(id: string): { rating: number; reviewCount: number } {
  const r = 4.15 + hashTo01(id) * 0.75;
  const reviews = 12 + Math.floor(hashTo01(`${id}:rev`) * 180);
  return { rating: Math.round(r * 10) / 10, reviewCount: reviews };
}

function parseThcBadge(h: string): string | null {
  const m = h.match(/\b(\d{2,4})\s*mg\b[^a-z]{0,6}thc\b|\b(\d{2,4})\s*mg\s*thc\b/i);
  if (m) return `${m[1] || m[2]}mg THC`;
  if (/\b100\s*mg\b/i.test(h) && /thc|edible|gumm/i.test(h)) return "100mg THC";
  return null;
}

function buildHaystack(p: MarketplaceProductDto): string {
  return [
    p.name,
    p.description,
    p.category,
    p.productType,
    p.strainName,
    p.flavorName,
    p.sku,
    p.unitSize,
    p.company?.name,
    p.company?.slug,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function derivePriceUnit(unitSize: string | null | undefined): string {
  const u = String(unitSize || "").trim().toLowerCase();
  if (!u) return "unit";
  if (/\blb\b|pound/.test(u)) return "lb";
  if (/unit|each|ea\b/.test(u)) return "unit";
  if (/g\b|gram/.test(u)) return "g";
  return unitSize!.trim() || "unit";
}

function deriveMinOrder(p: MarketplaceProductDto): { qty: number; unit: string } {
  const u = derivePriceUnit(p.unitSize);
  if (u === "lb") return { qty: 1, unit: "lb" };
  if (u === "g") return { qty: Math.min(5, Math.max(1, Math.ceil(p.quantityAvailable > 0 ? 5 : 1))), unit: "g" };
  if (/\b100\b/.test(String(p.name)) && /pre-?roll|preroll/i.test(String(p.name))) return { qty: 100, unit: "Units" };
  if (/gumm|edible/i.test(buildHaystack(p))) return { qty: 10, unit: "Units" };
  if (/vape|cart|disposable/i.test(buildHaystack(p))) return { qty: 50, unit: "Units" };
  return { qty: 1, unit: u === "unit" ? "Units" : u };
}

function displayCategoryFromProduct(p: MarketplaceProductDto, haystack: string): string {
  const pt = String(p.productType || "").trim();
  const cat = String(p.category || "").trim();
  if (pt) return pt;
  if (cat) return cat;
  if (/live rosin/i.test(haystack)) return "Live Rosin";
  if (/live resin/i.test(haystack)) return "Live Resin";
  if (/rosin/i.test(haystack)) return "Rosin";
  if (/gumm|edible|chocolate/i.test(haystack)) return "Edible";
  if (/vape|cart|disposable/i.test(haystack)) return "Vape";
  if (/flower|bud|smalls|popcorn/i.test(haystack)) return "Flower";
  if (/pre-?roll|joint/i.test(haystack)) return "Pre-Rolls";
  if (/diamond|concentrate|badder|wax|shatter|sugar/i.test(haystack)) return "Concentrate";
  return "Cannabis";
}

function badgeCategoryForCard(haystack: string, display: string): string {
  if (/live rosin/i.test(haystack)) return "Live Rosin";
  if (/live resin/i.test(haystack)) return "Live Resin";
  if (/\brosin\b/i.test(haystack)) return "Rosin";
  if (/pre-?roll|joint/i.test(haystack)) return "Pre-Rolls";
  if (/gumm|edible|chocolate/i.test(haystack)) return "Edibles";
  if (/vape|cart|cartridge|disposable/i.test(haystack)) return "Vapes";
  if (/tincture/i.test(haystack)) return "Tinctures";
  if (/topical|balm|lotion/i.test(haystack)) return "Topicals";
  if (/popcorn|smalls/i.test(haystack)) return "Popcorn";
  if (/flower|bud/i.test(haystack)) return "Flower";
  if (/diamond|badder|wax|shatter|sugar|dab/i.test(haystack)) return "Concentrates";
  return display;
}

export function normalizeBuyerProduct(p: MarketplaceProductDto): BuyerMarketplaceRow {
  const haystack = buildHaystack(p);
  const strainType = inferStrainType(`${p.strainName || ""} ${p.name} ${p.description || ""}`);
  const { rating, reviewCount } = stableRating(p.id);
  const sellerCompanyName = p.company?.name || "Seller";
  const displayCategoryBadge = badgeCategoryForCard(haystack, displayCategoryFromProduct(p, haystack));
  const priceUnit = derivePriceUnit(p.unitSize);
  const { qty: minOrderQty, unit: minOrderUnit } = deriveMinOrder(p);
  const tags: string[] = [];
  if (p.strainName) tags.push(p.strainName);
  if (p.flavorName) tags.push(p.flavorName);
  if (p.productType) tags.push(p.productType);
  if (p.category) tags.push(p.category);
  const thcBadge = parseThcBadge(haystack);
  const rawUpdated = (p as { updatedAt?: string }).updatedAt;
  const updatedAtMs = rawUpdated ? Date.parse(rawUpdated) : 0;

  let state = "";
  if (p.id.startsWith(DEMO_PREFIX)) {
    const stateByCo: Record<string, string> = {
      "demo-co-budfox": "CA",
      "demo-co-peak": "CO",
      "demo-co-truenorth": "OR",
    };
    state = stateByCo[p.companyId] || "";
  }

  return {
    raw: p,
    isDemo: p.id.startsWith(DEMO_PREFIX),
    haystack,
    sellerCompanyId: p.companyId,
    sellerCompanyName,
    productName: p.name,
    categoryLabel: displayCategoryFromProduct(p, haystack),
    displayCategoryBadge,
    priceUnit,
    minOrderQty,
    minOrderUnit,
    tags: [...new Set(tags.map((t) => t.trim()).filter(Boolean))],
    strainType,
    state,
    rating,
    reviewCount,
    coaAvailable: true,
    labTested: true,
    updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : 0,
    thcBadge,
  };
}

export function matchesCompanyFilter(row: BuyerMarketplaceRow, f: CompanyFilter): boolean {
  if (f.kind === "all") return true;
  if (f.kind === "seller") return row.sellerCompanyId === f.id;
  return row.sellerCompanyName.toLowerCase() === f.name.toLowerCase();
}

export function matchesSearch(row: BuyerMarketplaceRow, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return row.haystack.includes(s);
}

function hayHasAny(h: string, words: string[]): boolean {
  return words.some((w) => h.includes(w));
}

export function matchesCategory(row: BuyerMarketplaceRow, cat: MarketplaceCategoryId): boolean {
  if (cat === "all") return true;
  const h = row.haystack;
  switch (cat) {
    case "flower":
      return hayHasAny(h, ["flower", " bud", "top shelf", "buds"]) && !hayHasAny(h, ["pre-roll", "preroll", "joint"]);
    case "popcorn":
      return hayHasAny(h, ["popcorn", "smalls", "small bud"]);
    case "preRolls":
      return hayHasAny(h, ["pre-roll", "preroll", "joint"]);
    case "concentrates":
      if (hayHasAny(h, ["live resin", "live rosin", "rosin"])) return false;
      return hayHasAny(h, ["dab", "dabs", "sugar", "badder", "wax", "diamond", "shatter", "concentrate"]);
    case "liveResin":
      return hayHasAny(h, ["live resin", "live resin cart", "live resin disposable"]);
    case "rosin":
      return hayHasAny(h, ["rosin", "live rosin"]);
    case "vapes":
      return hayHasAny(h, ["vape", "cart", "cartridge", "disposable"]);
    case "edibles":
      return hayHasAny(h, ["gumm", "edible", "chocolate", "drink"]);
    case "tinctures":
      return h.includes("tincture");
    case "topicals":
      return hayHasAny(h, ["topical", "balm", "lotion"]);
    case "more": {
      const buckets: MarketplaceCategoryId[] = [
        "flower",
        "popcorn",
        "preRolls",
        "concentrates",
        "liveResin",
        "rosin",
        "vapes",
        "edibles",
        "tinctures",
        "topicals",
      ];
      return !buckets.some((c) => c !== "more" && matchesCategory(row, c));
    }
    default:
      return true;
  }
}

export function matchesQuickFilter(row: BuyerMarketplaceRow, q: QuickFilterId | null): boolean {
  if (!q) return true;
  const h = row.haystack;
  switch (q) {
    case "flavors":
      return (
        !!row.raw.flavorName ||
        hayHasAny(h, ["flavor", "watermelon", "pineapple", "berry", "citrus", "lemon", "cherry", "papaya"])
      );
    case "topShelf":
      return hayHasAny(h, ["top shelf", "premium", "craft", "small batch"]);
    case "indoor":
      return h.includes("indoor");
    case "organic":
      return h.includes("organic");
    case "smallBatch":
      return hayHasAny(h, ["small batch", "micro", "limited"]);
    default:
      return true;
  }
}

export function countQuickFilter(rows: BuyerMarketplaceRow[], q: QuickFilterId): number {
  return rows.filter((r) => matchesQuickFilter(r, q)).length;
}

export function matchesPriceRange(row: BuyerMarketplaceRow, min?: number, max?: number): boolean {
  const p = row.raw.price;
  if (typeof min === "number" && Number.isFinite(min) && p < min) return false;
  if (typeof max === "number" && Number.isFinite(max) && p > max) return false;
  return true;
}

export function sortBuyerRows(rows: BuyerMarketplaceRow[], sort: MarketplaceSortId): BuyerMarketplaceRow[] {
  const next = [...rows];
  switch (sort) {
    case "priceAsc":
      next.sort((a, b) => a.raw.price - b.raw.price);
      break;
    case "priceDesc":
      next.sort((a, b) => b.raw.price - a.raw.price);
      break;
    case "name":
      next.sort((a, b) => a.productName.localeCompare(b.productName));
      break;
    case "company":
      next.sort((a, b) => a.sellerCompanyName.localeCompare(b.sellerCompanyName));
      break;
    case "rating":
      next.sort((a, b) => b.rating - a.rating);
      break;
    case "newest":
    default:
      next.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  }
  return next;
}

export type CompanyChip = {
  key: string;
  filter: CompanyFilter;
  label: string;
  /** Emoji or short glyph for icon area */
  icon: string;
  productCount?: number;
};

function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function findSellerForShowcaseName(
  sellers: Array<{ id: string; name: string; productCount: number }>,
  label: string,
): { id: string; name: string; productCount: number } | null {
  const nk = normalizeKey(label);
  return (
    sellers.find((s) => normalizeKey(s.name) === nk) ||
    sellers.find((s) => s.name.toLowerCase().includes(label.toLowerCase())) ||
    null
  );
}

export function buildCompanyChips(
  sellers: Array<{ id: string; name: string; productCount: number }>,
): CompanyChip[] {
  const chips: CompanyChip[] = [
    { key: "all", filter: { kind: "all" }, label: "All Companies", icon: "▣", productCount: undefined },
  ];
  const used = new Set<string>();
  for (const label of MARKETPLACE_SHOWCASE_COMPANY_NAMES) {
    const hit = findSellerForShowcaseName(sellers, label);
    if (hit) {
      used.add(hit.id);
      chips.push({
        key: `s-${hit.id}`,
        filter: { kind: "seller", id: hit.id, name: hit.name },
        label: hit.name,
        icon: label.slice(0, 1),
        productCount: hit.productCount,
      });
    } else {
      chips.push({
        key: `n-${normalizeKey(label)}`,
        filter: { kind: "name", name: label },
        label,
        icon: label.slice(0, 1),
      });
    }
  }
  const rest = sellers.filter((s) => !used.has(s.id)).sort((a, b) => a.name.localeCompare(b.name));
  for (const s of rest) {
    chips.push({
      key: `s-${s.id}`,
      filter: { kind: "seller", id: s.id, name: s.name },
      label: s.name,
      icon: s.name.slice(0, 1),
      productCount: s.productCount,
    });
  }
  return chips;
}

export function companyFilterToSelectValue(f: CompanyFilter): string {
  if (f.kind === "all") return "";
  if (f.kind === "seller") return f.id;
  return `__name__:${f.name}`;
}

export function companyFilterFromSelectValue(v: string): CompanyFilter {
  if (!v) return { kind: "all" };
  if (v.startsWith("__name__:")) return { kind: "name", name: v.slice("__name__:".length) };
  return { kind: "seller", id: v, name: "" };
}

/** Demo catalog when API returns no rows — UI polish only; checkout blocked for demo IDs. */
export function marketplaceDemoProducts(): MarketplaceProductDto[] {
  const mk = (
    id: string,
    partial: Omit<Partial<MarketplaceProductDto>, "id"> & Pick<MarketplaceProductDto, "name" | "companyId" | "price" | "quantityAvailable">,
  ): MarketplaceProductDto => ({
    id: `${DEMO_PREFIX}${id}`,
    companyId: partial.companyId,
    name: partial.name,
    description: partial.description ?? null,
    category: partial.category ?? null,
    productType: partial.productType ?? null,
    strainName: partial.strainName ?? null,
    flavorName: partial.flavorName ?? null,
    sku: partial.sku ?? null,
    unitSize: partial.unitSize ?? null,
    price: partial.price,
    quantityAvailable: partial.quantityAvailable,
    imageUrl: partial.imageUrl ?? null,
    companyInventoryLogoUrl: null,
    availabilityStatus: "AVAILABLE",
    source: "MANUAL",
    leafLinkInventoryId: null,
    company: partial.company,
    imageDisplayMode: "COVER",
  });

  return [
    mk("gelato41", {
      name: "Gelato 41",
      companyId: "demo-co-budfox",
      price: 1450,
      quantityAvailable: 40,
      unitSize: "lb",
      category: "Flower",
      productType: "Flower",
      strainName: "Gelato 41",
      description: "Hybrid indoor flower — California wholesale.",
      company: { id: "demo-co-budfox", name: "BudFox", slug: "budfox" },
    }),
    mk("gelato-pr", {
      name: "Gelato 41 Pre-Rolls",
      companyId: "demo-co-budfox",
      price: 1.75,
      quantityAvailable: 5000,
      unitSize: "unit",
      category: "Pre-Rolls",
      productType: "Pre-Rolls",
      strainName: "Gelato 41",
      description: "100-pack ready — hybrid pre-rolls.",
      company: { id: "demo-co-budfox", name: "BudFox", slug: "budfox" },
    }),
    mk("gmo-lr", {
      name: "GMO Live Resin",
      companyId: "demo-co-peak",
      price: 32,
      quantityAvailable: 200,
      unitSize: "g",
      category: "Live Resin",
      productType: "Live Resin",
      strainName: "GMO",
      description: "Indica live resin — Colorado.",
      company: { id: "demo-co-peak", name: "Peak Extracts", slug: "peak-extracts" },
    }),
    mk("pine-vape", {
      name: "Pineapple Express",
      companyId: "demo-co-truenorth",
      price: 18,
      quantityAvailable: 800,
      unitSize: "unit",
      category: "Vape",
      productType: "Vape Cartridge",
      strainName: "Pineapple Express",
      description: "Sativa vape — Oregon wholesale.",
      company: { id: "demo-co-truenorth", name: "TrueNorth", slug: "truenorth" },
    }),
    mk("gummies", {
      name: "Watermelon Gummies",
      companyId: "demo-co-greenbite",
      price: 6.5,
      quantityAvailable: 2000,
      unitSize: "unit",
      category: "Edible",
      productType: "Gummies",
      description: "100mg THC watermelon gummies.",
      company: { id: "demo-co-greenbite", name: "GreenBite", slug: "greenbite" },
    }),
    mk("papaya-rosin", {
      name: "Papaya Rosin",
      companyId: "demo-co-solventless",
      price: 45,
      quantityAvailable: 120,
      unitSize: "g",
      category: "Rosin",
      productType: "Rosin",
      strainName: "Papaya",
      description: "Hybrid solventless rosin.",
      company: { id: "demo-co-solventless", name: "Solventless Labs", slug: "solventless-labs" },
    }),
    mk("lemon-live-rosin", {
      name: "Lemon Cherry Live Rosin",
      companyId: "demo-co-solventless",
      price: 50,
      quantityAvailable: 90,
      unitSize: "g",
      category: "Live Rosin",
      productType: "Live Rosin",
      strainName: "Lemon Cherry",
      description: "Sativa-leaning live rosin.",
      company: { id: "demo-co-solventless", name: "Solventless Labs", slug: "solventless-labs" },
    }),
    mk("gg4-dia", {
      name: "GG4 Live Diamonds",
      companyId: "demo-co-peak",
      price: 60,
      quantityAvailable: 75,
      unitSize: "g",
      category: "Concentrate",
      productType: "Diamonds",
      strainName: "GG4",
      description: "Indica live diamonds.",
      company: { id: "demo-co-peak", name: "Peak Extracts", slug: "peak-extracts" },
    }),
  ];
}

export function isDemoProductId(id: string): boolean {
  return id.startsWith(DEMO_PREFIX);
}
