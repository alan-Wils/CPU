"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Nav from "@/components/Nav";
import PageAccessGate from "@/components/PageAccessGate";
import {
  extractCheckFields,
  listCheckCaptures,
  saveCheckCapture,
  uploadCheckImage,
  type CheckCaptureRecord,
  type CheckExtractedFields
} from "@/lib/checksApi";
import { getApiErrorMessage } from "@/lib/api";
import {
  parseCheckTextFromOcr,
  runLocalCheckOcr,
  shrinkCheckImageFileIfLarge,
  type ParsedCheckFields,
  type LocalOcrBestResult
} from "@/lib/checkCaptureOcr";

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

function isParsedEmpty(parsed: CheckExtractedFields) {
  return (
    !parsed.checkDate &&
    !Number.isFinite(Number(parsed.amount)) &&
    !parsed.checkNumber &&
    !parsed.payerName &&
    !parsed.routingNumber &&
    !parsed.accountNumber &&
    !parsed.bankName &&
    !parsed.memo
  );
}

function isDevLogEnabled() {
  return process.env.NODE_ENV !== "production";
}

function debugLog(label: string, payload: unknown) {
  if (!isDevLogEnabled()) return;
  // eslint-disable-next-line no-console
  console.info(`[check-capture] ${label}`, payload);
}

function mergeExtractedToForm(
  prev: FormState,
  imageUrl: string,
  server: CheckExtractedFields,
  local?: ParsedCheckFields
) {
  const l = local || {};
  const amountStr = (v: number | undefined) =>
    Number.isFinite(Number(v)) && Number(v) >= 0 ? String(Number(v)) : "";
  const pick = (serverValue: string | undefined, localValue: string | undefined, prevValue: string) => {
    const fromServer = String(serverValue || "").trim();
    if (fromServer) return fromServer;
    const fromLocal = String(localValue || "").trim();
    if (fromLocal) return fromLocal;
    return prevValue;
  };
  const amount =
    amountStr(server.amount) || amountStr(l.amount) || (String(prev.amount || "").trim() ? String(prev.amount) : "");
  return {
    imageUrl,
    checkDate: pick(server.checkDate, l.checkDate, prev.checkDate),
    amount,
    checkNumber: pick(server.checkNumber, l.checkNumber, prev.checkNumber),
    payerName: pick(server.payerName, l.payerName, prev.payerName),
    routingNumber: pick(server.routingNumber, l.routingNumber, prev.routingNumber),
    accountNumber: pick(server.accountNumber, l.accountNumber, prev.accountNumber),
    bankName: pick(server.bankName, l.bankName, prev.bankName),
    memo: pick(server.memo, l.memo, prev.memo)
  };
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
  const lastOcrRawRef = useRef<unknown>(undefined);

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
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, []);

  const maskedAccount = useMemo(() => {
    if (!form.accountNumber) return "";
    const tail = form.accountNumber.slice(-4);
    return `••••${tail}`;
  }, [form.accountNumber]);

  function patchForm(next: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...next }));
  }

  async function onExtract() {
    if (!file) {
      setError("Capture or select a check image first.");
      return;
    }
    setError("");
    setStatus("Uploading check image...");
    setUploading(true);
    try {
      const uploadFile = await shrinkCheckImageFileIfLarge(file);
      const dataBase64 = await toBase64(uploadFile);
      const mimeType = (uploadFile.type || "image/jpeg") as "image/jpeg" | "image/jpg" | "image/png" | "image/webp";
      const uploaded = await uploadCheckImage({
        fileName: uploadFile.name,
        mimeType,
        dataBase64
      });
      setStatus("Extracting check fields...");
      const extracted = await extractCheckFields({
        imageUrl: uploaded.imageUrl,
        dataBase64,
        mimeType
      });
      debugLog("server raw OCR payload", extracted.raw);

      let localResult: LocalOcrBestResult | null = null;
      let localParsed: ParsedCheckFields | undefined;
      lastOcrRawRef.current = extracted.raw;

      if (extracted.provider === "manual-review" || isParsedEmpty(extracted.parsed)) {
        setStatus("Running on-device OCR (first use may download language data)...");
        localResult = await runLocalCheckOcr(uploadFile);
        localParsed = localResult.parsed || parseCheckTextFromOcr(localResult.text);
        debugLog("selected OCR rotation", {
          angle: localResult.angle,
          score: localResult.score,
          fieldsDetected: localResult.fieldsDetected,
          textLength: localResult.text.length
        });
        debugLog("parsed check object", localParsed);
        lastOcrRawRef.current = {
          server: extracted.raw,
          localOcr: {
            angle: localResult.angle,
            score: localResult.score,
            fieldsDetected: localResult.fieldsDetected,
            textLength: localResult.text.length,
            preview: localResult.text.slice(0, 500)
          }
        };
      }

      const mergedPreview = mergeExtractedToForm(form, uploaded.imageUrl, extracted.parsed, localParsed);
      setForm((prev) => {
        const merged = mergeExtractedToForm(prev, uploaded.imageUrl, extracted.parsed, localParsed);
        debugLog("final form state after merge", merged);
        return merged;
      });
      const hasAnyValue = Boolean(
        mergedPreview.checkDate ||
          mergedPreview.amount ||
          mergedPreview.checkNumber ||
          mergedPreview.payerName ||
          mergedPreview.routingNumber ||
          mergedPreview.accountNumber ||
          mergedPreview.bankName ||
          mergedPreview.memo
      );
      if (hasAnyValue) {
        if (localResult) {
          setStatus(`Extraction complete (browser OCR at ${localResult.angle}° + review). Edit any fields, then save.`);
        } else {
          setStatus(`Extraction complete (${extracted.provider}). Review fields below before saving.`);
        }
      } else {
        setStatus("No fields detected automatically. Enter values manually, then save.");
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
    setStatus("Saving check record...");
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
      setError(getApiErrorMessage(err, "Could not save check record"));
      setStatus("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageAccessGate allowedRoles={["CULTIVATION", "EXTRACTION", "PACKAGING"]}>
      <main style={pageStyle}>
        <Nav />
        <section style={cardStyle}>
          <h1 style={{ marginTop: 0, marginBottom: 8 }}>Check Capture</h1>
          <p style={mutedStyle}>
            Capture a check image, auto-extract fields, review, and save to your shared check records table. If the
            server has no OCR API key, the app runs OCR in your browser (may take a few seconds the first time while
            language data downloads).
          </p>

          <div style={rowStyle}>
            <input
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/webp,image/*"
              capture="environment"
              onChange={(event) => {
                const selected = event.target.files?.[0] || null;
                setFile(selected);
                setError("");
                setStatus("");
                lastOcrRawRef.current = undefined;
                setForm(emptyForm);
                if (previewUrl) URL.revokeObjectURL(previewUrl);
                if (selected) {
                  setPreviewUrl(URL.createObjectURL(selected));
                } else {
                  setPreviewUrl("");
                }
              }}
              style={inputStyle}
            />
            <button style={primaryButton} onClick={onExtract} disabled={uploading || !file}>
              {uploading ? "Processing..." : "Upload & Extract"}
            </button>
          </div>

          {previewUrl ? (
            <div style={{ marginTop: 12 }}>
              <img src={previewUrl} alt="Check preview" style={imageStyle} />
            </div>
          ) : null}

          {status ? <div style={statusStyle}>{status}</div> : null}
          {error ? <div style={errorStyle}>{error}</div> : null}

          <div style={gridStyle}>
            <label style={labelStyle}>
              Check Date
              <input type="date" value={form.checkDate} onChange={(e) => patchForm({ checkDate: e.target.value })} style={fieldStyle} />
            </label>
            <label style={labelStyle}>
              Amount
              <input type="number" step="0.01" min="0" value={form.amount} onChange={(e) => patchForm({ amount: e.target.value })} style={fieldStyle} />
            </label>
            <label style={labelStyle}>
              Check Number
              <input value={form.checkNumber} onChange={(e) => patchForm({ checkNumber: e.target.value })} style={fieldStyle} />
            </label>
            <label style={labelStyle}>
              Payer Name
              <input value={form.payerName} onChange={(e) => patchForm({ payerName: e.target.value })} style={fieldStyle} />
            </label>
            <label style={labelStyle}>
              Routing Number
              <input value={form.routingNumber} onChange={(e) => patchForm({ routingNumber: e.target.value })} style={fieldStyle} />
            </label>
            <label style={labelStyle}>
              Account Number
              <input value={form.accountNumber} onChange={(e) => patchForm({ accountNumber: e.target.value })} style={fieldStyle} />
            </label>
            <label style={labelStyle}>
              Bank Name
              <input value={form.bankName} onChange={(e) => patchForm({ bankName: e.target.value })} style={fieldStyle} />
            </label>
            <label style={labelStyle}>
              Memo
              <input value={form.memo} onChange={(e) => patchForm({ memo: e.target.value })} style={fieldStyle} />
            </label>
          </div>

          <div style={{ marginTop: 10, color: "#93c5fd" }}>
            Account Preview: {maskedAccount || "Not provided"}
          </div>
          <div style={{ marginTop: 10, color: "#cbd5e1", wordBreak: "break-all" }}>
            Image Link: {form.imageUrl || "Not uploaded"}
          </div>

          <button style={{ ...primaryButton, marginTop: 16 }} onClick={onSave} disabled={saving || !form.imageUrl}>
            {saving ? "Saving..." : "Save Check Record"}
          </button>
        </section>

        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Recent Check Records</h2>
          {loadingRecords ? (
            <p style={mutedStyle}>Loading records...</p>
          ) : records.length === 0 ? (
            <p style={mutedStyle}>No checks saved yet.</p>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {records.map((record) => (
                <div key={record.id} style={listRowStyle}>
                  <div>
                    <b>{record.payerName || "Unknown payer"}</b> | Check #{record.checkNumber || "—"} | $
                    {Number(record.amount || 0).toFixed(2)}
                  </div>
                  <div style={mutedStyle}>
                    {record.checkDate ? new Date(record.checkDate).toLocaleDateString() : "No check date"} |{" "}
                    {new Date(record.createdAt).toLocaleString()}
                  </div>
                  <a href={record.imageUrl} target="_blank" rel="noreferrer" style={linkStyle}>
                    Open image
                  </a>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </PageAccessGate>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "radial-gradient(circle at top, #1e293b 0, #020617 45%, #020617 100%)",
  color: "#fff",
  padding: 24
};

const cardStyle: React.CSSProperties = {
  background: "rgba(15, 23, 42, 0.9)",
  border: "1px solid rgba(148,163,184,0.28)",
  borderRadius: 16,
  padding: 18,
  marginBottom: 18
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
  alignItems: "center"
};

const inputStyle: React.CSSProperties = {
  color: "#e2e8f0",
  maxWidth: 360
};

const primaryButton: React.CSSProperties = {
  background: "#22c55e",
  color: "#052e16",
  border: "none",
  borderRadius: 10,
  padding: "10px 14px",
  fontWeight: 800,
  cursor: "pointer"
};

const imageStyle: React.CSSProperties = {
  width: "100%",
  maxHeight: 420,
  objectFit: "contain",
  borderRadius: 12,
  border: "1px solid #334155",
  background: "#020617"
};

const statusStyle: React.CSSProperties = {
  marginTop: 10,
  color: "#86efac",
  fontWeight: 700
};

const errorStyle: React.CSSProperties = {
  marginTop: 10,
  color: "#fca5a5",
  fontWeight: 700
};

const gridStyle: React.CSSProperties = {
  marginTop: 14,
  display: "grid",
  gap: 10,
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))"
};

const labelStyle: React.CSSProperties = {
  display: "grid",
  gap: 6,
  fontWeight: 700,
  color: "#cbd5e1"
};

const fieldStyle: React.CSSProperties = {
  width: "100%",
  borderRadius: 8,
  border: "1px solid #334155",
  background: "#0f172a",
  color: "#fff",
  padding: "9px 10px"
};

const mutedStyle: React.CSSProperties = {
  color: "#94a3b8"
};

const listRowStyle: React.CSSProperties = {
  border: "1px solid #334155",
  borderRadius: 10,
  padding: 12,
  background: "#020617"
};

const linkStyle: React.CSSProperties = {
  color: "#93c5fd"
};
