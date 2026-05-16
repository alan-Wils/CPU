"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createSectionCalendarEvent,
  deleteSectionCalendarEvent,
  listSectionCalendarEvents,
  patchSectionCalendarEvent,
  type SectionCalendarEventDto,
  type SectionCalendarSection,
} from "@/lib/sectionCalendarApi";
import { monthYmdBounds } from "@/lib/sectionCalendarMonth";
import { groupMonthEventsIntoBatchCards } from "@/lib/sectionCalendarMonthBatchCards";
import { getCompanyDisplayTimezone, getTodayYmdInCompanyTimezone, logTimeIsoForStageMoveDate } from "@/lib/companyTimezone";
import {
  formatCultivationBatchCalendarOptionLabel,
  groupCultivationBatchesForCalendarPicker,
  type CultivationBatchCalendarPickRow,
} from "@/lib/cultivationCalendarBatchPick";

const modalOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.75)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
  padding: 20,
};

const modalStyle: CSSProperties = {
  background: "#020617",
  color: "white",
  border: "1px solid #334155",
  borderRadius: 18,
  padding: 22,
  width: "100%",
  maxWidth: 720,
  maxHeight: "90vh",
  overflowY: "auto",
  boxShadow: "0 25px 80px rgba(0,0,0,0.55)",
};

const inputStyle: CSSProperties = {
  width: "100%",
  borderRadius: 10,
  border: "1px solid #334155",
  background: "#0f172a",
  color: "white",
  padding: "10px 12px",
  boxSizing: "border-box",
};

const buttonStyle: CSSProperties = {
  padding: "8px 14px",
  borderRadius: 10,
  border: "1px solid #334155",
  background: "#0f172a",
  color: "#e2e8f0",
  fontWeight: 700,
  cursor: "pointer",
};

const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: "#22c55e",
  color: "black",
  border: "1px solid #22c55e",
};

/** Nested overlay on top of the main schedule modal (day click). */
const dayPanelOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 10000,
  padding: 16,
};

const dayPanelStyle: CSSProperties = {
  background: "#0f172a",
  color: "#e2e8f0",
  border: "1px solid #22d3ee",
  borderRadius: 14,
  padding: 18,
  width: "100%",
  maxWidth: 440,
  maxHeight: "min(82vh, 640px)",
  overflowY: "auto",
  boxShadow: "0 24px 64px rgba(0,0,0,0.65)",
};

/** Above day panel (z 10000) when confirming delete. */
const deleteConfirmOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(2, 6, 23, 0.88)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 10001,
  padding: 20,
};

const deleteConfirmCardStyle: CSSProperties = {
  background: "#0f172a",
  color: "#e2e8f0",
  border: "1px solid rgba(248, 113, 113, 0.45)",
  borderRadius: 14,
  padding: 18,
  width: "100%",
  maxWidth: 400,
  boxShadow: "0 24px 64px rgba(0,0,0,0.65), 0 0 28px rgba(56, 189, 248, 0.1)",
};

const dangerButtonStyle: CSSProperties = {
  ...buttonStyle,
  borderColor: "#b91c1c",
  background: "rgba(127, 29, 29, 0.35)",
  color: "#fecaca",
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function ymdWeekdaySun0(ymd: string): number {
  const tz = getCompanyDisplayTimezone();
  const noonIso = logTimeIsoForStageMoveDate(ymd);
  const d = new Date(noonIso);
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(d);
  const map: Record<string, number> = {
    Sunday: 0,
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6,
  };
  return map[name] ?? 0;
}

function monthLabel(yyyyMm: string): string {
  const [y, m] = yyyyMm.split("-").map((x) => Number(x));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return yyyyMm;
  const d = new Date(y, m - 1, 1);
  return d.toLocaleString("en-US", { month: "long", year: "numeric" });
}

function dedupeTasks(list: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of list) {
    const s = String(t || "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export type SectionCalendarLauncherProps = {
  section: SectionCalendarSection;
  taskSuggestions: string[];
  readOnly?: boolean;
  /** When set (cultivation page), batch ref is chosen from Clone / Veg / Flower groups instead of free text only. */
  cultivationBatchesForPicker?: CultivationBatchCalendarPickRow[];
};

export default function SectionCalendarLauncher({
  section,
  taskSuggestions,
  readOnly = false,
  cultivationBatchesForPicker,
}: SectionCalendarLauncherProps) {
  const [open, setOpen] = useState(false);
  const [monthYyyyMm, setMonthYyyyMm] = useState(() => getTodayYmdInCompanyTimezone().slice(0, 7));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<SectionCalendarEventDto[]>([]);
  const [selectedYmd, setSelectedYmd] = useState<string | null>(null);
  const [taskPick, setTaskPick] = useState<string>("");
  const [customTitle, setCustomTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [batchRef, setBatchRef] = useState("");
  /** When cultivation picker is shown: whether the ref came from the grouped list, custom text, or none. */
  const [batchLinkMode, setBatchLinkMode] = useState<"none" | "list" | "custom">("none");
  const [editingId, setEditingId] = useState<string | null>(null);
  /** When set, a compact day panel lists tasks for that date and hosts add/edit. */
  const [dayPanelYmd, setDayPanelYmd] = useState<string | null>(null);
  /** Expanded batch card in "This month" list (groupKey from `groupMonthEventsIntoBatchCards`). */
  const [expandedMonthBatchGroupKey, setExpandedMonthBatchGroupKey] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);

  const suggestions = useMemo(() => dedupeTasks(taskSuggestions), [taskSuggestions]);

  const cultivationBatchGroups = useMemo(() => {
    if (section !== "cultivation" || !cultivationBatchesForPicker?.length) return [];
    return groupCultivationBatchesForCalendarPicker(cultivationBatchesForPicker);
  }, [section, cultivationBatchesForPicker]);

  const cultivationPickerIdSet = useMemo(() => {
    const ids = new Set<string>();
    for (const g of cultivationBatchGroups) for (const b of g.batches) ids.add(b.id);
    return ids;
  }, [cultivationBatchGroups]);

  const cultivationBatchLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of cultivationBatchGroups) {
      for (const b of g.batches) {
        m.set(b.id, `${g.label}: ${formatCultivationBatchCalendarOptionLabel(b)}`);
      }
    }
    return m;
  }, [cultivationBatchGroups]);

  const cultivationBatchSelectValue = useMemo(() => {
    if (cultivationBatchGroups.length === 0) return "";
    if (batchLinkMode === "list" && batchRef.trim()) return batchRef.trim();
    if (batchLinkMode === "custom") return "__custom__";
    return "";
  }, [cultivationBatchGroups.length, batchLinkMode, batchRef]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const out = await listSectionCalendarEvents({ section, month: monthYyyyMm });
      setEvents(out.events || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load calendar");
    } finally {
      setLoading(false);
    }
  }, [section, monthYyyyMm]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  useEffect(() => {
    setExpandedMonthBatchGroupKey(null);
  }, [monthYyyyMm]);

  const eventsByYmd = useMemo(() => {
    const m = new Map<string, SectionCalendarEventDto[]>();
    for (const ev of events) {
      const k = String(ev.dateYmd || "").trim();
      if (!k) continue;
      const arr = m.get(k) || [];
      arr.push(ev);
      m.set(k, arr);
    }
    return m;
  }, [events]);

  const { gridCells } = useMemo(() => {
    const { fromYmd, toYmd } = monthYmdBounds(monthYyyyMm);
    const [yStr, mStr] = monthYyyyMm.split("-");
    const last = Number(toYmd.slice(-2));
    const firstYmd = fromYmd;
    const lead = ymdWeekdaySun0(firstYmd);
    const cells: { kind: "blank" | "day"; ymd?: string; label?: string }[] = [];
    for (let i = 0; i < lead; i++) cells.push({ kind: "blank" });
    for (let d = 1; d <= last; d++) {
      const dd = String(d).padStart(2, "0");
      const ymd = `${yStr}-${mStr}-${dd}`;
      cells.push({ kind: "day", ymd, label: String(d) });
    }
    while (cells.length % 7 !== 0) cells.push({ kind: "blank" });
    while (cells.length < 42) cells.push({ kind: "blank" });
    return { gridCells: cells };
  }, [monthYyyyMm]);

  function resetForm() {
    setTaskPick("");
    setCustomTitle("");
    setNotes("");
    setBatchRef("");
    setBatchLinkMode("none");
    setEditingId(null);
  }

  function close() {
    setOpen(false);
    setError(null);
    resetForm();
    setSelectedYmd(null);
    setDayPanelYmd(null);
    setExpandedMonthBatchGroupKey(null);
  }

  function closeDayPanel() {
    setDayPanelYmd(null);
    resetForm();
    setSelectedYmd(null);
  }

  async function onSave() {
    if (readOnly || !selectedYmd) return;
    const title = (taskPick === "__custom__" ? customTitle : taskPick).trim();
    if (!title) {
      setError("Choose a task or enter a custom title.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (editingId) {
        const row = await patchSectionCalendarEvent(editingId, {
          dateYmd: selectedYmd,
          title,
          notes: notes.trim() || null,
          batchRef: batchRef.trim() || null,
          templateDedupeKey: null,
          templateManaged: false,
        });
        const nm = String(row.dateYmd || "").slice(0, 7);
        if (/^\d{4}-\d{2}$/.test(nm) && nm !== monthYyyyMm) {
          setMonthYyyyMm(nm);
        }
        setEvents((prev) => prev.map((x) => (x.id === row.id ? row : x)));
      } else {
        const row = await createSectionCalendarEvent({
          section,
          dateYmd: selectedYmd,
          title,
          notes: notes.trim() || null,
          batchRef: batchRef.trim() || null,
        });
        const nm = String(row.dateYmd || "").slice(0, 7);
        if (/^\d{4}-\d{2}$/.test(nm) && nm !== monthYyyyMm) {
          setMonthYyyyMm(nm);
        }
        setEvents((prev) => [...prev, row].sort((a, b) => a.dateYmd.localeCompare(b.dateYmd) || a.id.localeCompare(b.id)));
      }
      resetForm();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setLoading(false);
    }
  }

  function requestDelete(ev: SectionCalendarEventDto) {
    if (readOnly) return;
    setPendingDelete({ id: ev.id, title: ev.title });
  }

  function cancelPendingDelete() {
    setPendingDelete(null);
  }

  async function confirmPendingDelete() {
    if (!pendingDelete || readOnly) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    setLoading(true);
    setError(null);
    try {
      await deleteSectionCalendarEvent(id);
      setEvents((prev) => prev.filter((x) => x.id !== id));
      if (editingId === id) resetForm();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setLoading(false);
    }
  }

  function startEdit(ev: SectionCalendarEventDto) {
    setSelectedYmd(ev.dateYmd);
    setDayPanelYmd(ev.dateYmd);
    const m = ev.dateYmd.slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(m) && m !== monthYyyyMm) setMonthYyyyMm(m);
    setEditingId(ev.id);
    const inList = suggestions.includes(ev.title);
    if (inList) {
      setTaskPick(ev.title);
      setCustomTitle("");
    } else {
      setTaskPick("__custom__");
      setCustomTitle(ev.title);
    }
    setNotes(ev.notes || "");
    const ref = String(ev.batchRef || "").trim();
    setBatchRef(ref);
    if (cultivationPickerIdSet.size && ref && cultivationPickerIdSet.has(ref)) {
      setBatchLinkMode("list");
    } else if (ref) {
      setBatchLinkMode("custom");
    } else {
      setBatchLinkMode("none");
    }
  }

  const monthEvents = useMemo(() => {
    const { fromYmd, toYmd } = monthYmdBounds(monthYyyyMm);
    return events.filter((e) => e.dateYmd >= fromYmd && e.dateYmd <= toYmd);
  }, [events, monthYyyyMm]);

  const monthBatchCards = useMemo(() => {
    const todayYmd = getTodayYmdInCompanyTimezone();
    return groupMonthEventsIntoBatchCards(monthEvents, cultivationBatchLabelById, todayYmd);
  }, [monthEvents, cultivationBatchLabelById]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setMonthYyyyMm(getTodayYmdInCompanyTimezone().slice(0, 7));
          setDayPanelYmd(null);
          setSelectedYmd(null);
          resetForm();
          setOpen(true);
        }}
        style={{
          ...buttonStyle,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          border: "1px solid #0891b2",
          background: "#0c4a6e",
          color: "#a5f3fc",
          fontWeight: 800,
        }}
        aria-label="Open section schedule calendar"
      >
        Schedule
      </button>

      {open ? (
        <div style={modalOverlayStyle} onClick={close} role="presentation">
          <div
            style={modalStyle}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Section schedule calendar"
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
              <div>
                <h2 style={{ margin: "0 0 6px", fontSize: 20 }}>
                  {section === "cultivation" ? "Cultivation" : section === "extraction" ? "Extraction" : "Packaging"} schedule
                </h2>
                <p style={{ margin: 0, color: "#94a3b8", fontSize: 13 }}>
                  Dates use company timezone ({getCompanyDisplayTimezone()}).
                </p>
              </div>
              <button type="button" style={buttonStyle} onClick={close}>
                Close
              </button>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 16 }}>
              <button
                type="button"
                style={buttonStyle}
                onClick={() => {
                  const [y, m] = monthYyyyMm.split("-").map(Number);
                  const d = new Date(y, m - 2, 1);
                  setMonthYyyyMm(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
                }}
              >
                Prev
              </button>
              <div style={{ fontWeight: 900, fontSize: 16 }}>{monthLabel(monthYyyyMm)}</div>
              <button
                type="button"
                style={buttonStyle}
                onClick={() => {
                  const [y, m] = monthYyyyMm.split("-").map(Number);
                  const d = new Date(y, m, 1);
                  setMonthYyyyMm(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
                }}
              >
                Next
              </button>
            </div>

            {error ? (
              <p style={{ color: "#fca5a5", marginTop: 12, fontWeight: 700 }}>{error}</p>
            ) : null}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
                gap: 6,
                marginTop: 14,
                textAlign: "center",
                fontSize: 12,
                color: "#94a3b8",
              }}
            >
              {WEEKDAY_LABELS.map((w) => (
                <div key={w} style={{ fontWeight: 800 }}>
                  {w}
                </div>
              ))}
              {gridCells.map((cell, idx) => {
                if (cell.kind === "blank") {
                  return <div key={`b-${idx}`} style={{ minHeight: 40 }} />;
                }
                const ymd = cell.ymd!;
                const count = (eventsByYmd.get(ymd) || []).length;
                const sel = dayPanelYmd === ymd;
                return (
                  <button
                    key={ymd}
                    type="button"
                    onClick={() => {
                      if (dayPanelYmd === ymd) {
                        closeDayPanel();
                        return;
                      }
                      setSelectedYmd(ymd);
                      setDayPanelYmd(ymd);
                      if (!editingId) resetForm();
                    }}
                    style={{
                      minHeight: 44,
                      borderRadius: 10,
                      border: sel ? "2px solid #22c55e" : "1px solid #334155",
                      background: sel ? "rgba(34,197,94,0.12)" : "#0f172a",
                      color: "#e2e8f0",
                      cursor: "pointer",
                      fontWeight: 800,
                      position: "relative",
                    }}
                  >
                    {cell.label}
                    {count > 0 ? (
                      <span
                        style={{
                          position: "absolute",
                          top: 4,
                          right: 6,
                          fontSize: 10,
                          color: "#22d3ee",
                        }}
                      >
                        {count}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {dayPanelYmd ? (
              <div style={dayPanelOverlayStyle} onClick={closeDayPanel} role="presentation">
                <div
                  style={dayPanelStyle}
                  onClick={(e) => e.stopPropagation()}
                  role="dialog"
                  aria-modal="true"
                  aria-label={`Schedule tasks for ${dayPanelYmd}`}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 10,
                      marginBottom: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <h3 style={{ margin: 0, fontSize: 16, color: "#f1f5f9" }}>Tasks — {dayPanelYmd}</h3>
                    <button type="button" style={buttonStyle} onClick={closeDayPanel}>
                      Close
                    </button>
                  </div>
                  <p style={{ margin: "0 0 12px", color: "#64748b", fontSize: 12, lineHeight: 1.45 }}>
                    {readOnly ? "Scheduled for this day." : "Click a task row to load it into the form below, or add a new task."}
                  </p>
                  <ul style={{ listStyle: "none", padding: 0, margin: "0 0 14px", display: "grid", gap: 8 }}>
                    {(eventsByYmd.get(dayPanelYmd) || []).length === 0 ? (
                      <li style={{ color: "#94a3b8", fontSize: 13 }}>No tasks on this day.</li>
                    ) : (
                      (eventsByYmd.get(dayPanelYmd) || []).map((ev) => (
                        <li
                          key={ev.id}
                          style={{
                            border: "1px solid #334155",
                            borderRadius: 10,
                            padding: "10px 12px",
                            background: "#020617",
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 10,
                            flexWrap: "wrap",
                            alignItems: "flex-start",
                          }}
                        >
                          <div
                            role={readOnly ? undefined : "button"}
                            tabIndex={readOnly ? undefined : 0}
                            onClick={() => {
                              if (readOnly) return;
                              startEdit(ev);
                            }}
                            onKeyDown={(e) => {
                              if (readOnly) return;
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                startEdit(ev);
                              }
                            }}
                            style={{
                              flex: 1,
                              minWidth: 0,
                              cursor: readOnly ? "default" : "pointer",
                              outline: "none",
                            }}
                          >
                            <div style={{ fontWeight: 800 }}>{ev.title}</div>
                            {ev.notes ? <div style={{ color: "#94a3b8", marginTop: 4, fontSize: 13 }}>{ev.notes}</div> : null}
                            {ev.batchRef ? (
                              <div style={{ color: "#64748b", marginTop: 4, fontSize: 12 }}>
                                {cultivationBatchLabelById.get(ev.batchRef) ?? `Ref: ${ev.batchRef}`}
                              </div>
                            ) : null}
                            {!readOnly ? (
                              <div style={{ color: "#38bdf8", marginTop: 6, fontSize: 12, fontWeight: 700 }}>Click to edit →</div>
                            ) : null}
                          </div>
                          {!readOnly ? (
                            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                              <button
                                type="button"
                                style={{ ...buttonStyle, borderColor: "#b91c1c", color: "#fecaca" }}
                                onClick={() => requestDelete(ev)}
                              >
                                Delete
                              </button>
                            </div>
                          ) : null}
                        </li>
                      ))
                    )}
                  </ul>

                  {!readOnly && selectedYmd && dayPanelYmd === selectedYmd ? (
                    <div style={{ display: "grid", gap: 10, borderTop: "1px solid #1e293b", paddingTop: 14 }}>
                      <div style={{ fontWeight: 800, fontSize: 13, color: "#a5f3fc" }}>
                        {editingId ? "Edit task" : "Add task"}
                      </div>
                      <label style={{ display: "grid", gap: 4 }}>
                        <span style={{ color: "#94a3b8", fontSize: 12 }}>Task</span>
                        <select style={inputStyle} value={taskPick} onChange={(e) => setTaskPick(e.target.value)}>
                          <option value="">Select from list…</option>
                          {suggestions.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                          <option value="__custom__">Custom title…</option>
                        </select>
                      </label>
                      {taskPick === "__custom__" ? (
                        <label style={{ display: "grid", gap: 4 }}>
                          <span style={{ color: "#94a3b8", fontSize: 12 }}>Custom title</span>
                          <input
                            style={inputStyle}
                            value={customTitle}
                            onChange={(e) => setCustomTitle(e.target.value)}
                            placeholder="New task name"
                          />
                        </label>
                      ) : null}
                      <label style={{ display: "grid", gap: 4 }}>
                        <span style={{ color: "#94a3b8", fontSize: 12 }}>Task date (YYYY-MM-DD)</span>
                        <input
                          style={inputStyle}
                          type="date"
                          value={selectedYmd || ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
                            setSelectedYmd(v);
                            setDayPanelYmd(v);
                            const m = v.slice(0, 7);
                            if (/^\d{4}-\d{2}$/.test(m) && m !== monthYyyyMm) setMonthYyyyMm(m);
                          }}
                        />
                      </label>
                      <label style={{ display: "grid", gap: 4 }}>
                        <span style={{ color: "#94a3b8", fontSize: 12 }}>Notes (optional)</span>
                        <input style={inputStyle} value={notes} onChange={(e) => setNotes(e.target.value)} />
                      </label>
                      <label style={{ display: "grid", gap: 4 }}>
                        <span style={{ color: "#94a3b8", fontSize: 12 }}>Batch / ref (optional)</span>
                        {cultivationBatchGroups.length > 0 ? (
                          <>
                            <select
                              style={inputStyle}
                              value={cultivationBatchSelectValue}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v === "") {
                                  setBatchLinkMode("none");
                                  setBatchRef("");
                                } else if (v === "__custom__") {
                                  setBatchLinkMode("custom");
                                  setBatchRef("");
                                } else {
                                  setBatchLinkMode("list");
                                  setBatchRef(v);
                                }
                              }}
                            >
                              <option value="">— No batch linked —</option>
                              {cultivationBatchGroups.map((g) => (
                                <optgroup key={g.group} label={g.label}>
                                  {g.batches.map((b) => (
                                    <option key={b.id} value={b.id}>
                                      {formatCultivationBatchCalendarOptionLabel(b)}
                                    </option>
                                  ))}
                                </optgroup>
                              ))}
                              <option value="__custom__">Custom reference (type below)…</option>
                            </select>
                            {cultivationBatchSelectValue === "__custom__" ? (
                              <input
                                style={inputStyle}
                                value={batchRef}
                                onChange={(e) => setBatchRef(e.target.value)}
                                placeholder="Batch id, METRC tag, or other note"
                              />
                            ) : (
                              <p style={{ margin: 0, fontSize: 11, color: "#64748b" }}>
                                Stages are grouped so clone, veg, and flower batches are easy to tell apart.
                              </p>
                            )}
                          </>
                        ) : (
                          <input
                            style={inputStyle}
                            value={batchRef}
                            onChange={(e) => setBatchRef(e.target.value)}
                            placeholder="Batch id or reference"
                          />
                        )}
                      </label>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        {editingId ? (
                          <button type="button" style={buttonStyle} onClick={resetForm}>
                            Cancel edit
                          </button>
                        ) : null}
                        <button type="button" style={primaryButtonStyle} disabled={loading} onClick={() => void onSave()}>
                          {editingId ? "Save changes" : "Add to calendar"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div style={{ marginTop: 20, borderTop: "1px solid #1e293b", paddingTop: 16 }}>
              <p style={{ margin: "0 0 12px", color: "#94a3b8", fontSize: 13, lineHeight: 1.5 }}>
                {readOnly
                  ? "Each batch shows its next task this month. Click a card to list every scheduled item for that batch."
                  : "Click a day on the grid to open its tasks. Batches below show the next task in this month — click a card to expand and edit or delete any task."}
              </p>

              <div style={{ marginTop: 4 }}>
                <div style={{ fontWeight: 800, marginBottom: 8, color: "#cbd5e1" }}>This month</div>
                {loading && events.length === 0 ? (
                  <p style={{ color: "#94a3b8" }}>Loading…</p>
                ) : monthBatchCards.length === 0 ? (
                  <p style={{ color: "#94a3b8" }}>No scheduled items.</p>
                ) : (
                  <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
                    {monthBatchCards.map((card) => {
                      const expanded = expandedMonthBatchGroupKey === card.groupKey;
                      return (
                        <li
                          key={card.groupKey}
                          style={{
                            border: "1px solid #334155",
                            borderRadius: 10,
                            background: "#0f172a",
                            overflow: "hidden",
                          }}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedMonthBatchGroupKey((k) => (k === card.groupKey ? null : card.groupKey))
                            }
                            style={{
                              width: "100%",
                              textAlign: "left",
                              cursor: "pointer",
                              padding: "12px 14px",
                              background: "transparent",
                              border: "none",
                              color: "inherit",
                              display: "block",
                              boxSizing: "border-box",
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                              <div style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
                                <div style={{ fontWeight: 900, color: "#f8fafc" }}>{card.label}</div>
                                <div style={{ color: "#a5f3fc", marginTop: 6, fontSize: 13, fontWeight: 700 }}>
                                  Next: {card.next.dateYmd} — {card.next.title}
                                </div>
                                <div style={{ color: "#64748b", marginTop: 4, fontSize: 12 }}>
                                  {card.events.length} scheduled {card.events.length === 1 ? "task" : "tasks"} this month
                                </div>
                              </div>
                              <span style={{ color: "#94a3b8", fontSize: 14, flexShrink: 0 }} aria-hidden>
                                {expanded ? "▼" : "▶"}
                              </span>
                            </div>
                          </button>
                          {expanded ? (
                            <div
                              style={{ padding: "0 12px 12px", borderTop: "1px solid #1e293b" }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "grid", gap: 8 }}>
                                {card.events.map((ev) => (
                                  <li
                                    key={ev.id}
                                    style={{
                                      border: "1px solid #1e293b",
                                      borderRadius: 8,
                                      padding: "10px 12px",
                                      background: "#020617",
                                      display: "flex",
                                      justifyContent: "space-between",
                                      gap: 10,
                                      flexWrap: "wrap",
                                    }}
                                  >
                                    <div style={{ flex: 1, minWidth: 200 }}>
                                      <div style={{ fontWeight: 800 }}>
                                        {ev.dateYmd} — {ev.title}
                                      </div>
                                      {ev.notes ? (
                                        <div style={{ color: "#94a3b8", marginTop: 4, fontSize: 13 }}>{ev.notes}</div>
                                      ) : null}
                                    </div>
                                    {!readOnly ? (
                                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                        <button
                                          type="button"
                                          style={buttonStyle}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            startEdit(ev);
                                          }}
                                        >
                                          Edit
                                        </button>
                                        <button
                                          type="button"
                                          style={{ ...buttonStyle, borderColor: "#b91c1c", color: "#fecaca" }}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            requestDelete(ev);
                                          }}
                                        >
                                          Delete
                                        </button>
                                      </div>
                                    ) : null}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {pendingDelete ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="schedule-delete-confirm-title"
          style={deleteConfirmOverlayStyle}
          onClick={cancelPendingDelete}
        >
          <div
            style={deleteConfirmCardStyle}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id="schedule-delete-confirm-title"
              style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 800, color: "#fca5a5" }}
            >
              Remove scheduled item?
            </h3>
            <p style={{ margin: "0 0 16px", color: "#cbd5e1", fontSize: 14, lineHeight: 1.5 }}>
              <span style={{ fontWeight: 800, color: "#f1f5f9" }}>{pendingDelete.title}</span>
              {" "}
              will be removed from the schedule. This cannot be undone.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
              <button type="button" style={buttonStyle} onClick={cancelPendingDelete} disabled={loading}>
                Cancel
              </button>
              <button
                type="button"
                style={dangerButtonStyle}
                disabled={loading}
                onClick={() => void confirmPendingDelete()}
              >
                {loading ? "Removing…" : "Remove"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
