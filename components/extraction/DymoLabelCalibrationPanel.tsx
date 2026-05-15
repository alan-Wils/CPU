"use client";

import type { CSSProperties } from "react";
import type { DymoLabelCalibrationSettings } from "@/lib/dymoLabelCalibration";

export type DymoLabelCalibrationPanelProps = {
  draft: DymoLabelCalibrationSettings;
  onDraftChange: (next: DymoLabelCalibrationSettings) => void;
  onSave: () => void | Promise<void>;
  onReset: () => void;
  onTestPrint: () => void;
  saveBusy?: boolean;
  saveError?: string | null;
  inputStyle?: CSSProperties;
};

function fieldRowStyle(): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "minmax(140px, 1fr) minmax(0, 2fr)",
    gap: "10px 14px",
    alignItems: "center",
    marginBottom: 10,
  };
}

function labelStyle(): CSSProperties {
  return {
    color: "#cbd5e1",
    fontSize: 13,
    lineHeight: 1.35,
  };
}

const defaultInput: CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid rgba(148, 163, 184, 0.35)",
  background: "rgba(15, 23, 42, 0.85)",
  color: "#f1f5f9",
  fontSize: 13,
};

/**
 * In-page calibration for DYMO LabelWriter extraction batch stickers.
 * Settings persist via company `extraction.dymoLabelCalibration` (see docs on {@link DymoLabelCalibrationSettings}).
 */
export function DymoLabelCalibrationPanel({
  draft,
  onDraftChange,
  onSave,
  onReset,
  onTestPrint,
  saveBusy,
  saveError,
  inputStyle,
}: DymoLabelCalibrationPanelProps) {
  const inp = { ...defaultInput, ...inputStyle };

  function patch(p: Partial<DymoLabelCalibrationSettings>) {
    onDraftChange({ ...draft, ...p });
  }

  return (
    <div
      style={{
        width: "100%",
        maxWidth: 560,
        margin: "0 auto",
        padding: "18px 18px 16px",
        borderRadius: 12,
        border: "1px solid rgba(99, 102, 241, 0.35)",
        background: "linear-gradient(155deg, rgba(30, 41, 59, 0.92), rgba(15, 23, 42, 0.96))",
        boxShadow: "0 8px 32px rgba(0,0,0,0.28)",
      }}
    >
      <h3
        style={{
          margin: "0 0 6px",
          fontSize: 16,
          fontWeight: 700,
          color: "#e2e8f0",
          letterSpacing: "0.02em",
        }}
      >
        DYMO label calibration
      </h3>
      <p style={{ margin: "0 0 14px", fontSize: 12, color: "#94a3b8", lineHeight: 1.45 }}>
        Sticker top-left is (0,0). <strong style={{ color: "#e2e8f0" }}>Whole label</strong> offsets + rotation
        move the entire template (frame). <strong style={{ color: "#e2e8f0" }}>Inner content</strong> offsets only
        nudge text inside that frame; <strong style={{ color: "#e2e8f0" }}>Top/start offset</strong> adds feed-axis
        correction combined into whole-label Y. Lengths: <code style={{ color: "#a5b4fc" }}>2in</code>,{" "}
        <code style={{ color: "#a5b4fc" }}>-18px</code>, or plain{" "}
        <code style={{ color: "#a5b4fc" }}>-18</code>
        {" "}→ <code style={{ color: "#a5b4fc" }}>-18px</code>.
      </p>

      <div style={{ ...fieldRowStyle(), gridTemplateColumns: "1fr 1fr" }}>
        <div style={labelStyle()}>Label width</div>
        <input
          style={inp}
          value={draft.labelWidth}
          onChange={(e) => patch({ labelWidth: e.target.value })}
          aria-label="Label width"
        />
        <div style={labelStyle()}>Label height</div>
        <input
          style={inp}
          value={draft.labelHeight}
          onChange={(e) => patch({ labelHeight: e.target.value })}
          aria-label="Label height"
        />
      </div>

      <div style={{ ...fieldRowStyle(), gridTemplateColumns: "1fr 1fr" }}>
        <div style={labelStyle()}>Whole label X offset</div>
        <input
          style={inp}
          value={draft.labelFrameOffsetX}
          onChange={(e) => patch({ labelFrameOffsetX: e.target.value })}
          aria-label="Whole label X offset"
        />
        <div style={labelStyle()}>Whole label Y offset</div>
        <input
          style={inp}
          value={draft.labelFrameOffsetY}
          onChange={(e) => patch({ labelFrameOffsetY: e.target.value })}
          aria-label="Whole label Y offset"
        />
      </div>

      <div style={{ ...fieldRowStyle(), gridTemplateColumns: "1fr 1fr" }}>
        <div style={labelStyle()}>Inner content X offset</div>
        <input
          style={inp}
          value={draft.contentOffsetX}
          onChange={(e) => patch({ contentOffsetX: e.target.value })}
          aria-label="Inner content X offset"
        />
        <div style={labelStyle()}>Inner content Y offset</div>
        <input
          style={inp}
          value={draft.contentOffsetY}
          onChange={(e) => patch({ contentOffsetY: e.target.value })}
          aria-label="Inner content Y offset"
        />
      </div>

      <div style={fieldRowStyle()}>
        <div style={labelStyle()}>Top/start offset</div>
        <input
          style={inp}
          value={draft.startOffsetY}
          onChange={(e) => patch({ startOffsetY: e.target.value })}
          aria-label="Top start offset along feed"
        />
      </div>

      <div style={{ ...fieldRowStyle(), gridTemplateColumns: "1fr 1fr" }}>
        <div style={labelStyle()}>Rotation (deg)</div>
        <input
          style={inp}
          type="number"
          step={1}
          value={draft.rotationDeg}
          onChange={(e) => {
            const n = Number(e.target.value);
            patch({ rotationDeg: Number.isFinite(n) ? n : draft.rotationDeg });
          }}
          aria-label="Rotation degrees"
        />
        <div style={labelStyle()}>Font size (×)</div>
        <input
          style={inp}
          type="number"
          step={0.05}
          min={0.25}
          max={4}
          value={draft.fontSizeMultiplier}
          onChange={(e) => {
            const n = Number(e.target.value);
            patch({ fontSizeMultiplier: Number.isFinite(n) ? n : draft.fontSizeMultiplier });
          }}
          aria-label="Font size multiplier"
        />
      </div>

      <div style={{ ...fieldRowStyle(), gridTemplateColumns: "1fr 1fr" }}>
        <div style={labelStyle()}>Left/right padding</div>
        <input
          style={inp}
          value={draft.paddingLeftRight}
          onChange={(e) => patch({ paddingLeftRight: e.target.value })}
          aria-label="Left right padding"
        />
        <div style={labelStyle()}>Text spacing</div>
        <input
          style={inp}
          value={draft.textSpacing}
          onChange={(e) => patch({ textSpacing: e.target.value })}
          aria-label="Text spacing"
        />
      </div>

      <div style={fieldRowStyle()}>
        <div style={labelStyle()}>Print scale</div>
        <input
          style={inp}
          type="number"
          step={0.05}
          min={0.25}
          max={4}
          value={draft.printScale}
          onChange={(e) => {
            const n = Number(e.target.value);
            patch({ printScale: Number.isFinite(n) ? n : draft.printScale });
          }}
          aria-label="Print scale"
        />
      </div>

      {saveError ? (
        <p style={{ color: "#fca5a5", fontSize: 12, margin: "8px 0 0" }}>{saveError}</p>
      ) : null}

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          marginTop: 16,
          justifyContent: "center",
        }}
      >
        <button
          type="button"
          disabled={saveBusy}
          style={{
            ...inp,
            cursor: saveBusy ? "wait" : "pointer",
            fontWeight: 600,
            background: "linear-gradient(135deg, #6366f1, #4f46e5)",
            border: "1px solid #818cf8",
            color: "#f8fafc",
            minWidth: 160,
          }}
          onClick={() => void onSave()}
        >
          {saveBusy ? "Saving…" : "Save DYMO settings"}
        </button>
        <button
          type="button"
          style={{
            ...inp,
            cursor: "pointer",
            fontWeight: 600,
            borderColor: "rgba(148, 163, 184, 0.45)",
            minWidth: 140,
          }}
          onClick={onReset}
        >
          Reset to default
        </button>
        <button
          type="button"
          style={{
            ...inp,
            cursor: "pointer",
            fontWeight: 600,
            background: "rgba(34, 211, 238, 0.12)",
            border: "1px solid rgba(34, 211, 238, 0.45)",
            color: "#a5f3fc",
            minWidth: 140,
          }}
          onClick={onTestPrint}
        >
          Test print
        </button>
      </div>
    </div>
  );
}
