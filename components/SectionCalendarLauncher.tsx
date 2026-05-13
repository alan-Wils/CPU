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
import { getCompanyDisplayTimezone, getTodayYmdInCompanyTimezone, logTimeIsoForStageMoveDate } from "@/lib/companyTimezone";

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
};

export default function SectionCalendarLauncher({
  section,
  taskSuggestions,
  readOnly = false,
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
  const [editingId, setEditingId] = useState<string | null>(null);

  const suggestions = useMemo(() => dedupeTasks(taskSuggestions), [taskSuggestions]);

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
    setEditingId(null);
  }

  function close() {
    setOpen(false);
    setError(null);
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
        });
        setEvents((prev) => prev.map((x) => (x.id === row.id ? row : x)));
      } else {
        const row = await createSectionCalendarEvent({
          section,
          dateYmd: selectedYmd,
          title,
          notes: notes.trim() || null,
          batchRef: batchRef.trim() || null,
        });
        setEvents((prev) => [...prev, row].sort((a, b) => a.dateYmd.localeCompare(b.dateYmd) || a.id.localeCompare(b.id)));
      }
      resetForm();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setLoading(false);
    }
  }

  async function onDelete(id: string) {
    if (readOnly) return;
    if (!window.confirm("Remove this scheduled item?")) return;
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
    setBatchRef(ev.batchRef || "");
  }

  const monthEvents = useMemo(() => {
    const { fromYmd, toYmd } = monthYmdBounds(monthYyyyMm);
    return events.filter((e) => e.dateYmd >= fromYmd && e.dateYmd <= toYmd);
  }, [events, monthYyyyMm]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setMonthYyyyMm(getTodayYmdInCompanyTimezone().slice(0, 7));
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
                const sel = selectedYmd === ymd;
                return (
                  <button
                    key={ymd}
                    type="button"
                    onClick={() => {
                      setSelectedYmd(ymd);
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

            <div style={{ marginTop: 20, borderTop: "1px solid #1e293b", paddingTop: 16 }}>
              <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>
                {readOnly
                  ? "Scheduled items (read only)"
                  : selectedYmd
                    ? `Add / edit — ${selectedYmd}`
                    : "Pick a day to add a task"}
              </h3>

              {!readOnly && selectedYmd ? (
                <div style={{ display: "grid", gap: 10 }}>
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
                      <input style={inputStyle} value={customTitle} onChange={(e) => setCustomTitle(e.target.value)} placeholder="New task name" />
                    </label>
                  ) : null}
                  <label style={{ display: "grid", gap: 4 }}>
                    <span style={{ color: "#94a3b8", fontSize: 12 }}>Notes (optional)</span>
                    <input style={inputStyle} value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </label>
                  <label style={{ display: "grid", gap: 4 }}>
                    <span style={{ color: "#94a3b8", fontSize: 12 }}>Batch / ref (optional)</span>
                    <input style={inputStyle} value={batchRef} onChange={(e) => setBatchRef(e.target.value)} placeholder="Batch id or reference" />
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

              <div style={{ marginTop: 16 }}>
                <div style={{ fontWeight: 800, marginBottom: 8, color: "#cbd5e1" }}>This month</div>
                {loading && events.length === 0 ? (
                  <p style={{ color: "#94a3b8" }}>Loading…</p>
                ) : monthEvents.length === 0 ? (
                  <p style={{ color: "#94a3b8" }}>No scheduled items.</p>
                ) : (
                  <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
                    {monthEvents.map((ev) => (
                      <li
                        key={ev.id}
                        style={{
                          border: "1px solid #334155",
                          borderRadius: 10,
                          padding: "10px 12px",
                          background: "#0f172a",
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 10,
                          flexWrap: "wrap",
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 200 }}>
                          <div style={{ fontWeight: 900 }}>
                            {ev.dateYmd} — {ev.title}
                          </div>
                          {ev.notes ? <div style={{ color: "#94a3b8", marginTop: 4, fontSize: 13 }}>{ev.notes}</div> : null}
                          {ev.batchRef ? (
                            <div style={{ color: "#64748b", marginTop: 4, fontSize: 12 }}>Ref: {ev.batchRef}</div>
                          ) : null}
                        </div>
                        {!readOnly ? (
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <button type="button" style={buttonStyle} onClick={() => startEdit(ev)}>
                              Edit
                            </button>
                            <button type="button" style={{ ...buttonStyle, borderColor: "#b91c1c", color: "#fecaca" }} onClick={() => void onDelete(ev.id)}>
                              Delete
                            </button>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
