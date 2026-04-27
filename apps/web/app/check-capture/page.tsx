"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCameraOverlay } from "@/components/CheckCameraOverlay";
import {
  extractCheckFields,
  listCheckCaptures,
  saveCheckCapture,
  uploadCheckImage,
  type CheckCaptureRecord,
  type CheckExtractedFields,
  type ExtractCheckResponse
} from "@/lib/checksApi";
import { getApiErrorMessage } from "@/lib/api";
import {
  runLocalCheckOcr,
  type LocalOcrBestResult,
  type ParsedCheckFields,
  type OcrProgress
} from "@/lib/checkCaptureOcr";
import { assessImageQualityFromCanvas } from "@/lib/checkImageQuality";
import { shrinkCheckImageFileIfLarge } from "@/lib/shrinkCheckImage";

type FormState = {
  checkDate: string;
  amount: string;
  checkNumber: string;
  payerName: string;
  routingNumber: string;
  accountNumber: string;
  bankName: string;
  memo: string;
  imageUrl: string;
};

const emptyForm: FormState = {
  checkDate: "",
  amount: "",
  checkNumber: "",
  payerName: "",
  routingNumber: "",
  accountNumber: "",
  bankName: "",
  memo: "",
  imageUrl: ""
};

const FIELD_KEYS: (keyof CheckExtractedFields)[] = [
  "checkDate",
  "amount",
  "checkNumber",
  "payerName",
  "routingNumber",
  "accountNumber",
  "bankName",
  "memo"
];

function isParsedEmpty(p: CheckExtractedFields | undefined) {
  if (!p) return true;
  return !FIELD_KEYS.some((k) => {
    const v = p[k];
    return v !== undefined && v !== null && String(v).trim() !== "";
  });
}

function toFormStrings(p: ParsedCheckFields | CheckExtractedFields | undefined): Partial<FormState> {
  if (!p) return {};
  return {
    checkDate: p.checkDate ? String(p.checkDate).slice(0, 10) : "",
    amount: p.amount != null && Number.isFinite(p.amount) ? String(p.amount) : "",
    checkNumber: p.checkNumber ? String(p.checkNumber) : "",
    payerName: p.payerName ? String(p.payerName) : "",
    routingNumber: p.routingNumber ? String(p.routingNumber) : "",
    accountNumber: p.accountNumber ? String(p.accountNumber) : "",
    bankName: p.bankName ? String(p.bankName) : "",
    memo: p.memo ? String(p.memo) : ""
  };
}

function mergePreferConfidentServer(
  server: CheckExtractedFields,
  local: ParsedCheckFields,
  conf: Partial<Record<string, number>> | undefined
): Partial<FormState> {
  const a = toFormStrings(server);
  const b = toFormStrings(local);
  const out: Partial<FormState> = {};
  const keys: (keyof FormState)[] = [
    "checkDate",
    "amount",
    "checkNumber",
    "payerName",
    "routingNumber",
    "accountNumber",
    "bankName",
    "memo"
  ];
  for (const k of keys) {
    const c = conf?.[k] ?? 0;
    const bs = b[k]?.trim();
    const as = a[k]?.trim();
    if (c >= 0.52 && bs) out[k] = b[k] as never;
    else if (as) out[k] = a[k] as never;
    else if (bs) out[k] = b[k] as never;
  }
  return out;
}

function lowConfidenceKeys(conf: Partial<Record<string, number>> | undefined): Set<string> {
  const s = new Set<string>();
  if (!conf) return s;
  for (const k of FIELD_KEYS) {
    const v = conf[k];
    if (v != null && v < 0.52) s.add(k);
  }
  return s;
}

function toBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || "");
      resolve(raw.replace(/^data:[^;]+;base64,/, ""));
    };
    reader.onerror = () => reject(new Error("Failed to read image file"));
    reader.readAsDataURL(file);
  });
}

async function fileToSmallCanvas(file: File, max = 900): Promise<HTMLCanvasElement> {
  const upload = await shrinkCheckImageFileIfLarge(file, max);
  const url = URL.createObjectURL(upload);
  try {
    const img = new Image();
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("load"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.drawImage(img, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function CheckCapturePage() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [records, setRecords] = useState<CheckCaptureRecord[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [reviewLow, setReviewLow] = useState<Set<string>>(() => new Set());
  const lastOcrRawRef = useRef<unknown>(undefined);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoadingRecords(true);
    listCheckCaptures()
      .then((rows) => {
        if (mounted) setRecords(rows);
      })
      .catch((err) => {
        if (mounted) setError(getApiErrorMessage(err, "Could not load check records"));
      })
      .finally(() => {
        if (mounted) setLoadingRecords(false);
      });
    return () => {
      mounted = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, []);

  const maskedAccount = useMemo(() => {
    if (!form.accountNumber) return "";
    return `••••${form.accountNumber.slice(-4)}`;
  }, [form.accountNumber]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  }, []);

  const startCamera = useCallback(async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
    } catch {
      setError("Could not access the camera. Use “Choose File” instead.");
    }
  }, []);

  const captureFromVideo = useCallback(async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob((b) => r(b), "image/jpeg", 0.92));
    if (!blob) return;
    const f = new File([blob], `capture-${Date.now()}.jpg`, { type: "image/jpeg" });
    setFile(f);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const url = URL.createObjectURL(f);
    setPreviewUrl(url);
    stopCamera();
  }, [previewUrl, stopCamera]);

  async function onExtract() {
    if (!file) {
      setError("Capture or select a check image first.");
      return;
    }
    setError("");
    setReviewLow(new Set());
    setUploading(true);
    setStatus("Checking image quality…");
    try {
      const qcCanvas = await fileToSmallCanvas(file, 960);
      const q = assessImageQualityFromCanvas(qcCanvas);
      if (!q.ok) {
        setError(q.detail);
        setStatus("");
        setUploading(false);
        return;
      }

      setStatus("Resizing & uploading check image…");
      const uploadFile = await shrinkCheckImageFileIfLarge(file);
      const dataBase64 = await toBase64(uploadFile);
      const mimeType = (uploadFile.type || "image/jpeg") as "image/jpeg" | "image/jpg" | "image/png" | "image/webp";

      setStatus("Uploading to server…");
      const uploaded = await uploadCheckImage({
        fileName: uploadFile.name,
        mimeType,
        dataBase64
      });

      setStatus("Server OCR (extract)…");
      const extracted: ExtractCheckResponse = await extractCheckFields({
        imageUrl: uploaded.imageUrl,
        dataBase64,
        mimeType
      });

      let localResult: LocalOcrBestResult | null = null;
      lastOcrRawRef.current = extracted.raw;

      if (extracted.provider === "manual-review" || isParsedEmpty(extracted.parsed)) {
        setStatus("Running region OCR in your browser…");
        const tOcr = performance.now();
        localResult = await runLocalCheckOcr(uploadFile, {
          onPhase: (m) => setStatus(m),
          onProgress: (p: OcrProgress) => {
            if (p.phase === "scanning_region" && p.region) {
              setStatus(`Scanning ${p.label}`);
            } else {
              setStatus(p.label);
            }
          }
        });
        if (process.env.NODE_ENV === "development") {
          console.info("[check-capture] OCR timings ms", localResult.timingsMs);
        }
        lastOcrRawRef.current = {
          server: extracted.raw,
          localOcr: { ...localResult, ocrMs: Math.round(performance.now() - tOcr) }
        };
      }

      const mergedFields = mergePreferConfidentServer(
        extracted.parsed || {},
        localResult?.parsed || {},
        localResult?.confidenceByField || extracted.confidenceByField
      );

      setForm((prev) => ({
        ...prev,
        ...mergedFields,
        imageUrl: uploaded.imageUrl
      }));

      setReviewLow(lowConfidenceKeys(localResult?.confidenceByField || extracted.confidenceByField));

      const hasAny = Object.keys(mergedFields).some((k) => {
        const v = mergedFields[k as keyof FormState];
        return v !== undefined && String(v).trim() !== "";
      });
      if (hasAny) {
        setStatus(
          localResult
            ? `Complete in ${(localResult.timingsMs.totalMs / 1000).toFixed(1)}s — review highlighted fields if needed.`
            : "Extraction complete — review fields below."
        );
      } else {
        setStatus("No fields detected — enter manually or retake a clearer photo.");
      }
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not extract check data"));
      setStatus("");
    } finally {
      setUploading(false);
    }
  }

  async function onSave() {
    if (!form.imageUrl) {
      setError("Image URL missing. Extract fields first.");
      return;
    }
    setSaving(true);
    setError("");
    setStatus("Saving check record…");
    try {
      const saved = await saveCheckCapture({
        imageUrl: form.imageUrl,
        checkDate: form.checkDate || undefined,
        amount: form.amount ? Number(form.amount) : undefined,
        checkNumber: form.checkNumber || undefined,
        payerName: form.payerName || undefined,
        routingNumber: form.routingNumber || undefined,
        accountNumber: form.accountNumber || undefined,
        bankName: form.bankName || undefined,
        memo: form.memo || undefined,
        rawOcrJson: lastOcrRawRef.current
      });
      setRecords((prev) => [saved, ...prev]);
      setStatus("Check record saved.");
      setFile(null);
      setForm(emptyForm);
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        setPreviewUrl("");
      }
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not save check"));
      setStatus("");
    } finally {
      setSaving(false);
    }
  }

  function fieldStyle(name: keyof FormState): CSSProperties {
    const low = reviewLow.has(name);
    return {
      width: "100%",
      padding: "10px 12px",
      borderRadius: 8,
      border: low ? "2px solid #f59e0b" : "1px solid #334155",
      background: "#0f172a",
      color: "#f8fafc",
      outline: "none"
    };
  }

  return (
    <main style={{ minHeight: "100vh", background: "#020617", color: "#fff", padding: 24 }}>
      <h1 style={{ marginTop: 0 }}>Check Capture</h1>
      <p style={{ color: "#94a3b8", maxWidth: 720 }}>
        Align the check using the camera overlay (or choose a file). We assess photo quality, run fast region OCR in the
        browser when needed, and merge with server OCR. Low-confidence fields are highlighted in orange.
      </p>

      {error ? (
        <p style={{ color: "#fca5a5", marginTop: 12 }} role="alert">
          {error}
        </p>
      ) : null}
      {status ? (
        <p style={{ color: "#6ee7b7", marginTop: 8 }} aria-live="polite">
          {status}
        </p>
      ) : null}

      <section style={{ marginTop: 20, display: "grid", gap: 16, maxWidth: 960 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <label style={{ color: "#cbd5e1" }}>
            <span style={{ marginRight: 8 }}>Choose File</span>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setFile(f);
                if (previewUrl) URL.revokeObjectURL(previewUrl);
                setPreviewUrl(URL.createObjectURL(f));
              }}
            />
          </label>
          {!cameraOn ? (
            <button
              type="button"
              onClick={startCamera}
              style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #334155", background: "#1e293b" }}
            >
              Use camera
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={captureFromVideo}
                style={{ padding: "8px 14px", borderRadius: 8, background: "#059669", border: "none", color: "#fff" }}
              >
                Capture photo
              </button>
              <button type="button" onClick={stopCamera} style={{ padding: "8px 14px", borderRadius: 8 }}>
                Cancel camera
              </button>
            </>
          )}
          <button
            type="button"
            disabled={uploading || !file}
            onClick={onExtract}
            style={{
              padding: "10px 18px",
              borderRadius: 8,
              background: uploading || !file ? "#334155" : "#059669",
              color: "#fff",
              border: "none",
              fontWeight: 600
            }}
          >
            {uploading ? "Working…" : "Upload & Extract"}
          </button>
        </div>

        <div
          style={{
            position: "relative",
            minHeight: cameraOn ? 320 : 200,
            borderRadius: 12,
            overflow: "hidden",
            background: "#0f172a",
            border: "1px solid #1e293b"
          }}
        >
          {cameraOn ? (
            <div style={{ position: "relative", width: "100%", minHeight: 280, background: "#000" }}>
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                style={{
                  width: "100%",
                  height: "100%",
                  minHeight: 280,
                  display: "block",
                  objectFit: "cover",
                  position: "relative",
                  zIndex: 0
                }}
              />
              <CheckCameraOverlay active />
            </div>
          ) : previewUrl ? (
            <img src={previewUrl} alt="Check preview" style={{ width: "100%", display: "block" }} />
          ) : (
            <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>No preview yet</div>
          )}
        </div>

        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
          <label>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>Check Date</div>
            <input
              type="date"
              value={form.checkDate}
              onChange={(e) => setForm((p) => ({ ...p, checkDate: e.target.value }))}
              style={fieldStyle("checkDate")}
            />
          </label>
          <label>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>Amount</div>
            <input
              value={form.amount}
              onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
              style={fieldStyle("amount")}
            />
          </label>
          <label>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>Check #</div>
            <input
              value={form.checkNumber}
              onChange={(e) => setForm((p) => ({ ...p, checkNumber: e.target.value }))}
              style={fieldStyle("checkNumber")}
            />
          </label>
          <label style={{ gridColumn: "1 / -1" }}>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>Payer / Payee name</div>
            <input
              value={form.payerName}
              onChange={(e) => setForm((p) => ({ ...p, payerName: e.target.value }))}
              style={fieldStyle("payerName")}
            />
          </label>
          <label>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>Routing</div>
            <input
              value={form.routingNumber}
              onChange={(e) => setForm((p) => ({ ...p, routingNumber: e.target.value }))}
              style={fieldStyle("routingNumber")}
            />
          </label>
          <label>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>Account</div>
            <input
              value={form.accountNumber}
              onChange={(e) => setForm((p) => ({ ...p, accountNumber: e.target.value }))}
              style={fieldStyle("accountNumber")}
            />
          </label>
          <label style={{ gridColumn: "1 / -1" }}>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>Bank name</div>
            <input
              value={form.bankName}
              onChange={(e) => setForm((p) => ({ ...p, bankName: e.target.value }))}
              style={fieldStyle("bankName")}
            />
          </label>
          <label style={{ gridColumn: "1 / -1" }}>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>Memo</div>
            <input
              value={form.memo}
              onChange={(e) => setForm((p) => ({ ...p, memo: e.target.value }))}
              style={fieldStyle("memo")}
            />
          </label>
        </div>

        <div style={{ color: "#94a3b8", fontSize: 13 }}>Account preview: {maskedAccount || "—"}</div>
        <div style={{ color: "#64748b", fontSize: 12, wordBreak: "break-all" }}>Image: {form.imageUrl || "—"}</div>

        <button
          type="button"
          disabled={saving || !form.imageUrl}
          onClick={onSave}
          style={{
            padding: "12px 20px",
            borderRadius: 8,
            background: saving || !form.imageUrl ? "#334155" : "#059669",
            color: "#fff",
            border: "none",
            fontWeight: 600,
            maxWidth: 280
          }}
        >
          {saving ? "Saving…" : "Save check record"}
        </button>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 18 }}>Recent check records</h2>
        {loadingRecords ? (
          <p style={{ color: "#94a3b8" }}>Loading…</p>
        ) : records.length === 0 ? (
          <p style={{ color: "#64748b" }}>No checks saved yet.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
            {records.map((r) => (
              <li key={r.id} style={{ border: "1px solid #1e293b", borderRadius: 8, padding: 12 }}>
                <div style={{ fontWeight: 600 }}>{r.payerName || "Unknown payer"}</div>
                <div style={{ color: "#94a3b8", fontSize: 13 }}>
                  ${Number(r.amount || 0).toFixed(2)} · {r.checkDate ? new Date(r.checkDate).toLocaleDateString() : "—"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
