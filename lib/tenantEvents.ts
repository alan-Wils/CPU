/**
 * Browser-only: fired when the active company tenant changes (`cpu_selected_company_id`).
 * Data hub and other pages listen to refresh scoped data without a full reload.
 */
export const CPU_TENANT_CHANGED_EVENT = "cpu:tenant-changed";

export type CpuTenantChangedDetail = { companyId: string };

export function emitTenantChanged(companyId: string): void {
  if (typeof window === "undefined") return;
  const id = String(companyId || "").trim();
  if (!id) return;
  window.dispatchEvent(
    new CustomEvent<CpuTenantChangedDetail>(CPU_TENANT_CHANGED_EVENT, {
      detail: { companyId: id }
    })
  );
}
