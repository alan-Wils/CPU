"use client";

import { useMemo } from "react";
import {
  freshFrozenAvailableLine,
  freshFrozenPackageDisplay,
} from "@/lib/freshFrozenPackageDisplay";
import { getSourceAvailableGrams } from "@/lib/sourceBatchActive";
import {
  findHarvestGroupKeyForSourceId,
  formatHarvestGroupSelectLabelWithStrain,
  groupSourceBatchesByHarvest,
  type ExtractionHarvestSourceGroup,
} from "@/lib/extractionSourceHarvestGroups";

export type ExtractionSourceInputRow = {
  sourceId: string;
  amount: string;
};

type Props = {
  row: ExtractionSourceInputRow;
  index: number;
  availableSources: any[];
  excludedSourceIds: Set<string>;
  inputStyle: React.CSSProperties;
  buttonStyle: React.CSSProperties;
  canRemove: boolean;
  sourcePackageDisplayId: (row: { id?: string; harvestCode?: string }) => string;
  getSourceMaterialType: (source: any) => string;
  getSourceAvailable: (source: unknown) => number;
  onSourceIdChange: (index: number, sourceId: string) => void;
  onAmountChange: (index: number, amount: string) => void;
  onRemove: (index: number) => void;
  onAddAllInBatch?: (index: number, group: ExtractionHarvestSourceGroup) => void;
};

function isBlank(value: unknown): boolean {
  return String(value ?? "").trim() === "";
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function packageOptionLabel(
  b: any,
  getSourceMaterialType: (source: any) => string,
  getSourceAvailable: (source: unknown) => number,
  sourcePackageDisplayId: (row: { id?: string; harvestCode?: string }) => string,
): string {
  const materialType = getSourceMaterialType(b);
  const metrcTag = String(b.metrcTag || b.plantTag || "").trim();
  const availLbs = getSourceAvailable(b);
  const availG = getSourceAvailableGrams(b);

  if (materialType === "freshFrozen") {
    const tagPart = metrcTag ? `METRC ${metrcTag}` : sourcePackageDisplayId(b);
    return `${tagPart} · ${freshFrozenAvailableLine(availLbs)}`;
  }

  const name = String(b.name || b.type || sourcePackageDisplayId(b)).trim();
  return `${name} · ${Math.round(availG).toLocaleString()} g available`;
}

export default function ExtractionCreateSourcePickerRow({
  row,
  index,
  availableSources,
  excludedSourceIds,
  inputStyle,
  buttonStyle,
  canRemove,
  sourcePackageDisplayId,
  getSourceMaterialType,
  getSourceAvailable,
  onSourceIdChange,
  onAmountChange,
  onRemove,
  onAddAllInBatch,
}: Props) {
  const harvestGroups = useMemo(
    () => groupSourceBatchesByHarvest(availableSources),
    [availableSources],
  );

  const selectedGroupKey = findHarvestGroupKeyForSourceId(harvestGroups, row.sourceId);

  const selectableGroups = useMemo(() => {
    return harvestGroups.filter((group) =>
      group.rows.some((r) => {
        const id = String(r.id ?? "").trim();
        if (!id) return false;
        if (excludedSourceIds.has(id) && id !== row.sourceId) return false;
        return getSourceAvailable(r) > 0;
      }),
    );
  }, [harvestGroups, excludedSourceIds, row.sourceId, getSourceAvailable]);

  const packagesInBatch = useMemo(() => {
    const group = harvestGroups.find((g) => g.key === selectedGroupKey);
    if (!group) return [];
    return group.rows.filter((r) => {
      const id = String(r.id ?? "").trim();
      if (!id || getSourceAvailable(r) <= 0) return false;
      if (excludedSourceIds.has(id) && id !== row.sourceId) return false;
      return true;
    });
  }, [harvestGroups, selectedGroupKey, row.sourceId, excludedSourceIds, getSourceAvailable]);

  const selectedSource =
    availableSources.find((b: any) => String(b?.id) === row.sourceId) ?? null;
  const selectedAvailable = selectedSource ? getSourceAvailableGrams(selectedSource) : 0;
  const selectedMaterialType = selectedSource ? getSourceMaterialType(selectedSource) : "";

  const activeGroup = harvestGroups.find((g) => g.key === selectedGroupKey) ?? null;
  const showAddAll =
    Boolean(activeGroup) &&
    packagesInBatch.length > 1 &&
    Boolean(onAddAllInBatch) &&
    packagesInBatch.some((r) => String(r.id) !== row.sourceId);

  function handleBatchChange(groupKey: string) {
    const group = harvestGroups.find((g) => g.key === groupKey);
    if (!group) {
      onSourceIdChange(index, "");
      return;
    }
    const first = group.rows.find((r) => {
      const id = String(r.id ?? "").trim();
      if (!id || getSourceAvailable(r) <= 0) return false;
      if (excludedSourceIds.has(id)) return false;
      return true;
    });
    onSourceIdChange(index, first ? String(first.id) : "");
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1.2fr) 120px 42px",
          gap: 8,
          alignItems: "center",
        }}
      >
        <select
          style={inputStyle}
          value={selectedGroupKey}
          onChange={(e) => handleBatchChange(e.target.value)}
        >
          <option value="">Harvest batch</option>
          {selectableGroups.map((group) => (
            <option key={group.key} value={group.key}>
              {formatHarvestGroupSelectLabelWithStrain(group)}
            </option>
          ))}
        </select>

        <select
          style={inputStyle}
          value={row.sourceId}
          disabled={!selectedGroupKey}
          onChange={(e) => onSourceIdChange(index, e.target.value)}
        >
          <option value="">
            {selectedGroupKey ? "Package / tag" : "Select batch first"}
          </option>
          {packagesInBatch.map((b) => (
            <option key={String(b.id)} value={String(b.id)}>
              {packageOptionLabel(
                b,
                getSourceMaterialType,
                getSourceAvailable,
                sourcePackageDisplayId,
              )}
            </option>
          ))}
        </select>

        <input
          style={inputStyle}
          placeholder={
            selectedSource
              ? `Grams (max ${Math.round(selectedAvailable).toLocaleString()})`
              : "Grams used"
          }
          value={row.amount}
          onChange={(e) => onAmountChange(index, e.target.value)}
        />

        <button
          type="button"
          style={buttonStyle}
          onClick={() => onRemove(index)}
          disabled={!canRemove}
        >
          X
        </button>
      </div>

      {showAddAll && activeGroup ? (
        <button
          type="button"
          style={{
            border: "none",
            background: "transparent",
            color: "#67e8f9",
            padding: 0,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            textAlign: "left",
            width: "fit-content",
          }}
          onClick={() => onAddAllInBatch?.(index, activeGroup)}
        >
          + Add all {packagesInBatch.length} packages from this batch
        </button>
      ) : null}

      {selectedSource ? (
        <div
          style={{
            background: "#1e293b",
            border: "1px solid #334155",
            borderRadius: 10,
            padding: "10px 12px",
            color: "#cbd5e1",
            fontSize: 14,
          }}
        >
          <div>
            <b>Batch:</b> {activeGroup ? formatHarvestGroupSelectLabelWithStrain(activeGroup) : "—"}
          </div>
          <div>
            <b>Package:</b> {sourcePackageDisplayId(selectedSource)}
            {String(selectedSource.metrcTag || selectedSource.plantTag || "").trim()
              ? ` (METRC ${selectedSource.metrcTag || selectedSource.plantTag})`
              : ""}
          </div>
          <div>
            <b>Name:</b> {selectedSource.name || selectedSource.type}
          </div>
          <div>
            <b>Material:</b>{" "}
            {selectedMaterialType === "freshFrozen"
              ? "Fresh Frozen"
              : selectedMaterialType === "dryTrim"
                ? "Dry Trim"
                : "Unknown"}
          </div>
          <div>
            <b>Available:</b>{" "}
            {selectedMaterialType === "freshFrozen"
              ? freshFrozenAvailableLine(selectedAvailable)
              : `${selectedAvailable} lbs`}
          </div>
          {selectedMaterialType === "freshFrozen" ? (
            <div>
              <b>Package size:</b> {freshFrozenPackageDisplay(selectedSource).packageLine}
            </div>
          ) : null}
        </div>
      ) : null}

      {selectedSource && !isBlank(row.amount) && num(row.amount) > selectedAvailable ? (
        <div style={{ color: "#f87171", fontSize: 13, marginTop: -2 }}>
          Entered amount is greater than the available amount.
        </div>
      ) : null}
    </div>
  );
}