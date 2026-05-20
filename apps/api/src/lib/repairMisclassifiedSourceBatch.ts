import { getSourceAvailable } from "./sourceBatchActive.js";

function norm(value: unknown): string {
    return String(value ?? "").trim();
}

export function isCultivationTransferredSource(row: unknown): boolean {
    if (!row || typeof row !== "object")
        return false;
    const r = row as Record<string, unknown>;
    if (r.manualTransferToExtraction === true)
        return true;
    return Boolean(norm(r.cultivationTransferId));
}

export function isMisclassifiedTerminalSourceBatch(row: unknown): boolean {
    if (!row || typeof row !== "object")
        return false;
    const status = norm((row as { status?: unknown }).status).toLowerCase();
    if (status === "used in extraction")
        return false;
    if (!status.includes("complete"))
        return false;
    if (getSourceAvailable(row) <= 0)
        return false;
    return isCultivationTransferredSource(row);
}

export function repairMisclassifiedSourceBatchRow(row: unknown): Record<string, unknown> | null {
    if (!row || typeof row !== "object")
        return null;
    if (!isMisclassifiedTerminalSourceBatch(row))
        return null;
    const r = { ...(row as Record<string, unknown>) };
    r.status = "Available for Extraction";
    if (r.remainingAmount !== undefined && Number(r.remainingAmount) <= 0)
        delete r.remainingAmount;
    return r;
}
