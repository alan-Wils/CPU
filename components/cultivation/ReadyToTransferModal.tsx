"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  formatCultivationTransferApiError,
  listCultivationExtractionTransfers,
  patchCultivationExtractionTransfer,
  transferCultivationExtractionToExtraction,
  type CultivationExtractionTransferRow,
  type CultivationTransferMaterialType,
} from "@/lib/cultivationTransferApi";
import {
  normalizeCultivationStorageLocationsConfig,
  type CultivationStorageLocationsConfig,
} from "@/lib/cultivationStorageConfig";
import {
  groupTransfersByStorage,
  storageZoneKey,
  UNASSIGNED_STORAGE_GROUP_ID,
} from "@/lib/cultivationTransferStorageGroups";
import { fetchCachedCompanyConfig } from "@/lib/configClient";

type Props = {
  open: boolean;
  onClose: () => void;
  onTransferred?: () => void;
  canWrite: boolean;
};

const selectStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #475569",
  background: "#0f172a",
  color: "#e2e8f0",
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

export default function ReadyToTransferModal({ open, onClose, onTransferred, canWrite }: Props) {
  const [rows, setRows] = useState<CultivationExtractionTransferRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filterType, setFilterType] = useState<"" | CultivationTransferMaterialType>("");
  const [search, setSearch] = useState("");
  const [storageFilter, setStorageFilter] = useState("");
  const [storageConfig, setStorageConfig] = useState<CultivationStorageLocationsConfig>(
    normalizeCultivationStorageLocationsConfig(null),
  );
  const [storageEdits, setStorageEdits] = useState<Record<string, string>>({});
  const [expandedZones, setExpandedZones] = useState<Set<string>>(new Set());

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const list = await listCultivationExtractionTransfers({ status: "pending" });
      setRows(list);
      setSelected(new Set());
    } catch (e) {
      setError(formatCultivationTransferApiError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setExpandedZones(new Set());
    void loadRows();
    void fetchCachedCompanyConfig<{ cultivation?: { storageLocations?: unknown } }>(
      "/api/config/cultivation",
    )
      .then((data) => {
        const cult = data?.cultivation;
        setStorageConfig(normalizeCultivationStorageLocationsConfig(cult?.storageLocations));
      })
      .catch(() => {
        setStorageConfig(normalizeCultivationStorageLocationsConfig(null));
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

  async function saveStorage(row: CultivationExtractionTransferRow) {
    const locId = storageEdits[row.id] ?? row.storageLocationId ?? "";
    if (!locId) return;
    const loc = locationsForRow(row).find((l) => l.id === locId);
    if (!loc) return;
    setBusy(true);
    setError("");
    try {
      await patchCultivationExtractionTransfer(row.id, {
        storageLocationId: loc.id,
        storageLocationName: loc.name,
      });
      await loadRows();
    } catch (e) {
      setError(formatCultivationTransferApiError(e));
    } finally {
      setBusy(false);
    }
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
    setBusy(true);
    setError("");
    try {
      for (const id of ids) {
        const row = rows.find((r) => r.id === id);
        if (!row) continue;
        const editLoc = storageEdits[id];
        if (editLoc && editLoc !== row.storageLocationId) {
          const loc = locationsForRow(row).find((l) => l.id === editLoc);
          if (loc) {
            await patchCultivationExtractionTransfer(id, {
              storageLocationId: loc.id,
              storageLocationName: loc.name,
            });
          }
        }
      }
      await transferCultivationExtractionToExtraction(ids);
      onTransferred?.();
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
            disabled={!canWrite || busy}
            checked={selected.has(row.id)}
            onChange={() => toggleSelect(row.id)}
            style={{ marginTop: 4 }}
          />
          <TransferRowDetails row={row} hideStorage={inZone} />
        </label>
        {canWrite ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10, marginLeft: 24 }}>
            <select
              value={currentLoc}
              disabled={busy}
              onChange={(e) =>
                setStorageEdits((prev) => ({ ...prev, [row.id]: e.target.value }))
              }
              style={{ ...selectStyle, minWidth: 140 }}
            >
              <option value="">Select storage…</option>
              {locs.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy || !currentLoc}
              onClick={() => void saveStorage(row)}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid #0891b2",
                background: "#0c4a6e",
                color: "#a5f3fc",
                fontWeight: 700,
              }}
            >
              Save location
            </button>
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
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "12px 14px",
                    border: "none",
                    background:
                      group.id === UNASSIGNED_STORAGE_GROUP_ID ? "#422006" : "#1e293b",
                    color: "#f1f5f9",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span
                      style={{
                        display: "inline-block",
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
                  <span style={{ color: "#94a3b8", fontSize: 13, fontWeight: 600 }}>
                    {packageLabel}
                  </span>
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
              Packages are grouped by freezer or dry room. Expand a zone to view and transfer.
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
      {String(row.metrcTag || "").trim() ? (
        <div style={{ color: "#67e8f9", fontSize: 13, marginTop: 4, fontWeight: 700 }}>
          METRC {String(row.metrcTag || "").trim()}
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

