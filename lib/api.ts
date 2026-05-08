import { clearAuthSession, getAuthToken, type LoginResponse } from "./auth";

function resolveApiBaseUrl(): string {
  const raw =
    typeof process !== "undefined"
      ? (process.env.NEXT_PUBLIC_API_URL || "").trim()
      : "";
  if (!raw) return "http://localhost:4000";
  const base = raw.replace(/\/+$/, "");
  /** Must be `https://...` host; a bare path or non-URL string becomes same-origin on the browser → Next 404 HTML. */
  if (/^https?:\/\//i.test(base)) return base;
  return "http://localhost:4000";
}

/** Railway / local `@cpu/api` origin; set `NEXT_PUBLIC_API_URL` on Vercel (no trailing slash). */
export const API_BASE_URL = resolveApiBaseUrl();

const SELECTED_COMPANY_KEY = "cpu_selected_company_id";

type ApiOptions = {
  method?: string;
  body?: any;
  auth?: boolean;
  companyId?: string;
  /** When true, a 401 response does not clear the session or redirect (e.g. probing token validity). */
  skipAuthRedirectOn401?: boolean;
  /** Omit `X-Company-Id` (portal pre-selector or company switch refresh). */
  omitCompanyHeader?: boolean;
};

export function getSelectedCompanyId() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(SELECTED_COMPANY_KEY) || "";
}

export function setSelectedCompanyId(companyId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SELECTED_COMPANY_KEY, companyId);
}

export function clearSelectedCompanyId() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SELECTED_COMPANY_KEY);
}

const API_FAIL_FALLBACK = "API request failed";

function looksLikeHtml(text: string): boolean {
  const t = String(text || "").trim().toLowerCase();
  return t.startsWith("<!doctype") || t.startsWith("<html") || t.startsWith("<head") || t.startsWith("<body");
}

function coerceUnknownToMessage(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => coerceUnknownToMessage(item))
      .filter(Boolean) as string[];
    return parts.length ? parts.join("; ") : null;
  }
  if (typeof value === "object") {
    const m = (value as { message?: unknown }).message;
    if (typeof m === "string" && m.trim()) return m;
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }
  return null;
}

function formatErrorsArray(entries: unknown[]): string | null {
  const parts: string[] = [];
  for (const item of entries) {
    if (typeof item === "string") {
      if (item.trim()) parts.push(item.trim());
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const picked =
      (typeof row.msg === "string" && row.msg.trim()) ||
      (typeof row.message === "string" && row.message.trim()) ||
      (typeof row.path === "string" && row.path.trim()
        ? `${row.path}: ${typeof row.msg === "string" ? row.msg : row.code || "invalid"}`
        : "");
    if (picked) parts.push(picked.trim());
    else {
      const nested = coerceUnknownToMessage(row);
      if (nested) parts.push(nested);
    }
  }
  return parts.length ? parts.join("; ") : null;
}

/** Readable message for failed HTTP responses (avoids `[object Object]` from Error ctor). */
function stringifyApiFailureBody(data: unknown): string {
  if (typeof data === "string") {
    const t = data.trim();
    return t || API_FAIL_FALLBACK;
  }
  if (!data || typeof data !== "object") return API_FAIL_FALLBACK;

  const obj = data as Record<string, unknown>;

  let primary: string | null = null;
  /** Prefer top-level `message` when present (API often puts user-facing copy here). */
  const topMessage = coerceUnknownToMessage(obj.message);
  if (topMessage) {
    primary = topMessage;
  } else {
    for (const key of ["error", "message", "details"] as const) {
      const s = coerceUnknownToMessage(obj[key]);
      if (s) {
        primary = s;
        break;
      }
    }
  }

  const fromErrors =
    Array.isArray(obj.errors) ? formatErrorsArray(obj.errors as unknown[]) : null;

  const nestedErr = obj.error;
  let fromNestedDetails: string | null = null;
  if (
    nestedErr &&
    typeof nestedErr === "object" &&
    !Array.isArray(nestedErr) &&
    primary &&
    /^validation failed$/i.test(String(primary).trim())
  ) {
    const d = (nestedErr as { details?: unknown }).details;
    if (Array.isArray(d) && d.length) {
      fromNestedDetails = formatErrorsArray(d as unknown[]);
    }
  }

  if (fromErrors && primary && /^validation failed$/i.test(primary.trim())) {
    return `${primary}: ${fromErrors}`;
  }
  if (fromNestedDetails) {
    return `${primary}: ${fromNestedDetails}`;
  }
  if (primary) return primary;
  if (fromErrors) return fromErrors;

  try {
    const json = JSON.stringify(data);
    if (json && json !== "{}") return json;
  } catch {
    /* ignore */
  }

  return API_FAIL_FALLBACK;
}

export async function apiRequest<T = any>(
  path: string,
  options: ApiOptions = {}
): Promise<T> {
  const token = getAuthToken();
  const selectedCompanyId = options.companyId || getSelectedCompanyId();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (options.auth !== false && token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (!options.omitCompanyHeader && selectedCompanyId) {
    headers["X-Company-Id"] = selectedCompanyId;
  }

  const requestUrl = `${API_BASE_URL}${path}`;
  let res: Response;
  try {
    res = await fetch(requestUrl, {
      method: options.method || "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch (error) {
    const msg =
      error instanceof Error
        ? error.message
        : "Network request failed";
    throw new Error(
      `Could not reach API (${requestUrl}). ${msg}. Check API deployment, NEXT_PUBLIC_API_URL, CORS, and network.`,
    );
  }

  const text = await res.text();
  const contentType = String(res.headers.get("content-type") || "").toLowerCase();

  let data: any = null;
  const hasBody = Boolean(String(text || "").trim());
  const jsonByHeader =
    contentType.includes("application/json") || contentType.includes("+json");
  const jsonByBody = String(text || "").trim().startsWith("{") || String(text || "").trim().startsWith("[");
  const shouldParseJson = hasBody && (jsonByHeader || jsonByBody);
  if (!hasBody) {
    data = null;
  } else if (shouldParseJson) {
    try {
      data = JSON.parse(text);
    } catch {
      if (looksLikeHtml(text)) {
        throw new Error(
          `API returned HTML instead of JSON at ${requestUrl}. Check NEXT_PUBLIC_API_URL/proxy and API route deployment.`,
        );
      }
      throw new Error(`API returned invalid JSON at ${requestUrl}.`);
    }
  } else {
    data = text;
  }

  if (!res.ok) {
    if (
      res.status === 401 &&
      typeof window !== "undefined" &&
      options.auth !== false &&
      !options.skipAuthRedirectOn401
    ) {
      const path = window.location.pathname || "";
      if (
        !path.startsWith("/login") &&
        !path.startsWith("/accept-invite") &&
        !path.startsWith("/accept-nexbatch-invite") &&
        !path.startsWith("/forgot-password") &&
        !path.startsWith("/password-reset")
      ) {
        clearAuthSession();
        const next = encodeURIComponent(path + (window.location.search || ""));
        window.location.replace(`/login?next=${next}`);
      }
    }
    throw new Error(stringifyApiFailureBody(data));
  }

  if (!shouldParseJson && looksLikeHtml(String(data || ""))) {
    throw new Error(
      `API returned HTML instead of JSON at ${requestUrl}. Check NEXT_PUBLIC_API_URL/proxy and API route deployment.`,
    );
  }

  return data;
}

export async function loginCompany(payload: {
  companyCode?: string;
  username: string;
  password: string;
  /** When true, API issues a longer-lived JWT (7d vs `JWT_EXPIRES_IN`, default 15m). */
  remember?: boolean;
}) {
  return apiRequest("/api/auth/login", {
    method: "POST",
    auth: false,
    body: payload,
  });
}

export async function acceptInvite(payload: {
  token: string;
  password: string;
}) {
  return apiRequest("/api/auth/accept-invite", {
    method: "POST",
    auth: false,
    body: payload,
  });
}

/** Resolve company slug for accept-invite copy (unauthenticated; valid open invite only). */
export async function getInvitePreview(token: string) {
  const q = encodeURIComponent(token);
  return apiRequest<{ companyCode: string }>(
    `/api/auth/invite-preview?token=${q}`,
    {
      method: "GET",
      auth: false,
      omitCompanyHeader: true,
    },
  );
}

export async function acceptNexBatchInvite(payload: {
  token: string;
  password: string;
}) {
  return apiRequest<LoginResponse>("/api/auth/accept-nexbatch-invite", {
    method: "POST",
    auth: false,
    body: payload,
  });
}

export async function requestPasswordResetEmail(email: string) {
  return apiRequest("/api/auth/password-reset/request", {
    method: "POST",
    auth: false,
    body: { email: email.trim().toLowerCase() },
  });
}

export async function confirmPasswordReset(payload: {
  token: string;
  password: string;
}) {
  return apiRequest("/api/auth/password-reset/confirm", {
    method: "POST",
    auth: false,
    body: payload,
  });
}

export async function changePassword(payload: {
  currentPassword?: string;
  newPassword: string;
}) {
  return apiRequest("/api/auth/change-password", {
    method: "POST",
    body: payload,
  });
}

export async function getMe() {
  return apiRequest("/api/auth/me");
}

export async function selectPortalCompany(companyId: string) {
  return apiRequest<{
    token: string;
    user: Record<string, unknown>;
    company: { id: string; name: string; code: string };
  }>("/api/auth/select-company", {
    method: "POST",
    body: { companyId },
    omitCompanyHeader: true,
  });
}

export async function getUsers(companyId?: string) {
  return apiRequest("/api/admin/users", {
    companyId,
  });
}

export async function inviteUser(payload: {
  username?: string;
  email: string;
  role: string;
  companyId?: string;
}) {
  return apiRequest("/api/admin/invites", {
    method: "POST",
    body: { email: payload.email.trim().toLowerCase(), role: payload.role },
    companyId: payload.companyId,
  });
}

/** Appends `?companyId=` / `&companyId=` for OWNER tenant scoping when proxies drop `X-Company-Id` on GET. */
export function appendCompanyIdQuery(path: string, companyId: string): string {
  const id = String(companyId || "").trim();
  if (!id) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}companyId=${encodeURIComponent(id)}`;
}

export async function deletePendingInvite(inviteId: string, companyId?: string) {
  const cid = String(companyId ?? "").trim() || getSelectedCompanyId();
  const base = `/api/admin/invites/${encodeURIComponent(inviteId)}`;
  const path = appendCompanyIdQuery(base, cid);
  return apiRequest(path, {
    method: "DELETE",
    companyId: cid || companyId,
  });
}

export async function createUser(payload: {
  username?: string;
  email: string;
  password?: string;
  role: string;
  companyId?: string;
}) {
  return inviteUser({
    username: payload.username,
    email: payload.email,
    role: payload.role,
    companyId: payload.companyId,
  });
}

export async function getCompanies() {
  const raw = await apiRequest<
    { companies: Array<{ code?: string; slug?: string; [k: string]: unknown }> }
  >("/api/companies/all");
  const list = raw.companies ?? [];
  return list.map((c) => ({
    ...c,
    code: c.code || String(c.slug ?? "").toUpperCase(),
  }));
}

/** NexBatch Owner / NexBatch Admin: permanently delete a tenant and all cascaded company data. */
export async function deletePlatformCompany(companyId: string) {
  return apiRequest<{ ok: boolean }>(
    `/api/companies/${encodeURIComponent(companyId)}`,
    {
      method: "DELETE",
      omitCompanyHeader: true,
    },
  );
}

export async function getCompanyData<T = any[]>(
  type: string,
  companyId?: string
): Promise<T> {
  return apiRequest(`/api/data/${type}`, {
    companyId,
  });
}

export async function saveCompanyItem<T = any>(
  type: string,
  item: any,
  companyId?: string
): Promise<T> {
  return apiRequest(`/api/data/${type}`, {
    method: "POST",
    body: item,
    companyId,
  });
}

export async function deleteCompanyItem(
  type: string,
  id: string,
  companyId?: string
) {
  return apiRequest(`/api/data/${type}/${encodeURIComponent(id)}`, {
    method: "DELETE",
    companyId,
  });
}

export async function getLogs(companyId?: string) {
  return apiRequest("/api/logs", {
    companyId,
  });
}

export async function saveLog(
  log: {
    area: string;
    batch?: string;
    task: string;
    output?: string;
    data?: any;
  },
  companyId?: string
) {
  return apiRequest("/api/logs", {
    method: "POST",
    body: log,
    companyId,
  });
}

/** Strain-only labels; server builds the OpenAI prompt from `apps/api/prompts/extraction-product-name.md`. */
export async function suggestExtractionProductNames(
  strains: string[],
  companyId?: string
): Promise<{ suggestions: string[] }> {
  return apiRequest<{ suggestions: string[] }>(
    "/api/extraction-assist/suggest-product-names",
    {
      method: "POST",
      body: { strains },
      companyId,
    }
  );
}

/** Per-company membership: scheduled cash / financial log digest email. */
export type CashLogEodPrefsDto = {
  enabled: boolean;
  weekdays: number[];
  sendTime: string;
  window: "LAST_24H" | "LAST_7_DAYS";
  timezone: string;
};

function withCompanyIdQuery(path: string, companyId: string) {
  const id = String(companyId || "").trim();
  if (!id) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}companyId=${encodeURIComponent(id)}`;
}

export async function fetchCashLogEodPrefs(companyId: string) {
  return apiRequest<{ prefs: CashLogEodPrefsDto }>(
    withCompanyIdQuery("/api/cash-log/eod-prefs", companyId),
    { companyId },
  );
}

export async function saveCashLogEodPrefs(companyId: string, prefs: CashLogEodPrefsDto) {
  return apiRequest<{ prefs: CashLogEodPrefsDto }>(
    withCompanyIdQuery("/api/cash-log/eod-prefs", companyId),
    { method: "PUT", body: prefs, companyId },
  );
}

/** Autogrow MultiGrow readings (requires company Autogrow config + JWT roles). */

export type AutogrowWeatherSnapshotDto = {
  ok: boolean;
  status: number;
  metadata: Record<string, unknown> | null;
  readings: Record<string, unknown> | null;
  message?: string;
};

export type AutogrowCompSnapshotItemDto = {
  compIndex: number;
  ok: boolean;
  status: number;
  metadata: Record<string, unknown> | null;
  readings: Record<string, unknown> | null;
  message?: string;
};

export type AutogrowSnapshotSuccessDto = {
  ok: true;
  deviceUuid: string;
  compLabels: Array<{ compIndex: number; label: string }>;
  comps: AutogrowCompSnapshotItemDto[];
  weather: AutogrowWeatherSnapshotDto;
};

export type AutogrowSnapshotFailureDto = {
  ok: false;
  status: number;
  message: string;
};

export type AutogrowSnapshotDto = AutogrowSnapshotSuccessDto | AutogrowSnapshotFailureDto;

export async function fetchAutogrowSnapshot(companyId?: string) {
  return apiRequest<AutogrowSnapshotDto>("/api/autogrow/snapshot", { companyId });
}

/** Success body only; failures throw via apiRequest. */
export type AutogrowCompDetailSuccess = {
  deviceUuid: string;
  compIndex: number;
  metadata: Record<string, unknown> | null;
  readings: Record<string, unknown>;
};

export async function fetchAutogrowCompReadings(compIndex: number, companyId?: string) {
  const idx = encodeURIComponent(String(compIndex));
  return apiRequest<AutogrowCompDetailSuccess>(`/api/autogrow/comps/${idx}`, { companyId });
}

export type AutogrowCompHistoryDto = {
  deviceUuid: string;
  compIndex: number;
  fromEpoch: number;
  toEpoch: number;
  points: Array<{ time: string; [key: string]: string | number | null }>;
};

export async function fetchAutogrowCompHistory(
  compIndex: number,
  fromEpoch: number,
  toEpoch: number,
  companyId?: string,
) {
  const idx = encodeURIComponent(String(compIndex));
  const qs = `from=${encodeURIComponent(String(Math.floor(fromEpoch)))}&to=${encodeURIComponent(String(Math.floor(toEpoch)))}`;
  return apiRequest<AutogrowCompHistoryDto>(`/api/autogrow/comps/${idx}/history?${qs}`, { companyId });
}

/** NexBatch portal — platform admins only (`omitCompanyHeader` + JWT platform role). */
export type UsageCostProviderDto = {
  provider: string;
  displayName: string;
  usageSummary: string;
  usageMetrics: { label: string; value: string }[];
  displayCost: number;
  estimatedCost: number;
  vendorTotalCost: number | null;
  currency: "USD";
  status: "live_synced" | "missing_token" | "sync_failed" | "estimated_only" | "no_activity";
  statusLabel: string;
  allocationMethod: "exact_internal" | "vendor_allocated" | "estimated";
  lastSyncedAt: string | null;
  notes: string;
};

export type CompanyUsageCostsDto = {
  companyId: string;
  companyName: string;
  monthLabel: string;
  monthStart: string;
  monthEnd: string;
  totalEstimatedCost: number;
  totalDisplayCost: number;
  projectedMonthlyCost: number | null;
  lastUpdated: string | null;
  providers: UsageCostProviderDto[];
};

export async function fetchCompanyUsageCosts(companyId: string) {
  return apiRequest<CompanyUsageCostsDto>(
    `/api/admin/companies/${encodeURIComponent(companyId)}/usage-costs`,
    { omitCompanyHeader: true },
  );
}

export type NexbatchCompanyUsageLogItemDto = {
  id: string;
  actorUserId: string | null;
  feature: string;
  category: string;
  provider: string;
  unitType: string;
  units: number;
  estimatedCost: number;
  metadata: unknown;
  createdAt: string;
};

export async function fetchNexbatchCompanyUsageLog(companyId: string, take = 40) {
  const q = take > 0 ? `?take=${encodeURIComponent(String(take))}` : "";
  return apiRequest<{ companyId: string; items: NexbatchCompanyUsageLogItemDto[] }>(
    `/api/admin/companies/${encodeURIComponent(companyId)}/nexbatch-company-usage-log${q}`,
    { omitCompanyHeader: true },
  );
}

export type VendorSyncSummaryDto = {
  provider: string;
  status: "live_synced" | "missing_token" | "sync_failed" | "estimated_only";
  totalCost: number | null;
  currency: string;
  syncedAt: string | null;
  message: string | null;
};

export async function syncVendorUsageCosts() {
  return apiRequest<{ month: string; results: VendorSyncSummaryDto[] }>(
    "/api/admin/usage-costs/sync",
    { method: "POST", omitCompanyHeader: true },
  );
}

export type LeafLinkInventoryItemDto = {
  id: string;
  productName: string;
  sku: string;
  strain: string;
  category: string;
  productType: string;
  /** Live resin, sugar wax, disposable, etc. — filters independently from top-level category. */
  subcategory?: string;
  brand: string;
  availableQuantity: number;
  unit: string;
  packageSize: string;
  price: number | null;
  status: string;
  updatedAt: string;
  imageUrl: string;
  /** Batch/source key when multiple SKUs share one package (see API leaflink normalize). */
  sourcePackageGroup?: string;
};

export type LeafLinkInventoryDto = {
  source: "leaflink";
  items: LeafLinkInventoryItemDto[];
  stats: {
    totalSkus: number;
    totalInventoryUnits: number;
    totalInventoryValue: number;
    categoriesCount: number;
  };
  lastSyncedAt: string;
  /** Present when the API returned Postgres snapshot without calling LeafLink. */
  fromCache?: boolean;
  /** How rows were produced: cache hit, full catalog pull, or merged incremental delta. */
  syncMode?: "cache" | "full" | "incremental";
};

export type LeafLinkConfigDto = {
  integrationEnabled: boolean;
  companySlug: string;
  companyId: string;
  username: string;
  baseUrl: string;
  hasApiKey: boolean;
};

export type LeafLinkConfigUpsertInput = {
  integrationEnabled: boolean;
  companySlug: string;
  companyId: string;
  username: string;
  baseUrl: string;
  apiKey?: string;
  clearApiKey?: boolean;
};

export async function fetchLeafLinkInventory(companyId?: string, opts?: { refresh?: boolean }) {
  const q = opts?.refresh ? "?refresh=1" : "";
  return apiRequest<LeafLinkInventoryDto>(`/api/inventory/leaflink${q}`, { companyId });
}

export async function fetchLeafLinkConfig(companyId?: string) {
  return apiRequest<LeafLinkConfigDto>("/api/inventory/leaflink/config", { companyId });
}

export async function saveLeafLinkConfig(input: LeafLinkConfigUpsertInput, companyId?: string) {
  return apiRequest<LeafLinkConfigDto>("/api/inventory/leaflink/config", {
    method: "PUT",
    body: input,
    companyId,
  });
}

/** LeafLink wholesale orders (backend-normalized JSON). See `LeafLinkOrdersService`. */
export type LeafLinkOrderLineItemDto = {
  id: string;
  productName: string;
  sku: string;
  quantity: number;
  unitPrice: number | null;
  lineTotal: number | null;
  notes: string;
  productId: string;
  /** LeafLink `is_sample` / product sample state (see API). */
  isSample: boolean;
};

export type LeafLinkOrderSummaryDto = {
  id: string;
  orderNumber: string;
  shortNumber: string;
  customerName: string;
  status: string;
  statusNormalized: string;
  createdAt: string;
  updatedAt: string;
  subtotal: number | null;
  total: number | null;
  itemCount: number;
  salesRep: string;
  paymentStatus: string;
  deliveryDate: string | null;
  lineItems: LeafLinkOrderLineItemDto[];
  notes: string;
  internalNotes: string | null;
  discount: number | null;
  discountType: string | null;
  taxAmount: number | null;
  finalTaxAmount: number | null;
  shippingAmount: number | null;
  paymentTerm: string | null;
  paid: boolean;
  shipDate: string | null;
  deliveryPreferences: string | null;
  shippingDetails: string | null;
  classification: string;
  buyerCustomerId: string;
};

export type LeafLinkOrderCardDto = Omit<LeafLinkOrderSummaryDto, "lineItems"> & {
  itemCount: number;
};

export type LeafLinkOrdersListDto = {
  source: "leaflink";
  configured: boolean;
  integrationEnabled: boolean;
  orders: LeafLinkOrderCardDto[];
  totalCount: number;
  page: number;
  pageSize: number;
  ordering: string;
  hasNext: boolean;
  hasPrevious: boolean;
  lastFetchedAt: string;
  fromCache?: boolean;
};

export type LeafLinkOrdersSyncDto = {
  ok: boolean;
  configured: boolean;
  integrationEnabled: boolean;
  pagesPulled: number;
  ordersSeen: number;
  lastFetchedAt: string;
};

export async function fetchLeafLinkOrdersList(
  opts: {
    companyId?: string;
    page?: number;
    pageSize?: number;
    status?: string;
    sort?: "newest" | "oldest";
    search?: string;
    refresh?: boolean;
  } = {},
) {
  const q = new URLSearchParams();
  if (opts.page && opts.page >= 1) q.set("page", String(opts.page));
  if (opts.pageSize && opts.pageSize >= 1 && opts.pageSize <= 500)
    q.set("page_size", String(opts.pageSize));
  const st = String(opts.status || "").trim();
  if (st && st !== "all") q.set("status", st);
  if (opts.sort) q.set("sort", opts.sort);
  const s = String(opts.search || "").trim();
  if (s) q.set("search", s);
  if (opts.refresh) q.set("refresh", "true");
  const qs = q.toString();
  return apiRequest<LeafLinkOrdersListDto>(
    qs ? `/api/orders?${qs}` : "/api/orders",
    opts.companyId ? { companyId: opts.companyId } : {},
  );
}

export async function fetchLeafLinkOrderDetail(orderId: string, companyId?: string) {
  const id = encodeURIComponent(orderId);
  return apiRequest<{ order: LeafLinkOrderSummaryDto }>(
    `/api/orders/${id}`,
    companyId ? { companyId } : {},
  );
}

export async function syncLeafLinkOrders(companyId?: string) {
  return apiRequest<LeafLinkOrdersSyncDto>(
    "/api/orders/sync",
    { method: "POST", companyId },
  );
}

export type OrdersAnalyticsSampleTypeBreakdown = {
  typeLabel: string;
  units: number;
};

export type OrdersAnalyticsSampleLineItemDto = {
  orderId: string;
  orderNumber: string;
  createdAt: string;
  productName: string;
  sku: string;
  quantity: number;
  typeLabel: string;
};

export type OrdersAnalyticsQualifyingOrderDto = {
  orderId: string;
  orderNumber: string;
  customerKey: string;
  createdAt: string;
  totalUsd: number;
};

export type OrdersAnalyticsCustomerDto = {
  key: string;
  label: string;
  lastPurchaseDate: string;
  /** Most recent qualifying order total in the selected range. */
  lastOrderTotal: number;
  orderTotalInRange: number;
  sampleUnitsInRange: number;
  samplesByType: OrdersAnalyticsSampleTypeBreakdown[];
  sampleLineItems: OrdersAnalyticsSampleLineItemDto[];
  revenueByDay: number[];
  orderCountByDay: number[];
  sampleUnitsByDay: number[];
};

export type OrdersAnalyticsDto = {
  source: "leaflink";
  configured: boolean;
  integrationEnabled: boolean;
  dateFrom: string;
  dateTo: string;
  ordersIncluded: number;
  minOrderTotal: number;
  pagesScanned: number;
  truncated: boolean;
  days: string[];
  customers: OrdersAnalyticsCustomerDto[];
  qualifyingOrders: OrdersAnalyticsQualifyingOrderDto[];
  qualifyingOrdersTruncated: boolean;
  readFromDatabase: boolean;
  leafLinkRefreshRan: boolean;
  storedRowsInRange: number;
  storedSnapshotMaxUpdatedAt: string | null;
  filteredByLeafLinkCurrentCustomerStatus: boolean;
  leafLinkCurrentCustomerCount: number;
};

export async function fetchOrdersAnalytics(
  from: string,
  to: string,
  companyId?: string,
  opts?: { refreshLeafLink?: boolean },
) {
  const q = new URLSearchParams({ from, to });
  if (opts?.refreshLeafLink) q.set("refresh", "true");
  return apiRequest<OrdersAnalyticsDto>(`/api/orders/analytics?${q.toString()}`, {
    companyId,
  });
}