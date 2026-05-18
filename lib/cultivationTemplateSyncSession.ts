import { getSelectedCompanyId } from "@/lib/api";
import { CPU_TENANT_CHANGED_EVENT } from "@/lib/tenantEvents";

const SESSION_PREFIX = "nexbatch:cult-sync:";

function storageKey(companyId: string): string {
  return `${SESSION_PREFIX}${companyId}`;
}

/** Stable fingerprint from schedule template rows (ids, stage offsets, titles). */
export function buildCultivationTemplateFingerprint(
  templates: readonly { id?: string; stage?: string; daysFromStageStart?: number; title?: string }[],
): string {
  const parts = (templates || [])
    .map((t) => {
      const id = String(t.id ?? "").trim();
      const stage = String(t.stage ?? "clone").trim().toLowerCase();
      const days = Number.isFinite(Number(t.daysFromStageStart))
        ? Math.trunc(Number(t.daysFromStageStart))
        : 0;
      const title = String(t.title ?? "").trim();
      return `${id}|${stage}|${days}|${title}`;
    })
    .filter(Boolean)
    .sort();
  return parts.join("\n");
}

export function shouldSkipCultivationTemplateSync(fingerprint: string): boolean {
  if (typeof window === "undefined") return false;
  const companyId = getSelectedCompanyId().trim();
  if (!companyId || !fingerprint) return false;
  try {
    return sessionStorage.getItem(storageKey(companyId)) === fingerprint;
  } catch {
    return false;
  }
}

export function markCultivationTemplateSyncDone(fingerprint: string): void {
  if (typeof window === "undefined") return;
  const companyId = getSelectedCompanyId().trim();
  if (!companyId || !fingerprint) return;
  try {
    sessionStorage.setItem(storageKey(companyId), fingerprint);
  } catch {
    /* ignore quota */
  }
}

export function clearCultivationTemplateSyncSession(): void {
  if (typeof window === "undefined") return;
  const companyId = getSelectedCompanyId().trim();
  if (!companyId) return;
  try {
    sessionStorage.removeItem(storageKey(companyId));
  } catch {
    /* ignore */
  }
}

if (typeof window !== "undefined") {
  window.addEventListener(CPU_TENANT_CHANGED_EVENT, () => {
    try {
      const keys: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k?.startsWith(SESSION_PREFIX)) keys.push(k);
      }
      for (const k of keys) sessionStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  });
}
