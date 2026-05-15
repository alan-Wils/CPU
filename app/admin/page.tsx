"use client";

import {
  ADMIN_PERMISSION_SECTIONS,
  APP_PERMISSION_LABELS,
  defaultPagePermissionsForRole,
  fullAccessPermissionIds,
  isOwnerOrAdminRoleKey,
} from "@/lib/appPermissionAdminUi";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Nav from "@/components/Nav";
import PageAccessGate from "@/components/PageAccessGate";
import {
  API_BASE_URL,
  apiRequest,
  CashLogEodPrefsDto,
  deletePendingInvite,
  fetchCashLogEodPrefs,
  getMe,
  getSelectedCompanyId,
  inviteUser,
  saveCashLogEodPrefs,
  setSelectedCompanyId,
  syncLeafLinkOrders,
} from "@/lib/api";
import { getAuthCompany, getAuthToken, getAuthUser } from "@/lib/auth";
import { formatCompanyTimestamp } from "@/lib/companyTimezone";

type AdminUser = {
  id: string;
  username: string;
  email?: string | null;
  role: string;
  active: boolean;
  status?: string;
  emailVerified?: boolean;
  mustChangePassword?: boolean;
  createdAt?: string;
  /** From `CompanyMembership.appPermissions`; `null` = role defaults. */
  appPermissions?: string[] | null;
  /** Per-employee EOD financial digest recipient toggle (default false). */
  cashLogEodEnabled?: boolean;
  /** Staff rewards enrollment for this company membership. */
  rewardsEnrolled?: boolean;
  /** Cultivation climate (Autogrow) threshold alerts for this workspace. */
  cultivationAlertsEnabled?: boolean;
};

type CompanyItem = {
  id: string;
  name: string;
  code: string;
  /** Present when using `@cpu/api` responses */
  slug?: string;
  createdAt?: string;
  usersCount?: number;
};

/** Matches `inviteCreateSchema` on `@cpu/api` */
type PendingInvite = {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  createdAt: string;
};

/** `@cpu/api` returns `{ users }`; legacy servers may return a bare array. */
function normalizeAdminUsersList(raw: unknown): AdminUser[] {
  const mapRow = (u: AdminUser): AdminUser => ({
    ...u,
    id: String(u.id),
    role: String(u.role || "").trim(),
  });
  if (Array.isArray(raw)) return (raw as AdminUser[]).map(mapRow);
  if (
    raw &&
    typeof raw === "object" &&
    Array.isArray((raw as { users?: unknown }).users)
  ) {
    return (raw as { users: AdminUser[] }).users.map(mapRow);
  }
  return [];
}

function normalizePendingInvites(raw: unknown): PendingInvite[] {
  if (Array.isArray(raw)) return raw as PendingInvite[];
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.invites)) return o.invites as PendingInvite[];
    if (Array.isArray(o.data)) return o.data as PendingInvite[];
    const nested = o.data;
    if (nested && typeof nested === "object" && Array.isArray((nested as { invites?: unknown }).invites)) {
      return (nested as { invites: PendingInvite[] }).invites;
    }
  }
  return [];
}

const PENDING_INVITE_ROW_PREFIX = "pending-invite:";

const CASH_EOD_WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const CASH_EOD_TIMEZONE_OPTIONS = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "Pacific/Honolulu",
  "UTC",
] as const;

/**
 * `InviteToken` rows are not `User` rows until accept-invite. Merge them into the
 * Company Users grid so invited people stay visible after reload (same as having a saved user).
 */
function mergeUsersWithPendingInvites(
  userRows: AdminUser[],
  invites: PendingInvite[],
): AdminUser[] {
  const seen = new Set(
    userRows
      .map((u) => String(u.email || "").trim().toLowerCase())
      .filter(Boolean),
  );
  const extras: AdminUser[] = [];
  for (const inv of invites) {
    const em = inv.email.trim().toLowerCase();
    if (!em || seen.has(em)) continue;
    extras.push({
      id: `${PENDING_INVITE_ROW_PREFIX}${inv.id}`,
      username: inv.email.split("@")[0] || inv.email,
      email: inv.email,
      role: inv.role,
      active: false,
      status: "INVITED",
      mustChangePassword: true,
      createdAt: inv.createdAt,
    });
    seen.add(em);
  }
  return [...userRows, ...extras];
}

function isPendingInviteGridRow(user: AdminUser) {
  return user.id.startsWith(PENDING_INVITE_ROW_PREFIX);
}

/** GET requests may lose `X-Company-Id` through some CDNs; OWNER scoping also reads `companyId` query on API. */
function withCompanyQuery(path: string, companyId: string): string {
  const id = String(companyId || "").trim();
  if (!id) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}companyId=${encodeURIComponent(id)}`;
}

/**
 * `GET /api/auth/me` on `@cpu/api` returns `{ auth: { userId, companyId, role } }`.
 * Admin must still treat OWNER correctly so company + pending-invite loads match the UI.
 */
function resolveAdminBootstrap(me: {
  user?: Record<string, unknown> | null;
  company?: Record<string, unknown> | null;
  auth?: { userId: string; companyId: string; role: string };
}) {
  if (me.user && typeof me.user === "object")
    return { user: me.user as any, company: (me.company as any) ?? getAuthCompany() };
  if (me.auth?.userId) {
    const stored = getAuthUser();
    return {
      user: {
        ...(stored || {}),
        id: me.auth.userId,
        role: me.auth.role,
        companyId: me.auth.companyId,
      } as any,
      company: getAuthCompany(),
    };
  }
  return { user: getAuthUser() as any, company: getAuthCompany() };
}

const INVITE_ROLE_OPTIONS: {
  value: string;
  label: string;
  description: string;
}[] = [
  {
    value: "VIEW_ONLY",
    label: "View Only",
    description:
      "Starts with Data Hub only. A Manager or Company Admin can add Inventory, Orders, Analytics, or floor pages after they join.",
  },
  {
    value: "CULTIVATION_SPECIALIST",
    label: "Cultivation",
    description:
      "Starts with Cultivation and Data Hub. Other areas (inventory, orders, etc.) can be granted by a Manager or Company Admin; Owners can adjust anyone.",
  },
  {
    value: "EXTRACTION_SPECIALIST",
    label: "Extraction",
    description:
      "Starts with Extraction and Data Hub. Other areas can be granted by a Manager or Company Admin; Owners can adjust anyone.",
  },
  {
    value: "PACKAGING_SPECIALIST",
    label: "Packaging",
    description:
      "Starts with Packaging and Data Hub. Other areas can be granted by a Manager or Company Admin; Owners can adjust anyone.",
  },
  {
    value: "EDIBLES",
    label: "Edibles",
    description:
      "Starts with Edibles kitchen and Data Hub. Create batches, log production tasks, submit QA. Managers handle approvals and packaging transfers.",
  },
  {
    value: "EDIBLES_MANAGER",
    label: "Edibles Manager",
    description:
      "Edibles + Data Hub + Analytics. Can approve QA, delete batches, and transfer finished goods to packaging.",
  },
  {
    value: "FACILITY_MAINTENANCE_SPECIALIST",
    label: "Facility Maintenance Specialist",
    description:
      "Starts with Facilities Maintenance and Data Hub. Other areas can be granted by a Manager or Company Admin; Owners can adjust anyone.",
  },
  {
    value: "OPERATIONS_MANAGER",
    label: "Manager",
    description:
      "Starts with full production-floor pages. Page access can be narrowed like any other employee. Only Company Admins / Owners send invites or change roles.",
  },
  {
    value: "ADMIN",
    label: "Company Admin",
    description: "Full workspace access and user management (cannot promote anyone to Application Owner).",
  },
];

/** Roles allowed when editing a user — must match `@cpu/api` `adminUserUpdateSchema` / Prisma `UserRole`. */
/** Match `PageAccessGate` / JWT — tolerate lowercase or stray spaces. */
function normalizePlatformRole(role: string | undefined | null): string {
  return String(role ?? "").trim().toUpperCase();
}

function getEditUserRoleOptions(currentActorRole: string) {
  const ownerOption = {
    value: "OWNER",
    label: "Application Owner",
    description: "Application owner access.",
  };
  if (normalizePlatformRole(currentActorRole) === "OWNER") {
    return [...INVITE_ROLE_OPTIONS, ownerOption];
  }
  return [...INVITE_ROLE_OPTIONS];
}

function getAllowedRoleOptions(currentRole: string) {
  if (normalizePlatformRole(currentRole) === "OWNER") return getEditUserRoleOptions("OWNER");
  return getEditUserRoleOptions(currentRole).filter((option) => option.value !== "OWNER");
}

function getRoleColor(role: string) {
  if (role === "OWNER") return "#f59e0b";
  if (role === "ADMIN") return "#a855f7";
  if (role === "MANAGER" || role === "OPERATIONS_MANAGER") return "#38bdf8";
  if (role === "CULTIVATION" || role === "CULTIVATION_SPECIALIST")
    return "#22c55e";
  if (role === "EXTRACTION" || role === "EXTRACTION_SPECIALIST")
    return "#14b8a6";
  if (role === "PACKAGING" || role === "PACKAGING_SPECIALIST")
    return "#ec4899";
  if (role === "EDIBLES") return "#fb923c";
  if (role === "EDIBLES_MANAGER") return "#f97316";
  if (role === "FACILITY_MAINTENANCE_SPECIALIST")
    return "#06b6d4";
  if (role === "FINANCIAL_ANALYST") return "#eab308";
  if (role === "DATABASE_ARCHITECT") return "#6366f1";
  if (role === "FULL_STACK_DEVELOPER") return "#06b6d4";
  if (role === "QA_TESTER") return "#f472b6";
  return "#94a3b8";
}

function canCreateUsers(role: string) {
  const r = normalizePlatformRole(role);
  return r === "OWNER" || r === "ADMIN";
}

function canManageUsers(role: string) {
  const r = normalizePlatformRole(role);
  return r === "OWNER" || r === "ADMIN" || r === "OPERATIONS_MANAGER";
}

/** Invites, revoke, activate/deactivate, delete — company owner or company admin only (not floor managers). */
function isCompanyOwnerOrAdminActor(role: string) {
  const r = normalizePlatformRole(role);
  return r === "OWNER" || r === "ADMIN";
}

/** Matches `/api/checks/.../leaflink-mark-paid` and `/api/cash-log/.../leaflink-mark-paid` RBAC. */
function canPostLeafLinkPayment(role: string) {
  const r = normalizePlatformRole(role);
  return r === "OWNER" || r === "ADMIN" || r === "OPERATIONS_MANAGER";
}

/** Financial logs panel, digest email, and read-only cash/check views. */
function canAccessFinancialAdminTools(role: string) {
  const r = normalizePlatformRole(role);
  return (
    r === "OWNER" ||
    r === "ADMIN" ||
    r === "OPERATIONS_MANAGER" ||
    r === "FINANCIAL_ANALYST"
  );
}

type CheckMime = "image/jpeg" | "image/jpg" | "image/png" | "image/webp";

/** Matches API `LeafLinkInvoiceLineStatusDto` on check/cash list rows. */
type LeafLinkInvoiceLineStatus = {
  hasInvoiceTokens: boolean;
  matchedOrderNumber: string | null;
  markedPaidInLeafLink: boolean;
  paymentStatus: string | null;
  summary: string;
};

type CheckCaptureRow = {
  id: string;
  createdAt: string;
  checkDate?: string | null;
  amount?: number | null;
  checkNumber?: string | null;
  payerName?: string | null;
  memo?: string | null;
  invoiceNumber?: string | null;
  imageUrl: string;
  stubImageUrl?: string | null;
  leaflinkOrderId?: string | null;
  leaflinkOrderNumber?: string | null;
  leaflinkPaymentId?: string | null;
  leaflinkPaymentStatus?: string | null;
  leaflinkMatchedAt?: string | null;
  leaflinkPaidAt?: string | null;
  paymentSyncStatus?: string | null;
  paymentSyncError?: string | null;
  leafLinkInvoiceStatus?: LeafLinkInvoiceLineStatus | null;
};

type CheckLeafLinkMatchCandidate = {
  leafLinkKey: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  total: number;
  outstandingBalance: number | null;
  status: string;
  paymentStatus: string;
  deliveryDate: string | null;
  lineItems: Array<{ productName: string; sku: string; quantity: number }>;
  score: number;
  matchedBy: string[];
};

type CashLogDepartment = "CULTIVATION" | "EXTRACTION" | "PACKAGING" | "GENERAL";

type CashLogRow = {
  id: string;
  direction: "INCOMING" | "OUTGOING";
  amount: number;
  payeeCompany?: string | null;
  invoiceNumber?: string | null;
  department?: CashLogDepartment | null;
  memo?: string | null;
  entryDate?: string | null;
  receiptImageUrl?: string | null;
  createdAt: string;
  leaflinkPostedPayments?: unknown;
  leaflinkPaymentSyncStatus?: string | null;
  leaflinkPaymentSyncError?: string | null;
  leafLinkInvoiceStatus?: LeafLinkInvoiceLineStatus | null;
};

function formatLeafLinkAdminListCell(row: {
  direction?: "INCOMING" | "OUTGOING";
  leafLinkInvoiceStatus?: LeafLinkInvoiceLineStatus | null;
  leaflinkOrderNumber?: string | null;
  leaflinkPaymentStatus?: string | null;
  leaflinkPaidAt?: string | null;
  paymentSyncStatus?: string | null;
  leaflinkPaymentSyncStatus?: string | null;
}): string {
  const payPosted =
    Boolean(row.leaflinkPaidAt) ||
    String(row.paymentSyncStatus || "").toLowerCase() === "payment_posted" ||
    String(row.leaflinkPaymentStatus || "").toLowerCase() === "paid";
  if (payPosted) {
    return row.leaflinkOrderNumber
      ? `Paid in LeafLink (#${row.leaflinkOrderNumber})`
      : "Paid in LeafLink";
  }
  const cashSync = String(row.leaflinkPaymentSyncStatus || "").toLowerCase();
  if (cashSync === "payment_posted") {
    return "Payment posted to LeafLink";
  }
  if (cashSync === "matched") {
    return "Matched (not paid in LeafLink yet)";
  }
  if (cashSync === "failed") {
    return "LeafLink sync failed";
  }
  const li = row.leafLinkInvoiceStatus;
  if (!li) return "—";
  if (!li.hasInvoiceTokens) return "—";
  if (li.matchedOrderNumber) {
    return li.markedPaidInLeafLink
      ? `Paid in LeafLink (#${li.matchedOrderNumber})`
      : `Open · ${li.paymentStatus || "unpaid"} · #${li.matchedOrderNumber}`;
  }
  const s = li.summary || "";
  if (s.length > 56) return `${s.slice(0, 53)}…`;
  return s || "No LeafLink match (cache)";
}

function formatUsdLeafLink(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function formatCashDepartment(d: CashLogDepartment | string | null | undefined): string {
  if (!d) return "—";
  const labels: Record<string, string> = {
    CULTIVATION: "Cultivation",
    EXTRACTION: "Extraction",
    PACKAGING: "Packaging",
    GENERAL: "General",
  };
  return labels[String(d)] || String(d);
}

function defaultCheckFilterTo(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultCheckFilterFrom(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 30);
  return d.toISOString().slice(0, 10);
}

function normalizeCheckMime(raw: string): CheckMime | null {
  const m = String(raw || "").toLowerCase();
  if (m === "image/jpg" || m === "image/jpeg") return "image/jpeg";
  if (m === "image/png") return "image/png";
  if (m === "image/webp") return "image/webp";
  return null;
}

async function readImageFileForCheckUpload(file: File): Promise<{
  mimeType: CheckMime;
  dataBase64: string;
}> {
  const mimeType = normalizeCheckMime(file.type);
  if (!mimeType) {
    throw new Error("Use a JPEG, PNG, or WebP image.");
  }
  const dataUrl: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read the image file."));
    reader.readAsDataURL(file);
  });
  const stripped = dataUrl.replace(/^data:[^;]+;base64,/, "");
  if (!stripped || stripped.length < 20) {
    throw new Error("Invalid image data.");
  }
  return { mimeType, dataBase64: stripped };
}

function canEditTargetUser(currentRole: string, targetRole: string) {
  const c = normalizePlatformRole(currentRole);
  const t = normalizePlatformRole(targetRole);
  if (c === "OWNER") return true;
  if (c === "ADMIN" && t !== "OWNER") return true;
  if (c === "OPERATIONS_MANAGER") {
    const floor = new Set([
      "VIEW_ONLY",
      "CULTIVATION_SPECIALIST",
      "EXTRACTION_SPECIALIST",
      "PACKAGING_SPECIALIST",
      "EDIBLES",
      "EDIBLES_MANAGER",
      "FACILITY_MAINTENANCE_SPECIALIST",
    ]);
    return floor.has(t);
  }
  return false;
}

function getDisplayStatus(user: AdminUser) {
  if (user.status === "INVITED" || user.mustChangePassword) return "Invited";
  return user.active ? "Active" : "Inactive";
}

export default function AdminPage() {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [company, setCompany] = useState<any>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [companies, setCompanies] = useState<CompanyItem[]>([]);
  const [selectedCompanyId, setSelectedCompanyIdState] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("VIEW_ONLY");

  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editUsername, setEditUsername] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState("VIEW_ONLY");
  const [editActive, setEditActive] = useState(true);
  const [editAppPermissions, setEditAppPermissions] = useState<string[]>([]);
  const [editCashLogEodEnabled, setEditCashLogEodEnabled] = useState(false);
  const [editRewardsEnrolled, setEditRewardsEnrolled] = useState(false);
  const [editCultivationAlertsEnabled, setEditCultivationAlertsEnabled] = useState(false);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [sendingResetUserId, setSendingResetUserId] = useState<string | null>(null);
  const [savingInviteId, setSavingInviteId] = useState<string | null>(null);

  const checkImageInputRef = useRef<HTMLInputElement | null>(null);
  const stubImageInputRef = useRef<HTMLInputElement | null>(null);
  const [checkFileKey, setCheckFileKey] = useState(0);
  const [checkRows, setCheckRows] = useState<CheckCaptureRow[]>([]);
  const [checkListLoading, setCheckListLoading] = useState(false);
  const [checkListError, setCheckListError] = useState("");
  const [checkFilterFrom, setCheckFilterFrom] = useState(defaultCheckFilterFrom);
  const [checkFilterTo, setCheckFilterTo] = useState(defaultCheckFilterTo);
  const [checkPayee, setCheckPayee] = useState("");
  const [checkTotal, setCheckTotal] = useState("");
  const [checkInvoice, setCheckInvoice] = useState("");
  const [checkWrittenDate, setCheckWrittenDate] = useState("");
  const [checkSaving, setCheckSaving] = useState(false);
  const [checkFormError, setCheckFormError] = useState("");
  const [checkFormSuccess, setCheckFormSuccess] = useState("");
  const [checkExporting, setCheckExporting] = useState(false);
  const [checkLogOpen, setCheckLogOpen] = useState(false);
  const [cashLogOpen, setCashLogOpen] = useState(false);

  const [cashRows, setCashRows] = useState<CashLogRow[]>([]);
  const [cashListLoading, setCashListLoading] = useState(false);
  const [cashListError, setCashListError] = useState("");
  const [cashFilterFrom, setCashFilterFrom] = useState(defaultCheckFilterFrom);
  const [cashFilterTo, setCashFilterTo] = useState(defaultCheckFilterTo);
  const [cashDirection, setCashDirection] = useState<"INCOMING" | "OUTGOING">("INCOMING");
  const [cashAmount, setCashAmount] = useState("");
  const [cashPayeeCompany, setCashPayeeCompany] = useState("");
  const [cashInvoiceNumber, setCashInvoiceNumber] = useState("");
  const [cashDepartment, setCashDepartment] = useState<CashLogDepartment>("GENERAL");
  const [cashMemo, setCashMemo] = useState("");
  const cashReceiptInputRef = useRef<HTMLInputElement | null>(null);
  const [cashReceiptImageUrl, setCashReceiptImageUrl] = useState("");
  const [cashReceiptFileKey, setCashReceiptFileKey] = useState(0);
  const [cashReceiptUploading, setCashReceiptUploading] = useState(false);
  const [cashEntryDate, setCashEntryDate] = useState("");
  const [cashSaving, setCashSaving] = useState(false);
  const [cashFormError, setCashFormError] = useState("");
  const [cashFormSuccess, setCashFormSuccess] = useState("");
  const [cashExporting, setCashExporting] = useState(false);
  /** History table only — not the new-entry form direction. */
  const [cashHistoryDirection, setCashHistoryDirection] = useState<"ALL" | "INCOMING" | "OUTGOING">("ALL");
  const [deletingCashId, setDeletingCashId] = useState<string | null>(null);
  const [deletingCheckId, setDeletingCheckId] = useState<string | null>(null);

  const [checkBeingEdited, setCheckBeingEdited] = useState<CheckCaptureRow | null>(null);
  const editCheckFrontInputRef = useRef<HTMLInputElement | null>(null);
  const editCheckStubInputRef = useRef<HTMLInputElement | null>(null);
  const [editCheckFieldKey, setEditCheckFieldKey] = useState(0);
  const [editCheckPayee, setEditCheckPayee] = useState("");
  const [editCheckTotal, setEditCheckTotal] = useState("");
  const [editCheckInvoice, setEditCheckInvoice] = useState("");
  const [editCheckWrittenDate, setEditCheckWrittenDate] = useState("");
  const [editCheckRemoveStub, setEditCheckRemoveStub] = useState(false);
  const [editCheckSaving, setEditCheckSaving] = useState(false);
  const [editCheckError, setEditCheckError] = useState("");
  const [leafLinkMatchLoading, setLeafLinkMatchLoading] = useState(false);
  const [leafLinkMatchError, setLeafLinkMatchError] = useState("");
  const [leafLinkMatchChoices, setLeafLinkMatchChoices] = useState<CheckLeafLinkMatchCandidate[]>([]);
  const [leafLinkMatchModalOpen, setLeafLinkMatchModalOpen] = useState(false);
  const [leafLinkSelectedOrderNumber, setLeafLinkSelectedOrderNumber] = useState("");
  const [leafLinkPostingPayment, setLeafLinkPostingPayment] = useState(false);

  const [cashBeingEdited, setCashBeingEdited] = useState<CashLogRow | null>(null);
  const editCashReceiptInputRef = useRef<HTMLInputElement | null>(null);
  const [editCashFieldKey, setEditCashFieldKey] = useState(0);
  const [editCashAmount, setEditCashAmount] = useState("");
  const [editCashPayeeCompany, setEditCashPayeeCompany] = useState("");
  const [editCashInvoiceNumber, setEditCashInvoiceNumber] = useState("");
  const [editCashDepartment, setEditCashDepartment] = useState<CashLogDepartment>("GENERAL");
  const [editCashMemo, setEditCashMemo] = useState("");
  const [editCashEntryDate, setEditCashEntryDate] = useState("");
  const [editCashRemoveReceipt, setEditCashRemoveReceipt] = useState(false);
  const [editCashNewReceiptUrl, setEditCashNewReceiptUrl] = useState("");
  const [editCashReceiptUploading, setEditCashReceiptUploading] = useState(false);
  const [editCashSaving, setEditCashSaving] = useState(false);
  const [editCashError, setEditCashError] = useState("");

  const [cashEodModalOpen, setCashEodModalOpen] = useState(false);
  const [cashEodLoading, setCashEodLoading] = useState(false);
  const [cashEodSaving, setCashEodSaving] = useState(false);
  const [cashEodError, setCashEodError] = useState("");
  const [cashEodPrefs, setCashEodPrefs] = useState<CashLogEodPrefsDto>({
    enabled: false,
    weekdays: [1, 2, 3, 4, 5],
    sendTime: "17:00",
    window: "LAST_24H",
    timezone: "America/New_York",
  });

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [notificationModal, setNotificationModal] = useState<{
    open: boolean;
    title: string;
    message: string;
    details?: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm?: (() => void) | null;
  }>({
    open: false,
    title: "",
    message: "",
    details: "",
    confirmText: "",
    cancelText: "",
    onConfirm: null,
  });

  /** Resolves when user confirms or cancels the styled LeafLink payment dialog (replaces `window.confirm`). */
  const leafLinkPaymentConfirmRef = useRef<((ok: boolean) => void) | null>(null);

  const [leafLinkToast, setLeafLinkToast] = useState<{ message: string } | null>(null);

  useEffect(() => {
    if (!leafLinkToast) return;
    const t = window.setTimeout(() => setLeafLinkToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [leafLinkToast]);

  const companyUsersDisplay = useMemo(
    () => mergeUsersWithPendingInvites(users, pendingInvites),
    [users, pendingInvites],
  );

  const editingTargetUser = useMemo(() => {
    if (editingUserId == null || editingUserId === "") return null;
    const key = String(editingUserId);
    const u = companyUsersDisplay.find((x) => String(x.id) === key);
    if (!u || isPendingInviteGridRow(u)) return null;
    return u;
  }, [editingUserId, companyUsersDisplay]);

  function checksCompanyId(): string {
    if (normalizePlatformRole(currentUser?.role) === "OWNER") {
      const sid = String(selectedCompanyId || "").trim();
      if (sid) return sid;
    }
    return (
      getSelectedCompanyId().trim() ||
      String((company as { id?: string } | null)?.id || "").trim() ||
      String(getAuthCompany()?.id || "").trim()
    );
  }

  async function promptLeafLinkPaymentsAfterCheckSave(checkId: string, invoiceEntered: boolean) {
    if (!invoiceEntered || !canPostLeafLinkPayment(currentUser?.role || "")) return;
    const cid = checksCompanyId();
    if (!cid || !checkId) return;
    try {
      const data = await apiRequest<{
        exactMatches?: CheckLeafLinkMatchCandidate[];
        possibleMatches?: CheckLeafLinkMatchCandidate[];
      }>(
        withCompanyQuery(`/api/checks/${encodeURIComponent(checkId)}/leaflink-match`, cid),
        {
          method: "POST",
          companyId: cid,
          body: { refreshIfNoMatch: true },
        },
      );
      const exact = Array.isArray(data?.exactMatches) ? data.exactMatches : [];
      const possible = Array.isArray(data?.possibleMatches) ? data.possibleMatches : [];
      const merged = new Map<string, CheckLeafLinkMatchCandidate>();
      for (const c of [...exact, ...possible]) {
        if (!merged.has(c.orderNumber)) merged.set(c.orderNumber, c);
      }
      const list = [...merged.values()].filter(
        (c) => String(c.paymentStatus || "").toLowerCase() !== "paid",
      );
      if (merged.size === 0) {
        setLeafLinkToast({
          message: "No matching LeafLink invoice found for the invoice number on this check.",
        });
      } else if (list.length === 0) {
        setLeafLinkToast({
          message: "LeafLink matched order(s) are already marked paid — nothing to post.",
        });
      }
      for (const c of list) {
        const ob =
          typeof c.outstandingBalance === "number" && Number.isFinite(c.outstandingBalance)
            ? c.outstandingBalance
            : c.total;
        const ok = await showLeafLinkPaymentConfirmDialog(
          "Post payment to LeafLink?",
          `LeafLink order ${c.orderNumber} (${c.customerName}) — payment status: ${c.paymentStatus || "Unpaid"}.`,
          `Post ${formatUsdLeafLink(ob)} to LeafLink as a check payment for this order?`,
        );
        if (!ok) continue;
        try {
          await apiRequest(
            withCompanyQuery(`/api/checks/${encodeURIComponent(checkId)}/leaflink-mark-paid`, cid),
            {
              method: "POST",
              companyId: cid,
              body: {
                orderNumber: c.orderNumber,
                ...(c.orderId ? { orderId: c.orderId } : {}),
                allowAmountOverride: true,
                paymentAmount: ob,
              },
            },
          );
          await resyncLeafLinkOrdersAfterPayment(cid);
          showPaymentAppliedToast();
        }
        catch (e: unknown) {
          showLeafLinkInfoOk(
            "Could not post to LeafLink",
            e instanceof Error ? e.message : "Could not post check payment to LeafLink.",
          );
        }
      }
      await loadCheckCaptures();
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : "Could not search LeafLink for a matching invoice after save.";
      setLeafLinkToast({ message: msg });
    }
  }

  async function promptLeafLinkPaymentsAfterCashSave(entryId: string, invoiceEntered: boolean) {
    if (!invoiceEntered || !canPostLeafLinkPayment(currentUser?.role || "")) return;
    const cid = checksCompanyId();
    if (!cid || !entryId) return;
    try {
      const data = await apiRequest<{
        exactMatches?: CheckLeafLinkMatchCandidate[];
        possibleMatches?: CheckLeafLinkMatchCandidate[];
      }>(
        withCompanyQuery(`/api/cash-log/${encodeURIComponent(entryId)}/leaflink-match`, cid),
        {
          method: "POST",
          companyId: cid,
          body: { refreshIfNoMatch: true },
        },
      );
      const exact = Array.isArray(data?.exactMatches) ? data.exactMatches : [];
      const possible = Array.isArray(data?.possibleMatches) ? data.possibleMatches : [];
      const merged = new Map<string, CheckLeafLinkMatchCandidate>();
      for (const c of [...exact, ...possible]) {
        if (!merged.has(c.orderNumber)) merged.set(c.orderNumber, c);
      }
      const list = [...merged.values()].filter(
        (c) => String(c.paymentStatus || "").toLowerCase() !== "paid",
      );
      if (merged.size === 0) {
        setLeafLinkToast({
          message: "No matching LeafLink invoice found for the invoice number on this cash entry.",
        });
      } else if (list.length === 0) {
        setLeafLinkToast({
          message: "LeafLink matched order(s) are already marked paid — nothing to post.",
        });
      }
      for (const c of list) {
        const ob =
          typeof c.outstandingBalance === "number" && Number.isFinite(c.outstandingBalance)
            ? c.outstandingBalance
            : c.total;
        const ok = await showLeafLinkPaymentConfirmDialog(
          "Post payment to LeafLink?",
          `LeafLink order ${c.orderNumber} (${c.customerName}) — payment status: ${c.paymentStatus || "Unpaid"}.`,
          `Post ${formatUsdLeafLink(ob)} to LeafLink as a cash payment for this order?`,
        );
        if (!ok) continue;
        try {
          await apiRequest(
            withCompanyQuery(`/api/cash-log/${encodeURIComponent(entryId)}/leaflink-mark-paid`, cid),
            {
              method: "POST",
              companyId: cid,
              body: {
                orderNumber: c.orderNumber,
                ...(c.orderId ? { orderId: c.orderId } : {}),
                allowAmountOverride: true,
                paymentAmount: ob,
              },
            },
          );
          await resyncLeafLinkOrdersAfterPayment(cid);
          showPaymentAppliedToast();
        }
        catch (e: unknown) {
          showLeafLinkInfoOk(
            "Could not post to LeafLink",
            e instanceof Error ? e.message : "Could not post cash payment to LeafLink.",
          );
        }
      }
      await loadCashEntries();
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : "Could not search LeafLink for a matching invoice after save.";
      setLeafLinkToast({ message: msg });
    }
  }

  async function loadCheckCaptures(): Promise<CheckCaptureRow[]> {
    if (!canManageUsers(currentUser?.role || "")) return [];
    const cid = checksCompanyId();
    if (!cid) return [];
    setCheckListLoading(true);
    setCheckListError("");
    try {
      const q = new URLSearchParams();
      if (checkFilterFrom.trim()) q.set("from", checkFilterFrom.trim());
      if (checkFilterTo.trim()) q.set("to", checkFilterTo.trim());
      q.set("take", "200");
      const path = withCompanyQuery(`/api/checks?${q.toString()}`, cid);
      const data = await apiRequest<{ rows?: CheckCaptureRow[] }>(path, { companyId: cid });
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      setCheckRows(rows);
      return rows;
    } catch (e: any) {
      setCheckListError(e?.message || "Could not load check captures.");
      return [];
    } finally {
      setCheckListLoading(false);
    }
  }

  async function saveCheckCapture() {
    setCheckFormError("");
    setCheckFormSuccess("");
    if (!canManageUsers(currentUser?.role || "")) {
      setCheckFormError("Only OWNER or ADMIN can save check captures.");
      return;
    }
    const cid = checksCompanyId();
    if (!cid) {
      setCheckFormError("Select a company context before saving.");
      return;
    }
    const checkFile = checkImageInputRef.current?.files?.[0];
    if (!checkFile) {
      setCheckFormError("Choose a photo of the check (front).");
      return;
    }
    const payee = checkPayee.trim();
    if (!payee) {
      setCheckFormError("Payee is required.");
      return;
    }
    const totalRaw = String(checkTotal || "").replace(/,/g, "").trim();
    const amount = Number(totalRaw);
    if (!Number.isFinite(amount) || amount < 0) {
      setCheckFormError("Total must be a valid non-negative number.");
      return;
    }
    const stubFile = stubImageInputRef.current?.files?.[0] || null;

    setCheckSaving(true);
    try {
      const checkPayload = await readImageFileForCheckUpload(checkFile);
      const uploadedCheck = await apiRequest<{ imageUrl: string }>(
        withCompanyQuery("/api/checks/upload", cid),
        {
          method: "POST",
          companyId: cid,
          body: {
            mimeType: checkPayload.mimeType,
            dataBase64: checkPayload.dataBase64,
            fileName: checkFile.name,
          },
        },
      );

      let stubImageUrl: string | undefined;
      if (stubFile) {
        const stubPayload = await readImageFileForCheckUpload(stubFile);
        const uploadedStub = await apiRequest<{ imageUrl: string }>(
          withCompanyQuery("/api/checks/upload", cid),
          {
            method: "POST",
            companyId: cid,
            body: {
              mimeType: stubPayload.mimeType,
              dataBase64: stubPayload.dataBase64,
              fileName: stubFile.name,
            },
          },
        );
        stubImageUrl = uploadedStub.imageUrl;
      }

      const invoiceTrim = checkInvoice.trim();
      const saved = await apiRequest<CheckCaptureRow>(withCompanyQuery("/api/checks", cid), {
        method: "POST",
        companyId: cid,
        body: {
          imageUrl: uploadedCheck.imageUrl,
          stubImageUrl: stubImageUrl || undefined,
          payerName: payee,
          amount,
          invoiceNumber: invoiceTrim || undefined,
          checkDate: checkWrittenDate.trim()
            ? new Date(`${checkWrittenDate.trim()}T12:00:00.000Z`).toISOString()
            : undefined,
        },
      });

      setCheckFormSuccess("Check capture saved.");
      setCheckPayee("");
      setCheckTotal("");
      setCheckInvoice("");
      setCheckWrittenDate("");
      if (checkImageInputRef.current) checkImageInputRef.current.value = "";
      if (stubImageInputRef.current) stubImageInputRef.current.value = "";
      setCheckFileKey((k) => k + 1);
      await loadCheckCaptures();
      if (invoiceTrim && saved?.id) {
        void promptLeafLinkPaymentsAfterCheckSave(saved.id, true);
      }
    } catch (e: any) {
      setCheckFormError(e?.message || "Could not save check capture.");
    } finally {
      setCheckSaving(false);
    }
  }

  async function exportCheckCapturesCsv() {
    setCheckFormError("");
    setCheckFormSuccess("");
    if (!canManageUsers(currentUser?.role || "")) {
      setCheckFormError("Only OWNER or ADMIN can export check data.");
      return;
    }
    const cid = checksCompanyId();
    if (!cid) {
      setCheckFormError("Select a company context before exporting.");
      return;
    }
    const from = checkFilterFrom.trim();
    const to = checkFilterTo.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      setCheckFormError("Use YYYY-MM-DD for both filter dates before exporting.");
      return;
    }
    setCheckExporting(true);
    try {
      const token = getAuthToken();
      const path = withCompanyQuery(
        `/api/checks/export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        cid,
      );
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      if (cid) headers["X-Company-Id"] = cid;
      const res = await fetch(`${API_BASE_URL}${path}`, { headers });
      const blob = await res.blob();
      if (!res.ok) {
        let msg = await blob.text();
        try {
          const j = JSON.parse(msg) as { message?: string };
          if (j?.message) msg = j.message;
        } catch {
          /* keep text */
        }
        throw new Error(msg || "Export failed.");
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `check-captures-${from}_${to}.csv`;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setCheckFormSuccess("Download started.");
    } catch (e: any) {
      setCheckFormError(e?.message || "Could not export check captures.");
    } finally {
      setCheckExporting(false);
    }
  }

  function toggleCashEodWeekday(day: number) {
    setCashEodPrefs((p) => {
      const set = new Set(p.weekdays);
      if (set.has(day)) set.delete(day);
      else set.add(day);
      let weekdays = [...set].sort((a, b) => a - b);
      if (!weekdays.length) weekdays = [day];
      return { ...p, weekdays };
    });
  }

  async function openCashEodSettings() {
    const cid = checksCompanyId();
    if (!cid) {
      setCashEodError("Select a company before opening email settings.");
      return;
    }
    setCashEodModalOpen(true);
    setCashEodError("");
    setCashEodLoading(true);
    try {
      const { prefs } = await fetchCashLogEodPrefs(cid);
      setCashEodPrefs(prefs);
    } catch (e: any) {
      setCashEodError(e?.message || "Could not load email settings.");
    } finally {
      setCashEodLoading(false);
    }
  }

  async function saveCashEodSettings() {
    const cid = checksCompanyId();
    if (!cid) return;
    setCashEodError("");
    setCashEodSaving(true);
    try {
      const { prefs } = await saveCashLogEodPrefs(cid, cashEodPrefs);
      setCashEodPrefs(prefs);
      setCashEodModalOpen(false);
    } catch (e: any) {
      setCashEodError(e?.message || "Could not save email settings.");
    } finally {
      setCashEodSaving(false);
    }
  }

  async function loadCashEntries(): Promise<CashLogRow[]> {
    if (!canAccessFinancialAdminTools(currentUser?.role || "")) return [];
    const cid = checksCompanyId();
    if (!cid) return [];
    setCashListLoading(true);
    setCashListError("");
    try {
      const q = new URLSearchParams();
      if (cashFilterFrom.trim()) q.set("from", cashFilterFrom.trim());
      if (cashFilterTo.trim()) q.set("to", cashFilterTo.trim());
      if (cashHistoryDirection !== "ALL") q.set("direction", cashHistoryDirection);
      q.set("take", "200");
      const path = withCompanyQuery(`/api/cash-log?${q.toString()}`, cid);
      const data = await apiRequest<{ rows?: CashLogRow[] }>(path, { companyId: cid });
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      setCashRows(rows);
      return rows;
    } catch (e: any) {
      setCashListError(e?.message || "Could not load cash log.");
      return [];
    } finally {
      setCashListLoading(false);
    }
  }

  async function handleCashReceiptFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!canManageUsers(currentUser?.role || "")) return;
    const cid = checksCompanyId();
    if (!cid) {
      setCashFormError("Select a company context before attaching a receipt.");
      return;
    }
    setCashFormError("");
    setCashReceiptUploading(true);
    try {
      const payload = await readImageFileForCheckUpload(file);
      const uploaded = await apiRequest<{ imageUrl: string }>(
        withCompanyQuery("/api/cash-log/upload-receipt", cid),
        {
          method: "POST",
          companyId: cid,
          body: {
            mimeType: payload.mimeType,
            dataBase64: payload.dataBase64,
            fileName: file.name,
          },
        },
      );
      setCashReceiptImageUrl(uploaded.imageUrl);
    } catch (err: any) {
      setCashFormError(err?.message || "Could not upload receipt.");
    } finally {
      setCashReceiptUploading(false);
    }
  }

  async function saveCashEntry() {
    setCashFormError("");
    setCashFormSuccess("");
    if (!canManageUsers(currentUser?.role || "")) {
      setCashFormError("Only OWNER or ADMIN can save cash entries.");
      return;
    }
    const cid = checksCompanyId();
    if (!cid) {
      setCashFormError("Select a company context before saving.");
      return;
    }
    const totalRaw = String(cashAmount || "").replace(/,/g, "").trim();
    const amount = Number(totalRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      setCashFormError("Total must be a positive number.");
      return;
    }
    if (cashDirection === "INCOMING") {
      if (!cashPayeeCompany.trim()) {
        setCashFormError("Payee company is required for incoming cash.");
        return;
      }
      if (!cashEntryDate.trim()) {
        setCashFormError("Date is required for incoming cash.");
        return;
      }
    }
    setCashSaving(true);
    try {
      const invoiceTrimCash = cashInvoiceNumber.trim();
      const wasIncoming = cashDirection === "INCOMING";
      const body: Record<string, unknown> = {
        direction: cashDirection,
        amount,
      };
      if (cashDirection === "INCOMING") {
        body.payeeCompany = cashPayeeCompany.trim();
        body.invoiceNumber = invoiceTrimCash || undefined;
        body.entryDate = new Date(`${cashEntryDate.trim()}T12:00:00.000Z`).toISOString();
      } else {
        body.department = cashDepartment;
        body.memo = cashMemo.trim() || undefined;
        body.entryDate = cashEntryDate.trim()
          ? new Date(`${cashEntryDate.trim()}T12:00:00.000Z`).toISOString()
          : undefined;
        if (cashReceiptImageUrl.trim()) {
          body.receiptImageUrl = cashReceiptImageUrl.trim();
        }
      }
      const savedCash = await apiRequest<CashLogRow>(withCompanyQuery("/api/cash-log", cid), {
        method: "POST",
        companyId: cid,
        body,
      });
      setCashFormSuccess("Cash entry saved.");
      setCashAmount("");
      setCashPayeeCompany("");
      setCashInvoiceNumber("");
      setCashDepartment("GENERAL");
      setCashMemo("");
      setCashReceiptImageUrl("");
      if (cashReceiptInputRef.current) cashReceiptInputRef.current.value = "";
      setCashReceiptFileKey((k) => k + 1);
      setCashEntryDate("");
      await loadCashEntries();
      if (wasIncoming && invoiceTrimCash && savedCash?.id) {
        void promptLeafLinkPaymentsAfterCashSave(savedCash.id, true);
      }
    } catch (e: any) {
      setCashFormError(e?.message || "Could not save cash entry.");
    } finally {
      setCashSaving(false);
    }
  }

  async function exportCashLogCsv() {
    setCashFormError("");
    setCashFormSuccess("");
    if (!canAccessFinancialAdminTools(currentUser?.role || "")) {
      setCashFormError("You do not have access to export cash data.");
      return;
    }
    const cid = checksCompanyId();
    if (!cid) {
      setCashFormError("Select a company context before exporting.");
      return;
    }
    const from = cashFilterFrom.trim();
    const to = cashFilterTo.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      setCashFormError("Use YYYY-MM-DD for both filter dates before exporting.");
      return;
    }
    setCashExporting(true);
    try {
      const token = getAuthToken();
      const exportQs = new URLSearchParams({
        from,
        to,
      });
      if (cashHistoryDirection !== "ALL") exportQs.set("direction", cashHistoryDirection);
      const path = withCompanyQuery(`/api/cash-log/export?${exportQs.toString()}`, cid);
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      if (cid) headers["X-Company-Id"] = cid;
      const res = await fetch(`${API_BASE_URL}${path}`, { headers });
      const blob = await res.blob();
      if (!res.ok) {
        let msg = await blob.text();
        try {
          const j = JSON.parse(msg) as { message?: string };
          if (j?.message) msg = j.message;
        } catch {
          /* keep text */
        }
        throw new Error(msg || "Export failed.");
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cash-log-${from}_${to}.csv`;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setCashFormSuccess("Download started.");
    } catch (e: any) {
      setCashFormError(e?.message || "Could not export cash log.");
    } finally {
      setCashExporting(false);
    }
  }

  function requestDeleteCashEntry(row: CashLogRow) {
    if (!canManageUsers(currentUser?.role || "")) return;
    const label = row.direction === "INCOMING" ? "incoming" : "outgoing";
    showConfirm(
      "Delete cash entry",
      `Remove this ${label} row (${String(row.amount)})? This cannot be undone.`,
      () => void executeDeleteCashEntry(row.id),
    );
  }

  async function executeDeleteCashEntry(id: string) {
    if (!canManageUsers(currentUser?.role || "")) return;
    const cid = checksCompanyId();
    if (!cid) {
      setCashListError("Select a company context before deleting.");
      return;
    }
    setCashListError("");
    setCashFormError("");
    setDeletingCashId(id);
    try {
      await apiRequest(withCompanyQuery(`/api/cash-log/${encodeURIComponent(id)}`, cid), {
        method: "DELETE",
        companyId: cid,
      });
      setCashFormSuccess("Cash entry deleted.");
      await loadCashEntries();
    } catch (e: any) {
      setCashListError(e?.message || "Could not delete cash entry.");
    } finally {
      setDeletingCashId(null);
    }
  }

  function requestDeleteCheckCapture(row: CheckCaptureRow) {
    if (!canManageUsers(currentUser?.role || "")) return;
    showConfirm(
      "Delete check capture",
      `Remove this check record (${row.payerName || "payee unknown"})? Images will be removed from storage where possible. This cannot be undone.`,
      () => void executeDeleteCheckCapture(row.id),
    );
  }

  async function executeDeleteCheckCapture(id: string) {
    if (!canManageUsers(currentUser?.role || "")) return;
    const cid = checksCompanyId();
    if (!cid) {
      setCheckListError("Select a company context before deleting.");
      return;
    }
    setCheckListError("");
    setCheckFormError("");
    setDeletingCheckId(id);
    try {
      await apiRequest(withCompanyQuery(`/api/checks/${encodeURIComponent(id)}`, cid), {
        method: "DELETE",
        companyId: cid,
      });
      setCheckFormSuccess("Check capture deleted.");
      await loadCheckCaptures();
    } catch (e: any) {
      setCheckListError(e?.message || "Could not delete check capture.");
    } finally {
      setDeletingCheckId(null);
    }
  }

  async function saveCheckEdit() {
    if (!checkBeingEdited) return;
    if (!canManageUsers(currentUser?.role || "")) return;
    setEditCheckError("");
    const cid = checksCompanyId();
    if (!cid) {
      setEditCheckError("Select a company context before saving.");
      return;
    }
    const payee = editCheckPayee.trim();
    if (!payee) {
      setEditCheckError("Payee is required.");
      return;
    }
    const totalRaw = String(editCheckTotal || "").replace(/,/g, "").trim();
    const amount = Number(totalRaw);
    if (!Number.isFinite(amount) || amount < 0) {
      setEditCheckError("Total must be a valid non-negative number.");
      return;
    }

    const body: Record<string, unknown> = {
      payerName: payee,
      amount,
      invoiceNumber: editCheckInvoice.trim() || undefined,
      checkDate: editCheckWrittenDate.trim()
        ? new Date(`${editCheckWrittenDate.trim()}T12:00:00.000Z`).toISOString()
        : undefined,
    };

    const front = editCheckFrontInputRef.current?.files?.[0];
    const stubFile = editCheckStubInputRef.current?.files?.[0];

    setEditCheckSaving(true);
    try {
      if (front) {
        const checkPayload = await readImageFileForCheckUpload(front);
        const uploadedCheck = await apiRequest<{ imageUrl: string }>(
          withCompanyQuery("/api/checks/upload", cid),
          {
            method: "POST",
            companyId: cid,
            body: {
              mimeType: checkPayload.mimeType,
              dataBase64: checkPayload.dataBase64,
              fileName: front.name,
            },
          },
        );
        body.imageUrl = uploadedCheck.imageUrl;
      }

      if (editCheckRemoveStub) {
        body.stubImageUrl = null;
      } else if (stubFile) {
        const stubPayload = await readImageFileForCheckUpload(stubFile);
        const uploadedStub = await apiRequest<{ imageUrl: string }>(
          withCompanyQuery("/api/checks/upload", cid),
          {
            method: "POST",
            companyId: cid,
            body: {
              mimeType: stubPayload.mimeType,
              dataBase64: stubPayload.dataBase64,
              fileName: stubFile.name,
            },
          },
        );
        body.stubImageUrl = uploadedStub.imageUrl;
      }

      await apiRequest(withCompanyQuery(`/api/checks/${encodeURIComponent(checkBeingEdited.id)}`, cid), {
        method: "PATCH",
        companyId: cid,
        body,
      });

      setCheckFormSuccess("Check entry updated.");
      setCheckBeingEdited(null);
      await loadCheckCaptures();
    } catch (e: any) {
      setEditCheckError(e?.message || "Could not update check.");
    } finally {
      setEditCheckSaving(false);
    }
  }

  async function findLeafLinkInvoiceForCheck() {
    if (!checkBeingEdited) return;
    if (!canManageUsers(currentUser?.role || "")) return;
    const cid = checksCompanyId();
    if (!cid) {
      setEditCheckError("Select a company context before matching.");
      return;
    }
    setLeafLinkMatchLoading(true);
    setLeafLinkMatchError("");
    setLeafLinkMatchChoices([]);
    setLeafLinkSelectedOrderNumber("");
    try {
      const data = await apiRequest<{
        exactMatches?: CheckLeafLinkMatchCandidate[];
        possibleMatches?: CheckLeafLinkMatchCandidate[];
      }>(withCompanyQuery(`/api/checks/${encodeURIComponent(checkBeingEdited.id)}/leaflink-match`, cid), {
        method: "POST",
        companyId: cid,
        body: { refreshIfNoMatch: true },
      });
      const exact = Array.isArray(data?.exactMatches) ? data.exactMatches : [];
      const possible = Array.isArray(data?.possibleMatches) ? data.possibleMatches : [];
      const combined = [...exact, ...possible];
      if (!combined.length) {
        setLeafLinkMatchError("No open LeafLink invoice found.");
        setLeafLinkToast({ message: "No matching LeafLink invoice found." });
        return;
      }
      setLeafLinkMatchChoices(combined);
      setLeafLinkSelectedOrderNumber(combined[0]?.orderNumber || "");
      setLeafLinkMatchModalOpen(true);
    } catch (e: any) {
      setLeafLinkMatchError(e?.message || "Could not search LeafLink invoices.");
    } finally {
      setLeafLinkMatchLoading(false);
    }
  }

  async function markLeafLinkInvoicePaidForCheck() {
    if (!checkBeingEdited || !leafLinkSelectedOrderNumber) return;
    const cid = checksCompanyId();
    if (!cid) return;
    setLeafLinkPostingPayment(true);
    setLeafLinkMatchError("");
    const editedId = checkBeingEdited.id;
    try {
      const cand = leafLinkMatchChoices.find((x) => x.orderNumber === leafLinkSelectedOrderNumber);
      const payAmt =
        cand && typeof cand.outstandingBalance === "number" && Number.isFinite(cand.outstandingBalance)
          ? cand.outstandingBalance
          : cand?.total;
      await apiRequest(withCompanyQuery(`/api/checks/${encodeURIComponent(checkBeingEdited.id)}/leaflink-mark-paid`, cid), {
        method: "POST",
        companyId: cid,
        body: {
          orderNumber: leafLinkSelectedOrderNumber,
          ...(cand?.orderId ? { orderId: cand.orderId } : {}),
          allowAmountOverride: true,
          ...(typeof payAmt === "number" && Number.isFinite(payAmt) ? { paymentAmount: payAmt } : {}),
        },
      });
      await resyncLeafLinkOrdersAfterPayment(cid);
      showPaymentAppliedToast();
      setLeafLinkMatchModalOpen(false);
      setCheckFormSuccess("LeafLink payment posted successfully.");
      const rows = await loadCheckCaptures();
      const fresh = rows.find((r) => r.id === editedId);
      if (fresh) setCheckBeingEdited(fresh);
    } catch (e: any) {
      setLeafLinkMatchError(e?.message || "Could not post payment to LeafLink.");
    } finally {
      setLeafLinkPostingPayment(false);
    }
  }

  async function handleEditCashReceiptFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !cashBeingEdited || cashBeingEdited.direction !== "OUTGOING") return;
    if (!canManageUsers(currentUser?.role || "")) return;
    const cid = checksCompanyId();
    if (!cid) {
      setEditCashError("Select a company context before attaching a receipt.");
      return;
    }
    setEditCashError("");
    setEditCashReceiptUploading(true);
    try {
      const payload = await readImageFileForCheckUpload(file);
      const uploaded = await apiRequest<{ imageUrl: string }>(
        withCompanyQuery("/api/cash-log/upload-receipt", cid),
        {
          method: "POST",
          companyId: cid,
          body: {
            mimeType: payload.mimeType,
            dataBase64: payload.dataBase64,
            fileName: file.name,
          },
        },
      );
      setEditCashNewReceiptUrl(uploaded.imageUrl);
      setEditCashRemoveReceipt(false);
    } catch (err: any) {
      setEditCashError(err?.message || "Could not upload receipt.");
    } finally {
      setEditCashReceiptUploading(false);
    }
  }

  async function saveCashEdit() {
    if (!cashBeingEdited) return;
    if (!canManageUsers(currentUser?.role || "")) return;
    setEditCashError("");
    const cid = checksCompanyId();
    if (!cid) {
      setEditCashError("Select a company context before saving.");
      return;
    }
    const totalRaw = String(editCashAmount || "").replace(/,/g, "").trim();
    const amount = Number(totalRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      setEditCashError("Amount must be a positive number.");
      return;
    }

    const body: Record<string, unknown> = {
      amount,
    };

    if (cashBeingEdited.direction === "INCOMING") {
      if (!editCashPayeeCompany.trim()) {
        setEditCashError("Payee company is required for incoming entries.");
        return;
      }
      if (!editCashEntryDate.trim()) {
        setEditCashError("Date is required for incoming entries.");
        return;
      }
      body.payeeCompany = editCashPayeeCompany.trim();
      body.invoiceNumber = editCashInvoiceNumber.trim() || undefined;
      body.entryDate = new Date(`${editCashEntryDate.trim()}T12:00:00.000Z`).toISOString();
    } else {
      body.department = editCashDepartment;
      body.memo = editCashMemo.trim() || undefined;
      body.entryDate = editCashEntryDate.trim()
        ? new Date(`${editCashEntryDate.trim()}T12:00:00.000Z`).toISOString()
        : null;
      if (editCashRemoveReceipt) {
        body.receiptImageUrl = null;
      } else if (editCashNewReceiptUrl.trim()) {
        body.receiptImageUrl = editCashNewReceiptUrl.trim();
      }
    }

    setEditCashSaving(true);
    try {
      await apiRequest(
        withCompanyQuery(`/api/cash-log/${encodeURIComponent(cashBeingEdited.id)}`, cid),
        {
          method: "PATCH",
          companyId: cid,
          body,
        },
      );

      setCashFormSuccess("Cash entry updated.");
      setCashBeingEdited(null);
      await loadCashEntries();
    } catch (e: any) {
      setEditCashError(e?.message || "Could not update cash entry.");
    } finally {
      setEditCashSaving(false);
    }
  }

  function inviteAdminCompanyId(): string {
    return (
      (normalizePlatformRole(currentUser?.role) === "OWNER"
        ? String(selectedCompanyId || "").trim()
        : "") ||
      getSelectedCompanyId().trim() ||
      String(getAuthCompany()?.id || "").trim() ||
      ""
    );
  }

  async function loadPendingInvitesForCompany(companyId: string) {
    /** OWNER uses selected tenant in localStorage; ADMIN often has no `cpu_selected_company_id` — use session company from login. */
    const effective =
      String(companyId || "").trim() ||
      getSelectedCompanyId().trim() ||
      getAuthCompany()?.id ||
      "";
    if (!effective) {
      setPendingInvites([]);
      return;
    }
    const raw = await apiRequest(withCompanyQuery("/api/admin/invites", effective), {
      companyId: effective,
    });
    setPendingInvites(normalizePendingInvites(raw));
  }

  function confirmRevokePendingInvite(inv: PendingInvite) {
    setError("");
    setSuccess("");
    if (!isCompanyOwnerOrAdminActor(currentUser?.role || "")) {
      setError("Only company owners or company admins can revoke invites.");
      return;
    }
    showConfirm(
      "Revoke invite",
      `Remove the pending invite for ${inv.email}? They will not be able to accept it.`,
      () => {
        void (async () => {
          const cid = inviteAdminCompanyId();
          if (!cid) {
            setError("Company is required to revoke an invite.");
            return;
          }
          setSavingInviteId(inv.id);
          try {
            await deletePendingInvite(inv.id, cid);
            setPendingInvites((p) => p.filter((x) => x.id !== inv.id));
            setUsers((rows) =>
              rows.filter((u) => u.id !== `${PENDING_INVITE_ROW_PREFIX}${inv.id}`),
            );
            setSuccess(`Revoked invite for ${inv.email}.`);
          } catch (err: any) {
            setError(err?.message || "Could not revoke invite.");
          } finally {
            setSavingInviteId(null);
          }
        })();
      },
    );
  }

  function confirmRevokeInviteFromGridRow(user: AdminUser) {
    if (!isPendingInviteGridRow(user)) return;
    const rawId = user.id.slice(PENDING_INVITE_ROW_PREFIX.length);
    const inv = pendingInvites.find((p) => p.id === rawId);
    if (!inv) {
      setError("Could not find that invite. Try Refresh.");
      return;
    }
    confirmRevokePendingInvite(inv);
  }

  async function loadAdminData() {
    setError("");
    setLoading(true);

    try {
      const me = await getMe();
      const { user: resolvedUser, company: resolvedCompany } = resolveAdminBootstrap(
        me as { user?: any; company?: any; auth?: { userId: string; companyId: string; role: string } },
      );
      setCurrentUser(resolvedUser);
      setCompany(resolvedCompany);

      if (normalizePlatformRole(resolvedUser?.role) === "OWNER") {
        const raw = await apiRequest<
          CompanyItem[] | { companies: CompanyItem[] }
        >("/api/companies/all");
        const list = Array.isArray(raw) ? raw : raw.companies ?? [];
        const loadedCompanies = list.map((c) => ({
          ...c,
          code:
            c.code ||
            String((c as { slug?: string }).slug ?? "").toUpperCase(),
        }));
        setCompanies(loadedCompanies);

        let savedCompanyId = getSelectedCompanyId();

        if (!savedCompanyId && loadedCompanies.length > 0) {
          savedCompanyId = loadedCompanies[0].id;
          setSelectedCompanyId(savedCompanyId);
        }

        const selectedCompany =
          loadedCompanies.find((c) => c.id === savedCompanyId) ||
          loadedCompanies[0] ||
          resolvedCompany;

        if (selectedCompany?.id) {
          setSelectedCompanyIdState(selectedCompany.id);
          setSelectedCompanyId(selectedCompany.id);
          setCompany(selectedCompany);

          const rawUsers = await apiRequest(
            withCompanyQuery("/api/admin/users", selectedCompany.id),
            {
              companyId: selectedCompany.id,
            },
          );
          setUsers(normalizeAdminUsersList(rawUsers));
          await loadPendingInvitesForCompany(selectedCompany.id);
        } else {
          setUsers([]);
          setPendingInvites([]);
        }
      } else {
        const cid = getSelectedCompanyId();
        const rawUsers = await apiRequest(withCompanyQuery("/api/admin/users", cid), {
          companyId: cid || undefined,
        });
        setUsers(normalizeAdminUsersList(rawUsers));
        await loadPendingInvitesForCompany(
          getSelectedCompanyId() ||
            String((resolvedCompany as { id?: string })?.id || "").trim() ||
            getAuthCompany()?.id ||
            "",
        );
      }
    } catch (err: any) {
      setError(err?.message || "Could not load admin data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setCurrentUser(getAuthUser());
    setCompany(getAuthCompany());
    loadAdminData();
  }, []);

  useEffect(() => {
    if (!checkLogOpen || loading) return;
    if (!canManageUsers(currentUser?.role || "")) return;
    void loadCheckCaptures();
  }, [checkLogOpen, loading, currentUser?.role, selectedCompanyId, company?.id]);

  useEffect(() => {
    if (!cashLogOpen || loading) return;
    if (!canManageUsers(currentUser?.role || "")) return;
    void loadCashEntries();
  }, [cashLogOpen, loading, currentUser?.role, selectedCompanyId, company?.id]);

  useEffect(() => {
    if (!checkBeingEdited) return;
    setEditCheckPayee(checkBeingEdited.payerName || "");
    setEditCheckTotal(checkBeingEdited.amount != null ? String(checkBeingEdited.amount) : "");
    setEditCheckInvoice(checkBeingEdited.invoiceNumber || "");
    const cd = checkBeingEdited.checkDate;
    setEditCheckWrittenDate(cd ? String(cd).slice(0, 10) : "");
    setEditCheckRemoveStub(false);
    setEditCheckError("");
    setLeafLinkMatchError("");
    setLeafLinkMatchChoices([]);
    setLeafLinkSelectedOrderNumber("");
    setLeafLinkMatchModalOpen(false);
    setEditCheckFieldKey((k) => k + 1);
  }, [checkBeingEdited]);

  useEffect(() => {
    if (!cashBeingEdited) return;
    setEditCashAmount(String(cashBeingEdited.amount ?? ""));
    setEditCashPayeeCompany(cashBeingEdited.payeeCompany || "");
    setEditCashInvoiceNumber(cashBeingEdited.invoiceNumber || "");
    setEditCashDepartment((cashBeingEdited.department as CashLogDepartment) || "GENERAL");
    setEditCashMemo(cashBeingEdited.memo || "");
    const ed = cashBeingEdited.entryDate;
    setEditCashEntryDate(ed ? String(ed).slice(0, 10) : "");
    setEditCashRemoveReceipt(false);
    setEditCashNewReceiptUrl("");
    setEditCashError("");
    setEditCashFieldKey((k) => k + 1);
  }, [cashBeingEdited]);

  useEffect(() => {
    if (!editingUserId) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") cancelEditUser();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editingUserId]);

  useEffect(() => {
    if (editingUserId && !editingTargetUser) cancelEditUser();
  }, [editingUserId, editingTargetUser]);

  async function handleCompanySwitch(companyId: string) {
    setError("");
    setSuccess("");

    try {
      setSelectedCompanyId(companyId);
      setSelectedCompanyIdState(companyId);

      const selected = companies.find((c) => c.id === companyId);

      if (selected) {
        setCompany(selected);
      }

      const rawUsers = await apiRequest(withCompanyQuery("/api/admin/users", companyId), {
        companyId,
      });

      setUsers(normalizeAdminUsersList(rawUsers));
      await loadPendingInvitesForCompany(companyId);
      setSuccess("Switched company view.");
    } catch (err: any) {
      setError(err?.message || "Could not switch company.");
    }
  }

  function showConfirm(title: string, message: string, onConfirm: () => void, details = "") {
    setNotificationModal({
      open: true,
      title,
      message,
      details,
      confirmText: "Confirm",
      cancelText: "Cancel",
      onConfirm,
    });
  }

  function closeNotificationModal() {
    setNotificationModal({
      open: false,
      title: "",
      message: "",
      details: "",
      confirmText: "",
      cancelText: "",
      onConfirm: null,
    });
  }

  function showLeafLinkInfoOk(title: string, message: string) {
    setNotificationModal({
      open: true,
      title,
      message,
      details: "",
      confirmText: "OK",
      cancelText: "",
      onConfirm: null,
    });
  }

  /** Styled confirm matching admin notification modal (not `window.confirm`). */
  function showLeafLinkPaymentConfirmDialog(title: string, message: string, details: string): Promise<boolean> {
    return new Promise((resolve) => {
      const dangling = leafLinkPaymentConfirmRef.current;
      if (dangling) {
        leafLinkPaymentConfirmRef.current = null;
        dangling(false);
      }
      leafLinkPaymentConfirmRef.current = resolve;
      setNotificationModal({
        open: true,
        title,
        message,
        details,
        confirmText: "Post payment",
        cancelText: "Cancel",
        onConfirm: null,
      });
    });
  }

  function cancelNotificationModal() {
    const r = leafLinkPaymentConfirmRef.current;
    if (r) {
      leafLinkPaymentConfirmRef.current = null;
      closeNotificationModal();
      r(false);
      return;
    }
    closeNotificationModal();
  }

  function confirmNotificationModal() {
    const r = leafLinkPaymentConfirmRef.current;
    const action = notificationModal.onConfirm;
    if (r) {
      leafLinkPaymentConfirmRef.current = null;
      closeNotificationModal();
      r(true);
      return;
    }
    closeNotificationModal();
    if (action) action();
  }

  function showPaymentAppliedToast() {
    setLeafLinkToast({ message: "Payment applied" });
  }

  async function resyncLeafLinkOrdersAfterPayment(companyId: string) {
    try {
      await syncLeafLinkOrders(companyId);
    }
    catch (syncErr: unknown) {
      const msg = syncErr instanceof Error ? syncErr.message : "Could not resync LeafLink orders.";
      showLeafLinkInfoOk("LeafLink sync", msg);
    }
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!canCreateUsers(currentUser?.role || "")) {
      setError("Only OWNER or ADMIN users can invite new users.");
      return;
    }

    if (!email.trim()) {
      setError("Email is required for invites.");
      return;
    }

    if (!role.trim()) {
      setError("Role is required.");
      return;
    }

    if (normalizePlatformRole(currentUser?.role) === "ADMIN" && role === "OWNER") {
      setError("Admins cannot invite application owners.");
      return;
    }

    setSaving(true);

    try {
      const response = await inviteUser({
        email: email.trim(),
        role,
        companyId:
          normalizePlatformRole(currentUser?.role) === "OWNER"
            ? selectedCompanyId
            : undefined,
      });

      const handle = username.trim() || email.trim().split("@")[0] || "user";
      await loadPendingInvitesForCompany(
        normalizePlatformRole(currentUser?.role) === "OWNER"
          ? selectedCompanyId
          : getSelectedCompanyId() || getAuthCompany()?.id || "",
      );
      setUsername("");
      setEmail("");
      setRole("VIEW_ONLY");

      if (response?.inviteUrl) {
        setSuccess(
          `Invite created for ${handle}. Invite link: ${response.inviteUrl}`,
        );
      } else {
        setSuccess(`Invite created for ${handle}.`);
      }
    } catch (err: any) {
      setError(err?.message || "Could not invite user.");
    } finally {
      setSaving(false);
    }
  }

  function startEditUser(user: AdminUser) {
    setError("");
    setSuccess("");
    setEditingUserId(String(user.id));
    setEditUsername(user.username || "");
    setEditEmail(user.email || "");
    setEditRole(normalizePlatformRole(user.role) || "VIEW_ONLY");
    setEditActive(user.active);
    setEditCashLogEodEnabled(
      normalizePlatformRole(user.role) === "OWNER" ? false : Boolean(user.cashLogEodEnabled),
    );
    setEditRewardsEnrolled(Boolean(user.rewardsEnrolled));
    setEditCultivationAlertsEnabled(Boolean(user.cultivationAlertsEnabled));
    const roleU = String(user.role || "VIEW_ONLY").trim().toUpperCase();
    if (isOwnerOrAdminRoleKey(roleU)) {
      setEditAppPermissions(fullAccessPermissionIds());
    }
    else {
      const raw = user.appPermissions;
      const initial =
        Array.isArray(raw) && raw.length
          ? raw.map((x) => String(x))
          : defaultPagePermissionsForRole(roleU);
      setEditAppPermissions([...new Set(initial)]);
    }
  }

  function cancelEditUser() {
    setEditingUserId(null);
    setEditUsername("");
    setEditEmail("");
    setEditRole("VIEW_ONLY");
    setEditActive(true);
    setEditAppPermissions([]);
    setEditCashLogEodEnabled(false);
    setEditRewardsEnrolled(false);
    setEditCultivationAlertsEnabled(false);
  }

  function toggleEditPermission(id: string) {
    if (isOwnerOrAdminRoleKey(editRole))
      return;
    setEditAppPermissions((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function saveEditedUser(user: AdminUser) {
    setError("");
    setSuccess("");

    if (!canManageUsers(currentUser?.role || "")) {
      setError("Only company owners, company admins, or managers can edit employees.");
      return;
    }

    if (!canEditTargetUser(currentUser?.role || "", user.role)) {
      setError("You do not have permission to edit this user.");
      return;
    }

    const actorIsManager = normalizePlatformRole(currentUser?.role || "") === "OPERATIONS_MANAGER";

    if (!actorIsManager) {
      if (normalizePlatformRole(currentUser?.role) === "ADMIN" && normalizePlatformRole(editRole) === "OWNER") {
        setError("Admins cannot make users application owners.");
        return;
      }

      if (!editUsername.trim()) {
        setError("Username is required.");
        return;
      }

      if (!editRole.trim()) {
        setError("Role is required.");
        return;
      }

      if (currentUser?.id === user.id && editActive === false) {
        setError("You cannot deactivate your own account while signed in.");
        return;
      }
    }

    setSavingUserId(user.id);

    try {
      const ownerOrAdminRole = isOwnerOrAdminRoleKey(editRole);
      const body: Record<string, unknown> = {};

      if (actorIsManager) {
        if (ownerOrAdminRole) {
          setError("Managers cannot update this account type.");
          setSavingUserId(null);
          return;
        }
        body.appPermissions = editAppPermissions.length > 0 ? editAppPermissions : null;
      } else {
        body.email = editEmail.trim() || undefined;
        body.role = editRole;
        body.isActive = editActive;
        // Application owners opt in/out only via Admin → Financial logs (digest modal), not this field.
        if (normalizePlatformRole(user.role) !== "OWNER") {
          body.cashLogEodEnabled = editCashLogEodEnabled;
        }
        body.rewardsEnrolled = editRewardsEnrolled;
        body.cultivationAlertsEnabled = editCultivationAlertsEnabled;
        if (ownerOrAdminRole) body.appPermissions = null;
        else body.appPermissions = editAppPermissions.length > 0 ? editAppPermissions : null;
      }

      const updatedUser = await apiRequest<AdminUser>(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        body,
      });

      setUsers((current) =>
        current.map((u) => (u.id === updatedUser.id ? updatedUser : u))
      );

      setEditingUserId(null);
      setSuccess(`Updated user ${updatedUser.username}.`);
    } catch (err: any) {
      setError(err?.message || "Could not update user.");
    } finally {
      setSavingUserId(null);
    }
  }

  async function sendPasswordResetForEditingUser() {
    setError("");
    setSuccess("");
    if (!editingTargetUser) return;
    if (!canManageUsers(currentUser?.role || "")) {
      setError("Only company owners, company admins, or managers can send password resets.");
      return;
    }
    if (!canEditTargetUser(currentUser?.role || "", editingTargetUser.role)) {
      setError("You do not have permission to reset this user.");
      return;
    }
    const savedEmail = String(editingTargetUser.email || "").trim();
    const dirtyEmail = String(editEmail || "").trim() !== savedEmail;
    if (dirtyEmail) {
      setError(
        "Save or revert email changes first. The reset email goes to the address already saved for this employee.",
      );
      return;
    }
    if (!savedEmail) {
      setError("Add an email address for this user and save before sending a reset.");
      return;
    }
    if (!editingTargetUser.active) {
      setError("Cannot send a reset while this account is inactive.");
      return;
    }
    setSendingResetUserId(editingTargetUser.id);
    try {
      const cid = checksCompanyId();
      const data = await apiRequest<{ ok?: boolean; emailed?: boolean; resetUrl?: string }>(
        withCompanyQuery(
          `/api/admin/users/${encodeURIComponent(editingTargetUser.id)}/password-reset-email`,
          cid,
        ),
        { method: "POST" },
      );
      if (data.emailed) {
        setSuccess(`Password reset email sent to ${savedEmail}.`);
      } else if (data.resetUrl) {
        setSuccess(
          `Email delivery failed (check API mail settings). Share this one-time link with the employee — it expires in about an hour: ${data.resetUrl}`,
        );
      } else {
        setError("Could not issue a password reset.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not send password reset.");
    } finally {
      setSendingResetUserId(null);
    }
  }

  async function runToggleUserActive(user: AdminUser, nextActive: boolean) {
    setSavingUserId(user.id);

    try {
      await apiRequest(`/api/admin/users/${user.id}/status`, {
        method: "POST",
        body: { isActive: nextActive },
      });

      setUsers((current) =>
        current.map((u) =>
          u.id === user.id ? { ...u, active: nextActive } : u,
        ),
      );

      setSuccess(
        nextActive
          ? `Reactivated user ${user.username}.`
          : `Deactivated user ${user.username}.`
      );
    } catch (err: any) {
      setError(err?.message || "Could not update user status.");
    } finally {
      setSavingUserId(null);
    }
  }

  function toggleUserActive(user: AdminUser) {
    setError("");
    setSuccess("");

    if (!isCompanyOwnerOrAdminActor(currentUser?.role || "")) {
      setError("Only company owners or company admins can activate or deactivate users.");
      return;
    }

    if (!canEditTargetUser(currentUser?.role || "", user.role)) {
      setError("You do not have permission to change this user.");
      return;
    }

    if (currentUser?.id === user.id && user.active) {
      setError("You cannot deactivate your own account while signed in.");
      return;
    }

    const nextActive = !user.active;

    showConfirm(
      nextActive ? "Reactivate User" : "Deactivate User",
      nextActive ? `Reactivate ${user.username}?` : `Deactivate ${user.username}?`,
      () => runToggleUserActive(user, nextActive),
      nextActive
        ? "This user will be able to sign in again."
        : "This user will no longer be able to sign in or use the app."
    );
  }

  async function runDeleteUser(user: AdminUser) {
    setSavingUserId(user.id);

    try {
      await apiRequest(`/api/admin/users/${user.id}`, {
        method: "DELETE",
      });

      setUsers((current) => current.filter((u) => u.id !== user.id));
      setSuccess(`Deleted user ${user.username}.`);
    } catch (err: any) {
      setError(err?.message || "Could not delete user.");
    } finally {
      setSavingUserId(null);
    }
  }

  function deleteUser(user: AdminUser) {
    setError("");
    setSuccess("");

    if (!isCompanyOwnerOrAdminActor(currentUser?.role || "")) {
      setError("Only company owners or company admins can delete users.");
      return;
    }

    if (!canEditTargetUser(currentUser?.role || "", user.role)) {
      setError("You do not have permission to delete this user.");
      return;
    }

    if (currentUser?.id === user.id) {
      setError("You cannot delete your own account while signed in.");
      return;
    }

    showConfirm(
      "Delete User",
      `Delete ${user.username}?`,
      () => runDeleteUser(user),
      "This removes the user from this company. This cannot be undone."
    );
  }

  const allowedRoleOptions = getAllowedRoleOptions(currentUser?.role || "");
  const managerEditingEmployees =
    normalizePlatformRole(currentUser?.role || "") === "OPERATIONS_MANAGER";

  return (
    <PageAccessGate allowedRoles={["ADMIN", "OWNER", "OPERATIONS_MANAGER"]}>
      <main
        style={{
          minHeight: "100vh",
          background:
            "radial-gradient(circle at top left, rgba(168,85,247,0.18), transparent 34%), radial-gradient(circle at top right, rgba(34,197,94,0.14), transparent 34%), #020617",
          color: "white",
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 1180, margin: "0 auto" }}>
          <header
            style={{
              background: "rgba(15, 23, 42, 0.84)",
              border: "1px solid rgba(148, 163, 184, 0.22)",
              borderRadius: 24,
              padding: 28,
              boxShadow: "0 24px 70px rgba(0,0,0,0.35)",
              marginBottom: 22,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 18,
                alignItems: "flex-start",
                flexWrap: "wrap",
              }}
            >
              <div>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    background: "rgba(168, 85, 247, 0.12)",
                    color: "#d8b4fe",
                    border: "1px solid rgba(168, 85, 247, 0.28)",
                    padding: "7px 12px",
                    borderRadius: 999,
                    fontSize: 13,
                    fontWeight: 800,
                    marginBottom: 14,
                  }}
                >
                  Company Admin
                </div>

                <h1
                  style={{
                    fontSize: "clamp(34px, 5vw, 56px)",
                    lineHeight: 1,
                    margin: 0,
                    letterSpacing: "-0.05em",
                    fontWeight: 950,
                  }}
                >
                  User Access & Permissions
                </h1>

                <p
                  style={{
                    maxWidth: 760,
                    color: "#cbd5e1",
                    fontSize: 18,
                    lineHeight: 1.6,
                    marginTop: 16,
                    marginBottom: 0,
                  }}
                >
                  {managerEditingEmployees ? (
                    <>
                      As a <strong style={{ color: "#bae6fd" }}>Manager</strong>, you can open employees and adjust{" "}
                      <strong style={{ color: "#bae6fd" }}>page access</strong> for View Only and floor specialists.
                      Invites, role changes, account status, and deleting users are handled by a{" "}
                      <strong style={{ color: "#bae6fd" }}>Company Admin</strong> or{" "}
                      <strong style={{ color: "#bae6fd" }}>Company Owner</strong>.
                    </>
                  ) : (
                    <>
                      Invite people to your company workspace, assign permissions, edit users, deactivate access, or
                      delete accounts.
                    </>
                  )}
                </p>

                <p
                  style={{
                    maxWidth: 760,
                    color: "#64748b",
                    fontSize: 13,
                    lineHeight: 1.55,
                    marginTop: 14,
                    marginBottom: 0,
                  }}
                >
                  {process.env.NEXT_PUBLIC_APP_GIT_SHA ? (
                    <>
                      Web UI build{" "}
                      <span style={{ color: "#94a3b8", fontFamily: "ui-monospace, monospace" }}>
                        {String(process.env.NEXT_PUBLIC_APP_GIT_SHA).slice(0, 7)}
                      </span>
                      .{" "}
                    </>
                  ) : null}
                  Click <b>Edit</b> to open a dialog — <b>Access &amp; permissions</b> is at the top of that
                  window. Railway deploys the API only; this page comes from your Next.js host (e.g. Vercel). If
                  the dialog never appears, trigger a new frontend deploy from the repo root (see root{" "}
                  <span style={{ color: "#94a3b8" }}>vercel.json</span>
                  ), not only a Railway API redeploy.
                </p>
              </div>

              <div
                style={{
                  minWidth: 240,
                  background: "rgba(2, 6, 23, 0.74)",
                  border: "1px solid rgba(148, 163, 184, 0.18)",
                  borderRadius: 18,
                  padding: 16,
                }}
              >
                <div style={smallLabelStyle}>Company</div>

                <div style={{ fontSize: 24, fontWeight: 900 }}>
                  {company?.name || "—"}
                </div>

                {normalizePlatformRole(currentUser?.role) === "OWNER" && companies.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <div style={smallLabelStyle}>View Company</div>

                    <select
                      value={selectedCompanyId}
                      onChange={(e) => handleCompanySwitch(e.target.value)}
                      style={inputStyle}
                    >
                      {companies.map((companyItem) => (
                        <option key={companyItem.id} value={companyItem.id}>
                          {companyItem.name} ({companyItem.code})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div style={{ color: "#64748b", marginTop: 4 }}>
                  Signed in as {currentUser?.username || "—"}
                </div>

                <div
                  style={{
                    display: "inline-flex",
                    marginTop: 10,
                    padding: "6px 10px",
                    borderRadius: 999,
                    background: `${getRoleColor(currentUser?.role || "")}22`,
                    border: `1px solid ${getRoleColor(currentUser?.role || "")}66`,
                    color: getRoleColor(currentUser?.role || ""),
                    fontWeight: 900,
                    fontSize: 13,
                  }}
                >
                  {currentUser?.role || "—"}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 24 }}>
              <Nav />
            </div>
          </header>

          {loading ? (
            <section style={panelStyle}>
              <h2 style={sectionTitleStyle}>Loading Admin Data...</h2>
            </section>
          ) : (
            <>
              {error && (
                <div
                  style={{
                    ...messageStyle,
                    background: "rgba(127, 29, 29, 0.58)",
                    border: "1px solid rgba(248, 113, 113, 0.5)",
                    color: "#fecaca",
                  }}
                >
                  {error}
                </div>
              )}

              {success && (
                <div
                  style={{
                    ...messageStyle,
                    background: "rgba(20, 83, 45, 0.58)",
                    border: "1px solid rgba(34, 197, 94, 0.5)",
                    color: "#bbf7d0",
                    wordBreak: "break-word",
                  }}
                >
                  {success}
                </div>
              )}

              <section
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(280px, 420px) 1fr",
                  gap: 18,
                  alignItems: "start",
                }}
              >
                <div style={{ display: "grid", gap: 18 }}>
                  <form onSubmit={createUser} style={panelStyle} autoComplete="off">
                    <h2 style={sectionTitleStyle}>Invite User</h2>

                    {!canCreateUsers(currentUser?.role || "") && (
                      <div
                        style={{
                          background: "rgba(120, 53, 15, 0.55)",
                          border: "1px solid rgba(251, 191, 36, 0.35)",
                          color: "#fde68a",
                          borderRadius: 14,
                          padding: 12,
                          marginBottom: 16,
                          lineHeight: 1.45,
                        }}
                      >
                        Your role can open this page, but only a <strong>Company Owner</strong> or{" "}
                        <strong>Company Admin</strong> can send invites. Managers adjust page access after someone
                        joins.
                      </div>
                    )}

                    <label style={labelStyle}>
                      Display name (optional)
                      <input
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        style={inputStyle}
                        placeholder="Not stored — invite uses email only"
                        autoComplete="off"
                        name="invite-user-username"
                      />
                    </label>

                    <label style={labelStyle}>
                      Email Required
                      <input
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        style={inputStyle}
                        type="email"
                        placeholder="example@email.com"
                        autoComplete="off"
                        name="invite-user-email"
                      />
                    </label>

                    <label style={labelStyle}>
                      Role / Access Level
                      <select
                        value={role}
                        onChange={(e) => setRole(e.target.value)}
                        style={inputStyle}
                      >
                        {INVITE_ROLE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div
                      style={{
                        background: "rgba(2, 6, 23, 0.72)",
                        border: "1px solid rgba(148, 163, 184, 0.16)",
                        borderRadius: 12,
                        padding: 10,
                        color: "#94a3b8",
                        lineHeight: 1.4,
                        marginBottom: 14,
                        fontSize: 14,
                      }}
                    >
                      {
                        INVITE_ROLE_OPTIONS.find(
                          (option) => option.value === role,
                        )?.description
                      }
                    </div>

                    <button
                      type="submit"
                      disabled={saving || !canCreateUsers(currentUser?.role || "")}
                      style={{
                        width: "100%",
                        border: "none",
                        borderRadius: 12,
                        padding: "11px 14px",
                        background:
                          saving || !canCreateUsers(currentUser?.role || "")
                            ? "#475569"
                            : "#a855f7",
                        color: "white",
                        fontWeight: 900,
                        fontSize: 15,
                        cursor:
                          saving || !canCreateUsers(currentUser?.role || "")
                            ? "not-allowed"
                            : "pointer",
                      }}
                    >
                      {saving ? "Sending Invite..." : "Send Invite"}
                    </button>
                  </form>
                </div>

                <section style={panelStyle}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      alignItems: "center",
                      marginBottom: 16,
                      flexWrap: "wrap",
                    }}
                  >
                    <h2 style={sectionTitleStyle}>Pending invites</h2>
                  </div>
                  <p
                    style={{
                      color: "#94a3b8",
                      fontSize: 14,
                      marginTop: 0,
                      marginBottom: 14,
                      lineHeight: 1.45,
                    }}
                  >
                    Stored in the database until accepted or expired (7 days).
                    Open invites are also listed under Company Users as
                    &quot;Invited&quot; until the person accepts.
                  </p>
                  <div style={{ display: "grid", gap: 10 }}>
                    {pendingInvites.length === 0 ? (
                      <div style={{ color: "#94a3b8" }}>No pending invites.</div>
                    ) : (
                      pendingInvites.map((inv) => (
                        <div
                          key={inv.id}
                          style={{
                            background: "rgba(2, 6, 23, 0.72)",
                            border: "1px solid rgba(168, 85, 247, 0.28)",
                            borderRadius: 14,
                            padding: 14,
                            display: "grid",
                            gap: 6,
                          }}
                        >
                          <div style={{ fontWeight: 900 }}>{inv.email}</div>
                          <div style={{ color: "#64748b", fontSize: 13 }}>
                            Role:{" "}
                            <span
                              style={{
                                color: getRoleColor(inv.role),
                                fontWeight: 800,
                              }}
                            >
                              {inv.role}
                            </span>
                          </div>
                          <div style={{ color: "#64748b", fontSize: 12 }}>
                            Expires:{" "}
                            {formatCompanyTimestamp(inv.expiresAt)}
                          </div>
                          {isCompanyOwnerOrAdminActor(currentUser?.role || "") && (
                            <div style={{ marginTop: 8 }}>
                              <button
                                type="button"
                                disabled={savingInviteId === inv.id}
                                onClick={() => confirmRevokePendingInvite(inv)}
                                style={{
                                  ...smallButtonStyle,
                                  background: "rgba(127, 29, 29, 0.38)",
                                  border: "1px solid rgba(248, 113, 113, 0.46)",
                                  color: "#fecaca",
                                  cursor:
                                    savingInviteId === inv.id ? "wait" : "pointer",
                                }}
                              >
                                {savingInviteId === inv.id ? "Revoking…" : "Revoke invite"}
                              </button>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </section>

                <section
                  style={{
                    ...panelStyle,
                    gridColumn: "1 / -1",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      alignItems: "center",
                      marginBottom: 16,
                      flexWrap: "wrap",
                    }}
                  >
                    <h2 style={sectionTitleStyle}>Company Users</h2>

                    <div
                      style={{
                        display: "flex",
                        gap: 10,
                        flexWrap: "wrap",
                        alignItems: "center",
                      }}
                    >
                      <Link
                        href="/admin/config"
                        style={{
                          textDecoration: "none",
                          border: "1px solid rgba(37, 99, 235, 0.4)",
                          background: "rgba(37, 99, 235, 0.16)",
                          color: "#bfdbfe",
                          borderRadius: 12,
                          padding: "10px 14px",
                          fontWeight: 800,
                          display: "inline-block",
                        }}
                      >
                        Company Config
                      </Link>

                      <button
                        type="button"
                        onClick={loadAdminData}
                        style={{
                          border: "1px solid rgba(148, 163, 184, 0.28)",
                          background: "rgba(2, 6, 23, 0.72)",
                          color: "#cbd5e1",
                          borderRadius: 12,
                          padding: "10px 13px",
                          fontWeight: 800,
                          cursor: "pointer",
                        }}
                      >
                        Refresh
                      </button>
                    </div>
                  </div>

                  <div style={{ display: "grid", gap: 12 }}>
                    {companyUsersDisplay.length === 0 ? (
                      <div style={{ color: "#94a3b8" }}>No users found.</div>
                    ) : (
                      companyUsersDisplay.map((user) => {
                        const isEditing =
                          editingUserId != null && String(editingUserId) === String(user.id);
                        const inviteGridRow = isPendingInviteGridRow(user);
                        const canManageThisUser =
                          !inviteGridRow &&
                          canManageUsers(currentUser?.role || "") &&
                          canEditTargetUser(currentUser?.role || "", user.role);
                        const canLifecycleThisUser =
                          canManageThisUser &&
                          isCompanyOwnerOrAdminActor(currentUser?.role || "");

                        return (
                          <div
                            key={user.id}
                            style={{
                              background: "rgba(2, 6, 23, 0.72)",
                              border: user.active
                                ? "1px solid rgba(148, 163, 184, 0.16)"
                                : "1px solid rgba(248, 113, 113, 0.28)",
                              borderRadius: 16,
                              padding: 16,
                              display: "grid",
                              gap: 14,
                              ...(isEditing
                                ? {
                                    boxShadow:
                                      "0 0 0 2px rgba(56, 189, 248, 0.45), 0 12px 40px rgba(0,0,0,0.35)",
                                  }
                                : {}),
                            }}
                          >
                            {!isEditing ? (
                              <>
                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    gap: 14,
                                    alignItems: "center",
                                    flexWrap: "wrap",
                                  }}
                                >
                                  <div>
                                    <div
                                      style={{
                                        fontSize: 18,
                                        fontWeight: 900,
                                        marginBottom: 4,
                                      }}
                                    >
                                      {user.username}
                                    </div>

                                    <div style={{ color: "#94a3b8" }}>
                                      {user.email || "No email saved"}
                                    </div>

                                    <div
                                      style={{
                                        color: user.active ? "#64748b" : "#fca5a5",
                                        fontSize: 13,
                                        marginTop: 6,
                                        fontWeight: 800,
                                      }}
                                    >
                                      Status: {getDisplayStatus(user)}
                                    </div>
                                  </div>

                                  <div
                                    style={{
                                      display: "inline-flex",
                                      padding: "7px 11px",
                                      borderRadius: 999,
                                      background: `${getRoleColor(user.role)}22`,
                                      border: `1px solid ${getRoleColor(user.role)}66`,
                                      color: getRoleColor(user.role),
                                      fontWeight: 900,
                                      fontSize: 13,
                                    }}
                                  >
                                    {user.role}
                                  </div>
                                </div>

                                <div
                                  style={{
                                    display: "flex",
                                    gap: 8,
                                    flexWrap: "wrap",
                                    justifyContent: "flex-end",
                                  }}
                                >
                                  {inviteGridRow &&
                                  isCompanyOwnerOrAdminActor(currentUser?.role || "") ? (
                                    <button
                                      type="button"
                                      disabled={
                                        savingInviteId ===
                                        user.id.slice(PENDING_INVITE_ROW_PREFIX.length)
                                      }
                                      onClick={() => confirmRevokeInviteFromGridRow(user)}
                                      style={{
                                        ...smallButtonStyle,
                                        background: "rgba(127, 29, 29, 0.38)",
                                        border: "1px solid rgba(248, 113, 113, 0.46)",
                                        color: "#fecaca",
                                        cursor:
                                          savingInviteId ===
                                          user.id.slice(PENDING_INVITE_ROW_PREFIX.length)
                                            ? "wait"
                                            : "pointer",
                                      }}
                                    >
                                      {savingInviteId ===
                                      user.id.slice(PENDING_INVITE_ROW_PREFIX.length)
                                        ? "Revoking…"
                                        : "Revoke invite"}
                                    </button>
                                  ) : (
                                    <>
                                      <button
                                        type="button"
                                        disabled={
                                          !canManageThisUser ||
                                          savingUserId === user.id ||
                                          inviteGridRow
                                        }
                                        onClick={() => startEditUser(user)}
                                        style={{
                                          ...smallButtonStyle,
                                          background: canManageThisUser
                                            ? "rgba(56, 189, 248, 0.16)"
                                            : "rgba(71, 85, 105, 0.45)",
                                          border: canManageThisUser
                                            ? "1px solid rgba(56, 189, 248, 0.4)"
                                            : "1px solid rgba(71, 85, 105, 0.5)",
                                          color: canManageThisUser ? "#bae6fd" : "#94a3b8",
                                          cursor: canManageThisUser ? "pointer" : "not-allowed",
                                        }}
                                      >
                                        Edit
                                      </button>

                                      <button
                                        type="button"
                                        disabled={
                                          !canLifecycleThisUser ||
                                          savingUserId === user.id ||
                                          inviteGridRow
                                        }
                                        onClick={() => toggleUserActive(user)}
                                        style={{
                                          ...smallButtonStyle,
                                          background: user.active
                                            ? "rgba(245, 158, 11, 0.14)"
                                            : "rgba(34, 197, 94, 0.14)",
                                          border: user.active
                                            ? "1px solid rgba(245, 158, 11, 0.42)"
                                            : "1px solid rgba(34, 197, 94, 0.42)",
                                          color: user.active ? "#fde68a" : "#bbf7d0",
                                          cursor: canLifecycleThisUser ? "pointer" : "not-allowed",
                                        }}
                                      >
                                        {user.active ? "Deactivate" : "Reactivate"}
                                      </button>

                                      <button
                                        type="button"
                                        disabled={
                                          !canLifecycleThisUser ||
                                          savingUserId === user.id ||
                                          inviteGridRow
                                        }
                                        onClick={() => deleteUser(user)}
                                        style={{
                                          ...smallButtonStyle,
                                          background: "rgba(127, 29, 29, 0.38)",
                                          border: "1px solid rgba(248, 113, 113, 0.46)",
                                          color: "#fecaca",
                                          cursor: canLifecycleThisUser ? "pointer" : "not-allowed",
                                        }}
                                      >
                                        Delete
                                      </button>
                                    </>
                                  )}
                                </div>
                              </>
                            ) : (
                              <>
                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    gap: 14,
                                    alignItems: "center",
                                    flexWrap: "wrap",
                                  }}
                                >
                                  <div>
                                    <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 4 }}>
                                      {user.username}
                                    </div>
                                    <div style={{ color: "#67e8f9", fontSize: 13, fontWeight: 800, lineHeight: 1.45 }}>
                                      Edit window open —{" "}
                                      {"set Access & permissions in the dialog, then Save."}
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={cancelEditUser}
                                    style={{
                                      ...smallButtonStyle,
                                      background: "rgba(71, 85, 105, 0.32)",
                                      border: "1px solid rgba(148, 163, 184, 0.28)",
                                      color: "#cbd5e1",
                                      cursor: "pointer",
                                    }}
                                  >
                                    Close dialog
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </section>
              </section>

              {canAccessFinancialAdminTools(currentUser?.role || "") ? (
                <section style={{ ...panelStyle, marginTop: 22 }}>
                  <h2 style={sectionTitleStyle}>Financial logs</h2>
                  <p
                    style={{
                      color: "#94a3b8",
                      marginTop: 0,
                      marginBottom: 16,
                      lineHeight: 1.55,
                      fontSize: 15,
                    }}
                  >
                    Log check photos and stub images, or record cash in and out. Each tool opens in its own window.
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                    <button
                      type="button"
                      onClick={() => {
                        setCheckFormError("");
                        setCheckFormSuccess("");
                        setCheckLogOpen(true);
                      }}
                      style={{
                        ...smallButtonStyle,
                        background: "rgba(56, 189, 248, 0.2)",
                        border: "1px solid rgba(56, 189, 248, 0.45)",
                        color: "#bae6fd",
                        cursor: "pointer",
                      }}
                    >
                      Open check log…
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCashFormError("");
                        setCashFormSuccess("");
                        setCashReceiptImageUrl("");
                        if (cashReceiptInputRef.current) cashReceiptInputRef.current.value = "";
                        setCashReceiptFileKey((k) => k + 1);
                        setCashLogOpen(true);
                      }}
                      style={{
                        ...smallButtonStyle,
                        background: "rgba(34, 197, 94, 0.18)",
                        border: "1px solid rgba(34, 197, 94, 0.45)",
                        color: "#bbf7d0",
                        cursor: "pointer",
                      }}
                    >
                      Open cash log…
                    </button>
                    <button
                      type="button"
                      onClick={() => void openCashEodSettings()}
                      style={{
                        ...smallButtonStyle,
                        background: "rgba(251, 191, 36, 0.12)",
                        border: "1px solid rgba(251, 191, 36, 0.45)",
                        color: "#fde68a",
                        cursor: "pointer",
                      }}
                    >
                      EOD digest email…
                    </button>
                  </div>
                </section>
              ) : null}
        {checkLogOpen ? (
          <div style={{ ...modalOverlayStyle, zIndex: 1100 }}>
            <div
              style={{
                ...modalStyle,
                maxWidth: 940,
                maxHeight: "92vh",
                overflowY: "auto",
                width: "100%",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  marginBottom: 14,
                  flexWrap: "wrap",
                }}
              >
                <h2 style={{ ...sectionTitleStyle, marginBottom: 0 }}>Check log</h2>
                <button
                  type="button"
                  onClick={() => setCheckLogOpen(false)}
                  style={{ ...modalButtonStyle }}
                >
                  Close
                </button>
              </div>
                  <p
                    style={{
                      color: "#94a3b8",
                      marginTop: 0,
                      marginBottom: 18,
                      lineHeight: 1.55,
                      fontSize: 15,
                    }}
                  >
                    Photograph the check and optional stub, enter payee and totals, then save.
                    Filter by capture date (UTC calendar day) and export CSV for the selected range. Invoice
                    references may include multiple values (comma, semicolon, or newline); each is matched to saved
                    LeafLink orders by full order # or by the <strong style={{ color: "#cbd5e1" }}>last four digits</strong>{" "}
                    (same as the Orders page). After save, you may be prompted to post payments to LeafLink for unpaid
                    matches.
                  </p>

                  {checkFormError ? (
                    <div
                      style={{
                        ...messageStyle,
                        marginBottom: 12,
                        background: "rgba(127, 29, 29, 0.58)",
                        border: "1px solid rgba(248, 113, 113, 0.5)",
                        color: "#fecaca",
                      }}
                    >
                      {checkFormError}
                    </div>
                  ) : null}
                  {checkFormSuccess ? (
                    <div
                      style={{
                        ...messageStyle,
                        marginBottom: 12,
                        background: "rgba(20, 83, 45, 0.58)",
                        border: "1px solid rgba(34, 197, 94, 0.5)",
                        color: "#bbf7d0",
                      }}
                    >
                      {checkFormSuccess}
                    </div>
                  ) : null}

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                      gap: 16,
                      marginBottom: 18,
                    }}
                  >
                    <div>
                      <div style={smallLabelStyle}>Check photo (required)</div>
                      <input
                        key={`check-front-${checkFileKey}`}
                        ref={checkImageInputRef}
                        type="file"
                        accept="image/jpeg,image/jpg,image/png,image/webp"
                        capture="environment"
                        style={{ width: "100%", color: "#cbd5e1" }}
                      />
                    </div>
                    <div>
                      <div style={smallLabelStyle}>Stub photo (optional)</div>
                      <input
                        ref={stubImageInputRef}
                        type="file"
                        accept="image/jpeg,image/jpg,image/png,image/webp"
                        capture="environment"
                        style={{ width: "100%", color: "#cbd5e1" }}
                      />
                    </div>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                      gap: 14,
                      marginBottom: 16,
                    }}
                  >
                    <label style={labelStyle}>
                      Payee
                      <input
                        value={checkPayee}
                        onChange={(e) => setCheckPayee(e.target.value)}
                        placeholder="Name on check"
                        style={inputStyle}
                        autoComplete="off"
                      />
                    </label>
                    <label style={labelStyle}>
                      Total
                      <input
                        value={checkTotal}
                        onChange={(e) => setCheckTotal(e.target.value)}
                        placeholder="0.00"
                        inputMode="decimal"
                        style={inputStyle}
                        autoComplete="off"
                      />
                    </label>
                    <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>
                      Invoice # (one or many — matches LeafLink order # or last 4 digits)
                      <textarea
                        value={checkInvoice}
                        onChange={(e) => setCheckInvoice(e.target.value)}
                        placeholder={"9511\n9449, 9448"}
                        rows={3}
                        style={{ ...inputStyle, resize: "vertical", minHeight: 72, fontFamily: "inherit" }}
                        autoComplete="off"
                      />
                    </label>
                    <label style={labelStyle}>
                      Check date (optional)
                      <input
                        type="date"
                        value={checkWrittenDate}
                        onChange={(e) => setCheckWrittenDate(e.target.value)}
                        style={inputStyle}
                      />
                    </label>
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 22 }}>
                    <button
                      type="button"
                      disabled={checkSaving}
                      onClick={() => void saveCheckCapture()}
                      style={{
                        ...smallButtonStyle,
                        background: checkSaving ? "rgba(71, 85, 105, 0.5)" : "#22c55e",
                        border: "1px solid rgba(34, 197, 94, 0.7)",
                        color: "white",
                        cursor: checkSaving ? "wait" : "pointer",
                      }}
                    >
                      {checkSaving ? "Saving…" : "Save check capture"}
                    </button>
                  </div>

                  <div
                    style={{
                      borderTop: "1px solid rgba(148, 163, 184, 0.2)",
                      paddingTop: 18,
                    }}
                  >
                    <h3
                      style={{
                        margin: "0 0 12px",
                        fontSize: 17,
                        fontWeight: 900,
                        color: "#e2e8f0",
                      }}
                    >
                      History &amp; export
                    </h3>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 12,
                        alignItems: "flex-end",
                        marginBottom: 14,
                      }}
                    >
                      <label style={{ ...labelStyle, minWidth: 160, marginBottom: 0 }}>
                        From (YYYY-MM-DD)
                        <input
                          value={checkFilterFrom}
                          onChange={(e) => setCheckFilterFrom(e.target.value)}
                          placeholder="2026-01-01"
                          style={inputStyle}
                        />
                      </label>
                      <label style={{ ...labelStyle, minWidth: 160, marginBottom: 0 }}>
                        To (YYYY-MM-DD)
                        <input
                          value={checkFilterTo}
                          onChange={(e) => setCheckFilterTo(e.target.value)}
                          placeholder="2026-12-31"
                          style={inputStyle}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={checkListLoading}
                        onClick={() => void loadCheckCaptures()}
                        style={{
                          ...smallButtonStyle,
                          background: "rgba(56, 189, 248, 0.16)",
                          border: "1px solid rgba(56, 189, 248, 0.4)",
                          color: "#bae6fd",
                          cursor: checkListLoading ? "wait" : "pointer",
                        }}
                      >
                        {checkListLoading ? "Loading…" : "Apply filter"}
                      </button>
                      <button
                        type="button"
                        disabled={checkExporting}
                        onClick={() => void exportCheckCapturesCsv()}
                        style={{
                          ...smallButtonStyle,
                          background: "rgba(168, 85, 247, 0.2)",
                          border: "1px solid rgba(168, 85, 247, 0.45)",
                          color: "#e9d5ff",
                          cursor: checkExporting ? "wait" : "pointer",
                        }}
                      >
                        {checkExporting ? "Exporting…" : "Export CSV (range)"}
                      </button>
                    </div>
                    {checkListError ? (
                      <div
                        style={{
                          color: "#fecaca",
                          marginBottom: 10,
                          fontWeight: 700,
                        }}
                      >
                        {checkListError}
                      </div>
                    ) : null}

                    <div
                      style={{
                        overflowX: "auto",
                        borderRadius: 12,
                        border: "1px solid rgba(148, 163, 184, 0.2)",
                      }}
                    >
                      <table
                        style={{
                          width: "100%",
                          borderCollapse: "collapse",
                          fontSize: 13,
                          minWidth: 720,
                        }}
                      >
                        <thead>
                          <tr style={{ background: "rgba(2, 6, 23, 0.65)" }}>
                            <th style={checkThStyle}>Captured</th>
                            <th style={checkThStyle}>Payee</th>
                            <th style={checkThStyle}>Total</th>
                            <th style={checkThStyle}>Invoice #</th>
                            <th style={checkThStyle}>LeafLink</th>
                            <th style={checkThStyle}>Images</th>
                            <th style={checkThStyle}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {checkRows.length === 0 ? (
                            <tr>
                              <td colSpan={7} style={checkTdStyle}>
                                No rows for this filter.
                              </td>
                            </tr>
                          ) : (
                            checkRows.map((row) => (
                              <tr key={row.id} style={{ borderTop: "1px solid rgba(51,65,85,0.6)" }}>
                                <td style={checkTdStyle}>
                                  {row.createdAt
                                    ? formatCompanyTimestamp(row.createdAt)
                                    : "—"}
                                </td>
                                <td style={checkTdStyle}>{row.payerName || "—"}</td>
                                <td style={checkTdStyle}>
                                  {row.amount != null ? String(row.amount) : "—"}
                                </td>
                                <td style={checkTdStyle}>{row.invoiceNumber || row.memo || "—"}</td>
                                <td style={{ ...checkTdStyle, maxWidth: 220, whiteSpace: "normal", wordBreak: "break-word" }}>
                                  {formatLeafLinkAdminListCell(row)}
                                </td>
                                <td style={checkTdStyle}>
                                  <a
                                    href={row.imageUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ color: "#38bdf8", fontWeight: 800, marginRight: 10 }}
                                  >
                                    Check
                                  </a>
                                  {row.stubImageUrl ? (
                                    <a
                                      href={row.stubImageUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      style={{ color: "#a78bfa", fontWeight: 800 }}
                                    >
                                      Stub
                                    </a>
                                  ) : (
                                    <span style={{ color: "#64748b" }}>—</span>
                                  )}
                                </td>
                                <td style={checkTdStyle}>
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                                    <button
                                      type="button"
                                      disabled={editCheckSaving && checkBeingEdited?.id === row.id}
                                      onClick={() => setCheckBeingEdited(row)}
                                      style={{
                                        ...smallButtonStyle,
                                        background: "rgba(30, 64, 175, 0.45)",
                                        border: "1px solid rgba(96, 165, 250, 0.5)",
                                        color: "#dbeafe",
                                        cursor: editCheckSaving && checkBeingEdited?.id === row.id ? "wait" : "pointer",
                                      }}
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      disabled={deletingCheckId === row.id}
                                      onClick={() => requestDeleteCheckCapture(row)}
                                      style={{
                                        ...smallButtonStyle,
                                        background:
                                          deletingCheckId === row.id
                                            ? "rgba(71, 85, 105, 0.5)"
                                            : "rgba(127, 29, 29, 0.55)",
                                        border: "1px solid rgba(248, 113, 113, 0.45)",
                                        color: "#fecaca",
                                        cursor: deletingCheckId === row.id ? "wait" : "pointer",
                                      }}
                                    >
                                      {deletingCheckId === row.id ? "…" : "Delete"}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
            </div>
          </div>
        ) : null}

        {cashLogOpen ? (
          <div style={{ ...modalOverlayStyle, zIndex: 1100 }}>
            <div
              style={{
                ...modalStyle,
                maxWidth: 900,
                maxHeight: "92vh",
                overflowY: "auto",
                width: "100%",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  marginBottom: 14,
                  flexWrap: "wrap",
                }}
              >
                <h2 style={{ ...sectionTitleStyle, marginBottom: 0 }}>Cash log</h2>
                <button
                  type="button"
                  onClick={() => setCashLogOpen(false)}
                  style={{ ...modalButtonStyle }}
                >
                  Close
                </button>
              </div>
              <p style={{ color: "#94a3b8", marginTop: 0, lineHeight: 1.55, fontSize: 14 }}>
                Incoming: payee company, date, total, and optional invoice reference(s). Use comma, semicolon, or new
                lines for multiple invoices on one deposit — values are matched to LeafLink orders by full order # or{" "}
                <strong style={{ color: "#cbd5e1" }}>last four digits</strong>. Outgoing: amount, department
                (cultivation, extraction, packaging, or general), optional date and memo, and optional receipt photo.
                History filter matches entry date (UTC calendar day); rows with no entry date use logged time for the
                same range. Use Direction to show only incoming or outgoing rows.
              </p>
              {!canManageUsers(currentUser?.role || "") ? (
                <div
                  style={{
                    ...messageStyle,
                    marginBottom: 14,
                    background: "rgba(30, 58, 138, 0.35)",
                    border: "1px solid rgba(96, 165, 250, 0.4)",
                    color: "#bfdbfe",
                  }}
                >
                  View only: only <strong>Owner</strong> or <strong>Admin</strong> can add, edit, or delete cash
                  entries. You can still review history and export.
                </div>
              ) : null}
              {cashFormError ? (
                <div
                  style={{
                    ...messageStyle,
                    marginBottom: 12,
                    background: "rgba(127, 29, 29, 0.58)",
                    border: "1px solid rgba(248, 113, 113, 0.5)",
                    color: "#fecaca",
                  }}
                >
                  {cashFormError}
                </div>
              ) : null}
              {cashFormSuccess ? (
                <div
                  style={{
                    ...messageStyle,
                    marginBottom: 12,
                    background: "rgba(20, 83, 45, 0.58)",
                    border: "1px solid rgba(34, 197, 94, 0.5)",
                    color: "#bbf7d0",
                  }}
                >
                  {cashFormSuccess}
                </div>
              ) : null}
              <fieldset
                disabled={!canManageUsers(currentUser?.role || "")}
                style={{
                  border: "none",
                  margin: 0,
                  padding: 0,
                  minWidth: 0,
                }}
              >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                  gap: 14,
                  marginBottom: 16,
                }}
              >
                <label style={{ ...labelStyle, marginBottom: 0 }}>
                  Direction
                  <select
                    value={cashDirection}
                    onChange={(e) => {
                      const v = e.target.value as "INCOMING" | "OUTGOING";
                      setCashDirection(v);
                      if (v === "INCOMING") {
                        setCashReceiptImageUrl("");
                        if (cashReceiptInputRef.current) cashReceiptInputRef.current.value = "";
                        setCashReceiptFileKey((k) => k + 1);
                      }
                    }}
                    style={{ ...inputStyle }}
                  >
                    <option value="INCOMING">Incoming (cash in)</option>
                    <option value="OUTGOING">Outgoing (cash out)</option>
                  </select>
                </label>
                {cashDirection === "INCOMING" ? (
                  <>
                    <label style={{ ...labelStyle, marginBottom: 0 }}>
                      Payee company
                      <input
                        value={cashPayeeCompany}
                        onChange={(e) => setCashPayeeCompany(e.target.value)}
                        placeholder="Company name"
                        style={{ ...inputStyle }}
                        autoComplete="organization"
                      />
                    </label>
                    <label style={{ ...labelStyle, marginBottom: 0 }}>
                      Date
                      <input
                        type="date"
                        value={cashEntryDate}
                        onChange={(e) => setCashEntryDate(e.target.value)}
                        style={{ ...inputStyle }}
                      />
                    </label>
                    <label style={{ ...labelStyle, marginBottom: 0 }}>
                      Total
                      <input
                        value={cashAmount}
                        onChange={(e) => setCashAmount(e.target.value)}
                        placeholder="0.00"
                        inputMode="decimal"
                        style={{ ...inputStyle }}
                        autoComplete="off"
                      />
                    </label>
                    <label style={{ ...labelStyle, marginBottom: 0, gridColumn: "1 / -1" }}>
                      Invoice # (optional — multiple allowed)
                      <textarea
                        value={cashInvoiceNumber}
                        onChange={(e) => setCashInvoiceNumber(e.target.value)}
                        placeholder={"9511\n9449, 9448"}
                        rows={3}
                        style={{ ...inputStyle, resize: "vertical", minHeight: 72, fontFamily: "inherit" }}
                        autoComplete="off"
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <label style={{ ...labelStyle, marginBottom: 0 }}>
                      Department
                      <select
                        value={cashDepartment}
                        onChange={(e) =>
                          setCashDepartment(e.target.value as CashLogDepartment)
                        }
                        style={{ ...inputStyle }}
                      >
                        <option value="CULTIVATION">Cultivation</option>
                        <option value="EXTRACTION">Extraction</option>
                        <option value="PACKAGING">Packaging</option>
                        <option value="GENERAL">General</option>
                      </select>
                    </label>
                    <label style={{ ...labelStyle, marginBottom: 0 }}>
                      Amount
                      <input
                        value={cashAmount}
                        onChange={(e) => setCashAmount(e.target.value)}
                        placeholder="0.00"
                        inputMode="decimal"
                        style={{ ...inputStyle }}
                        autoComplete="off"
                      />
                    </label>
                    <label style={{ ...labelStyle, marginBottom: 0 }}>
                      Date (optional)
                      <input
                        type="date"
                        value={cashEntryDate}
                        onChange={(e) => setCashEntryDate(e.target.value)}
                        style={{ ...inputStyle }}
                      />
                    </label>
                    <label style={{ ...labelStyle, marginBottom: 0 }}>
                      Memo (optional)
                      <input
                        value={cashMemo}
                        onChange={(e) => setCashMemo(e.target.value)}
                        style={{ ...inputStyle }}
                        autoComplete="off"
                      />
                    </label>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <div style={{ ...labelStyle, marginBottom: 0 }}>
                        Receipt photo (optional)
                        <input
                          key={cashReceiptFileKey}
                          ref={cashReceiptInputRef}
                          type="file"
                          accept="image/jpeg,image/jpg,image/png,image/webp"
                          capture="environment"
                          disabled={cashReceiptUploading || cashSaving}
                          onChange={(e) => void handleCashReceiptFileChange(e)}
                          style={{ ...inputStyle, padding: "8px 10px" }}
                        />
                        <div style={{ color: "#64748b", fontSize: 12, marginTop: 6, fontWeight: 600 }}>
                          Use your camera or photo library. JPEG, PNG, or WebP.
                          {cashReceiptUploading ? " Uploading…" : null}
                        </div>
                        {cashReceiptImageUrl ? (
                          <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                            <a
                              href={cashReceiptImageUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: "#38bdf8", fontWeight: 800, fontSize: 14 }}
                            >
                              Preview receipt
                            </a>
                            <button
                              type="button"
                              disabled={cashSaving}
                              onClick={() => {
                                setCashReceiptImageUrl("");
                                if (cashReceiptInputRef.current) cashReceiptInputRef.current.value = "";
                                setCashReceiptFileKey((k) => k + 1);
                              }}
                              style={{
                                ...smallButtonStyle,
                                background: "rgba(51, 65, 85, 0.6)",
                                border: "1px solid rgba(148, 163, 184, 0.35)",
                                color: "#e2e8f0",
                                cursor: cashSaving ? "not-allowed" : "pointer",
                              }}
                            >
                              Remove receipt
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </>
                )}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 22 }}>
                <button
                  type="button"
                  disabled={cashSaving || cashReceiptUploading}
                  onClick={() => void saveCashEntry()}
                  style={{
                    ...smallButtonStyle,
                    background:
                      cashSaving || cashReceiptUploading ? "rgba(71, 85, 105, 0.5)" : "#22c55e",
                    border: "1px solid rgba(34, 197, 94, 0.7)",
                    color: "white",
                    cursor: cashSaving ? "wait" : "pointer",
                  }}
                >
                  {cashSaving ? "Saving…" : "Save cash entry"}
                </button>
              </div>
              </fieldset>
              <div
                style={{
                  borderTop: "1px solid rgba(148, 163, 184, 0.2)",
                  paddingTop: 18,
                }}
              >
                <h3
                  style={{
                    margin: "0 0 12px",
                    fontSize: 17,
                    fontWeight: 900,
                    color: "#e2e8f0",
                  }}
                >
                  History &amp; export
                </h3>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 12,
                    alignItems: "flex-end",
                    marginBottom: 14,
                  }}
                >
                  <label style={{ ...labelStyle, minWidth: 160, marginBottom: 0 }}>
                    From (YYYY-MM-DD)
                    <input
                      value={cashFilterFrom}
                      onChange={(e) => setCashFilterFrom(e.target.value)}
                      style={{ ...inputStyle }}
                    />
                  </label>
                  <label style={{ ...labelStyle, minWidth: 160, marginBottom: 0 }}>
                    To (YYYY-MM-DD)
                    <input
                      value={cashFilterTo}
                      onChange={(e) => setCashFilterTo(e.target.value)}
                      style={{ ...inputStyle }}
                    />
                  </label>
                  <label style={{ ...labelStyle, minWidth: 160, marginBottom: 0 }}>
                    Direction
                    <select
                      value={cashHistoryDirection}
                      onChange={(e) =>
                        setCashHistoryDirection(e.target.value as "ALL" | "INCOMING" | "OUTGOING")
                      }
                      style={{ ...inputStyle }}
                    >
                      <option value="ALL">All</option>
                      <option value="INCOMING">Incoming only</option>
                      <option value="OUTGOING">Outgoing only</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={cashListLoading}
                    onClick={() => void loadCashEntries()}
                    style={{
                      ...smallButtonStyle,
                      background: "rgba(56, 189, 248, 0.16)",
                      border: "1px solid rgba(56, 189, 248, 0.4)",
                      color: "#bae6fd",
                      cursor: cashListLoading ? "wait" : "pointer",
                    }}
                  >
                    {cashListLoading ? "Loading…" : "Apply filter"}
                  </button>
                  <button
                    type="button"
                    disabled={cashExporting}
                    onClick={() => void exportCashLogCsv()}
                    style={{
                      ...smallButtonStyle,
                      background: "rgba(168, 85, 247, 0.2)",
                      border: "1px solid rgba(168, 85, 247, 0.45)",
                      color: "#e9d5ff",
                      cursor: cashExporting ? "wait" : "pointer",
                    }}
                  >
                    {cashExporting ? "Exporting…" : "Export CSV (range)"}
                  </button>
                </div>
                {cashListError ? (
                  <div style={{ color: "#fecaca", marginBottom: 10, fontWeight: 700 }}>
                    {cashListError}
                  </div>
                ) : null}
                <div
                  style={{
                    overflowX: "auto",
                    borderRadius: 12,
                    border: "1px solid rgba(148, 163, 184, 0.2)",
                  }}
                >
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: 13,
                      minWidth: 820,
                    }}
                  >
                    <thead>
                      <tr style={{ background: "rgba(2, 6, 23, 0.65)" }}>
                        <th style={checkThStyle}>Logged</th>
                        <th style={checkThStyle}>Dir</th>
                        <th style={checkThStyle}>Total</th>
                        <th style={checkThStyle}>Payee co.</th>
                        <th style={checkThStyle}>Invoice #</th>
                        <th style={checkThStyle}>LeafLink</th>
                        <th style={checkThStyle}>Dept</th>
                        <th style={checkThStyle}>Entry date</th>
                        <th style={checkThStyle}>Memo</th>
                        <th style={checkThStyle}>Receipt</th>
                        <th style={checkThStyle}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cashRows.length === 0 ? (
                        <tr>
                          <td colSpan={11} style={checkTdStyle}>
                            No rows for this filter.
                          </td>
                        </tr>
                      ) : (
                        cashRows.map((row) => (
                          <tr key={row.id} style={{ borderTop: "1px solid rgba(51,65,85,0.6)" }}>
                            <td style={checkTdStyle}>
                              {row.createdAt ? formatCompanyTimestamp(row.createdAt) : "—"}
                            </td>
                            <td style={checkTdStyle}>
                              {row.direction === "INCOMING" ? "In" : "Out"}
                            </td>
                            <td style={checkTdStyle}>{String(row.amount)}</td>
                            <td style={checkTdStyle}>{row.payeeCompany || "—"}</td>
                            <td style={checkTdStyle}>{row.invoiceNumber || "—"}</td>
                            <td style={{ ...checkTdStyle, maxWidth: 200, whiteSpace: "normal", wordBreak: "break-word" }}>
                              {formatLeafLinkAdminListCell(row)}
                            </td>
                            <td style={checkTdStyle}>{formatCashDepartment(row.department)}</td>
                            <td style={checkTdStyle}>
                              {row.entryDate
                                ? formatCompanyTimestamp(row.entryDate)
                                : "—"}
                            </td>
                            <td style={checkTdStyle}>{row.memo || "—"}</td>
                            <td style={checkTdStyle}>
                              {row.receiptImageUrl ? (
                                <a
                                  href={row.receiptImageUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{ color: "#38bdf8", fontWeight: 800 }}
                                >
                                  View
                                </a>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td style={checkTdStyle}>
                              {canManageUsers(currentUser?.role || "") ? (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                                  <button
                                    type="button"
                                    disabled={editCashSaving && cashBeingEdited?.id === row.id}
                                    onClick={() => setCashBeingEdited(row)}
                                    style={{
                                      ...smallButtonStyle,
                                      background: "rgba(30, 64, 175, 0.45)",
                                      border: "1px solid rgba(96, 165, 250, 0.5)",
                                      color: "#dbeafe",
                                      cursor: editCashSaving && cashBeingEdited?.id === row.id ? "wait" : "pointer",
                                    }}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    disabled={deletingCashId === row.id}
                                    onClick={() => requestDeleteCashEntry(row)}
                                    style={{
                                      ...smallButtonStyle,
                                      background:
                                        deletingCashId === row.id
                                          ? "rgba(71, 85, 105, 0.5)"
                                          : "rgba(127, 29, 29, 0.55)",
                                      border: "1px solid rgba(248, 113, 113, 0.45)",
                                      color: "#fecaca",
                                      cursor: deletingCashId === row.id ? "wait" : "pointer",
                                    }}
                                  >
                                    {deletingCashId === row.id ? "…" : "Delete"}
                                  </button>
                                </div>
                              ) : (
                                <span style={{ color: "#64748b" }}>—</span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {cashEodModalOpen ? (
          <div style={{ ...modalOverlayStyle, zIndex: 1120 }}>
            <div
              style={{
                ...modalStyle,
                maxWidth: 520,
                width: "100%",
                maxHeight: "92vh",
                overflowY: "auto",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  marginBottom: 12,
                  flexWrap: "wrap",
                }}
              >
                <h2 style={{ ...sectionTitleStyle, marginBottom: 0 }}>Financial digest email (cash & checks)</h2>
                <button
                  type="button"
                  onClick={() => setCashEodModalOpen(false)}
                  style={{ ...modalButtonStyle }}
                >
                  Close
                </button>
              </div>
              <p style={{ color: "#94a3b8", marginTop: 0, lineHeight: 1.55, fontSize: 14 }}>
                <strong>Schedule</strong> (days, time, timezone, 24h vs 7-day window) is saved for the{" "}
                <strong>whole company</strong>. The <strong>Send digest…</strong> checkbox is per user. Delivery uses a{" "}
                <strong>short window after send time</strong> (default ~10 minutes; server env can widen it)—typically{" "}
                <strong>one successful email per local day</strong> per person. Saving here again bumps the schedule so an
                extra send the same day is allowed if you are still inside that window. The email includes{" "}
                <strong>cash</strong> and <strong>check</strong> logs for the chosen rolling window. For the old
                “anytime after send time until midnight” behavior, set API{" "}
                <code style={{ fontSize: 12 }}>CASH_LOG_EOD_SEND_WINDOW_MODE=eod_local_day</code>.
              </p>
              {cashEodError ? (
                <div
                  style={{
                    ...messageStyle,
                    marginBottom: 12,
                    background: "rgba(127, 29, 29, 0.58)",
                    border: "1px solid rgba(248, 113, 113, 0.5)",
                    color: "#fecaca",
                  }}
                >
                  {cashEodError}
                </div>
              ) : null}
              {cashEodLoading ? (
                <p style={{ color: "#94a3b8" }}>Loading…</p>
              ) : (
                <>
                  <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={cashEodPrefs.enabled}
                      onChange={(e) => setCashEodPrefs((p) => ({ ...p, enabled: e.target.checked }))}
                    />
                    <span>Send digest emails when the schedule matches</span>
                  </label>
                  <div style={{ marginTop: 16, marginBottom: 8, fontWeight: 800, color: "#e2e8f0" }}>Days (local)</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {CASH_EOD_WEEKDAY_LABELS.map((label, day) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => toggleCashEodWeekday(day)}
                        style={{
                          ...smallButtonStyle,
                          background: cashEodPrefs.weekdays.includes(day)
                            ? "rgba(34, 197, 94, 0.35)"
                            : "rgba(51, 65, 85, 0.55)",
                          border: cashEodPrefs.weekdays.includes(day)
                            ? "1px solid rgba(34, 197, 94, 0.55)"
                            : "1px solid rgba(148, 163, 184, 0.25)",
                          color: cashEodPrefs.weekdays.includes(day) ? "#bbf7d0" : "#cbd5e1",
                          cursor: "pointer",
                          minWidth: 44,
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                      gap: 14,
                      marginTop: 16,
                    }}
                  >
                    <label style={{ ...labelStyle, marginBottom: 0 }}>
                      Send time (local)
                      <input
                        type="time"
                        value={cashEodPrefs.sendTime}
                        onChange={(e) => setCashEodPrefs((p) => ({ ...p, sendTime: e.target.value }))}
                        style={{ ...inputStyle }}
                      />
                    </label>
                    <label style={{ ...labelStyle, marginBottom: 0 }}>
                      Timezone
                      <select
                        value={cashEodPrefs.timezone}
                        onChange={(e) => setCashEodPrefs((p) => ({ ...p, timezone: e.target.value }))}
                        style={{ ...inputStyle }}
                      >
                        {CASH_EOD_TIMEZONE_OPTIONS.map((tz) => (
                          <option key={tz} value={tz}>
                            {tz}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label style={{ ...labelStyle, marginBottom: 0 }}>
                      Window
                      <select
                        value={cashEodPrefs.window}
                        onChange={(e) =>
                          setCashEodPrefs((p) => ({
                            ...p,
                            window: e.target.value as CashLogEodPrefsDto["window"],
                          }))
                        }
                        style={{ ...inputStyle }}
                      >
                        <option value="LAST_24H">Last 24 hours (rolling)</option>
                        <option value="LAST_7_DAYS">Last 7 days (rolling)</option>
                      </select>
                    </label>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 22 }}>
                    <button
                      type="button"
                      disabled={cashEodSaving}
                      onClick={() => void saveCashEodSettings()}
                      style={{
                        ...smallButtonStyle,
                        background: cashEodSaving ? "rgba(71, 85, 105, 0.5)" : "#22c55e",
                        border: "1px solid rgba(34, 197, 94, 0.7)",
                        color: "white",
                        cursor: cashEodSaving ? "wait" : "pointer",
                      }}
                    >
                      {cashEodSaving ? "Saving…" : "Save schedule"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : null}

        {checkBeingEdited ? (
          <div style={{ ...modalOverlayStyle, zIndex: 1150 }}>
            <div
              style={{
                ...modalStyle,
                maxWidth: 520,
                width: "100%",
                maxHeight: "92vh",
                overflowY: "auto",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 12,
                  flexWrap: "wrap",
                  marginBottom: 12,
                }}
              >
                <h2 style={{ ...sectionTitleStyle, marginBottom: 0 }}>Edit check</h2>
                <button type="button" onClick={() => setCheckBeingEdited(null)} style={{ ...modalButtonStyle }}>
                  Close
                </button>
              </div>
              <p style={{ color: "#94a3b8", marginTop: 0, lineHeight: 1.5, fontSize: 13 }}>
                Change payee or amounts below. Optionally choose a new{" "}
                <strong style={{ color: "#e2e8f0" }}>check front</strong> image to replace the stored file — the previous
                image is deleted from storage when you save. Same for stub.
              </p>
              {editCheckError ? (
                <div style={{ ...messageStyle, background: "rgba(127, 29, 29, 0.58)", color: "#fecaca", marginBottom: 12 }}>
                  {editCheckError}
                </div>
              ) : null}
              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }}>
                  <a
                    href={checkBeingEdited.imageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "#38bdf8", fontWeight: 800, fontSize: 13 }}
                  >
                    Current check image
                  </a>
                  {checkBeingEdited.stubImageUrl ? (
                    <a
                      href={checkBeingEdited.stubImageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "#a78bfa", fontWeight: 800, fontSize: 13 }}
                    >
                      Current stub
                    </a>
                  ) : (
                    <span style={{ color: "#64748b", fontSize: 13 }}>No stub on file</span>
                  )}
                </div>
                <label style={{ ...labelStyle, marginBottom: 0 }}>
                  Payee / payee name
                  <input value={editCheckPayee} onChange={(e) => setEditCheckPayee(e.target.value)} style={{ ...inputStyle }} />
                </label>
                <label style={{ ...labelStyle, marginBottom: 0 }}>
                  Total
                  <input
                    value={editCheckTotal}
                    onChange={(e) => setEditCheckTotal(e.target.value)}
                    inputMode="decimal"
                    style={{ ...inputStyle }}
                  />
                </label>
                <label style={{ ...labelStyle, marginBottom: 0, gridColumn: "1 / -1" }}>
                  Invoice # (optional — multiple allowed, matches order # or last 4 digits)
                  <textarea
                    value={editCheckInvoice}
                    onChange={(e) => setEditCheckInvoice(e.target.value)}
                    rows={3}
                    style={{ ...inputStyle, resize: "vertical", minHeight: 72, fontFamily: "inherit" }}
                  />
                </label>
                <label style={{ ...labelStyle, marginBottom: 0 }}>
                  Check date (optional)
                  <input
                    type="date"
                    value={editCheckWrittenDate}
                    onChange={(e) => setEditCheckWrittenDate(e.target.value)}
                    style={{ ...inputStyle }}
                  />
                </label>
                <label style={{ ...labelStyle, marginBottom: 0 }}>
                  Replace check photo (optional)
                  <input
                    key={`ec-front-${editCheckFieldKey}`}
                    ref={editCheckFrontInputRef}
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/webp"
                    capture="environment"
                    style={{ ...inputStyle, padding: "8px 10px" }}
                  />
                </label>
                <label style={{ ...labelStyle, marginBottom: 0, opacity: editCheckRemoveStub ? 0.55 : 1 }}>
                  Replace stub photo (optional)
                  <input
                    key={`ec-stub-${editCheckFieldKey}`}
                    ref={editCheckStubInputRef}
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/webp"
                    capture="environment"
                    disabled={editCheckRemoveStub}
                    style={{ ...inputStyle, padding: "8px 10px" }}
                  />
                </label>
                <label style={{ ...labelStyle, marginBottom: 0, cursor: "pointer", alignItems: "center", display: "flex", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={editCheckRemoveStub}
                    disabled={editCheckSaving}
                    onChange={(e) => {
                      setEditCheckRemoveStub(e.target.checked);
                      if (e.target.checked && editCheckStubInputRef.current) editCheckStubInputRef.current.value = "";
                    }}
                  />
                  Remove stub image from record
                </label>
                <div
                  style={{
                    marginTop: 6,
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid rgba(56, 189, 248, 0.35)",
                    background: "rgba(8, 47, 73, 0.35)",
                  }}
                >
                  <div style={{ fontSize: 12, color: "#bae6fd", marginBottom: 8, fontWeight: 800 }}>
                    LeafLink invoice/payment sync
                  </div>
                  <div style={{ fontSize: 12, color: "#cbd5e1", marginBottom: 8 }}>
                    Status: <strong>{checkBeingEdited.paymentSyncStatus || "not_matched"}</strong>
                    {checkBeingEdited.leaflinkOrderNumber ? ` | Order: ${checkBeingEdited.leaflinkOrderNumber}` : ""}
                    {checkBeingEdited.leaflinkPaymentId ? ` | Payment: ${checkBeingEdited.leaflinkPaymentId}` : ""}
                  </div>
                  {leafLinkMatchError ? (
                    <div style={{ color: "#fecaca", fontSize: 12, marginBottom: 8 }}>{leafLinkMatchError}</div>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void findLeafLinkInvoiceForCheck()}
                    disabled={leafLinkMatchLoading || editCheckSaving}
                    style={{
                      ...smallButtonStyle,
                      background: leafLinkMatchLoading ? "rgba(71, 85, 105, 0.5)" : "rgba(14, 116, 144, 0.45)",
                      border: "1px solid rgba(34, 211, 238, 0.5)",
                      color: "#cffafe",
                      cursor: leafLinkMatchLoading ? "wait" : "pointer",
                    }}
                  >
                    {leafLinkMatchLoading ? "Searching…" : "Find LeafLink Invoice"}
                  </button>
                </div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 18 }}>
                <button
                  type="button"
                  disabled={editCheckSaving}
                  onClick={() => void saveCheckEdit()}
                  style={{
                    ...smallButtonStyle,
                    background: editCheckSaving ? "rgba(71, 85, 105, 0.5)" : "#059669",
                    border: "1px solid rgba(34, 197, 94, 0.7)",
                    color: "#fff",
                    cursor: editCheckSaving ? "wait" : "pointer",
                  }}
                >
                  {editCheckSaving ? "Saving…" : "Save changes"}
                </button>
                <button type="button" disabled={editCheckSaving} onClick={() => setCheckBeingEdited(null)} style={modalButtonStyle}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {leafLinkMatchModalOpen && checkBeingEdited ? (
          <div style={{ ...modalOverlayStyle, zIndex: 1180 }}>
            <div style={{ ...modalStyle, maxWidth: 760, width: "100%", maxHeight: "92vh", overflowY: "auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 12 }}>
                <h2 style={{ ...sectionTitleStyle, marginBottom: 0 }}>Confirm LeafLink invoice match</h2>
                <button type="button" onClick={() => setLeafLinkMatchModalOpen(false)} style={{ ...modalButtonStyle }}>
                  Close
                </button>
              </div>
              <p style={{ color: "#94a3b8", marginTop: 0, marginBottom: 12, lineHeight: 1.5, fontSize: 13 }}>
                Select the invoice/order to mark paid. This action updates LeafLink and does not run automatically.
              </p>
              {leafLinkMatchChoices.map((m) => (
                <label
                  key={`${m.orderNumber}-${m.leafLinkKey}`}
                  style={{
                    display: "block",
                    border: "1px solid rgba(148,163,184,0.25)",
                    borderRadius: 10,
                    padding: 10,
                    marginBottom: 10,
                    background:
                      leafLinkSelectedOrderNumber === m.orderNumber ? "rgba(30, 64, 175, 0.35)" : "rgba(15,23,42,0.45)",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <input
                      type="radio"
                      checked={leafLinkSelectedOrderNumber === m.orderNumber}
                      onChange={() => setLeafLinkSelectedOrderNumber(m.orderNumber)}
                    />
                    <div style={{ fontSize: 13, color: "#e2e8f0", lineHeight: 1.45 }}>
                      <div><strong>Order:</strong> {m.orderNumber}</div>
                      <div><strong>Customer:</strong> {m.customerName || "—"}</div>
                      <div>
                        <strong>Total:</strong> {String(m.total)} | <strong>Outstanding:</strong>{" "}
                        {m.outstandingBalance == null ? "—" : String(m.outstandingBalance)}
                      </div>
                      <div>
                        <strong>Status:</strong> {m.status || "—"} | <strong>Payment:</strong> {m.paymentStatus || "—"}
                      </div>
                      <div>
                        <strong>Delivery:</strong> {m.deliveryDate ? String(m.deliveryDate).slice(0, 10) : "—"} |{" "}
                        <strong>Matched by:</strong> {m.matchedBy.join(", ")}
                      </div>
                      <div style={{ marginTop: 4, color: "#93c5fd" }}>
                        <strong>Line items:</strong>{" "}
                        {m.lineItems?.length
                          ? m.lineItems.slice(0, 3).map((li) => `${li.productName || li.sku || "item"} x${li.quantity}`).join(" | ")
                          : "—"}
                      </div>
                    </div>
                  </div>
                </label>
              ))}
              {leafLinkMatchError ? <div style={{ color: "#fecaca", marginBottom: 8 }}>{leafLinkMatchError}</div> : null}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                <button
                  type="button"
                  disabled={!leafLinkSelectedOrderNumber || leafLinkPostingPayment}
                  onClick={() => void markLeafLinkInvoicePaidForCheck()}
                  style={{
                    ...smallButtonStyle,
                    background: leafLinkPostingPayment ? "rgba(71, 85, 105, 0.5)" : "rgba(22, 163, 74, 0.55)",
                    border: "1px solid rgba(74, 222, 128, 0.55)",
                    color: "#dcfce7",
                    cursor: leafLinkPostingPayment ? "wait" : "pointer",
                  }}
                >
                  {leafLinkPostingPayment ? "Posting…" : "Mark Paid in LeafLink"}
                </button>
                <button type="button" onClick={() => setLeafLinkMatchModalOpen(false)} style={modalButtonStyle}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {cashBeingEdited ? (
          <div style={{ ...modalOverlayStyle, zIndex: 1160 }}>
            <div
              style={{
                ...modalStyle,
                maxWidth: 520,
                width: "100%",
                maxHeight: "92vh",
                overflowY: "auto",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 12,
                  flexWrap: "wrap",
                  marginBottom: 12,
                }}
              >
                <h2 style={{ ...sectionTitleStyle, marginBottom: 0 }}>
                  Edit cash ({cashBeingEdited.direction === "INCOMING" ? "incoming" : "outgoing"})
                </h2>
                <button type="button" onClick={() => setCashBeingEdited(null)} style={{ ...modalButtonStyle }}>
                  Close
                </button>
              </div>
              <p style={{ color: "#94a3b8", marginTop: 0, lineHeight: 1.5, fontSize: 13 }}>
                Amount and labels update the row. Outgoing rows can swap the receipt photo; the old receipt file is removed
                from storage when you save a replacement.
              </p>
              {editCashError ? (
                <div style={{ ...messageStyle, background: "rgba(127, 29, 29, 0.58)", color: "#fecaca", marginBottom: 12 }}>
                  {editCashError}
                </div>
              ) : null}
              <div style={{ display: "grid", gap: 12 }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>
                  Amount
                  <input
                    value={editCashAmount}
                    onChange={(e) => setEditCashAmount(e.target.value)}
                    inputMode="decimal"
                    style={{ ...inputStyle }}
                  />
                </label>
                {cashBeingEdited.direction === "INCOMING" ? (
                  <>
                    <label style={{ ...labelStyle, marginBottom: 0 }}>
                      Payee company
                      <input value={editCashPayeeCompany} onChange={(e) => setEditCashPayeeCompany(e.target.value)} style={{ ...inputStyle }} />
                    </label>
                    <label style={{ ...labelStyle, marginBottom: 0 }}>
                      Date
                      <input type="date" value={editCashEntryDate} onChange={(e) => setEditCashEntryDate(e.target.value)} style={{ ...inputStyle }} />
                    </label>
                    <label style={{ ...labelStyle, marginBottom: 0, gridColumn: "1 / -1" }}>
                      Invoice # (optional — multiple allowed)
                      <textarea
                        value={editCashInvoiceNumber}
                        onChange={(e) => setEditCashInvoiceNumber(e.target.value)}
                        rows={3}
                        style={{ ...inputStyle, resize: "vertical", minHeight: 72, fontFamily: "inherit" }}
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <label style={{ ...labelStyle, marginBottom: 0 }}>
                      Department
                      <select
                        value={editCashDepartment}
                        onChange={(e) => setEditCashDepartment(e.target.value as CashLogDepartment)}
                        style={{ ...inputStyle }}
                      >
                        <option value="CULTIVATION">Cultivation</option>
                        <option value="EXTRACTION">Extraction</option>
                        <option value="PACKAGING">Packaging</option>
                        <option value="GENERAL">General</option>
                      </select>
                    </label>
                    <label style={{ ...labelStyle, marginBottom: 0 }}>
                      Date (optional)
                      <input type="date" value={editCashEntryDate} onChange={(e) => setEditCashEntryDate(e.target.value)} style={{ ...inputStyle }} />
                    </label>
                    <label style={{ ...labelStyle, marginBottom: 0 }}>
                      Memo (optional)
                      <textarea
                        value={editCashMemo}
                        onChange={(e) => setEditCashMemo(e.target.value)}
                        rows={3}
                        style={{ ...inputStyle, resize: "vertical" }}
                      />
                    </label>
                    <div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 8 }}>
                        {cashBeingEdited.receiptImageUrl && !editCashRemoveReceipt ? (
                          <a
                            href={
                              editCashNewReceiptUrl.trim()
                                ? editCashNewReceiptUrl.trim()
                                : cashBeingEdited.receiptImageUrl
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: "#38bdf8", fontWeight: 800, fontSize: 13 }}
                          >
                            {editCashNewReceiptUrl.trim() ? "Preview new receipt (unsaved)" : "Current receipt"}
                          </a>
                        ) : (
                          <span style={{ color: "#64748b", fontSize: 13 }}>
                            {editCashRemoveReceipt ? "Receipt will be cleared on save." : "No receipt on file"}
                          </span>
                        )}
                      </div>
                      <label style={{ ...labelStyle, marginBottom: 0 }}>
                        New receipt photo (optional)
                        <input
                          key={`ec-cr-${editCashFieldKey}`}
                          ref={editCashReceiptInputRef}
                          type="file"
                          accept="image/jpeg,image/jpg,image/png,image/webp"
                          capture="environment"
                          disabled={editCashReceiptUploading || editCashSaving || editCashRemoveReceipt}
                          onChange={(e) => void handleEditCashReceiptFileChange(e)}
                          style={{ ...inputStyle, padding: "8px 10px" }}
                        />
                        {editCashReceiptUploading ? (
                          <div style={{ fontSize: 12, marginTop: 6, color: "#94a3b8" }}>Uploading…</div>
                        ) : null}
                      </label>
                      <label
                        style={{
                          ...labelStyle,
                          marginBottom: 0,
                          marginTop: 8,
                          cursor: "pointer",
                          display: "flex",
                          gap: 8,
                          alignItems: "center",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={editCashRemoveReceipt}
                          disabled={editCashSaving || editCashReceiptUploading}
                          onChange={(e) => {
                            setEditCashRemoveReceipt(e.target.checked);
                            if (e.target.checked) {
                              setEditCashNewReceiptUrl("");
                              if (editCashReceiptInputRef.current) editCashReceiptInputRef.current.value = "";
                              setEditCashFieldKey((k) => k + 1);
                            }
                          }}
                        />
                        Remove receipt from record
                      </label>
                    </div>
                  </>
                )}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 18 }}>
                <button
                  type="button"
                  disabled={editCashSaving || editCashReceiptUploading}
                  onClick={() => void saveCashEdit()}
                  style={{
                    ...smallButtonStyle,
                    background:
                      editCashSaving || editCashReceiptUploading ? "rgba(71, 85, 105, 0.5)" : "#059669",
                    border: "1px solid rgba(34, 197, 94, 0.7)",
                    color: "#fff",
                    cursor: editCashSaving ? "wait" : "pointer",
                  }}
                >
                  {editCashSaving ? "Saving…" : "Save changes"}
                </button>
                <button type="button" disabled={editCashSaving} onClick={() => setCashBeingEdited(null)} style={modalButtonStyle}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}

            </>
          )}
        </div>

        {notificationModal.open &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="admin-confirm-dialog-title"
              style={{
                ...modalOverlayStyle,
                zIndex: 2147483000,
              }}
            >
              <div style={{ ...modalStyle, maxWidth: 560 }}>
                <h2 id="admin-confirm-dialog-title" style={{ marginTop: 0, marginBottom: 10 }}>
                  {notificationModal.title}
                </h2>

                <p style={{ color: "#cbd5e1", marginTop: 0, lineHeight: 1.6 }}>
                  {notificationModal.message}
                </p>

                {notificationModal.details ? (
                  <div
                    style={{
                      background: "#020617",
                      border: "1px solid #334155",
                      borderRadius: 12,
                      padding: 12,
                      marginTop: 12,
                      marginBottom: 18,
                      color: "#cbd5e1",
                    }}
                  >
                    {notificationModal.details}
                  </div>
                ) : null}

                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    justifyContent: "center",
                    flexWrap: "wrap",
                    marginTop: 18,
                  }}
                >
                  {notificationModal.cancelText ? (
                    <button type="button" style={modalButtonStyle} onClick={cancelNotificationModal}>
                      {notificationModal.cancelText}
                    </button>
                  ) : null}

                  <button
                    type="button"
                    style={dangerModalButtonStyle}
                    onClick={confirmNotificationModal}
                  >
                    {notificationModal.confirmText || "Confirm"}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )}

        {leafLinkToast &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              role="status"
              aria-live="polite"
              style={{
                position: "fixed",
                bottom: 28,
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 2147483100,
                padding: "14px 22px",
                borderRadius: 12,
                background: "rgba(6, 78, 59, 0.94)",
                border: "1px solid rgba(52, 211, 153, 0.55)",
                color: "#dcfce7",
                fontWeight: 800,
                fontSize: 15,
                boxShadow: "0 12px 40px rgba(0,0,0,0.38)",
                pointerEvents: "none",
              }}
            >
              {leafLinkToast.message}
            </div>,
            document.body,
          )}

        {editingTargetUser &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="admin-edit-user-title"
              onClick={(e) => {
                if (e.target === e.currentTarget) cancelEditUser();
              }}
              style={{ ...modalOverlayStyle, zIndex: 2147482600 }}
            >
              <div
                style={{ ...modalStyle, maxWidth: 640, width: "100%" }}
                onClick={(e) => e.stopPropagation()}
              >
                <h2
                  id="admin-edit-user-title"
                  style={{ marginTop: 0, marginBottom: 6, fontSize: 22, fontWeight: 950 }}
                >
                  Edit employee
                </h2>
                <p style={{ color: "#94a3b8", marginTop: 0, marginBottom: 18, fontSize: 14, lineHeight: 1.45 }}>
                  <span style={{ color: "#e2e8f0", fontWeight: 800 }}>{editingTargetUser.username}</span>
                  {editingTargetUser.email ? ` · ${editingTargetUser.email}` : ""}
                </p>

                {managerEditingEmployees ? (
                  <div
                    style={{
                      marginBottom: 16,
                      padding: 12,
                      borderRadius: 12,
                      background: "rgba(8, 47, 73, 0.45)",
                      border: "1px solid rgba(56, 189, 248, 0.35)",
                      color: "#bae6fd",
                      fontSize: 13,
                      lineHeight: 1.55,
                    }}
                  >
                    You are signed in as a <strong>Manager</strong>. You may update <strong>page access only</strong>.
                    Username, email, role, and account options are managed by a Company Owner or Company Admin.
                  </div>
                ) : null}

                <div
                  style={{
                    padding: 14,
                    borderRadius: 14,
                    border: isOwnerOrAdminRoleKey(editRole)
                      ? "1px solid rgba(245, 158, 11, 0.45)"
                      : "1px solid rgba(56, 189, 248, 0.28)",
                    background: isOwnerOrAdminRoleKey(editRole)
                      ? "rgba(69, 26, 3, 0.42)"
                      : "rgba(8, 47, 73, 0.45)",
                    textAlign: "left",
                    marginBottom: 16,
                  }}
                >
                  <div
                    style={{
                      color: isOwnerOrAdminRoleKey(editRole) ? "#fde68a" : "#bae6fd",
                      fontWeight: 900,
                      marginBottom: 10,
                      fontSize: 15,
                    }}
                  >
                    Access & permissions
                  </div>
                  {isOwnerOrAdminRoleKey(editRole) ? (
                    <p
                      style={{
                        color: "#fcd34d",
                        fontSize: 13,
                        marginTop: 0,
                        marginBottom: 12,
                        lineHeight: 1.55,
                      }}
                    >
                      <b>Owner</b> and <b>Company Admin</b> always have full production access. These checkboxes are
                      read-only. To limit pages or delete rights, change the role to <b>Operations Manager</b>, a{" "}
                      <b>specialist</b>, or <b>View Only</b>, then save.
                    </p>
                  ) : (
                    <p
                      style={{
                        color: "#94a3b8",
                        fontSize: 13,
                        marginTop: 0,
                        marginBottom: 12,
                        lineHeight: 1.55,
                      }}
                    >
                      {String(editRole || "").trim().toUpperCase() === "OPERATIONS_MANAGER"
                        ? "Operations managers get all floor pages by default. Uncheck any area they should not open, or grant “Delete workflow records” only when needed."
                        : "Choose which areas this employee can open and whether they may delete workflow records."}
                    </p>
                  )}
                  <div style={{ display: "grid", gap: 14, marginBottom: 12 }}>
                    {ADMIN_PERMISSION_SECTIONS.map((section) => (
                      <div key={section.title} style={{ display: "grid", gap: 8 }}>
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 800,
                            letterSpacing: "0.04em",
                            textTransform: "uppercase",
                            color: "#64748b",
                          }}
                        >
                          {section.title}
                        </div>
                        {!isOwnerOrAdminRoleKey(editRole) && section.subtitle ? (
                          <p
                            style={{
                              color: "#64748b",
                              fontSize: 12,
                              margin: 0,
                              lineHeight: 1.5,
                              paddingLeft: 2,
                            }}
                          >
                            {section.subtitle}
                          </p>
                        ) : null}
                        {(section.ids as readonly string[]).map((pid) => {
                          const locked = isOwnerOrAdminRoleKey(editRole);
                          const checked = locked || editAppPermissions.includes(pid);
                          return (
                            <label
                              key={pid}
                              style={{
                                display: "flex",
                                alignItems: "flex-start",
                                gap: 10,
                                cursor: locked ? "not-allowed" : "pointer",
                                color: "#e2e8f0",
                                fontSize: 14,
                                opacity: locked ? 0.92 : 1,
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={locked}
                                onChange={() => toggleEditPermission(pid)}
                                style={{ marginTop: 3 }}
                              />
                              <span>
                                {APP_PERMISSION_LABELS[pid as keyof typeof APP_PERMISSION_LABELS]}
                                {locked ? " (always on)" : ""}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                  {!isOwnerOrAdminRoleKey(editRole) && (
                    <button
                      type="button"
                      onClick={() => setEditAppPermissions(defaultPagePermissionsForRole(editRole))}
                      style={{
                        ...smallButtonStyle,
                        background: "rgba(71, 85, 105, 0.4)",
                        border: "1px solid rgba(148, 163, 184, 0.35)",
                        color: "#cbd5e1",
                      }}
                    >
                      Reset to role defaults
                    </button>
                  )}
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: 12,
                    marginBottom: 12,
                  }}
                >
                  <label style={labelStyle}>
                    Username
                    <input
                      value={editUsername}
                      onChange={(e) => setEditUsername(e.target.value)}
                      disabled={managerEditingEmployees}
                      style={inputStyle}
                    />
                  </label>

                  <label style={labelStyle}>
                    Email Optional
                    <input
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      disabled={managerEditingEmployees}
                      style={inputStyle}
                    />
                  </label>

                  <label style={labelStyle}>
                    Role
                    <select
                      value={editRole}
                      onChange={(e) => {
                        const next = e.target.value;
                        setEditRole(next);
                        const nk = String(next || "").trim().toUpperCase();
                        if (isOwnerOrAdminRoleKey(nk)) setEditAppPermissions(fullAccessPermissionIds());
                        else setEditAppPermissions(defaultPagePermissionsForRole(nk));
                      }}
                      disabled={managerEditingEmployees}
                      style={inputStyle}
                    >
                      {allowedRoleOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label style={labelStyle}>
                    Status
                    <select
                      value={editActive ? "ACTIVE" : "INACTIVE"}
                      onChange={(e) => setEditActive(e.target.value === "ACTIVE")}
                      disabled={managerEditingEmployees}
                      style={inputStyle}
                    >
                      <option value="ACTIVE">Active</option>
                      <option value="INACTIVE">Inactive</option>
                    </select>
                  </label>
                </div>

                {!managerEditingEmployees ? (
                  <>
                    {normalizePlatformRole(editingTargetUser.role) === "OWNER" ? (
                  <div
                    style={{
                      marginBottom: 14,
                      borderRadius: 12,
                      border: "1px solid rgba(148, 163, 184, 0.22)",
                      background: "rgba(2, 6, 23, 0.42)",
                      padding: 12,
                      textAlign: "left",
                      color: "#94a3b8",
                      fontSize: 14,
                      lineHeight: 1.5,
                    }}
                  >
                    <b style={{ color: "#e2e8f0" }}>EOD financial digest emails</b>
                    <br />
                    Not controlled here for the <strong>application owner</strong>. They turn digests on or off under{" "}
                    <strong>Admin → Financial logs</strong> using <strong>Financial digest email (cash & checks)</strong>{" "}
                    (same schedule as the rest of the company; only “receive mail” is per person there).
                  </div>
                ) : (
                  <div
                    style={{
                      marginBottom: 14,
                      borderRadius: 12,
                      border: "1px solid rgba(148, 163, 184, 0.22)",
                      background: "rgba(2, 6, 23, 0.42)",
                      padding: 12,
                      textAlign: "left",
                    }}
                  >
                    <label
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 10,
                        cursor: "pointer",
                        color: "#e2e8f0",
                        fontSize: 14,
                        lineHeight: 1.45,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={editCashLogEodEnabled}
                        onChange={(e) => setEditCashLogEodEnabled(e.target.checked)}
                        style={{ marginTop: 3 }}
                      />
                      <span>
                        <b>Receive EOD financial digest emails</b>
                        <br />
                        <span style={{ color: "#94a3b8" }}>
                          Unchecked by default until saved for this employee.
                        </span>
                      </span>
                    </label>
                  </div>
                )}

                <div
                  style={{
                    marginBottom: 14,
                    borderRadius: 12,
                    border: "1px solid rgba(148, 163, 184, 0.22)",
                    background: "rgba(2, 6, 23, 0.42)",
                    padding: 12,
                    textAlign: "left",
                  }}
                >
                  <label
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      cursor: "pointer",
                      color: "#e2e8f0",
                      fontSize: 14,
                      lineHeight: 1.45,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={editRewardsEnrolled}
                      onChange={(e) => setEditRewardsEnrolled(e.target.checked)}
                      style={{ marginTop: 3 }}
                    />
                    <span>
                      <b>Enrolled in staff rewards program</b>
                      <br />
                      <span style={{ color: "#94a3b8" }}>
                        If unchecked, this user will not see Rewards (managers with access still see the dashboard).
                      </span>
                    </span>
                  </label>
                </div>

                <div
                  style={{
                    marginBottom: 14,
                    borderRadius: 12,
                    border: "1px solid rgba(248, 113, 113, 0.28)",
                    background: "rgba(69, 10, 10, 0.25)",
                    padding: 12,
                    textAlign: "left",
                  }}
                >
                  <label
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      cursor: "pointer",
                      color: "#e2e8f0",
                      fontSize: 14,
                      lineHeight: 1.45,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={editCultivationAlertsEnabled}
                      onChange={(e) => setEditCultivationAlertsEnabled(e.target.checked)}
                      style={{ marginTop: 3 }}
                    />
                    <span>
                      <b>Receive cultivation climate alerts</b>
                      <br />
                      <span style={{ color: "#94a3b8" }}>
                        When Admin configures Autogrow temp/RH thresholds (Company config → Cultivation), subscribed
                        users get inbox notifications if the scheduler job runs. Uncheck to opt out.
                      </span>
                    </span>
                  </label>
                </div>
                  </>
                ) : null}

                <div
                  style={{
                    marginBottom: 18,
                    borderRadius: 14,
                    border: "1px solid rgba(148, 163, 184, 0.22)",
                    background: "rgba(2, 6, 23, 0.42)",
                    padding: 14,
                  }}
                >
                  <div style={{ color: "#e2e8f0", fontWeight: 900, marginBottom: 8 }}>Password recovery</div>
                  <p style={{ color: "#94a3b8", fontSize: 14, lineHeight: 1.45, margin: "0 0 12px" }}>
                    Sends a one-time link to the <strong>saved email</strong> on file for this employee (not unsaved edits
                    in this form).
                  </p>
                  <button
                    type="button"
                    onClick={() => void sendPasswordResetForEditingUser()}
                    disabled={
                      savingUserId === editingTargetUser.id ||
                      sendingResetUserId === editingTargetUser.id ||
                      !canEditTargetUser(currentUser?.role || "", editingTargetUser.role)
                    }
                    style={{
                      ...smallButtonStyle,
                      background: "rgba(56, 189, 248, 0.18)",
                      border: "1px solid rgba(56, 189, 248, 0.45)",
                      color: "#e0f2fe",
                    }}
                  >
                    {sendingResetUserId === editingTargetUser.id ? "Sending…" : "Send password reset email"}
                  </button>
                </div>

                <div
                  style={{
                    background: "rgba(2, 6, 23, 0.72)",
                    border: "1px solid rgba(148, 163, 184, 0.16)",
                    borderRadius: 14,
                    padding: 12,
                    color: "#94a3b8",
                    lineHeight: 1.45,
                    marginBottom: 18,
                  }}
                >
                  {getAllowedRoleOptions(currentUser?.role || "").find((option) => option.value === editRole)
                    ?.description}
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={cancelEditUser}
                    disabled={savingUserId === editingTargetUser.id || sendingResetUserId === editingTargetUser.id}
                    style={{
                      ...smallButtonStyle,
                      background: "rgba(71, 85, 105, 0.32)",
                      border: "1px solid rgba(148, 163, 184, 0.28)",
                      color: "#cbd5e1",
                    }}
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    onClick={() => saveEditedUser(editingTargetUser)}
                    disabled={
                      savingUserId === editingTargetUser.id || sendingResetUserId === editingTargetUser.id
                    }
                    style={{
                      ...smallButtonStyle,
                      background: "#22c55e",
                      border: "1px solid rgba(34, 197, 94, 0.7)",
                      color: "white",
                    }}
                  >
                    {savingUserId === editingTargetUser.id ? "Saving..." : "Save changes"}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )}
      </main>
    </PageAccessGate>
  );
}

const panelStyle: React.CSSProperties = {
  background: "rgba(15, 23, 42, 0.78)",
  border: "1px solid rgba(148, 163, 184, 0.2)",
  borderRadius: 22,
  padding: 18,
  boxShadow: "0 18px 50px rgba(0,0,0,0.28)",
};

const sectionTitleStyle: React.CSSProperties = {
  margin: 0,
  marginBottom: 14,
  fontSize: 22,
  fontWeight: 950,
  letterSpacing: "-0.03em",
};

const smallLabelStyle: React.CSSProperties = {
  color: "#94a3b8",
  fontSize: 13,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  marginBottom: 8,
};

const labelStyle: React.CSSProperties = {
  display: "block",
  color: "#cbd5e1",
  fontWeight: 800,
  fontSize: 14,
  marginBottom: 10,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid rgba(148, 163, 184, 0.3)",
  background: "#020617",
  color: "white",
  borderRadius: 10,
  padding: "9px 12px",
  outline: "none",
  fontSize: 14,
  marginTop: 4,
  minHeight: 42,
  boxSizing: "border-box",
};

const messageStyle: React.CSSProperties = {
  borderRadius: 16,
  padding: 14,
  marginBottom: 18,
  fontWeight: 800,
};

const smallButtonStyle: React.CSSProperties = {
  borderRadius: 10,
  padding: "9px 12px",
  fontWeight: 900,
  fontSize: 13,
};

const checkThStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  color: "#94a3b8",
  fontWeight: 900,
  textTransform: "uppercase",
  fontSize: 11,
  letterSpacing: "0.06em",
};

const checkTdStyle: React.CSSProperties = {
  padding: "10px 12px",
  color: "#e2e8f0",
  verticalAlign: "top",
};

const modalOverlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(2, 6, 23, 0.78)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
  padding: 20,
};

const modalStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 760,
  background: "#0f172a",
  border: "1px solid #334155",
  borderRadius: 18,
  padding: 24,
  boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
  maxHeight: "85vh",
  overflowY: "auto",
};

const modalButtonStyle: React.CSSProperties = {
  background: "#334155",
  color: "white",
  border: "1px solid #475569",
  borderRadius: 10,
  padding: "10px 12px",
  cursor: "pointer",
  fontWeight: 800,
};

const dangerModalButtonStyle: React.CSSProperties = {
  ...modalButtonStyle,
  background: "#7f1d1d",
  border: "1px solid #ef4444",
  color: "#fecaca",
};