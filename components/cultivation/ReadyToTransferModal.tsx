"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  deleteCultivationExtractionTransfer,
  formatCultivationTransferApiError,
  listCultivationExtractionTransfers,
  patchCultivationExtractionTransfer,
  splitTransferIntoBundles,
  transferCultivationExtractionToExtraction,
  type CultivationExtractionTransferRow,
  type CultivationTransferMaterialType,
} from "@/lib/cultivationTransferApi";
import {
  normalizeCultivationStorageLocationsConfig,
  type CultivationStorageLocationsConfig,
} from "@/lib/cultivationStorageConfig";
import {
  formatTransferStorageGroupSummary,
  groupTransfersByStorage,
  storageZoneKey,
  summarizeTransferStorageGroup,
  UNASSIGNED_STORAGE_GROUP_ID,
} from "@/lib/cultivationTransferStorageGroups";
import { fetchCachedCompanyConfig } from "@/lib/configClient";
import {
  bundleSlotCountFromTotalGrams,
  isPlaceholderFreshFrozenMetrcTag,
  parseFreshFrozenGramsPerBundle,
} from "@/lib/freshFrozenPackageDisplay";

export type CultivationTransferToExtractionResult = {
  rows?: CultivationExtractionTransferRow[];
  sourceBatches?: unknown[];
};

type Props = {
  open: boolean;
  onClose: () => void;
  onTransferred?: (result: CultivationTransferToExtractionResult) => void;
  /** Select packages and transfer to Extraction (cultivation write roles). */
  canWrite: boolean;
  /** Edit fields, change freezer, and split combined bundles (Manager tier and up). */
  canManageRows: boolean;
};

type PackageFieldEdits = {
  displayName: string;
  metrcTag: string;
  grams: string;
  bundles: string;
  weightLbs: string;
};

const selectStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #475569",
  background: "#0f172a",
  color: "#e2e8f0",
};

const inputStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #475569",
  background: "#0f172a",
  color: "#e2e8f0",
  width: "100%",
  boxSizing: "border-box",
};

const closeBtnStyle: React.CSSProperties = {
  border: "1px solid #475569",
  background: "#1e293b",
  color: "#e2e8f0",
  borderRadius: 8,
  padding: "8px 14px",
  fontWeight: 700,
  height: "fit-content",
};

const refreshBtnStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #475569",
  background: "#1e293b",
  color: "#e2e8f0",
  fontWeight: 700,
};

const dangerBtnStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #b91c1c",
  background: "#7f1d1d",
  color: "#fecaca",
  fontWeight: 700,
};

function materialLabel(t: CultivationTransferMaterialType): string {
  return t === "FRESH_FROZEN" ? "Fresh Frozen" : "Trim";
}

function formatWeight(row: CultivationExtractionTransferRow): string {
  if (row.materialType === "FRESH_FROZEN") {
    const g = Number(row.grams ?? 0);
    const lbs = row.weightLbs != null ? Number(row.weightLbs) : g / 453.592;
    return `${g.toLocaleString()} g · ${lbs.toFixed(2)} lbs`;
  }
  return `${Number(row.weightLbs ?? 0).toFixed(2)} lbs`;
}

function fieldEditsFromRow(row: CultivationExtractionTransferRow): PackageFieldEdits {
  return {
    displayName: String(row.displayName || "").trim(),
    metrcTag: String(row.metrcTag || "").trim(),
    grams: row.grams != null ? String(row.grams) : "",
    bundles: row.bundles != null ? String(row.bundles) : "1",
    weightLbs: row.weightLbs != null ? String(row.weightLbs) : "",
  };
}

function metrcTagNeedsEntry(tag: unknown): boolean {
  return isPlaceholderFreshFrozenMetrcTag(tag);
}

function totalGramsForRow(
  row: CultivationExtractionTransferRow,
  edits?: PackageFieldEdits,
): number {
  const parsed = edits ? parseNum(edits.grams) : null;
  if (parsed != null && parsed >= 0) return parsed;
  return Math.max(0, Number(row.grams ?? 0));
}

/** Slots from config (full + partial last); otherwise stored bundle count on the row. */
function splitBundleCountForRow(
  row: CultivationExtractionTransferRow,
  edits: PackageFieldEdits | undefined,
  gramsPerBundle: number,
): number {
  const total = totalGramsForRow(row, edits);
  if (gramsPerBundle > 0 && total > 0)
    return bundleSlotCountFromTotalGrams(total, gramsPerBundle);
  const stored = Math.max(0, Math.floor(Number(row.bundles) || 0));
  const parsed = edits ? parseNum(edits.bundles) : null;
  if (parsed != null && parsed >= 2) return Math.floor(parsed);
  return Math.max(2, stored);
}

function parseNum(value: string): number | null {
  const n = Number(String(value || "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

export default function ReadyToTransferModal({
  open,
  onClose,
  onTransferred,
  canWrite,
  canManageRows,
}: Props) {
  const [rows, setRows] = useState<CultivationExtractionTransferRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savingRowId, setSavingRowId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filterType, setFilterType] = useState<"" | CultivationTransferMaterialType>("");
  const [search, setSearch] = useState("");
  const [storageFilter, setStorageFilter] = useState("");
  const [storageConfig, setStorageConfig] = useState<CultivationStorageLocationsConfig>(
    normalizeCultivationStorageLocationsConfig(null),
  );
  const [storageEdits, setStorageEdits] = useState<Record<string, string>>({});
  const [fieldEdits, setFieldEdits] = useState<Record<string, PackageFieldEdits>>({});
  const [expandedZones, setExpandedZones] = useState<Set<string>>(new Set());
  const [freshFrozenGramsPerBundle, setFreshFrozenGramsPerBundle] = useState(0);

  const syncEditsFromRows = useCallback((list: CultivationExtractionTransferRow[]) => {
    setFieldEdits(Object.fromEntries(list.map((r) => [r.id, fieldEditsFromRow(r)])));
    setStorageEdits({});
  }, []);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const list = await listCultivationExtractionTransfers({ status: "pending" });
      setRows(list);
      syncEditsFromRows(list);
      setSelected(new Set());
    } catch (e) {
      setError(formatCultivationTransferApiError(e));
    } finally {
      setLoading(false);
    }
  }, [syncEditsFromRows]);

  useEffect(() => {
    if (!open) return;
    setExpandedZones(new Set());
    void loadRows();
    void fetchCachedCompanyConfig<{
      cultivation?: { storageLocations?: unknown; freshFrozenGramsPerBundle?: unknown };
    }>("/api/config/cultivation")
      .then((data) => {
        const cult = data?.cultivation;
        setStorageConfig(normalizeCultivationStorageLocationsConfig(cult?.storageLocations));
        setFreshFrozenGramsPerBundle(parseFreshFrozenGramsPerBundle(cult?.freshFrozenGramsPerBundle));
      })
      .catch(() => {
        setStorageConfig(normalizeCultivationStorageLocationsConfig(null));
        setFreshFrozenGramsPerBundle(0);
      });
  }, [open, loadRows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (filterType && row.materialType !== filterType) return false;
      if (storageFilter) {
        const effectiveLoc = storageEdits[row.id] ?? row.storageLocationId ?? "";
        if (effectiveLoc !== storageFilter) return false;
      }
      if (!q) return true;
      const hay = [
        row.displayName,
        row.sourceCultivationBatchId,
        row.sourceDryFlowerBatchId,
        row.harvestCode,
        row.metrcTag,
        row.parentGroupId,
        row.storageLocationName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, filterType, search, storageFilter, storageEdits]);

  const freshFrozenGroups = useMemo(
    () =>
      groupTransfersByStorage(
        filtered.filter((r) => r.materialType === "FRESH_FROZEN"),
        storageConfig.freezers,
        storageEdits,
      ),
    [filtered, storageConfig.freezers, storageEdits],
  );

  const trimGroups = useMemo(
    () =>
      groupTransfersByStorage(
        filtered.filter((r) => r.materialType === "TRIM"),
        storageConfig.dryRooms,
        storageEdits,
      ),
    [filtered, storageConfig.dryRooms, storageEdits],
  );

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleZone(zoneKey: string) {
    setExpandedZones((prev) => {
      const next = new Set(prev);
      if (next.has(zoneKey)) next.delete(zoneKey);
      else next.add(zoneKey);
      return next;
    });
  }

  function locationsForRow(row: CultivationExtractionTransferRow) {
    return row.materialType === "FRESH_FROZEN" ? storageConfig.freezers : storageConfig.dryRooms;
  }

  function applyRowUpdate(updated: CultivationExtractionTransferRow) {
    setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    setFieldEdits((prev) => ({ ...prev, [updated.id]: fieldEditsFromRow(updated) }));
    setStorageEdits((prev) => {
      const next = { ...prev };
      delete next[updated.id];
      return next;
    });
  }

  async function saveStorageLocation(row: CultivationExtractionTransferRow, locId: string) {
    if (!locId) return;
    const savedLoc = row.storageLocationId ?? "";
    if (locId === savedLoc) return;

    const loc = locationsForRow(row).find((l) => l.id === locId);
    if (!loc) return;

    setSavingRowId(row.id);
    setError("");
    try {
      const updated = await patchCultivationExtractionTransfer(row.id, {
        storageLocationId: loc.id,
        storageLocationName: loc.name,
      });
      applyRowUpdate(updated);
    } catch (e) {
      setError(formatCultivationTransferApiError(e));
    } finally {
      setSavingRowId(null);
    }
  }

  async function deleteRow(row: CultivationExtractionTransferRow) {
    const label = String(row.displayName || row.metrcTag || row.id).trim();
    const batch = String(row.sourceCultivationBatchId || "").trim();
    const detail = batch ? `\n\nBatch: ${batch}` : "";
    const ok = window.confirm(
      `Delete "${label}" from Ready to Transfer?${detail}\n\nThis cannot be undone.`,
    );
    if (!ok) return;

    setSavingRowId(row.id);
    setError("");
    try {
      await deleteCultivationExtractionTransfer(row.id);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
      await loadRows();
    } catch (e) {
      setError(formatCultivationTransferApiError(e));
    } finally {
      setSavingRowId(null);
    }
  }

  async function splitRowIntoBundles(row: CultivationExtractionTransferRow) {
    const edits = fieldEdits[row.id];
    const bundleCount = splitBundleCountForRow(row, edits, freshFrozenGramsPerBundle);
    if (bundleCount < 2) {
      setError("Enter at least 2 bundles before splitting, or use a row that already has multiple bundles.");
      return;
    }

    setSavingRowId(row.id);
    setError("");
    try {
      await splitTransferIntoBundles(
        row.id,
        freshFrozenGramsPerBundle > 0 ? {} : { bundleCount },
      );
      await loadRows();
    } catch (e) {
      setError(formatCultivationTransferApiError(e));
    } finally {
      setSavingRowId(null);
    }
  }

  async function savePackageDetails(row: CultivationExtractionTransferRow) {
    const edits = fieldEdits[row.id];
    if (!edits) return;

    const patch: {
      displayName?: string;
      metrcTag?: string;
      grams?: number;
      bundles?: number;
      weightLbs?: number;
    } = {};

    const name = edits.displayName.trim();
    if (name && name !== String(row.displayName || "").trim())
      patch.displayName = name;

    if (row.materialType === "FRESH_FROZEN") {
      const metrcTag = edits.metrcTag.trim();
      const prevMetrc = String(row.metrcTag || "").trim();
      if (metrcTag && metrcTag !== prevMetrc)
        patch.metrcTag = metrcTag;
      const grams = parseNum(edits.grams);
      if (grams != null && grams >= 0 && grams !== Number(row.grams ?? 0))
        patch.grams = grams;
      const storedBundles = Math.floor(Number(row.bundles) || 0);
      if (storedBundles > 1 && freshFrozenGramsPerBundle > 0) {
        const total = totalGramsForRow(row, edits);
        const slots = bundleSlotCountFromTotalGrams(total, freshFrozenGramsPerBundle);
        if (slots >= 2 && slots !== storedBundles) patch.bundles = slots;
      } else if (storedBundles <= 1) {
        const bundles = parseNum(edits.bundles);
        if (bundles != null && bundles >= 0 && Math.floor(bundles) !== storedBundles)
          patch.bundles = Math.floor(bundles);
      }
    } else {
      const lbs = parseNum(edits.weightLbs);
      if (lbs != null && lbs >= 0 && lbs !== Number(row.weightLbs ?? 0))
        patch.weightLbs = lbs;
    }

    if (Object.keys(patch).length === 0) return;

    setSavingRowId(row.id);
    setError("");
    try {
      const updated = await patchCultivationExtractionTransfer(row.id, patch);
      applyRowUpdate(updated);
    } catch (e) {
      setError(formatCultivationTransferApiError(e));
    } finally {
      setSavingRowId(null);
    }
  }

  function updateFieldEdit(
    rowId: string,
    key: keyof PackageFieldEdits,
    value: string,
  ) {
    setFieldEdits((prev) => ({
      ...prev,
      [rowId]: {
        ...(prev[rowId] || {
          displayName: "",
          metrcTag: "",
          grams: "",
          bundles: "1",
          weightLbs: "",
        }),
        [key]: value,
      },
    }));
  }

  async function transferSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    const missingStorage = rows.filter((r) => {
      if (!ids.includes(r.id)) return false;
      return !(storageEdits[r.id] ?? r.storageLocationId);
    });
    if (missingStorage.length > 0) {
      setError("Assign a storage location to each selected item before transferring to Extraction.");
      return;
    }
    const needsMetrc = rows.filter((r) => {
      if (!ids.includes(r.id) || r.materialType !== "FRESH_FROZEN") return false;
      const tag = fieldEdits[r.id]?.metrcTag ?? r.metrcTag;
      return metrcTagNeedsEntry(tag);
    });
    if (needsMetrc.length > 0) {
      setError(
        "Enter a METRC tag on each selected Fresh Frozen bundle (split placeholders like BUNDLE-1 must be replaced).",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const transferResult = await transferCultivationExtractionToExtraction(ids);
      onTransferred?.({
        rows: Array.isArray(transferResult?.rows) ? transferResult.rows : [],
        sourceBatches: Array.isArray(transferResult?.sourceBatches)
          ? transferResult.sourceBatches
          : [],
      });
      await loadRows();
    } catch (e) {
      setError(formatCultivationTransferApiError(e));
    } finally {
      setBusy(false);
    }
  }

  function renderRow(row: CultivationExtractionTransferRow, inZone: boolean) {
    const locs = locationsForRow(row);
    const currentLoc = storageEdits[row.id] ?? row.storageLocationId ?? "";
    const edits = fieldEdits[row.id] ?? fieldEditsFromRow(row);
    const rowSaving = savingRowId === row.id;
    const isFf = row.materialType === "FRESH_FROZEN";
    const storedBundles = Math.max(0, Math.floor(Number(row.bundles) || 0));
    const splitBundleCount = splitBundleCountForRow(row, edits, freshFrozenGramsPerBundle);
    const isCombinedBundle = isFf && (storedBundles > 1 || splitBundleCount > 1);
    const metrcTag = edits.metrcTag.trim();
    const metrcMissing = isFf && metrcTagNeedsEntry(metrcTag);

    return (
      <div
        key={row.id}
        style={{
          border: "1px solid #334155",
          borderRadius: 10,
          padding: 12,
          background: "#020617",
        }}
      >
        <label style={{ display: "flex", gap: 8, cursor: canWrite ? "pointer" : "default" }}>
          <input
            type="checkbox"
            disabled={!canWrite || busy || rowSaving}
            checked={selected.has(row.id)}
            onChange={() => toggleSelect(row.id)}
            style={{ marginTop: 4 }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            {canManageRows ? (
              <div style={{ display: "grid", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Name</div>
                  <input
                    style={inputStyle}
                    value={edits.displayName}
                    disabled={busy || rowSaving}
                    onChange={(e) => updateFieldEdit(row.id, "displayName", e.target.value)}
                    onBlur={() => void savePackageDetails(row)}
                  />
                </div>
                {isFf ? (
                  <div>
                    <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>
                      METRC tag
                      {metrcMissing ? (
                        <span style={{ color: "#fbbf24", marginLeft: 6 }}>required</span>
                      ) : null}
                    </div>
                    <input
                      style={{
                        ...inputStyle,
                        borderColor: metrcMissing ? "#f59e0b" : "#475569",
                      }}
                      value={edits.metrcTag}
                      disabled={busy || rowSaving}
                      placeholder={
                        metrcMissing ? "Enter METRC package tag…" : "METRC package tag"
                      }
                      onChange={(e) => updateFieldEdit(row.id, "metrcTag", e.target.value)}
                      onBlur={() => void savePackageDetails(row)}
                    />
                  </div>
                ) : null}
                <div style={{ color: "#94a3b8", fontSize: 13 }}>
                  {materialLabel(row.materialType)} · Batch {row.sourceCultivationBatchId}
                  {row.sourceDryFlowerBatchId ? ` · Dry ${row.sourceDryFlowerBatchId}` : ""}
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: isFf ? "1fr 1fr" : "1fr",
                    gap: 8,
                  }}
                >
                  {isFf ? (
                    <>
                      <div>
                        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>
                          Grams
                        </div>
                        <input
                          style={inputStyle}
                          value={edits.grams}
                          disabled={busy || rowSaving}
                          inputMode="decimal"
                          onChange={(e) => updateFieldEdit(row.id, "grams", e.target.value)}
                          onBlur={() => void savePackageDetails(row)}
                        />
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>
                          Bundles
                        </div>
                        {isCombinedBundle ? (
                          <div
                            style={{
                              padding: "8px 10px",
                              borderRadius: 8,
                              border: "1px solid #f59e0b",
                              background: "rgba(120, 53, 15, 0.35)",
                              color: "#fcd34d",
                              fontSize: 13,
                            }}
                          >
                            {splitBundleCount} bundle{splitBundleCount === 1 ? "" : "s"} from{" "}
                            {totalGramsForRow(row, edits).toLocaleString()} g
                            {freshFrozenGramsPerBundle > 0 ? (
                              <>
                                {" "}
                                ({Math.floor(
                                  totalGramsForRow(row, edits) / freshFrozenGramsPerBundle,
                                )}{" "}
                                × {freshFrozenGramsPerBundle.toLocaleString()} g + partial last)
                              </>
                            ) : storedBundles > 1 ? (
                              ` · stored count ${storedBundles}`
                            ) : (
                              ""
                            )}
                          </div>
                        ) : (
                          <input
                            style={inputStyle}
                            value={edits.bundles}
                            disabled={busy || rowSaving}
                            inputMode="numeric"
                            onChange={(e) => updateFieldEdit(row.id, "bundles", e.target.value)}
                            onBlur={() => void savePackageDetails(row)}
                          />
                        )}
                      </div>
                    </>
                  ) : (
                    <div>
                      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>
                        Weight (lbs)
                      </div>
                      <input
                        style={inputStyle}
                        value={edits.weightLbs}
                        disabled={busy || rowSaving}
                        inputMode="decimal"
                        onChange={(e) => updateFieldEdit(row.id, "weightLbs", e.target.value)}
                        onBlur={() => void savePackageDetails(row)}
                      />
                    </div>
                  )}
                </div>
                <div style={{ color: "#cbd5e1", fontSize: 13 }}>{formatWeight(row)}</div>
              </div>
            ) : (
              <TransferRowDetails row={row} hideStorage={inZone} />
            )}
          </div>
        </label>
        {canManageRows ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10, marginLeft: 24 }}>
            <select
              value={currentLoc}
              disabled={busy || rowSaving}
              onChange={(e) => {
                const locId = e.target.value;
                setStorageEdits((prev) => ({ ...prev, [row.id]: locId }));
                if (locId) void saveStorageLocation(row, locId);
              }}
              style={{ ...selectStyle, minWidth: 160 }}
            >
              <option value="">Select storage…</option>
              {locs.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            {isCombinedBundle ? (
              <button
                type="button"
                disabled={busy || rowSaving}
                onClick={() => void splitRowIntoBundles(row)}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid #f59e0b",
                  background: "#78350f",
                  color: "#fef3c7",
                  fontWeight: 700,
                }}
              >
                Split into {splitBundleCount} bundles
                {freshFrozenGramsPerBundle > 0
                  ? ` (${freshFrozenGramsPerBundle.toLocaleString()} g + off last)`
                  : ""}
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy || rowSaving}
              onClick={() => void deleteRow(row)}
              style={dangerBtnStyle}
            >
              Delete
            </button>
            {rowSaving ? (
              <span style={{ color: "#94a3b8", fontSize: 13, alignSelf: "center" }}>
                Saving…
              </span>
            ) : null}
          </div>
        ) : canWrite && currentLoc ? (
          <div style={{ marginTop: 8, marginLeft: 24, color: "#64748b", fontSize: 12 }}>
            Storage: {locs.find((l) => l.id === currentLoc)?.name || row.storageLocationName || "—"}
          </div>
        ) : null}
      </div>
    );
  }

  function renderMaterialSection(
    title: string,
    materialType: CultivationTransferMaterialType,
    groups: ReturnType<typeof groupTransfersByStorage>,
  ) {
    if (groups.length === 0) return null;
    return (
      <div style={{ marginBottom: 20 }}>
        <h3 style={{ margin: "0 0 10px", color: "#a5f3fc", fontSize: 16 }}>{title}</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {groups.map((group) => {
            const zoneKey = storageZoneKey(materialType, group.id);
            const isExpanded = expandedZones.has(zoneKey);
            const packageLabel =
              group.rows.length === 1 ? "1 package" : `${group.rows.length} packages`;
            const groupSummary = summarizeTransferStorageGroup(group.rows);
            const summaryLine = formatTransferStorageGroupSummary(groupSummary);
            return (
              <div
                key={zoneKey}
                style={{
                  border: "1px solid #334155",
                  borderRadius: 10,
                  overflow: "hidden",
                  background: "#0c1222",
                }}
              >
                <button
                  type="button"
                  onClick={() => toggleZone(zoneKey)}
                  style={{
                    width: "100%",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "stretch",
                    gap: 8,
                    padding: "12px 14px",
                    border: "none",
                    background:
                      group.id === UNASSIGNED_STORAGE_GROUP_ID ? "#422006" : "#1e293b",
                    color: "#f1f5f9",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      width: "100%",
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                      <span
                        style={{
                          display: "inline-block",
                          flexShrink: 0,
                          transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                          transition: "transform 0.15s ease",
                          color: "#94a3b8",
                          fontSize: 12,
                        }}
                        aria-hidden
                      >
                        ▶
                      </span>
                      <span style={{ fontWeight: 800, fontSize: 15 }}>{group.name}</span>
                    </span>
                    <span
                      style={{
                        color: "#94a3b8",
                        fontSize: 13,
                        fontWeight: 600,
                        flexShrink: 0,
                      }}
                    >
                      {packageLabel}
                    </span>
                  </span>
                  <div
                    style={{
                      color: "#cbd5e1",
                      fontSize: 13,
                      lineHeight: 1.45,
                      paddingLeft: 22,
                      fontWeight: 500,
                    }}
                  >
                    {summaryLine}
                  </div>
                </button>
                {isExpanded ? (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                      padding: 12,
                      borderTop: "1px solid #334155",
                    }}
                  >
                    {group.rows.map((row) => renderRow(row, true))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(2, 6, 23, 0.82)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9500,
        padding: 16,
      }}
    >
      <div
        style={{
          width: "min(960px, 100%)",
          maxHeight: "min(88vh, 900px)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          background: "#0f172a",
          border: "1px solid #334155",
          borderRadius: 14,
        }}
      >
        <div
          style={{
            padding: "16px 18px",
            borderBottom: "1px solid #334155",
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div>
            <h2 style={{ margin: 0, color: "#f8fafc" }}>Ready to Transfer</h2>
            <p style={{ margin: "6px 0 0", color: "#94a3b8", fontSize: 14 }}>
              Packages are grouped by freezer or dry room. Managers can edit, split, or delete;
              others can select and transfer.
            </p>
          </div>
          <button type="button" onClick={onClose} style={closeBtnStyle}>
            Close
          </button>
        </div>

        <div
          style={{
            padding: "12px 18px",
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            borderBottom: "1px solid #1e293b",
          }}
        >
          <input
            placeholder="Search batch, METRC tag, name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              flex: "1 1 180px",
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid #475569",
              background: "#020617",
              color: "#e2e8f0",
            }}
          />
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as "" | CultivationTransferMaterialType)}
            style={selectStyle}
          >
            <option value="">All types</option>
            <option value="FRESH_FROZEN">Fresh Frozen</option>
            <option value="TRIM">Trim</option>
          </select>
          <select
            value={storageFilter}
            onChange={(e) => setStorageFilter(e.target.value)}
            style={selectStyle}
          >
            <option value="">All storage</option>
            {[...storageConfig.freezers, ...storageConfig.dryRooms].map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void loadRows()}
            disabled={loading || busy}
            style={refreshBtnStyle}
          >
            Refresh
          </button>
        </div>

        {error ? (
          <p style={{ color: "#fca5a5", margin: "0 16px 8px", fontSize: 14 }}>{error}</p>
        ) : null}

        <div style={{ padding: "16px 18px", overflowY: "auto", flex: 1 }}>
          {loading ? (
            <p style={{ color: "#94a3b8", textAlign: "center" }}>Loading…</p>
          ) : filtered.length === 0 ? (
            <p style={{ color: "#94a3b8", textAlign: "center" }}>
              No material is waiting for transfer.
            </p>
          ) : (
            <>
              {renderMaterialSection("Fresh Frozen", "FRESH_FROZEN", freshFrozenGroups)}
              {renderMaterialSection("Trim (dry flower)", "TRIM", trimGroups)}
            </>
          )}
        </div>

        <div
          style={{
            padding: "14px 18px",
            borderTop: "1px solid #334155",
            display: "flex",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <span style={{ color: "#94a3b8", fontSize: 13 }}>
            {selected.size} selected · {filtered.length} shown
          </span>
          {canWrite ? (
            <button
              type="button"
              disabled={busy || selected.size === 0}
              onClick={() => void transferSelected()}
              style={{
                padding: "10px 18px",
                borderRadius: 10,
                border: "1px solid #22c55e",
                background: "#14532d",
                color: "#bbf7d0",
                fontWeight: 800,
                opacity: busy || selected.size === 0 ? 0.6 : 1,
              }}
            >
              Transfer selected to Extraction
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TransferRowDetails({
  row,
  hideStorage = false,
}: {
  row: CultivationExtractionTransferRow;
  hideStorage?: boolean;
}) {
  return (
    <div>
      <div style={{ fontWeight: 800, color: "#f1f5f9" }}>{row.displayName}</div>
      {row.materialType === "FRESH_FROZEN" ? (
        <div
          style={{
            color: metrcTagNeedsEntry(row.metrcTag) ? "#fbbf24" : "#67e8f9",
            fontSize: 13,
            marginTop: 4,
            fontWeight: 700,
          }}
        >
          METRC{" "}
          {metrcTagNeedsEntry(row.metrcTag)
            ? "tag required (ask a manager to enter)"
            : String(row.metrcTag || "").trim()}
        </div>
      ) : null}
      <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 4 }}>
        {materialLabel(row.materialType)} · Batch {row.sourceCultivationBatchId}
        {row.sourceDryFlowerBatchId ? ` · Dry ${row.sourceDryFlowerBatchId}` : ""}
      </div>
      <div style={{ color: "#cbd5e1", fontSize: 13, marginTop: 4 }}>{formatWeight(row)}</div>
      {!hideStorage ? (
        <div style={{ color: "#64748b", fontSize: 12, marginTop: 4 }}>
          Storage: {row.storageLocationName || "Not assigned"}
        </div>
      ) : null}
    </div>
  );
}
