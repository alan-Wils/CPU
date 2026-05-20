"use client";

import { useMemo, useState } from "react";
import {
  freshFrozenAvailableLine,
  freshFrozenPackageDisplay,
} from "@/lib/freshFrozenPackageDisplay";
import {
  groupSourceBatchesByHarvest,
  harvestGroupZoneKey,
} from "@/lib/extractionSourceHarvestGroups";
import { getSourceAvailable } from "@/lib/sourceBatchActive";

type Props = {
  sources: any[];
  rowStyle: React.CSSProperties;
  blueButtonStyle: React.CSSProperties;
  deleteButtonStyle: React.CSSProperties;
  userCanWrite: boolean;
  userCanDelete: boolean;
  isLikelyDatabaseSourcePackageId: (id: string) => boolean;
  sourcePackageDisplayId: (row: { id?: string; harvestCode?: string }) => string;
  getSourceMaterialType: (source: any) => string;
  onEdit: (row: any) => void;
  onDelete: (id: string) => void;
};

export default function ExtractionAvailableSourceList({
  sources,
  rowStyle,
  blueButtonStyle,
  deleteButtonStyle,
  userCanWrite,
  userCanDelete,
  isLikelyDatabaseSourcePackageId,
  sourcePackageDisplayId,
  getSourceMaterialType,
  onEdit,
  onDelete,
}: Props) {
  const [expandedHarvestGroups, setExpandedHarvestGroups] = useState<Set<string>>(new Set());

  const harvestGroups = useMemo(() => groupSourceBatchesByHarvest(sources), [sources]);

  function toggleHarvestGroup(zoneKey: string) {
    setExpandedHarvestGroups((prev) => {
      const next = new Set(prev);
      if (next.has(zoneKey)) next.delete(zoneKey);
      else next.add(zoneKey);
      return next;
    });
  }

  if (sources.length === 0) {
    return <p style={{ color: "#94a3b8" }}>No source batches available for extraction.</p>;
  }

  return (
    <>
      {harvestGroups.map((group) => {
        const zoneKey = harvestGroupZoneKey(group);
        const isExpanded = expandedHarvestGroups.has(zoneKey);
        const packageLabel =
          group.packageCount === 1 ? "1 package" : `${group.packageCount} packages`;

        return (
          <div
            key={zoneKey}
            style={{
              marginBottom: 10,
              border: "1px solid #334155",
              borderRadius: 12,
              overflow: "hidden",
              background: "#0c1222",
            }}
          >
            <button
              type="button"
              onClick={() => toggleHarvestGroup(zoneKey)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "12px 14px",
                border: "none",
                background: "#1e293b",
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
                  \u25b6
                </span>
                <span>
                  <span style={{ fontWeight: 800, fontSize: 15 }}>{group.label}</span>
                  <span style={{ color: "#94a3b8", fontSize: 13, marginLeft: 8 }}>
                    {packageLabel}
                    {" \u00b7 "}
                    {group.totalGrams.toLocaleString()} g \u00b7 {group.totalLbs.toFixed(2)} lbs
                    {group.hasFreshFrozen && group.totalBundles > 0
                      ? ` \u00b7 ${group.totalBundles} bundle${group.totalBundles === 1 ? "" : "s"}`
                      : ""}
                  </span>
                </span>
              </span>
            </button>
            {isExpanded ? (
              <div style={{ padding: 12, borderTop: "1px solid #334155" }}>
                {group.rows.map((b: any) => {
                  const available = getSourceAvailable(b);
                  const isEmpty = available <= 0 || b.status === "Used in Extraction";
                  const materialType = getSourceMaterialType(b);
                  const metrcTag = String(b.metrcTag || b.plantTag || "").trim();

                  return (
                    <div
                      key={b.id}
                      style={{
                        ...rowStyle,
                        marginBottom: 8,
                        background: isEmpty ? "#111827" : "#1e293b",
                        color: isEmpty ? "#94a3b8" : "white",
                        opacity: isEmpty ? 0.75 : 1,
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        {metrcTag ? (
                          <div
                            style={{
                              color: "#67e8f9",
                              fontSize: 13,
                              fontWeight: 700,
                              marginBottom: 4,
                            }}
                          >
                            METRC {metrcTag}
                            {b.name ? (
                              <span style={{ color: "#94a3b8", fontWeight: 400 }}>
                                {" "}
                                \u00b7 {b.name}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                        {isLikelyDatabaseSourcePackageId(b.id) ? (
                          <>
                            <b>{sourcePackageDisplayId(b)}</b>
                            <span style={{ color: "#94a3b8", fontSize: 13 }}>
                              {" "}
                              \u00b7 {b.name || b.type || "Source package"}
                            </span>
                            {" | Material: "}
                          </>
                        ) : (
                          <>
                            <b>{sourcePackageDisplayId(b)}</b> | {b.name || b.type} | Material:{" "}
                          </>
                        )}
                        {materialType === "freshFrozen"
                          ? "Fresh Frozen"
                          : materialType === "dryTrim"
                          ? "Dry Trim"
                          : "Unknown"}{" "}
                        | Status: {isEmpty ? "Used in Extraction" : b.status}
                        {materialType === "freshFrozen" ? (
                          <>
                            {" "}
                            | {freshFrozenPackageDisplay(b).packageLine} |{" "}
                            {freshFrozenAvailableLine(available)}
                          </>
                        ) : (
                          <> | Available: {available} lbs</>
                        )}
                      </div>

                      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                        {userCanWrite ? (
                          <button type="button" style={blueButtonStyle} onClick={() => onEdit(b)}>
                            Edit
                          </button>
                        ) : null}
                        {userCanDelete ? (
                          <button
                            type="button"
                            style={deleteButtonStyle}
                            onClick={() => onDelete(b.id)}
                          >
                            Delete
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
