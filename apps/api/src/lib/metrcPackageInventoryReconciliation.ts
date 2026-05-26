import type { LeafLinkInventoryItem } from "../services/leaflinkService.js";

export type NexbatchInventoryPackageRef = {
  source: "leaflink" | "cultivation_transfer";
  label: string;
  itemName: string;
  quantity: number;
  unit: string;
  location: string;
  strainName: string;
};

export type MetrcPackageInventoryReconciliationRow = {
  packageLabel: string;
  metrc: {
    itemName: string;
    quantity: number;
    unitOfMeasure: string;
    location: string;
    strainName: string;
  } | null;
  nexbatch: NexbatchInventoryPackageRef | null;
  status: "matched" | "metrc_only" | "nexbatch_only" | "quantity_mismatch";
  quantityDelta: number | null;
};

export type MetrcPackageReconciliationSummary = {
  metrcCount: number;
  nexbatchCount: number;
  matched: number;
  metrcOnly: number;
  nexbatchOnly: number;
  quantityMismatch: number;
};

function normalizePackageLabel(value: string): string {
  return String(value || "").trim().toUpperCase();
}

function labelsMatch(a: string, b: string): boolean {
  const left = normalizePackageLabel(a);
  const right = normalizePackageLabel(b);
  if (!left || !right) return false;
  if (left === right) return true;
  return left.includes(right) || right.includes(left);
}

function quantityClose(metrcQty: number, nexbatchQty: number): boolean {
  if (!Number.isFinite(metrcQty) || !Number.isFinite(nexbatchQty)) return false;
  const delta = Math.abs(metrcQty - nexbatchQty);
  if (delta <= 0.001) return true;
  const denom = Math.max(Math.abs(metrcQty), Math.abs(nexbatchQty), 1);
  return delta / denom <= 0.02;
}

export function collectNexbatchInventoryPackageRefs(input: {
  leafLinkItems: LeafLinkInventoryItem[];
  cultivationTransfers: Array<{
    metrcTag: string | null;
    displayName: string;
    grams: number | null;
    storageLocationName: string | null;
  }>;
}): NexbatchInventoryPackageRef[] {
  const out: NexbatchInventoryPackageRef[] = [];
  const seen = new Set<string>();

  for (const item of input.leafLinkItems) {
    const label =
      String(item.sku || "").trim() ||
      String(item.sourcePackageGroup || "").trim();
    if (!label) continue;
    const key = normalizePackageLabel(label);
    if (!key || seen.has(`leaflink:${key}`)) continue;
    seen.add(`leaflink:${key}`);
    out.push({
      source: "leaflink",
      label,
      itemName: item.productName,
      quantity: item.availableQuantity,
      unit: item.unit,
      location: item.category || item.productType || "",
      strainName: item.strain,
    });
  }

  for (const transfer of input.cultivationTransfers) {
    const label = String(transfer.metrcTag || "").trim();
    if (!label) continue;
    const key = normalizePackageLabel(label);
    if (!key || seen.has(`transfer:${key}`)) continue;
    seen.add(`transfer:${key}`);
    out.push({
      source: "cultivation_transfer",
      label,
      itemName: transfer.displayName,
      quantity: transfer.grams ?? 0,
      unit: "Grams",
      location: transfer.storageLocationName || "",
      strainName: "",
    });
  }

  return out;
}

export function buildMetrcPackageInventoryReconciliation(input: {
  metrcPackages: Array<{
    packageLabel: string;
    itemName: string;
    quantity: number;
    unitOfMeasure: string;
    location: string;
    strainName: string;
  }>;
  nexbatchRefs: NexbatchInventoryPackageRef[];
}): {
  rows: MetrcPackageInventoryReconciliationRow[];
  summary: MetrcPackageReconciliationSummary;
} {
  const nexbatchByLabel = new Map<string, NexbatchInventoryPackageRef>();
  for (const ref of input.nexbatchRefs) {
    const key = normalizePackageLabel(ref.label);
    if (key && !nexbatchByLabel.has(key)) {
      nexbatchByLabel.set(key, ref);
    }
  }

  const matchedNexbatchKeys = new Set<string>();
  const rows: MetrcPackageInventoryReconciliationRow[] = [];

  for (const pkg of input.metrcPackages) {
    const metrcKey = normalizePackageLabel(pkg.packageLabel);
    let nexbatch: NexbatchInventoryPackageRef | null = null;

    if (metrcKey && nexbatchByLabel.has(metrcKey)) {
      nexbatch = nexbatchByLabel.get(metrcKey) ?? null;
    } else {
      for (const [key, ref] of nexbatchByLabel.entries()) {
        if (labelsMatch(pkg.packageLabel, ref.label)) {
          nexbatch = ref;
          matchedNexbatchKeys.add(key);
          break;
        }
      }
    }

    if (nexbatch) {
      matchedNexbatchKeys.add(normalizePackageLabel(nexbatch.label));
    }

    let status: MetrcPackageInventoryReconciliationRow["status"] = "metrc_only";
    let quantityDelta: number | null = null;

    if (nexbatch) {
      quantityDelta = pkg.quantity - nexbatch.quantity;
      status = quantityClose(pkg.quantity, nexbatch.quantity) ? "matched" : "quantity_mismatch";
    }

    rows.push({
      packageLabel: pkg.packageLabel,
      metrc: {
        itemName: pkg.itemName,
        quantity: pkg.quantity,
        unitOfMeasure: pkg.unitOfMeasure,
        location: pkg.location,
        strainName: pkg.strainName,
      },
      nexbatch,
      status,
      quantityDelta,
    });
  }

  for (const ref of input.nexbatchRefs) {
    const key = normalizePackageLabel(ref.label);
    if (!key || matchedNexbatchKeys.has(key)) continue;
    const alreadyMatched = rows.some((row) => labelsMatch(row.packageLabel, ref.label));
    if (alreadyMatched) continue;
    rows.push({
      packageLabel: ref.label,
      metrc: null,
      nexbatch: ref,
      status: "nexbatch_only",
      quantityDelta: null,
    });
  }

  rows.sort((a, b) => a.packageLabel.localeCompare(b.packageLabel, undefined, { sensitivity: "base" }));

  const summary: MetrcPackageReconciliationSummary = {
    metrcCount: input.metrcPackages.length,
    nexbatchCount: input.nexbatchRefs.length,
    matched: rows.filter((r) => r.status === "matched").length,
    metrcOnly: rows.filter((r) => r.status === "metrc_only").length,
    nexbatchOnly: rows.filter((r) => r.status === "nexbatch_only").length,
    quantityMismatch: rows.filter((r) => r.status === "quantity_mismatch").length,
  };

  return { rows, summary };
}
