"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Nav from "@/components/Nav";
import { CollapsibleConfigSection } from "@/components/admin/CollapsibleConfigSection";
import { LeafLinkConfigCard } from "@/components/admin/LeafLinkConfigCard";
import { MarketplaceLeafLinkSyncCard } from "@/components/admin/MarketplaceLeafLinkSyncCard";
import {
  API_BASE_URL,
  apiRequest,
  appendCompanyIdQuery,
  getSelectedCompanyId,
} from "@/lib/api";
import { getAuthToken } from "@/lib/auth";
import {
  formatCompanyTimestamp,
  formatInCompanyTimezone,
  setCompanyDisplayTimezone,
  syncCompanyTimezoneFromConfigPayload,
} from "@/lib/companyTimezone";
import {
  defaultMetrcCompanyConfig,
  type MetrcCompanyConfig,
  type MetrcLastConnectionStatus,
  resolveMetrcApiBaseUrl,
} from "@/lib/metrcCompanyConfig";
import {
  clampCompanyHeaderLogoMaxHeightPx,
  clampCompanyHeaderLogoMaxWidthPx,
  clampInventoryLogoMaxHeightPx,
  clampInventoryLogoMaxWidthPx,
  resolveCompanyLogoImgSrc,
} from "@/lib/inventoryExport";
import {
  clampMarketplaceBuyerCardLogoMaxHeightPx,
  clampMarketplaceBuyerChipLogoMaxHeightPx,
} from "@/lib/marketplaceBuyerLogoSizing";
import { sortStrainsAlphabetically } from "@/lib/sortStrainsAlphabetically";
import {
  defaultAutogrowCompanyConfig,
  labelForAutogrowComp,
  type AutogrowCompLabel,
  type ClimateControlCompanyConfig,
} from "@/lib/autogrowCompanyConfig";
import {
  defaultCultivationClimateAlerts,
  mergeCultivationClimateAlerts,
  type CultivationClimateAlertsConfig,
} from "@/lib/cultivationClimateAlertsConfig";
import { syncCultivationSectionScheduleTemplates } from "@/lib/sectionCalendarApi";

type Strain = {
  id: string;
  name: string;
  acronym: string;
  dominance: string;
  potency: string;
  averageYield: string;
  /** Auto-computed from cultivation batches (Test Passed + lab THC / dry yield math). */
  autoAvgPotencyPct?: number;
  autoAvgDryYieldGPerSqFt?: number;
  autoMetricsSampleCount?: number;
  autoMetricsUpdatedAt?: string;
};

type Supply = {
  id: string;
  name: string;
  cost: string;
  unit: string;
};

type TableConfig = {
  id: string;
  name: string;
  squareFeet: string;
};

type BayConfig = {
  id: string;
  name: string;
  tables: TableConfig[];
};

/** Same structure for veg and flower — bays contain tables that operators pick during workflow. */
type RoomWithBayLayout = {
  id: string;
  name: string;
  bays: BayConfig[];
};

type VegRoom = RoomWithBayLayout;
type FlowerRoom = RoomWithBayLayout;

type ProductNameRecord = {
  id: string;
  sourceMix: string;
  productName: string;
};

type BlendNameHistoryRecord = {
  id: string;
  blendKey: string;
  blendLabel: string;
  productName: string;
  lastUsedAt: string;
};

type AppConfig = {
  company: {
    metrc: MetrcCompanyConfig;
    climateControl: ClimateControlCompanyConfig;
    settings: {
      companyWideNotes: string;
      /** IANA time zone for every facility-facing timestamp. Empty = browser default. */
      displayTimezone?: string;
      /** Facility-day wall times (24h HH:mm). Subtracts from start→end cultivation labor when overlap applies. */
      laborBreaks?: { id: string; label: string; start: string; end: string }[];
      /** When false, suppresses green realtime “peer completed a task” banners. Default true. */
      liveTaskNotifications?: boolean;
      /** When false, suppresses orange LeafLink “new order” banners. Default true. */
      liveOrderNotifications?: boolean;
      rewards?: {
        enabled: boolean;
        primaryWindowDays: number;
        scoring: {
          fastTaskBonusPoints: number;
          targetMinutesByTask: Record<string, number>;
          potencyThresholdPercent: number;
          potencyBonusPoints: number;
          yieldBonusPoints: number;
        };
        rewardItems: Array<{ id: string; label: string; pointsRequired: number }>;
        taskChallenge: {
          enabled: boolean;
          minSamplesForAverage: number;
          includeAreaInTaskKey: boolean;
          tiers: Array<{ label: string; multiplierVsAvg: number; points: number }>;
          requireManagerApproval: boolean;
          rewardManagerUserIds: string[];
          excludedTaskSubstrings: string[];
          offerChancePercent: number;
        };
      };
    };
  };
  cultivation: {
    strains: Strain[];
    supplies: Supply[];
    rooms: {
      vegRooms: VegRoom[];
      flowerRooms: FlowerRoom[];
    };
    /** Extra tasks merged into Clone / Veg / Flower task lists. */
    customTasks?: Array<{
      id: string;
      label: string;
      rewardsEligible: boolean;
      tierPointsMultiplier: number;
      stages: ("clone" | "veg" | "flower")[];
    }>;
    /** Autogrow zone temp/RH thresholds → inbox alerts (see Admin → Users). */
    climateAlerts?: CultivationClimateAlertsConfig;
    /**
     * Grams per standard Fresh Frozen bundle. When greater than zero, Cultivation harvest auto-fills
     * bundle count from total grams (floor). Operators can still edit bundles manually.
     */
    freshFrozenGramsPerBundle?: number;
    /**
     * Per-stage offsets from batch anchors (clone date, first veg move date, first flower move date)
     * used to populate the cultivation section schedule calendar.
     */
    scheduleTemplates?: Array<{
      id: string;
      stage: "clone" | "veg" | "flower";
      title: string;
      daysFromStageStart: number;
      defaultNotes?: string;
    }>;
  };
  extraction: {
    productNames: ProductNameRecord[];
    blendNameHistory: BlendNameHistoryRecord[];
    supplies: Supply[];
    /** Custom Markdown for AI product naming (advanced). When non-empty, overrides guided fields and server default. */
    productNameAiPromptMarkdown?: string;
    /** Plain-language intro for guided naming (simple); server wraps with fixed rules and JSON output. */
    productNameAiGuidedIntro?: string;
    /** Extra preferences for guided naming (simple). */
    productNameAiGuidedExtraRules?: string;
    customTasks?: Array<{
      id: string;
      label: string;
      rewardsEligible: boolean;
      tierPointsMultiplier: number;
    }>;
  };
  packaging: {
    supplies: Supply[];
    customTasks?: Array<{
      id: string;
      label: string;
      rewardsEligible: boolean;
      tierPointsMultiplier: number;
    }>;
  };
  /** Wholesale / ops contact, LeafLink category display names, and policy text (not sent to LeafLink). */
  sales: {
    primaryContactName: string;
    primaryContactEmail: string;
    primaryContactPhone: string;
    defaultPaymentTerms: string;
    fulfillmentNotes: string;
    wholesalePortalUrl: string;
    /** Map LeafLink category ids (e.g. 5, Category #5) to labels shown in Inventory. */
    leafLinkCategoryLabels: Array<{ id: string; displayName: string }>;
    /** Shown on the printable inventory menu (upload stores file; URL saved with Save Config). */
    inventoryPrintLogoUrl: string;
    /** Max width in pixels for the logo on the print layout (48–720). */
    inventoryPrintLogoMaxWidthPx: number;
    /** Max height on print (48–560); 0 = no height cap (width only). */
    inventoryPrintLogoMaxHeightPx: number;
    /** Navigation bar tenant logo max height (24–160); 0 = default (56 / 64 by page). */
    companyHeaderLogoMaxHeightPx: number;
    /** Navigation bar tenant logo max width (64–720); 0 = auto from height. */
    companyHeaderLogoMaxWidthPx: number;
    /** Buyer marketplace product card seller logo height (40–120); 0 = compact default (wide wordmarks). */
    marketplaceBuyerCardLogoMaxHeightPx: number;
    /** Buyer marketplace “Select company” chip logo height (36–120); 0 = compact default. */
    marketplaceBuyerChipLogoMaxHeightPx: number;
  };
  /** Merchandising notes (internal). */
  products: {
    notes: string;
  };
};

const emptyConfig: AppConfig = {
  company: {
    metrc: { ...defaultMetrcCompanyConfig },
    climateControl: {
      autogrow: { ...defaultAutogrowCompanyConfig },
    },
    settings: {
      companyWideNotes: "",
      displayTimezone: "",
      laborBreaks: [],
      liveTaskNotifications: true,
      liveOrderNotifications: true,
      rewards: {
        enabled: false,
        primaryWindowDays: 30,
        scoring: {
          fastTaskBonusPoints: 5,
          targetMinutesByTask: {},
          potencyThresholdPercent: 20,
          potencyBonusPoints: 15,
          yieldBonusPoints: 10,
        },
        rewardItems: [],
        taskChallenge: {
          enabled: true,
          minSamplesForAverage: 5,
          includeAreaInTaskKey: true,
          tiers: [
            { label: "Fast", multiplierVsAvg: 0.85, points: 30 },
            { label: "On target", multiplierVsAvg: 1, points: 20 },
            { label: "Stretch", multiplierVsAvg: 1.15, points: 10 },
          ],
          requireManagerApproval: false,
          rewardManagerUserIds: [],
          excludedTaskSubstrings: [],
          offerChancePercent: 35,
        },
      },
    },
  },
  cultivation: {
    strains: [],
    supplies: [],
    rooms: {
      vegRooms: [],
      flowerRooms: [],
    },
    customTasks: [],
    climateAlerts: { ...defaultCultivationClimateAlerts },
    freshFrozenGramsPerBundle: 0,
    scheduleTemplates: [],
  },
  extraction: {
    productNames: [],
    blendNameHistory: [],
    supplies: [],
    customTasks: [],
  },
  packaging: {
    supplies: [],
    customTasks: [],
  },
  sales: {
    primaryContactName: "",
    primaryContactEmail: "",
    primaryContactPhone: "",
    defaultPaymentTerms: "",
    fulfillmentNotes: "",
    wholesalePortalUrl: "",
    leafLinkCategoryLabels: [],
    inventoryPrintLogoUrl: "",
    inventoryPrintLogoMaxWidthPx: 160,
    inventoryPrintLogoMaxHeightPx: 0,
    companyHeaderLogoMaxHeightPx: 0,
    companyHeaderLogoMaxWidthPx: 0,
    marketplaceBuyerCardLogoMaxHeightPx: 0,
    marketplaceBuyerChipLogoMaxHeightPx: 0,
  },
  products: {
    notes: "",
  },
};

type LeafLinkCategoryLabelRow = { id: string; displayName: string };

/**
 * Prefer `sales.leafLinkCategoryLabels` when that key exists (including `[]`).
 * Otherwise fall back to legacy `products.categoryLabels`.
 */
function mergeLeafLinkCategoryLabelsFromPayload(data: {
  sales?: { leafLinkCategoryLabels?: unknown; categoryLabels?: unknown };
  products?: { categoryLabels?: unknown };
}): LeafLinkCategoryLabelRow[] {
  const sales = data.sales;
  if (sales && "leafLinkCategoryLabels" in sales && Array.isArray(sales.leafLinkCategoryLabels)) {
    return sales.leafLinkCategoryLabels as LeafLinkCategoryLabelRow[];
  }
  const legacySalesKey = data.sales?.categoryLabels;
  if (Array.isArray(legacySalesKey) && legacySalesKey.length > 0) {
    return legacySalesKey as LeafLinkCategoryLabelRow[];
  }
  const legacyProducts = data.products?.categoryLabels;
  if (Array.isArray(legacyProducts)) {
    return legacyProducts as LeafLinkCategoryLabelRow[];
  }
  return [];
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

type LogoMime = "image/jpeg" | "image/png" | "image/webp";

function normalizeLogoMime(raw: string): LogoMime | null {
  const m = String(raw || "").toLowerCase();
  if (m === "image/jpg" || m === "image/jpeg") return "image/jpeg";
  if (m === "image/png") return "image/png";
  if (m === "image/webp") return "image/webp";
  return null;
}

async function fileToLogoUploadPayload(file: File): Promise<{ mimeType: LogoMime; dataBase64: string }> {
  const mimeType = normalizeLogoMime(file.type);
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

function mergeRewardsSettings(
  incoming: AppConfig["company"]["settings"] | undefined,
): NonNullable<AppConfig["company"]["settings"]["rewards"]> {
  const base = emptyConfig.company.settings.rewards!;
  const inc = incoming?.rewards;
  if (!inc) return { ...base };
  return {
    ...base,
    ...inc,
    scoring: {
      ...base.scoring,
      ...inc.scoring,
      targetMinutesByTask: {
        ...base.scoring.targetMinutesByTask,
        ...(inc.scoring?.targetMinutesByTask || {}),
      },
    },
    rewardItems: Array.isArray(inc.rewardItems) ? inc.rewardItems : base.rewardItems,
    taskChallenge: {
      ...base.taskChallenge,
      ...inc.taskChallenge,
      tiers:
        Array.isArray(inc.taskChallenge?.tiers) && inc.taskChallenge!.tiers.length > 0
          ? inc.taskChallenge!.tiers
          : base.taskChallenge.tiers,
      rewardManagerUserIds: Array.isArray(inc.taskChallenge?.rewardManagerUserIds)
        ? inc.taskChallenge!.rewardManagerUserIds.map((x) => String(x ?? "").trim()).filter(Boolean)
        : base.taskChallenge.rewardManagerUserIds,
      excludedTaskSubstrings: Array.isArray(inc.taskChallenge?.excludedTaskSubstrings)
        ? inc.taskChallenge!.excludedTaskSubstrings.map((x) => String(x ?? "").trim()).filter(Boolean)
        : base.taskChallenge.excludedTaskSubstrings,
      offerChancePercent:
        inc.taskChallenge?.offerChancePercent != null &&
        Number.isFinite(Number(inc.taskChallenge.offerChancePercent))
          ? Math.min(100, Math.max(0, Number(inc.taskChallenge.offerChancePercent)))
          : base.taskChallenge.offerChancePercent,
    },
  };
}

function mergeClimateControl(
  incomingCompany: Partial<{ climateControl?: Partial<ClimateControlCompanyConfig> | null }> | null | undefined,
): ClimateControlCompanyConfig {
  const incRoot = incomingCompany?.climateControl;
  const ag = incRoot?.autogrow;
  return {
    autogrow: {
      ...defaultAutogrowCompanyConfig,
      ...(ag || {}),
      compLabels: Array.isArray(ag?.compLabels)
        ? ag.compLabels.map((r) => ({
            compIndex: Number((r as AutogrowCompLabel).compIndex),
            label: String((r as AutogrowCompLabel).label ?? ""),
          }))
        : [...defaultAutogrowCompanyConfig.compLabels],
      apiKey: String(ag?.apiKey ?? defaultAutogrowCompanyConfig.apiKey),
      deviceUuid: String(ag?.deviceUuid ?? defaultAutogrowCompanyConfig.deviceUuid),
      integrationEnabled: Boolean(ag?.integrationEnabled ?? false),
      notes: String(ag?.notes ?? defaultAutogrowCompanyConfig.notes),
    },
  };
}

function normalizeRoomsLayout(raw: unknown): RoomWithBayLayout[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const obj = entry as Record<string, unknown>;
    let id = String(obj.id ?? "").trim();
    if (!id) id = makeId("room");
    const name = String(obj.name ?? "").trim();
    const baysRaw = Array.isArray(obj.bays) ? obj.bays : [];
    const bays = baysRaw.map((bEnt) => {
      const b = bEnt as Record<string, unknown>;
      let bayId = String(b.id ?? "").trim();
      if (!bayId) bayId = makeId("bay");
      const bayName = String(b.name ?? "").trim();
      const tablesRaw = Array.isArray(b.tables) ? b.tables : [];
      const tables = tablesRaw.map((tEnt) => {
        const t = tEnt as Record<string, unknown>;
        let tid = String(t.id ?? "").trim();
        if (!tid) tid = makeId("table");
        return {
          id: tid,
          name: String(t.name ?? "").trim(),
          squareFeet: String(t.squareFeet ?? ""),
        };
      });
      return { id: bayId, name: bayName, tables };
    });
    return { id, name, bays };
  });
}

type CultivationFieldModalState =
  | { kind: "closed" }
  | { kind: "addBay"; suite: "vegRooms" | "flowerRooms"; roomId: string }
  | { kind: "addTable"; suite: "vegRooms" | "flowerRooms"; roomId: string; bayId: string }
  | { kind: "editTable"; suite: "vegRooms" | "flowerRooms"; roomId: string; bayId: string; tableId: string };

type MetrcTestConnectionJson =
  | {
      ok: true;
      connected: true;
      checkedAt: string;
      baseUrl: string;
      licenseNumber: string;
      locationCount: number;
      authMode: string;
      sampleLocations?: { id?: unknown; name?: string; label?: string }[];
    }
  | {
      ok: false;
      connected: false;
      checkedAt: string;
      status: number;
      message: string;
      baseUrl: string | null;
      licenseNumber: string;
      attemptedModes?: string[];
      failures?: Array<{
        mode: string;
        status: number;
        durationMs: number;
        metrcSnippet?: string | null;
      }>;
    };

const METRC_AUTH_MODE_LABELS: Record<string, string> = {
  dual_key_basic: "Dual-key Basic (vendor : user)",
  bearer_user: "Bearer (user API key)",
  basic_user_colon: "Basic — username=user key, password empty",
  basic_colon_user: "Basic — empty vendor, user key as password",
};

function formatMetrcAuthModeLabel(mode: string | undefined | null): string {
  const k = String(mode || "").trim();
  return METRC_AUTH_MODE_LABELS[k] || k || "—";
}

function userFacingMetrcTestFailureMessage(json: Extract<MetrcTestConnectionJson, { ok: false }>): string {
  const fromApi = String(json.message || "").trim();
  if (fromApi) return fromApi.slice(0, 4000);
  const s = Number(json.status);
  if (s === 401) return "Authentication failed. Check METRC keys.";
  if (s === 403) return "Permission denied. Check METRC user permissions and license access.";
  if (s === 400) return "Bad request. Check license number, state, and base URL.";
  if (s === 0) return "Unable to reach METRC from the API server.";
  return "METRC connection failed.";
}

function extractionAiNamingStatusLine(extraction: AppConfig["extraction"]): string {
  const md = String(extraction.productNameAiPromptMarkdown || "").trim();
  const intro = String(extraction.productNameAiGuidedIntro || "").trim();
  const extra = String(extraction.productNameAiGuidedExtraRules || "").trim();
  if (md) {
    return "Advanced: custom Markdown prompt (Save Config to persist).";
  }
  if (intro || extra) {
    return "Simple: custom wording on top of built-in naming rules (Save Config to persist).";
  }
  return "Using the built-in server naming prompt.";
}

export default function ConfigPage() {
  const pathname = usePathname();
  const [config, setConfig] = useState<AppConfig>(emptyConfig);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [aiPromptModalOpen, setAiPromptModalOpen] = useState(false);
  const [aiPromptModalTab, setAiPromptModalTab] = useState<"simple" | "advanced">("simple");
  const [aiPromptDraft, setAiPromptDraft] = useState("");
  const [aiGuidedIntroDraft, setAiGuidedIntroDraft] = useState("");
  const [aiGuidedExtraDraft, setAiGuidedExtraDraft] = useState("");
  const [aiPromptShippedDefault, setAiPromptShippedDefault] = useState("");
  const [aiPromptModalLoading, setAiPromptModalLoading] = useState(false);
  const [aiPromptModalError, setAiPromptModalError] = useState("");

  const [cultivationFieldModal, setCultivationFieldModal] = useState<CultivationFieldModalState>({
    kind: "closed",
  });
  const [fieldModalBayName, setFieldModalBayName] = useState("");
  const [fieldModalTableName, setFieldModalTableName] = useState("");
  const [fieldModalSquareFeet, setFieldModalSquareFeet] = useState("");
  const [fieldModalError, setFieldModalError] = useState("");
  const [saveSuccessModalOpen, setSaveSuccessModalOpen] = useState(false);
  const [timeZoneModalOpen, setTimeZoneModalOpen] = useState(false);
  const [displayTimezoneDraft, setDisplayTimezoneDraft] = useState("");
  const [timeZoneFilter, setTimeZoneFilter] = useState("");
  const [showMetrcSecrets, setShowMetrcSecrets] = useState(false);
  const [showAutogrowSecrets, setShowAutogrowSecrets] = useState(false);
  const [metrcConnectionTesting, setMetrcConnectionTesting] = useState(false);
  /** Last connection-test diagnostics (from API; keys never included). */
  const [metrcTestDiagnostics, setMetrcTestDiagnostics] = useState<{
    authMode?: string;
    attemptedModes?: string[];
    failures?: Array<{
      mode: string;
      status: number;
      durationMs: number;
      metrcSnippet?: string | null;
    }>;
  } | null>(null);
  const [companyLogoUploading, setCompanyLogoUploading] = useState(false);
  const companyLogoFileRef = useRef<HTMLInputElement | null>(null);

  const ianaTimeZones = useMemo(() => {
    if (typeof Intl !== "undefined" && typeof (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf === "function") {
      try {
        return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone");
      } catch {
        /* fall through */
      }
    }
    return [
      "UTC",
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles",
      "America/Phoenix",
      "America/Anchorage",
      "Pacific/Honolulu",
    ];
  }, []);

  const filteredTimeZones = useMemo(() => {
    const q = timeZoneFilter.trim().toLowerCase();
    if (!q) return ianaTimeZones;
    return ianaTimeZones.filter((z) => z.toLowerCase().includes(q));
  }, [ianaTimeZones, timeZoneFilter]);

  const cultivationStrainsAlphabetical = useMemo(
    () => sortStrainsAlphabetically(config.cultivation.strains),
    [config.cultivation.strains],
  );

  const metrcResolvedBaseUrl = useMemo(
    () => resolveMetrcApiBaseUrl(config.company.metrc),
    [config.company.metrc],
  );

  const metrcConnectionBadge = useMemo(() => {
    if (metrcConnectionTesting) {
      return { label: "Testing…", tone: "testing" as const };
    }
    const st = String(config.company.metrc.metrcLastConnectionStatus || "").trim() as MetrcLastConnectionStatus | "";
    if (st === "connected") return { label: "Connected", tone: "connected" as const };
    if (st === "not_connected") return { label: "Not connected", tone: "error" as const };
    return { label: "Not tested", tone: "muted" as const };
  }, [metrcConnectionTesting, config.company.metrc.metrcLastConnectionStatus]);

  const defaultStrainForm = {
    name: "",
    acronym: "",
    dominance: "Hybrid",
    potency: "Medium",
    averageYield: "Medium",
  };

  const [strainForm, setStrainForm] = useState(defaultStrainForm);

  /** When set, Add strain becomes Update strain for this id. */
  const [editingStrainId, setEditingStrainId] = useState<string | null>(null);

  const [cultivationSupplyForm, setCultivationSupplyForm] = useState({
    name: "",
    cost: "",
    unit: "",
  });

  const [extractionSupplyForm, setExtractionSupplyForm] = useState({
    name: "",
    cost: "",
    unit: "",
  });

  const [packagingSupplyForm, setPackagingSupplyForm] = useState({
    name: "",
    cost: "",
    unit: "",
  });

  const [vegRoomName, setVegRoomName] = useState("");
  const [flowerRoomName, setFlowerRoomName] = useState("");
  /** Quick-add flower room: number of bays and tables per bay (generated names A,B,… and table 1,2,…). */
  const [flowerQuickBayCount, setFlowerQuickBayCount] = useState("3");
  const [flowerQuickTablesPerBay, setFlowerQuickTablesPerBay] = useState("5");
  const [vegQuickBayCount, setVegQuickBayCount] = useState("3");
  const [vegQuickTablesPerBay, setVegQuickTablesPerBay] = useState("5");
  const [productNameForm, setProductNameForm] = useState({
    sourceMix: "",
    productName: "",
  });

  async function loadConfig() {
    setLoading(true);

    try {
      const token = getAuthToken();
      const companyId = getSelectedCompanyId().trim();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
      };
      if (companyId) {
        headers["X-Company-Id"] = companyId;
      }
      const path = appendCompanyIdQuery("/api/config", companyId);
      const res = await fetch(`${API_BASE_URL}${path}`, {
        headers,
      });

      if (!res.ok) {
        throw new Error("Could not load config");
      }

      const raw = await res.json();
      const { rows: _rows, ...data } = raw as AppConfig & { rows?: unknown };
      setConfig({
        ...emptyConfig,
        ...data,
        company: {
          ...emptyConfig.company,
          ...(data.company || {}),
          metrc: {
            ...defaultMetrcCompanyConfig,
            ...(data.company?.metrc || {}),
          },
          climateControl: mergeClimateControl(data.company),
          settings: {
            ...emptyConfig.company.settings,
            ...(data.company?.settings || {}),
            rewards: mergeRewardsSettings(data.company?.settings),
          },
        },
        cultivation: {
          ...emptyConfig.cultivation,
          ...(data.cultivation || {}),
          climateAlerts: mergeCultivationClimateAlerts(
            (data.cultivation as { climateAlerts?: unknown } | undefined)?.climateAlerts,
          ),
          customTasks: Array.isArray((data.cultivation as { customTasks?: unknown } | undefined)?.customTasks)
            ? ((data.cultivation as { customTasks: NonNullable<AppConfig["cultivation"]["customTasks"]> }).customTasks)
            : [],
          scheduleTemplates: Array.isArray(
            (data.cultivation as { scheduleTemplates?: unknown } | undefined)?.scheduleTemplates,
          )
            ? (
                data.cultivation as {
                  scheduleTemplates: NonNullable<AppConfig["cultivation"]["scheduleTemplates"]>;
                }
              ).scheduleTemplates
            : [],
          rooms: {
            ...emptyConfig.cultivation.rooms,
            ...(data.cultivation?.rooms || {}),
            vegRooms: normalizeRoomsLayout((data.cultivation?.rooms as { vegRooms?: unknown } | undefined)?.vegRooms),
            flowerRooms: normalizeRoomsLayout((data.cultivation?.rooms as { flowerRooms?: unknown } | undefined)?.flowerRooms),
          },
        },
        extraction: {
          ...emptyConfig.extraction,
          ...(data.extraction || {}),
          customTasks: Array.isArray((data.extraction as { customTasks?: unknown } | undefined)?.customTasks)
            ? ((data.extraction as { customTasks: NonNullable<AppConfig["extraction"]["customTasks"]> }).customTasks)
            : [],
        },
        packaging: {
          ...emptyConfig.packaging,
          ...(data.packaging || {}),
          customTasks: Array.isArray((data.packaging as { customTasks?: unknown } | undefined)?.customTasks)
            ? ((data.packaging as { customTasks: NonNullable<AppConfig["packaging"]["customTasks"]> }).customTasks)
            : [],
        },
        sales: {
          ...emptyConfig.sales,
          ...(data.sales || {}),
          inventoryPrintLogoMaxWidthPx: clampInventoryLogoMaxWidthPx(
            (data.sales as { inventoryPrintLogoMaxWidthPx?: unknown } | undefined)?.inventoryPrintLogoMaxWidthPx,
          ),
          inventoryPrintLogoMaxHeightPx: clampInventoryLogoMaxHeightPx(
            (data.sales as { inventoryPrintLogoMaxHeightPx?: unknown } | undefined)?.inventoryPrintLogoMaxHeightPx,
          ),
          companyHeaderLogoMaxHeightPx: clampCompanyHeaderLogoMaxHeightPx(
            (data.sales as { companyHeaderLogoMaxHeightPx?: unknown } | undefined)?.companyHeaderLogoMaxHeightPx,
          ),
          companyHeaderLogoMaxWidthPx: clampCompanyHeaderLogoMaxWidthPx(
            (data.sales as { companyHeaderLogoMaxWidthPx?: unknown } | undefined)?.companyHeaderLogoMaxWidthPx,
          ),
          marketplaceBuyerCardLogoMaxHeightPx: clampMarketplaceBuyerCardLogoMaxHeightPx(
            (data.sales as { marketplaceBuyerCardLogoMaxHeightPx?: unknown } | undefined)
              ?.marketplaceBuyerCardLogoMaxHeightPx,
          ),
          marketplaceBuyerChipLogoMaxHeightPx: clampMarketplaceBuyerChipLogoMaxHeightPx(
            (data.sales as { marketplaceBuyerChipLogoMaxHeightPx?: unknown } | undefined)
              ?.marketplaceBuyerChipLogoMaxHeightPx,
          ),
          leafLinkCategoryLabels: mergeLeafLinkCategoryLabelsFromPayload({
            sales: data.sales,
            products: data.products as { categoryLabels?: unknown; notes?: string },
          }),
        },
        products: {
          notes: String((data.products as { notes?: string } | undefined)?.notes || ""),
        },
      });
      syncCompanyTimezoneFromConfigPayload(raw);
    } catch (error) {
      console.error(error);
      alert("Could not load config. Make sure you are logged in as admin.");
    } finally {
      setLoading(false);
    }
  }

  async function uploadInventoryPrintLogo(file: File) {
    setCompanyLogoUploading(true);
    try {
      const { mimeType, dataBase64 } = await fileToLogoUploadPayload(file);
      const token = getAuthToken();
      const companyId = getSelectedCompanyId().trim();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      };
      if (companyId) {
        headers["X-Company-Id"] = companyId;
      }
      const path = appendCompanyIdQuery("/api/config/upload-company-logo", companyId);
      const res = await fetch(`${API_BASE_URL}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ mimeType, dataBase64 }),
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(text.slice(0, 500) || "Upload failed");
      }
      const json = JSON.parse(text) as { imageUrl?: string };
      if (!json.imageUrl) {
        throw new Error("No image URL returned");
      }
      setConfig((prev) => ({
        ...prev,
        sales: { ...prev.sales, inventoryPrintLogoUrl: json.imageUrl! },
      }));
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Could not upload logo");
    } finally {
      setCompanyLogoUploading(false);
    }
  }

  async function saveConfig() {
    setSaving(true);

    try {
      const token = getAuthToken();
      const companyId = getSelectedCompanyId().trim();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      };
      if (companyId) {
        headers["X-Company-Id"] = companyId;
      }
      const path = appendCompanyIdQuery("/api/config", companyId);
      const payload = {
        ...config,
        sales: {
          ...config.sales,
          inventoryPrintLogoMaxWidthPx: clampInventoryLogoMaxWidthPx(config.sales.inventoryPrintLogoMaxWidthPx),
          inventoryPrintLogoMaxHeightPx: clampInventoryLogoMaxHeightPx(config.sales.inventoryPrintLogoMaxHeightPx),
          companyHeaderLogoMaxHeightPx: clampCompanyHeaderLogoMaxHeightPx(
            config.sales.companyHeaderLogoMaxHeightPx,
          ),
          companyHeaderLogoMaxWidthPx: clampCompanyHeaderLogoMaxWidthPx(config.sales.companyHeaderLogoMaxWidthPx),
          marketplaceBuyerCardLogoMaxHeightPx: clampMarketplaceBuyerCardLogoMaxHeightPx(
            config.sales.marketplaceBuyerCardLogoMaxHeightPx,
          ),
          marketplaceBuyerChipLogoMaxHeightPx: clampMarketplaceBuyerChipLogoMaxHeightPx(
            config.sales.marketplaceBuyerChipLogoMaxHeightPx,
          ),
        },
      };
      const res = await fetch(`${API_BASE_URL}${path}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error("Could not save config");
      }

      const data = await res.json();
      setConfig({
        ...emptyConfig,
        ...data,
        company: {
          ...emptyConfig.company,
          ...(data.company || {}),
          metrc: {
            ...defaultMetrcCompanyConfig,
            ...(data.company?.metrc || {}),
          },
          climateControl: mergeClimateControl(data.company),
          settings: {
            ...emptyConfig.company.settings,
            ...(data.company?.settings || {}),
            rewards: mergeRewardsSettings(data.company?.settings),
          },
        },
        cultivation: {
          ...emptyConfig.cultivation,
          ...(data.cultivation || {}),
          climateAlerts: mergeCultivationClimateAlerts(
            (data.cultivation as { climateAlerts?: unknown } | undefined)?.climateAlerts,
          ),
          customTasks: Array.isArray((data.cultivation as { customTasks?: unknown } | undefined)?.customTasks)
            ? ((data.cultivation as { customTasks: NonNullable<AppConfig["cultivation"]["customTasks"]> }).customTasks)
            : [],
          scheduleTemplates: Array.isArray(
            (data.cultivation as { scheduleTemplates?: unknown } | undefined)?.scheduleTemplates,
          )
            ? (
                data.cultivation as {
                  scheduleTemplates: NonNullable<AppConfig["cultivation"]["scheduleTemplates"]>;
                }
              ).scheduleTemplates
            : [],
          rooms: {
            ...emptyConfig.cultivation.rooms,
            ...(data.cultivation?.rooms || {}),
            vegRooms: normalizeRoomsLayout((data.cultivation?.rooms as { vegRooms?: unknown } | undefined)?.vegRooms),
            flowerRooms: normalizeRoomsLayout(
              (data.cultivation?.rooms as { flowerRooms?: unknown } | undefined)?.flowerRooms,
            ),
          },
        },
        extraction: {
          ...emptyConfig.extraction,
          ...(data.extraction || {}),
          customTasks: Array.isArray((data.extraction as { customTasks?: unknown } | undefined)?.customTasks)
            ? ((data.extraction as { customTasks: NonNullable<AppConfig["extraction"]["customTasks"]> }).customTasks)
            : [],
        },
        packaging: {
          ...emptyConfig.packaging,
          ...(data.packaging || {}),
          customTasks: Array.isArray((data.packaging as { customTasks?: unknown } | undefined)?.customTasks)
            ? ((data.packaging as { customTasks: NonNullable<AppConfig["packaging"]["customTasks"]> }).customTasks)
            : [],
        },
        sales: {
          ...emptyConfig.sales,
          ...(data.sales || {}),
          inventoryPrintLogoMaxWidthPx: clampInventoryLogoMaxWidthPx(
            (data.sales as { inventoryPrintLogoMaxWidthPx?: unknown } | undefined)?.inventoryPrintLogoMaxWidthPx,
          ),
          inventoryPrintLogoMaxHeightPx: clampInventoryLogoMaxHeightPx(
            (data.sales as { inventoryPrintLogoMaxHeightPx?: unknown } | undefined)?.inventoryPrintLogoMaxHeightPx,
          ),
          companyHeaderLogoMaxHeightPx: clampCompanyHeaderLogoMaxHeightPx(
            (data.sales as { companyHeaderLogoMaxHeightPx?: unknown } | undefined)?.companyHeaderLogoMaxHeightPx,
          ),
          companyHeaderLogoMaxWidthPx: clampCompanyHeaderLogoMaxWidthPx(
            (data.sales as { companyHeaderLogoMaxWidthPx?: unknown } | undefined)?.companyHeaderLogoMaxWidthPx,
          ),
          marketplaceBuyerCardLogoMaxHeightPx: clampMarketplaceBuyerCardLogoMaxHeightPx(
            (data.sales as { marketplaceBuyerCardLogoMaxHeightPx?: unknown } | undefined)
              ?.marketplaceBuyerCardLogoMaxHeightPx,
          ),
          marketplaceBuyerChipLogoMaxHeightPx: clampMarketplaceBuyerChipLogoMaxHeightPx(
            (data.sales as { marketplaceBuyerChipLogoMaxHeightPx?: unknown } | undefined)
              ?.marketplaceBuyerChipLogoMaxHeightPx,
          ),
          leafLinkCategoryLabels: mergeLeafLinkCategoryLabelsFromPayload({
            sales: data.sales,
            products: data.products as { categoryLabels?: unknown; notes?: string },
          }),
        },
        products: {
          notes: String((data.products as { notes?: string } | undefined)?.notes || ""),
        },
      });
      syncCompanyTimezoneFromConfigPayload(data);
      setSaveSuccessModalOpen(true);
      void syncCultivationSectionScheduleTemplates().catch((e) => {
        console.error("Cultivation schedule template sync failed:", e);
      });
    } catch (error) {
      console.error(error);
      alert("Could not save config");
    } finally {
      setSaving(false);
    }
  }

  async function runMetrcConnectionTest() {
    setMetrcConnectionTesting(true);
    const checkedAtFallback = new Date().toISOString();
    try {
      const token = getAuthToken();
      const companyId = getSelectedCompanyId().trim();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
      };
      if (companyId) {
        headers["X-Company-Id"] = companyId;
      }
      const path = appendCompanyIdQuery("/api/metrc/test-connection", companyId);
      const res = await fetch(`${API_BASE_URL}${path}`, {
        method: "GET",
        headers,
      });
      const text = await res.text();
      let json: MetrcTestConnectionJson | null = null;
      try {
        json = text ? (JSON.parse(text) as MetrcTestConnectionJson) : null;
      } catch {
        json = null;
      }

      if (!res.ok || !json || typeof json !== "object") {
        setMetrcTestDiagnostics(null);
        setConfig((prev) => ({
          ...prev,
          company: {
            ...prev.company,
            metrc: {
              ...prev.company.metrc,
              metrcLastConnectionStatus: "not_connected",
              metrcLastConnectionCheckedAt: checkedAtFallback,
              metrcLastConnectionMessage: "Unable to reach METRC from the API server.",
              metrcLastConnectionHttpStatus: null,
              metrcLastLocationCount: null,
              metrcLastSuccessfulAuthMode: null,
            },
          },
        }));
        return;
      }

      if (json.ok && json.connected) {
        setMetrcTestDiagnostics({
          authMode: json.authMode,
        });
        setConfig((prev) => ({
          ...prev,
          company: {
            ...prev.company,
            metrc: {
              ...prev.company.metrc,
              metrcLastConnectionStatus: "connected",
              metrcLastConnectionCheckedAt: json.checkedAt,
              metrcLastConnectionMessage: "",
              metrcLastConnectionHttpStatus: null,
              metrcLastLocationCount: json.locationCount,
              metrcLastSuccessfulAuthMode: json.authMode,
            },
          },
        }));
        return;
      }

      if (!json.ok) {
        setMetrcTestDiagnostics({
          attemptedModes: json.attemptedModes,
          failures: json.failures,
        });
        setConfig((prev) => ({
          ...prev,
          company: {
            ...prev.company,
            metrc: {
              ...prev.company.metrc,
              metrcLastConnectionStatus: "not_connected",
              metrcLastConnectionCheckedAt: json.checkedAt,
              metrcLastConnectionMessage: userFacingMetrcTestFailureMessage(json),
              metrcLastConnectionHttpStatus:
                typeof json.status === "number" && Number.isFinite(json.status) ? json.status : null,
              metrcLastLocationCount: null,
              metrcLastSuccessfulAuthMode: null,
            },
          },
        }));
      }
    } catch {
      setMetrcTestDiagnostics(null);
      setConfig((prev) => ({
        ...prev,
        company: {
          ...prev.company,
          metrc: {
            ...prev.company.metrc,
            metrcLastConnectionStatus: "not_connected",
            metrcLastConnectionCheckedAt: checkedAtFallback,
            metrcLastConnectionMessage: "Unable to reach METRC from the API server.",
            metrcLastConnectionHttpStatus: null,
            metrcLastLocationCount: null,
            metrcLastSuccessfulAuthMode: null,
          },
        },
      }));
    } finally {
      setMetrcConnectionTesting(false);
    }
  }

  useEffect(() => {
    void loadConfig();
  }, [pathname]);

  function cancelStrainEdit() {
    setEditingStrainId(null);
    setStrainForm(defaultStrainForm);
  }

  function startEditStrain(strain: Strain) {
    setEditingStrainId(strain.id);
    setStrainForm({
      name: strain.name,
      acronym: strain.acronym,
      dominance: strain.dominance,
      potency: strain.potency,
      averageYield: strain.averageYield,
    });
  }

  function saveStrain() {
    if (!strainForm.name.trim() || !strainForm.acronym.trim()) {
      alert("Strain name and acronym are required");
      return;
    }

    if (editingStrainId) {
      setConfig((prev) => ({
        ...prev,
        cultivation: {
          ...prev.cultivation,
          strains: prev.cultivation.strains.map((s) =>
            s.id === editingStrainId
              ? {
                  ...s,
                  name: strainForm.name.trim(),
                  acronym: strainForm.acronym.trim().toUpperCase(),
                  dominance: strainForm.dominance,
                  potency: strainForm.potency,
                  averageYield: strainForm.averageYield,
                }
              : s,
          ),
        },
      }));
      cancelStrainEdit();
      return;
    }

    setConfig((prev) => ({
      ...prev,
      cultivation: {
        ...prev.cultivation,
        strains: [
          ...prev.cultivation.strains,
          {
            id: makeId("strain"),
            name: strainForm.name.trim(),
            acronym: strainForm.acronym.trim().toUpperCase(),
            dominance: strainForm.dominance,
            potency: strainForm.potency,
            averageYield: strainForm.averageYield,
          },
        ],
      },
    }));

    setStrainForm(defaultStrainForm);
  }

  function removeStrain(id: string) {
    if (editingStrainId === id) {
      cancelStrainEdit();
    }
    setConfig((prev) => ({
      ...prev,
      cultivation: {
        ...prev.cultivation,
        strains: prev.cultivation.strains.filter((s) => s.id !== id),
      },
    }));
  }

  function addSupply(section: "cultivation" | "extraction" | "packaging") {
    const form =
      section === "cultivation"
        ? cultivationSupplyForm
        : section === "extraction"
        ? extractionSupplyForm
        : packagingSupplyForm;

    if (!form.name.trim() || !form.cost.trim()) {
      alert("Supply name and cost are required");
      return;
    }

    const newSupply: Supply = {
      id: makeId(`${section}-supply`),
      name: form.name.trim(),
      cost: form.cost.trim(),
      unit: form.unit.trim(),
    };

    setConfig((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        supplies: [...prev[section].supplies, newSupply],
      },
    }));

    if (section === "cultivation") {
      setCultivationSupplyForm({ name: "", cost: "", unit: "" });
    }

    if (section === "extraction") {
      setExtractionSupplyForm({ name: "", cost: "", unit: "" });
    }

    if (section === "packaging") {
      setPackagingSupplyForm({ name: "", cost: "", unit: "" });
    }
  }

  function removeSupply(
    section: "cultivation" | "extraction" | "packaging",
    id: string
  ) {
    setConfig((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        supplies: prev[section].supplies.filter((s) => s.id !== id),
      },
    }));
  }

  function addVegRoom() {
    if (!vegRoomName.trim()) return;

    setConfig((prev) => ({
      ...prev,
      cultivation: {
        ...prev.cultivation,
        rooms: {
          ...prev.cultivation.rooms,
          vegRooms: [
            ...prev.cultivation.rooms.vegRooms,
            {
              id: makeId("veg-room"),
              name: vegRoomName.trim(),
              bays: [],
            },
          ],
        },
      },
    }));

    setVegRoomName("");
  }

  function addVegRoomWithLayout() {
    const name = vegRoomName.trim();
    const bayCount = Math.min(26, Math.max(1, Math.floor(Number(vegQuickBayCount))));
    const tablesPerBay = Math.max(1, Math.floor(Number(vegQuickTablesPerBay)));
    if (!name) {
      alert("Enter a veg room name first.");
      return;
    }
    if (!Number.isFinite(bayCount) || bayCount < 1) {
      alert("Number of bays must be at least 1 (max 26).");
      return;
    }
    if (!Number.isFinite(tablesPerBay) || tablesPerBay < 1) {
      alert("Tables per bay must be at least 1.");
      return;
    }

    const bays = Array.from({ length: bayCount }, (_, i) => {
      const bayLabel = i < 26 ? String.fromCharCode(65 + i) : String(i + 1);
      const tables = Array.from({ length: tablesPerBay }, (_, j) => ({
        id: makeId("table"),
        name: String(j + 1),
        squareFeet: "",
      }));
      return {
        id: makeId("bay"),
        name: bayLabel,
        tables,
      };
    });

    setConfig((prev) => ({
      ...prev,
      cultivation: {
        ...prev.cultivation,
        rooms: {
          ...prev.cultivation.rooms,
          vegRooms: [
            ...prev.cultivation.rooms.vegRooms,
            {
              id: makeId("veg-room"),
              name,
              bays,
            },
          ],
        },
      },
    }));

    setVegRoomName("");
  }

  function removeVegRoom(id: string) {
    setConfig((prev) => ({
      ...prev,
      cultivation: {
        ...prev.cultivation,
        rooms: {
          ...prev.cultivation.rooms,
          vegRooms: prev.cultivation.rooms.vegRooms.filter((r) => r.id !== id),
        },
      },
    }));
  }

  function addFlowerRoom() {
    if (!flowerRoomName.trim()) return;

    setConfig((prev) => ({
      ...prev,
      cultivation: {
        ...prev.cultivation,
        rooms: {
          ...prev.cultivation.rooms,
          flowerRooms: [
            ...prev.cultivation.rooms.flowerRooms,
            {
              id: makeId("flower-room"),
              name: flowerRoomName.trim(),
              bays: [],
            },
          ],
        },
      },
    }));

    setFlowerRoomName("");
  }

  function addFlowerRoomWithLayout() {
    const name = flowerRoomName.trim();
    const bayCount = Math.min(26, Math.max(1, Math.floor(Number(flowerQuickBayCount))));
    const tablesPerBay = Math.max(1, Math.floor(Number(flowerQuickTablesPerBay)));
    if (!name) {
      alert("Enter a flower room name first.");
      return;
    }
    if (!Number.isFinite(bayCount) || bayCount < 1) {
      alert("Number of bays must be at least 1 (max 26).");
      return;
    }
    if (!Number.isFinite(tablesPerBay) || tablesPerBay < 1) {
      alert("Tables per bay must be at least 1.");
      return;
    }

    const bays = Array.from({ length: bayCount }, (_, i) => {
      const bayLabel = i < 26 ? String.fromCharCode(65 + i) : String(i + 1);
      const tables = Array.from({ length: tablesPerBay }, (_, j) => ({
        id: makeId("table"),
        name: String(j + 1),
        squareFeet: "",
      }));
      return {
        id: makeId("bay"),
        name: bayLabel,
        tables,
      };
    });

    setConfig((prev) => ({
      ...prev,
      cultivation: {
        ...prev.cultivation,
        rooms: {
          ...prev.cultivation.rooms,
          flowerRooms: [
            ...prev.cultivation.rooms.flowerRooms,
            {
              id: makeId("flower-room"),
              name,
              bays,
            },
          ],
        },
      },
    }));

    setFlowerRoomName("");
  }

  function removeFlowerRoom(roomId: string) {
    setConfig((prev) => ({
      ...prev,
      cultivation: {
        ...prev.cultivation,
        rooms: {
          ...prev.cultivation.rooms,
          flowerRooms: prev.cultivation.rooms.flowerRooms.filter(
            (r) => r.id !== roomId
          ),
        },
      },
    }));
  }

  function openAddBayModal(suite: "vegRooms" | "flowerRooms", roomId: string) {
    setFieldModalError("");
    setFieldModalBayName("");
    setCultivationFieldModal({ kind: "addBay", suite, roomId });
  }

  function confirmCultivationFieldModal() {
    if (cultivationFieldModal.kind === "closed") return;

    const suite =
      cultivationFieldModal.kind === "addBay" ||
      cultivationFieldModal.kind === "addTable" ||
      cultivationFieldModal.kind === "editTable"
        ? cultivationFieldModal.suite
        : null;
    if (!suite) return;

    if (cultivationFieldModal.kind === "addBay") {
      const bayName = fieldModalBayName.trim();
      if (!bayName) {
        setFieldModalError("Enter a bay name (e.g. A, B, or C).");
        return;
      }
      const roomId = cultivationFieldModal.roomId;
      setConfig((prev) => ({
        ...prev,
        cultivation: {
          ...prev.cultivation,
          rooms: {
            ...prev.cultivation.rooms,
            [suite]: prev.cultivation.rooms[suite].map((room) =>
              room.id === roomId
                ? {
                    ...room,
                    bays: [
                      ...room.bays,
                      {
                        id: makeId("bay"),
                        name: bayName,
                        tables: [],
                      },
                    ],
                  }
                : room,
            ),
          },
        },
      }));
      setCultivationFieldModal({ kind: "closed" });
      setFieldModalError("");
      return;
    }

    if (cultivationFieldModal.kind !== "addTable" && cultivationFieldModal.kind !== "editTable") return;

    const tableName = fieldModalTableName.trim();
    const squareFeet = fieldModalSquareFeet.trim();
    if (!tableName) {
      setFieldModalError("Enter a table name or number.");
      return;
    }
    const { roomId, bayId } = cultivationFieldModal;
    const editingTableId =
      cultivationFieldModal.kind === "editTable" ? cultivationFieldModal.tableId : null;

    setConfig((prev) => ({
      ...prev,
      cultivation: {
        ...prev.cultivation,
        rooms: {
          ...prev.cultivation.rooms,
          [suite]: prev.cultivation.rooms[suite].map((room) =>
            room.id === roomId
              ? {
                  ...room,
                  bays: room.bays.map((bay) =>
                    bay.id === bayId
                      ? {
                          ...bay,
                          tables: editingTableId
                            ? bay.tables.map((t) =>
                                t.id === editingTableId ? { ...t, name: tableName, squareFeet } : t,
                              )
                            : [
                                ...bay.tables,
                                {
                                  id: makeId("table"),
                                  name: tableName,
                                  squareFeet,
                                },
                              ],
                        }
                      : bay,
                  ),
                }
              : room,
          ),
        },
      },
    }));
    setCultivationFieldModal({ kind: "closed" });
    setFieldModalError("");
    setFieldModalTableName("");
    setFieldModalSquareFeet("");
  }

  function closeCultivationFieldModal() {
    setCultivationFieldModal({ kind: "closed" });
    setFieldModalError("");
    setFieldModalBayName("");
    setFieldModalTableName("");
    setFieldModalSquareFeet("");
  }

  function removeBay(suite: "vegRooms" | "flowerRooms", roomId: string, bayId: string) {
    setConfig((prev) => ({
      ...prev,
      cultivation: {
        ...prev.cultivation,
        rooms: {
          ...prev.cultivation.rooms,
          [suite]: prev.cultivation.rooms[suite].map((room) =>
            room.id === roomId
              ? {
                  ...room,
                  bays: room.bays.filter((bay) => bay.id !== bayId),
                }
              : room,
          ),
        },
      },
    }));
  }

  function openAddTableModal(suite: "vegRooms" | "flowerRooms", roomId: string, bayId: string) {
    setFieldModalError("");
    setFieldModalTableName("");
    setFieldModalSquareFeet("");
    setCultivationFieldModal({ kind: "addTable", suite, roomId, bayId });
  }

  function openEditTableModal(
    suite: "vegRooms" | "flowerRooms",
    roomId: string,
    bayId: string,
    tableId: string,
  ) {
    const room = config.cultivation.rooms[suite].find((r) => r.id === roomId);
    const bay = room?.bays.find((b) => b.id === bayId);
    const table = bay?.tables.find((t) => t.id === tableId);
    setFieldModalError("");
    setFieldModalTableName(table?.name ?? "");
    setFieldModalSquareFeet(table != null ? String(table.squareFeet ?? "").trim() : "");
    setCultivationFieldModal({ kind: "editTable", suite, roomId, bayId, tableId });
  }

  function removeTable(
    suite: "vegRooms" | "flowerRooms",
    roomId: string,
    bayId: string,
    tableId: string,
  ) {
    setConfig((prev) => ({
      ...prev,
      cultivation: {
        ...prev.cultivation,
        rooms: {
          ...prev.cultivation.rooms,
          [suite]: prev.cultivation.rooms[suite].map((room) =>
            room.id === roomId
              ? {
                  ...room,
                  bays: room.bays.map((bay) =>
                    bay.id === bayId
                      ? {
                          ...bay,
                          tables: bay.tables.filter((t) => t.id !== tableId),
                        }
                      : bay,
                  ),
                }
              : room,
          ),
        },
      },
    }));
  }

  function addProductName() {
    if (!productNameForm.sourceMix.trim() || !productNameForm.productName.trim()) {
      alert("Source mix and product name are required");
      return;
    }

    setConfig((prev) => ({
      ...prev,
      extraction: {
        ...prev.extraction,
        productNames: [
          ...prev.extraction.productNames,
          {
            id: makeId("product-name"),
            sourceMix: productNameForm.sourceMix.trim(),
            productName: productNameForm.productName.trim(),
          },
        ],
      },
    }));

    setProductNameForm({
      sourceMix: "",
      productName: "",
    });
  }

  function removeProductName(id: string) {
    setConfig((prev) => ({
      ...prev,
      extraction: {
        ...prev.extraction,
        productNames: prev.extraction.productNames.filter((p) => p.id !== id),
      },
    }));
  }

  async function openAiPromptModal() {
    setAiPromptModalError("");
    setAiPromptModalOpen(true);
    const hasMarkdown = Boolean(String(config.extraction.productNameAiPromptMarkdown || "").trim());
    setAiPromptModalTab(hasMarkdown ? "advanced" : "simple");
    setAiGuidedIntroDraft(String(config.extraction.productNameAiGuidedIntro || ""));
    setAiGuidedExtraDraft(String(config.extraction.productNameAiGuidedExtraRules || ""));
    setAiPromptModalLoading(true);
    try {
      const data = await apiRequest<{ defaultMarkdown: string }>(
        "/api/extraction-assist/product-name-prompt-default"
      );
      const shipped = String(data?.defaultMarkdown || "");
      setAiPromptShippedDefault(shipped);
      const saved = String(config.extraction.productNameAiPromptMarkdown || "").trim();
      setAiPromptDraft(saved || shipped);
    } catch (error) {
      console.error(error);
      setAiPromptModalError(
        error instanceof Error
          ? error.message
          : "Could not load the default prompt (check Admin / Owner role and API URL)."
      );
    } finally {
      setAiPromptModalLoading(false);
    }
  }

  function applyAiPromptModalToConfig() {
    if (aiPromptModalTab === "simple") {
      const intro = aiGuidedIntroDraft.trim();
      const extra = aiGuidedExtraDraft.trim();
      setConfig((prev) => ({
        ...prev,
        extraction: {
          ...prev.extraction,
          productNameAiGuidedIntro: intro,
          productNameAiGuidedExtraRules: extra,
          productNameAiPromptMarkdown: "",
        },
      }));
    }
    else {
      setConfig((prev) => ({
        ...prev,
        extraction: {
          ...prev.extraction,
          productNameAiPromptMarkdown: aiPromptDraft.trim(),
          productNameAiGuidedIntro: "",
          productNameAiGuidedExtraRules: "",
        },
      }));
    }
    setAiPromptModalOpen(false);
  }

  if (loading) {
    return (
      <main style={styles.page}>
        <Nav />
        <p>Loading config...</p>
      </main>
    );
  }

  function previewFacilityTime(draft: string): string {
    const d = new Date();
    const z = draft.trim();
    if (!z) {
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        return new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          dateStyle: "short",
          timeStyle: "medium",
        }).format(d);
      } catch {
        return formatInCompanyTimezone(d);
      }
    }
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: z,
        dateStyle: "short",
        timeStyle: "medium",
      }).format(d);
    } catch {
      return "Invalid time zone";
    }
  }

  function applyFacilityTimezoneFromModal() {
    const trimmed = displayTimezoneDraft.trim();
    setConfig((prev) => ({
      ...prev,
      company: {
        ...prev.company,
        settings: {
          ...prev.company.settings,
          displayTimezone: trimmed,
        },
      },
    }));
    setCompanyDisplayTimezone(trimmed);
    setTimeZoneModalOpen(false);
    setTimeZoneFilter("");
  }

  return (
    <main style={styles.page}>
      <Nav />

      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Company Config</h1>
          <p style={styles.subtitle}>
            Admin-only company settings — sales, products, climate (Autogrow), METRC, cultivation, extraction, and
            packaging.
          </p>
        </div>

        <button style={styles.saveButton} onClick={saveConfig} disabled={saving}>
          {saving ? "Saving..." : "Save Config"}
        </button>
      </div>

      <CollapsibleConfigSection
        sectionStyle={styles.card}
        sectionNumber="1"
        title="Company"
        summaryCollapsed={
          <>
            METRC: <b style={{ color: "#e2e8f0" }}>{metrcConnectionBadge.label}</b>
            {" · "}
            Time zone:{" "}
            <b style={{ color: "#e2e8f0" }}>
              {(config.company.settings.displayTimezone || "").trim() || "Browser default"}
            </b>
          </>
        }
      >
        <div style={styles.configSubCard}>
        <div style={{ ...styles.inline, alignItems: "center", marginBottom: 4 }}>
          <h2 style={{ ...styles.sectionTitle, marginBottom: 0 }}>Facility &amp; METRC</h2>
          <button
            type="button"
            title="Facility time zone — applies to all timestamps in this workspace"
            aria-label="Open facility time zone settings"
            onClick={() => {
              setDisplayTimezoneDraft(String(config.company.settings.displayTimezone ?? ""));
              setTimeZoneFilter("");
              setTimeZoneModalOpen(true);
            }}
            style={{
              width: 40,
              height: 40,
              borderRadius: "9999px",
              border: "1px solid #475569",
              background: "#1e293b",
              color: "#93c5fd",
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            🕐
          </button>
        </div>
        <p style={{ color: "#94a3b8", fontSize: 13, marginTop: 6, marginBottom: 14 }}>
          Display time zone:{" "}
          <b style={{ color: "#e2e8f0" }}>
            {(config.company.settings.displayTimezone || "").trim() || "Browser default"}
          </b>
          . Use the clock button to change how dates and times appear everywhere.
        </p>

        <div
          style={{
            ...styles.inline,
            alignItems: "center",
            marginTop: 18,
            marginBottom: 8,
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <h3 style={{ ...styles.subTitle, marginTop: 0 }}>METRC API (facility)</h3>
          <span
            title="METRC connection status (last test)"
            style={{
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              padding: "5px 12px",
              borderRadius: "999px",
              border: "1px solid",
              ...(metrcConnectionBadge.tone === "connected"
                ? { color: "#bbf7d0", borderColor: "#166534", background: "#052e16" }
                : metrcConnectionBadge.tone === "error"
                  ? { color: "#fecaca", borderColor: "#991b1b", background: "#450a0a" }
                  : metrcConnectionBadge.tone === "testing"
                    ? { color: "#bae6fd", borderColor: "#0369a1", background: "#0c4a6e" }
                    : { color: "#cbd5e1", borderColor: "#475569", background: "#1e293b" }),
            }}
          >
            METRC: {metrcConnectionBadge.label}
          </span>
        </div>

        <div
          style={{
            border: "1px solid #334155",
            borderRadius: 14,
            padding: 16,
            marginBottom: 14,
            background: "#020617",
          }}
        >
          {metrcConnectionTesting ? (
            <>
              <div
                style={{
                  display: "inline-block",
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  padding: "4px 10px",
                  borderRadius: "999px",
                  border: "1px solid #0369a1",
                  color: "#bae6fd",
                  background: "#0c4a6e",
                  marginBottom: 10,
                }}
              >
                Testing
              </div>
              <p style={{ color: "#e2e8f0", margin: 0, fontSize: 14 }}>Testing METRC connection…</p>
              <p style={{ color: "#64748b", fontSize: 12, marginTop: 10, marginBottom: 0 }}>
                This uses the last saved METRC settings. Save changes before testing.
              </p>
            </>
          ) : String(config.company.metrc.metrcLastConnectionStatus || "") === "connected" ? (
            <>
              <div
                style={{
                  display: "inline-block",
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  padding: "4px 10px",
                  borderRadius: "999px",
                  border: "1px solid #166534",
                  color: "#bbf7d0",
                  background: "#052e16",
                  marginBottom: 10,
                }}
              >
                Connected
              </div>
              <p style={{ color: "#e2e8f0", margin: "0 0 10px", fontSize: 14 }}>
                Connected to METRC. Found{" "}
                <strong>{Number(config.company.metrc.metrcLastLocationCount ?? 0)}</strong> active location
                {Number(config.company.metrc.metrcLastLocationCount ?? 0) === 1 ? "" : "s"}.
              </p>
              <p style={{ color: "#93c5fd", fontSize: 13, margin: "0 0 10px", lineHeight: 1.5 }}>
                Auth mode:{" "}
                <strong style={{ color: "#e2e8f0" }}>
                  {formatMetrcAuthModeLabel(
                    metrcTestDiagnostics?.authMode || config.company.metrc.metrcLastSuccessfulAuthMode,
                  )}
                </strong>
              </p>
              <ul style={{ color: "#94a3b8", fontSize: 13, margin: "0 0 12px", paddingLeft: 18, lineHeight: 1.5 }}>
                <li>
                  License: <span style={{ color: "#e2e8f0" }}>{config.company.metrc.licenseNumber || "—"}</span>
                </li>
                <li>
                  Base URL: <span style={{ color: "#e2e8f0" }}>{metrcResolvedBaseUrl || "—"}</span>
                </li>
                <li>
                  Last checked:{" "}
                  <span style={{ color: "#e2e8f0" }}>
                    {config.company.metrc.metrcLastConnectionCheckedAt
                      ? formatCompanyTimestamp(config.company.metrc.metrcLastConnectionCheckedAt)
                      : "—"}
                  </span>
                </li>
              </ul>
              <p style={{ color: "#64748b", fontSize: 12, marginTop: 0, marginBottom: 10 }}>
                This uses the last saved METRC settings. Save changes before testing.
              </p>
              <button
                type="button"
                style={{ ...styles.saveButton, opacity: metrcConnectionTesting ? 0.6 : 1 }}
                disabled={metrcConnectionTesting}
                onClick={() => void runMetrcConnectionTest()}
              >
                Re-test connection
              </button>
            </>
          ) : String(config.company.metrc.metrcLastConnectionStatus || "") === "not_connected" ? (
            <>
              <div
                style={{
                  display: "inline-block",
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  padding: "4px 10px",
                  borderRadius: "999px",
                  border: "1px solid #991b1b",
                  color: "#fecaca",
                  background: "#450a0a",
                  marginBottom: 10,
                }}
              >
                Not connected
              </div>
              <p style={{ color: "#fecaca", margin: "0 0 10px", fontSize: 14 }}>
                {String(config.company.metrc.metrcLastConnectionMessage || "").trim() ||
                  "METRC connection failed."}
              </p>
              {metrcTestDiagnostics?.failures && metrcTestDiagnostics.failures.length > 0 && (
                <div
                  style={{
                    marginBottom: 12,
                    padding: 12,
                    borderRadius: 10,
                    border: "1px solid #475569",
                    background: "#0f172a",
                    overflowX: "auto",
                  }}
                >
                  <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 8, fontWeight: 600 }}>
                    Diagnostic attempts (GET /locations/v2/active — read-only)
                  </div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, color: "#cbd5e1" }}>
                    <thead>
                      <tr style={{ textAlign: "left", borderBottom: "1px solid #334155" }}>
                        <th style={{ padding: "6px 8px 6px 0" }}>Mode</th>
                        <th style={{ padding: "6px 8px" }}>HTTP</th>
                        <th style={{ padding: "6px 8px" }}>Time</th>
                        <th style={{ padding: "6px 0 6px 8px" }}>METRC note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metrcTestDiagnostics.failures.map((row, i) => (
                        <tr key={`${row.mode}-${i}`} style={{ borderBottom: "1px solid #1e293b" }}>
                          <td style={{ padding: "6px 8px 6px 0", verticalAlign: "top", whiteSpace: "nowrap" }}>
                            <code style={{ color: "#93c5fd", fontSize: 11 }}>{row.mode}</code>
                          </td>
                          <td style={{ padding: "6px 8px", verticalAlign: "top" }}>{row.status}</td>
                          <td style={{ padding: "6px 8px", verticalAlign: "top" }}>{row.durationMs} ms</td>
                          <td style={{ padding: "6px 0 6px 8px", verticalAlign: "top", wordBreak: "break-word" }}>
                            {row.metrcSnippet ? (
                              <span style={{ color: "#fcd34d" }}>{row.metrcSnippet}</span>
                            ) : (
                              <span style={{ color: "#64748b" }}>—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {metrcTestDiagnostics.attemptedModes && metrcTestDiagnostics.attemptedModes.length > 0 && (
                    <p style={{ color: "#64748b", fontSize: 11, marginTop: 10, marginBottom: 0 }}>
                      Order tried: {metrcTestDiagnostics.attemptedModes.join(" → ")}
                    </p>
                  )}
                </div>
              )}
              <ul style={{ color: "#94a3b8", fontSize: 13, margin: "0 0 12px", paddingLeft: 18, lineHeight: 1.5 }}>
                <li>
                  Status:{" "}
                  <span style={{ color: "#e2e8f0" }}>
                    {typeof config.company.metrc.metrcLastConnectionHttpStatus === "number" &&
                    config.company.metrc.metrcLastConnectionHttpStatus > 0
                      ? config.company.metrc.metrcLastConnectionHttpStatus
                      : "—"}
                  </span>
                </li>
                <li>
                  Base URL: <span style={{ color: "#e2e8f0" }}>{metrcResolvedBaseUrl || "—"}</span>
                </li>
                <li>
                  License: <span style={{ color: "#e2e8f0" }}>{config.company.metrc.licenseNumber || "—"}</span>
                </li>
                <li>
                  Last checked:{" "}
                  <span style={{ color: "#e2e8f0" }}>
                    {config.company.metrc.metrcLastConnectionCheckedAt
                      ? formatCompanyTimestamp(config.company.metrc.metrcLastConnectionCheckedAt)
                      : "—"}
                  </span>
                </li>
              </ul>
              <p style={{ color: "#64748b", fontSize: 12, marginTop: 0, marginBottom: 10 }}>
                This uses the last saved METRC settings. Save changes before testing.
              </p>
              <button
                type="button"
                style={{ ...styles.saveButton, opacity: metrcConnectionTesting ? 0.6 : 1 }}
                disabled={metrcConnectionTesting}
                onClick={() => void runMetrcConnectionTest()}
              >
                Reconnect / Test again
              </button>
            </>
          ) : (
            <>
              <div
                style={{
                  display: "inline-block",
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  padding: "4px 10px",
                  borderRadius: "999px",
                  border: "1px solid #475569",
                  color: "#cbd5e1",
                  background: "#1e293b",
                  marginBottom: 10,
                }}
              >
                Not tested
              </div>
              <p style={{ color: "#94a3b8", margin: "0 0 12px", fontSize: 14, lineHeight: 1.55 }}>
                Save your METRC settings, then test the connection.
              </p>
              <p style={{ color: "#64748b", fontSize: 12, marginTop: 0, marginBottom: 10 }}>
                This uses the last saved METRC settings. Save changes before testing.
              </p>
              <button
                type="button"
                style={{ ...styles.saveButton, opacity: metrcConnectionTesting ? 0.6 : 1 }}
                disabled={metrcConnectionTesting}
                onClick={() => void runMetrcConnectionTest()}
              >
                Test connection
              </button>
            </>
          )}
        </div>
        </div>

        <div style={styles.configSubCard}>
        <p style={{ color: "#94a3b8", fontSize: 13, marginTop: 0, marginBottom: 12, lineHeight: 1.55 }}>
          Credentials are saved per company in the database and used only by your server (e.g. Railway). They are not
          exposed to browsers except on this admin screen. Confirm API host patterns with your state&apos;s METRC
          integration guide — use <strong>API base URL override</strong> if the resolved URL below does not match your
          environment.
        </p>

        <label style={{ ...styles.label, display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={config.company.metrc.integrationEnabled}
            onChange={(e) =>
              setConfig((prev) => ({
                ...prev,
                company: {
                  ...prev.company,
                  metrc: {
                    ...prev.company.metrc,
                    integrationEnabled: e.target.checked,
                  },
                },
              }))
            }
          />
          Enable METRC API integration for this company (server-side sync)
        </label>
        <p style={{ color: "#94a3b8", fontSize: 13, margin: "0 0 12px", lineHeight: 1.5 }}>
          When unchecked, <strong style={{ color: "#e2e8f0" }}>Cultivation</strong> hides immature-batch and METRC tag
          tasks; Clone batches use <strong style={{ color: "#e2e8f0" }}>Move to Veg</strong> with plant counts only.
        </p>

        <div style={styles.grid}>
          <label style={styles.label}>
            State code (2 letters)
            <input
              style={styles.input}
              maxLength={2}
              placeholder="e.g. CO"
              value={config.company.metrc.stateCode}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  company: {
                    ...prev.company,
                    metrc: {
                      ...prev.company.metrc,
                      stateCode: e.target.value.toUpperCase().replace(/[^A-Za-z]/g, ""),
                    },
                  },
                }))
              }
            />
          </label>

          <label style={styles.label}>
            Environment
            <select
              style={styles.input}
              value={config.company.metrc.environment}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  company: {
                    ...prev.company,
                    metrc: {
                      ...prev.company.metrc,
                      environment: e.target.value === "sandbox" ? "sandbox" : "production",
                    },
                  },
                }))
              }
            >
              <option value="production">Production</option>
              <option value="sandbox">Sandbox</option>
            </select>
          </label>

          <label style={{ ...styles.label, gridColumn: "1 / -1" }}>
            API base URL override (optional)
            <input
              style={styles.input}
              placeholder="https://api-co.metrc.com"
              value={config.company.metrc.apiBaseUrlOverride}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  company: {
                    ...prev.company,
                    metrc: {
                      ...prev.company.metrc,
                      apiBaseUrlOverride: e.target.value,
                    },
                  },
                }))
              }
            />
          </label>
        </div>

        <div
          style={{
            ...styles.input,
            marginBottom: 14,
            fontSize: 13,
            color: "#cbd5e1",
            borderStyle: "dashed",
          }}
        >
          <strong style={{ color: "#93c5fd" }}>Resolved API base URL:</strong>{" "}
          {metrcResolvedBaseUrl || (
            <span style={{ color: "#fbbf24" }}>
              Enter a 2-letter state code or paste an override URL above.
            </span>
          )}
        </div>

        <label style={{ ...styles.label, display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={showMetrcSecrets}
            onChange={(e) => setShowMetrcSecrets(e.target.checked)}
          />
          Show METRC keys on screen (disable when sharing your display)
        </label>

        <div style={styles.grid}>
          <label style={{ ...styles.label, gridColumn: "1 / -1" }}>
            Software vendor API key (optional — integrator key from METRC)
            {showMetrcSecrets ? (
              <textarea
                style={{
                  ...styles.textarea,
                  minHeight: 72,
                  fontFamily: "ui-monospace, monospace",
                  wordBreak: "break-all",
                }}
                rows={3}
                spellCheck={false}
                autoComplete="off"
                value={config.company.metrc.apiKey}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    company: {
                      ...prev.company,
                      metrc: {
                        ...prev.company.metrc,
                        apiKey: e.target.value,
                      },
                    },
                  }))
                }
              />
            ) : (
              <input
                style={styles.input}
                type="password"
                autoComplete="off"
                value={config.company.metrc.apiKey}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    company: {
                      ...prev.company,
                      metrc: {
                        ...prev.company.metrc,
                        apiKey: e.target.value,
                      },
                    },
                  }))
                }
              />
            )}
            <span style={{ color: "#64748b", fontSize: 12, marginTop: 4, lineHeight: 1.45 }}>
              Vendor key may be required for official production integrations. Leave empty to test with only the
              facility user key (the server will try Bearer and other safe fallbacks on 401). Do not put passwords
              here — only the integrator key from METRC.
            </span>
          </label>

          <label style={{ ...styles.label, gridColumn: "1 / -1" }}>
            User API key (facility user key from METRC)
            {showMetrcSecrets ? (
              <textarea
                style={{
                  ...styles.textarea,
                  minHeight: 88,
                  fontFamily: "ui-monospace, monospace",
                  wordBreak: "break-all",
                }}
                rows={4}
                spellCheck={false}
                autoComplete="off"
                value={config.company.metrc.userKey}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    company: {
                      ...prev.company,
                      metrc: {
                        ...prev.company.metrc,
                        userKey: e.target.value,
                      },
                    },
                  }))
                }
              />
            ) : (
              <input
                style={styles.input}
                type="password"
                autoComplete="off"
                value={config.company.metrc.userKey}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    company: {
                      ...prev.company,
                      metrc: {
                        ...prev.company.metrc,
                        userKey: e.target.value,
                      },
                    },
                  }))
                }
              />
            )}
            <span style={{ color: "#64748b", fontSize: 12, marginTop: 4, lineHeight: 1.45 }}>
              Paste the full <strong style={{ color: "#94a3b8" }}>Current API Key</strong> from METRC (Admin → API
              Keys). It is typically one long line (often 50+ characters). A truncated key always returns 401.
            </span>
          </label>

          <label style={styles.label}>
            Facility license number
            <input
              style={styles.input}
              value={config.company.metrc.licenseNumber}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  company: {
                    ...prev.company,
                    metrc: {
                      ...prev.company.metrc,
                      licenseNumber: e.target.value,
                    },
                  },
                }))
              }
            />
          </label>

          <label style={styles.label}>
            Facility name (label only)
            <input
              style={styles.input}
              value={config.company.metrc.facilityName}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  company: {
                    ...prev.company,
                    metrc: {
                      ...prev.company.metrc,
                      facilityName: e.target.value,
                    },
                  },
                }))
              }
            />
          </label>
        </div>

        <label style={styles.label}>
          METRC notes (internal — not sent to METRC)
          <textarea
            style={styles.textarea}
            value={config.company.metrc.notes}
            onChange={(e) =>
              setConfig((prev) => ({
                ...prev,
                company: {
                  ...prev.company,
                  metrc: {
                    ...prev.company.metrc,
                    notes: e.target.value,
                  },
                },
              }))
            }
          />
        </label>

        <label style={styles.label}>
          Company Notes
          <textarea
            style={styles.textarea}
            value={config.company.settings.companyWideNotes}
            onChange={(e) =>
              setConfig((prev) => ({
                ...prev,
                company: {
                  ...prev.company,
                  settings: {
                    ...prev.company.settings,
                    companyWideNotes: e.target.value,
                  },
                },
              }))
            }
          />
        </label>
        </div>

        <div style={styles.configSubCard}>
        <h3 style={{ ...styles.subTitle, marginTop: 0 }}>Live task and order banners</h3>
        <p style={{ color: "#94a3b8", fontSize: 14, marginTop: 0, marginBottom: 12, lineHeight: 1.5 }}>
          Quick pop-ups when a logged task completes (green) or a new LeafLink order appears in your stored orders (orange).
          Disabled users still see full history on the Orders and workflow pages after refresh or sync.
        </p>
        <label style={{ ...styles.label, display: "flex", alignItems: "center", gap: 10 }}>
          <input
            type="checkbox"
            checked={(config.company.settings.liveTaskNotifications ?? true) !== false}
            onChange={(e) =>
              setConfig((prev) => ({
                ...prev,
                company: {
                  ...prev.company,
                  settings: {
                    ...prev.company.settings,
                    liveTaskNotifications: e.target.checked,
                  },
                },
              }))
            }
          />
          Show live task banners (who performed which task)
        </label>
        <label style={{ ...styles.label, display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
          <input
            type="checkbox"
            checked={(config.company.settings.liveOrderNotifications ?? true) !== false}
            onChange={(e) =>
              setConfig((prev) => ({
                ...prev,
                company: {
                  ...prev.company,
                  settings: {
                    ...prev.company.settings,
                    liveOrderNotifications: e.target.checked,
                  },
                },
              }))
            }
          />
          Show live order banners (customer name and order total)
        </label>
        </div>

        <div style={styles.configSubCard}>
          <h3 style={{ ...styles.subTitle, marginTop: 0 }}>Which employees see Inventory, Orders, and Analytics</h3>
          <p style={{ color: "#94a3b8", fontSize: 14, marginTop: 0, marginBottom: 0, lineHeight: 1.5 }}>
            Per-person page access is not stored here. Open{" "}
            <Link href="/admin" style={{ color: "#38bdf8", fontWeight: 800 }}>
              Admin → Users
            </Link>
            , choose <b>Edit</b>, and under{" "}
            <b style={{ color: "#e2e8f0" }}>Inventory, orders, and analytics</b>{" "}
            uncheck Inventory, Orders, or Analytics for that employee. That hides the nav links and home shortcuts for everyone except Owners and Company Admins.
          </p>
        </div>

        <div style={styles.configSubCard}>
        <h3 style={{ ...styles.subTitle, marginTop: 0 }}>Staff rewards</h3>
        <p style={{ color: "#94a3b8", fontSize: 14, marginTop: 0, marginBottom: 12, lineHeight: 1.5 }}>
          Points are derived from task logs and batch data (informational). Turn off to hide Rewards everywhere.
          Managers enroll employees under Admin → Users.
        </p>
        <label style={{ ...styles.label, display: "flex", alignItems: "center", gap: 10 }}>
          <input
            type="checkbox"
            checked={config.company.settings.rewards?.enabled ?? false}
            onChange={(e) =>
              setConfig((prev) => ({
                ...prev,
                company: {
                  ...prev.company,
                  settings: {
                    ...prev.company.settings,
                    rewards: {
                      ...(prev.company.settings.rewards || mergeRewardsSettings(undefined)),
                      enabled: e.target.checked,
                    },
                  },
                },
              }))
            }
          />
          Enable staff rewards program
        </label>
        <div style={styles.grid}>
          <label style={styles.label}>
            Points window (days)
            <input
              style={styles.input}
              type="number"
              min={1}
              value={config.company.settings.rewards?.primaryWindowDays ?? 30}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  company: {
                    ...prev.company,
                    settings: {
                      ...prev.company.settings,
                      rewards: {
                        ...(prev.company.settings.rewards || mergeRewardsSettings(undefined)),
                        primaryWindowDays: Math.max(1, Number(e.target.value) || 30),
                      },
                    },
                  },
                }))
              }
            />
          </label>
          <label style={styles.label}>
            Fast-task bonus points
            <input
              style={styles.input}
              type="number"
              value={config.company.settings.rewards?.scoring.fastTaskBonusPoints ?? 5}
              onChange={(e) =>
                setConfig((prev) => {
                  const r = prev.company.settings.rewards || mergeRewardsSettings(undefined);
                  return {
                    ...prev,
                    company: {
                      ...prev.company,
                      settings: {
                        ...prev.company.settings,
                        rewards: {
                          ...r,
                          scoring: {
                            ...r.scoring,
                            fastTaskBonusPoints: Number(e.target.value) || 0,
                          },
                        },
                      },
                    },
                  };
                })
              }
            />
          </label>
          <label style={styles.label}>
            Potency threshold (% THC)
            <input
              style={styles.input}
              type="number"
              value={config.company.settings.rewards?.scoring.potencyThresholdPercent ?? 20}
              onChange={(e) =>
                setConfig((prev) => {
                  const r = prev.company.settings.rewards || mergeRewardsSettings(undefined);
                  return {
                    ...prev,
                    company: {
                      ...prev.company,
                      settings: {
                        ...prev.company.settings,
                        rewards: {
                          ...r,
                          scoring: {
                            ...r.scoring,
                            potencyThresholdPercent: Number(e.target.value) || 0,
                          },
                        },
                      },
                    },
                  };
                })
              }
            />
          </label>
          <label style={styles.label}>
            Potency bonus points
            <input
              style={styles.input}
              type="number"
              value={config.company.settings.rewards?.scoring.potencyBonusPoints ?? 15}
              onChange={(e) =>
                setConfig((prev) => {
                  const r = prev.company.settings.rewards || mergeRewardsSettings(undefined);
                  return {
                    ...prev,
                    company: {
                      ...prev.company,
                      settings: {
                        ...prev.company.settings,
                        rewards: {
                          ...r,
                          scoring: {
                            ...r.scoring,
                            potencyBonusPoints: Number(e.target.value) || 0,
                          },
                        },
                      },
                    },
                  };
                })
              }
            />
          </label>
        </div>
        <p style={{ color: "#94a3b8", fontSize: 13, marginBottom: 8 }}>Reward milestones (label + points required)</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          {(config.company.settings.rewards?.rewardItems || []).map((item, idx) => (
            <div key={item.id || idx} style={{ ...styles.grid, alignItems: "end" }}>
              <label style={styles.label}>
                Label
                <input
                  style={styles.input}
                  value={item.label}
                  onChange={(e) => {
                    const v = e.target.value;
                    setConfig((prev) => {
                      const r = prev.company.settings.rewards || mergeRewardsSettings(undefined);
                      const list = [...(r.rewardItems || [])];
                      list[idx] = { ...list[idx], label: v };
                      return {
                        ...prev,
                        company: {
                          ...prev.company,
                          settings: {
                            ...prev.company.settings,
                            rewards: { ...r, rewardItems: list },
                          },
                        },
                      };
                    });
                  }}
                />
              </label>
              <label style={styles.label}>
                Points required
                <input
                  style={styles.input}
                  type="number"
                  value={item.pointsRequired}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setConfig((prev) => {
                      const r = prev.company.settings.rewards || mergeRewardsSettings(undefined);
                      const list = [...(r.rewardItems || [])];
                      list[idx] = { ...list[idx], pointsRequired: v };
                      return {
                        ...prev,
                        company: {
                          ...prev.company,
                          settings: {
                            ...prev.company.settings,
                            rewards: { ...r, rewardItems: list },
                          },
                        },
                      };
                    });
                  }}
                />
              </label>
              <button
                type="button"
                style={styles.deleteButton}
                onClick={() =>
                  setConfig((prev) => {
                    const r = prev.company.settings.rewards || mergeRewardsSettings(undefined);
                    return {
                      ...prev,
                      company: {
                        ...prev.company,
                        settings: {
                          ...prev.company.settings,
                          rewards: {
                            ...r,
                            rewardItems: r.rewardItems.filter((_, i) => i !== idx),
                          },
                        },
                      },
                    };
                  })
                }
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            style={styles.secondaryButton}
            onClick={() =>
              setConfig((prev) => {
                const r = prev.company.settings.rewards || mergeRewardsSettings(undefined);
                return {
                  ...prev,
                  company: {
                    ...prev.company,
                    settings: {
                      ...prev.company.settings,
                      rewards: {
                        ...r,
                        rewardItems: [
                          ...r.rewardItems,
                          { id: makeId("reward"), label: "Reward", pointsRequired: 100 },
                        ],
                      },
                    },
                  },
                };
              })
            }
          >
            + Add reward item
          </button>
        </div>
        <p style={{ color: "#94a3b8", fontSize: 13, marginBottom: 8 }}>Task challenge (beat-the-clock tiers vs facility average)</p>
        <label style={{ ...styles.label, display: "flex", alignItems: "center", gap: 10 }}>
          <input
            type="checkbox"
            checked={config.company.settings.rewards?.taskChallenge.enabled ?? true}
            onChange={(e) =>
              setConfig((prev) => {
                const r = prev.company.settings.rewards || mergeRewardsSettings(undefined);
                return {
                  ...prev,
                  company: {
                    ...prev.company,
                    settings: {
                      ...prev.company.settings,
                      rewards: {
                        ...r,
                        taskChallenge: { ...r.taskChallenge, enabled: e.target.checked },
                      },
                    },
                  },
                };
              })
            }
          />
          Enable timed task challenges
        </label>
        <label style={{ ...styles.label, display: "flex", alignItems: "center", gap: 10 }}>
          <input
            type="checkbox"
            checked={config.company.settings.rewards?.taskChallenge.requireManagerApproval ?? false}
            onChange={(e) =>
              setConfig((prev) => {
                const r = prev.company.settings.rewards || mergeRewardsSettings(undefined);
                return {
                  ...prev,
                  company: {
                    ...prev.company,
                    settings: {
                      ...prev.company.settings,
                      rewards: {
                        ...r,
                        taskChallenge: { ...r.taskChallenge, requireManagerApproval: e.target.checked },
                      },
                    },
                  },
                };
              })
            }
          />
          Require reward manager approval before challenge points count
        </label>
        <p style={{ color: "#64748b", fontSize: 12, margin: "0 0 8px" }}>
          When enabled, completed challenges appear under Rewards for designated managers to approve or deny. Leave manager
          list empty to allow any Manager, Operations Manager, Admin, or Owner.
        </p>
        <label style={styles.label}>
          Reward manager user IDs (optional, comma-separated)
          <input
            style={styles.input}
            placeholder="e.g. clxxxxxxxx, clyyyyyyyy"
            value={(config.company.settings.rewards?.taskChallenge.rewardManagerUserIds || []).join(", ")}
            onChange={(e) =>
              setConfig((prev) => {
                const r = prev.company.settings.rewards || mergeRewardsSettings(undefined);
                const ids = e.target.value
                  .split(/[,;\s]+/)
                  .map((x) => x.trim())
                  .filter(Boolean);
                return {
                  ...prev,
                  company: {
                    ...prev.company,
                    settings: {
                      ...prev.company.settings,
                      rewards: {
                        ...r,
                        taskChallenge: { ...r.taskChallenge, rewardManagerUserIds: ids },
                      },
                    },
                  },
                };
              })
            }
          />
        </label>
        <label style={styles.label}>
          Exclude tasks from challenges (substrings, comma-separated)
          <input
            style={styles.input}
            placeholder="e.g. print harvest, metrc tag"
            value={(config.company.settings.rewards?.taskChallenge.excludedTaskSubstrings || []).join(", ")}
            onChange={(e) =>
              setConfig((prev) => {
                const r = prev.company.settings.rewards || mergeRewardsSettings(undefined);
                const parts = e.target.value
                  .split(/[,;\n]+/)
                  .map((x) => x.trim())
                  .filter(Boolean);
                return {
                  ...prev,
                  company: {
                    ...prev.company,
                    settings: {
                      ...prev.company.settings,
                      rewards: {
                        ...r,
                        taskChallenge: { ...r.taskChallenge, excludedTaskSubstrings: parts },
                      },
                    },
                  },
                };
              })
            }
          />
        </label>
        <label style={styles.label}>
          Challenge prompt chance when saving (0–100%)
          <input
            style={styles.input}
            type="number"
            min={0}
            max={100}
            value={config.company.settings.rewards?.taskChallenge.offerChancePercent ?? 35}
            onChange={(e) =>
              setConfig((prev) => {
                const r = prev.company.settings.rewards || mergeRewardsSettings(undefined);
                const v = Math.min(100, Math.max(0, Number(e.target.value) || 0));
                return {
                  ...prev,
                  company: {
                    ...prev.company,
                    settings: {
                      ...prev.company.settings,
                      rewards: {
                        ...r,
                        taskChallenge: { ...r.taskChallenge, offerChancePercent: v },
                      },
                    },
                  },
                };
              })
            }
          />
        </label>
        <p style={{ color: "#64748b", fontSize: 12, margin: "0 0 8px" }}>
          After labor is valid, the app may show the speed-challenge popup on <b>Save</b>. Use a lower percent so it only
          appears occasionally (100 = every eligible save).
        </p>
        <label style={styles.label}>
          Min samples for average
          <input
            style={styles.input}
            type="number"
            min={1}
            value={config.company.settings.rewards?.taskChallenge.minSamplesForAverage ?? 5}
            onChange={(e) =>
              setConfig((prev) => {
                const r = prev.company.settings.rewards || mergeRewardsSettings(undefined);
                return {
                  ...prev,
                  company: {
                    ...prev.company,
                    settings: {
                      ...prev.company.settings,
                      rewards: {
                        ...r,
                        taskChallenge: {
                          ...r.taskChallenge,
                          minSamplesForAverage: Math.max(1, Number(e.target.value) || 5),
                        },
                      },
                    },
                  },
                };
              })
            }
          />
        </label>
        {(config.company.settings.rewards?.taskChallenge.tiers || []).map((tier, tidx) => (
          <div key={`tier-${tidx}`} style={{ ...styles.grid, marginBottom: 8 }}>
            <label style={styles.label}>
              Tier label
              <input
                style={styles.input}
                value={tier.label}
                onChange={(e) => {
                  const v = e.target.value;
                  setConfig((prev) => {
                    const r = prev.company.settings.rewards || mergeRewardsSettings(undefined);
                    const tiers = [...r.taskChallenge.tiers];
                    tiers[tidx] = { ...tiers[tidx], label: v };
                    return {
                      ...prev,
                      company: {
                        ...prev.company,
                        settings: {
                          ...prev.company.settings,
                          rewards: { ...r, taskChallenge: { ...r.taskChallenge, tiers } },
                        },
                      },
                    };
                  });
                }}
              />
            </label>
            <label style={styles.label}>
              × avg minutes
              <input
                style={styles.input}
                type="number"
                step={0.01}
                value={tier.multiplierVsAvg}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setConfig((prev) => {
                    const r = prev.company.settings.rewards || mergeRewardsSettings(undefined);
                    const tiers = [...r.taskChallenge.tiers];
                    tiers[tidx] = { ...tiers[tidx], multiplierVsAvg: v };
                    return {
                      ...prev,
                      company: {
                        ...prev.company,
                        settings: {
                          ...prev.company.settings,
                          rewards: { ...r, taskChallenge: { ...r.taskChallenge, tiers } },
                        },
                      },
                    };
                  });
                }}
              />
            </label>
            <label style={styles.label}>
              Points
              <input
                style={styles.input}
                type="number"
                value={tier.points}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setConfig((prev) => {
                    const r = prev.company.settings.rewards || mergeRewardsSettings(undefined);
                    const tiers = [...r.taskChallenge.tiers];
                    tiers[tidx] = { ...tiers[tidx], points: v };
                    return {
                      ...prev,
                      company: {
                        ...prev.company,
                        settings: {
                          ...prev.company.settings,
                          rewards: { ...r, taskChallenge: { ...r.taskChallenge, tiers } },
                        },
                      },
                    };
                  });
                }}
              />
            </label>
          </div>
        ))}
        </div>

        <div style={styles.configSubCard}>
        <h3 style={{ ...styles.subTitle, marginTop: 0 }}>Workflow — extra tasks & rewards</h3>
        <p style={{ color: "#94a3b8", fontSize: 14, marginTop: 0, marginBottom: 12, lineHeight: 1.5 }}>
          Add facility-specific tasks; they appear alongside built-in tasks in Cultivation, Extraction, and Packaging. For each
          row, choose whether staff rewards (fast-target bonus + tier challenge points) apply, and a multiplier for{" "}
          <b>tier challenge points only</b> (tiers are configured under Staff rewards above). Built-in tasks keep default
          reward behavior unless you add a row with the <b>exact same task name</b> to override.
        </p>

        <h4 style={{ ...styles.subTitle, fontSize: 16, marginBottom: 8 }}>Cultivation (Clone / Veg / Flower)</h4>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
          {(config.cultivation.customTasks || []).map((row, idx) => (
            <div
              key={row.id || `cult-ct-${idx}`}
              style={{
                ...styles.grid,
                border: "1px solid #334155",
                borderRadius: 10,
                padding: 10,
                alignItems: "center",
              }}
            >
              <input
                style={styles.input}
                placeholder="Task name (shown to operators)"
                value={row.label}
                onChange={(e) => {
                  const v = e.target.value;
                  setConfig((prev) => {
                    const list = [...(prev.cultivation.customTasks || [])];
                    list[idx] = { ...list[idx], label: v };
                    return {
                      ...prev,
                      cultivation: { ...prev.cultivation, customTasks: list },
                    };
                  });
                }}
              />
              <span style={{ color: "#94a3b8", fontSize: 13 }}>Stages</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {(["clone", "veg", "flower"] as const).map((st) => (
                  <label key={st} style={{ display: "flex", gap: 6, alignItems: "center", color: "#e2e8f0", fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={row.stages?.includes(st) ?? false}
                      onChange={(e) => {
                        const on = e.target.checked;
                        setConfig((prev) => {
                          const list = [...(prev.cultivation.customTasks || [])];
                          const cur = list[idx];
                          const nextStages = new Set(cur.stages || []);
                          if (on) nextStages.add(st);
                          else nextStages.delete(st);
                          list[idx] = {
                            ...cur,
                            stages: [...nextStages],
                          };
                          return {
                            ...prev,
                            cultivation: { ...prev.cultivation, customTasks: list },
                          };
                        });
                      }}
                    />
                    {st}
                  </label>
                ))}
              </div>
              <label style={{ ...styles.label, margin: 0 }}>
                Rewards
                <input
                  type="checkbox"
                  checked={row.rewardsEligible !== false}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setConfig((prev) => {
                      const list = [...(prev.cultivation.customTasks || [])];
                      list[idx] = { ...list[idx], rewardsEligible: v };
                      return {
                        ...prev,
                        cultivation: { ...prev.cultivation, customTasks: list },
                      };
                    });
                  }}
                />
              </label>
              <label style={styles.label}>
                Tier pts ×
                <input
                  style={styles.input}
                  type="number"
                  step={0.25}
                  min={0}
                  value={row.tierPointsMultiplier ?? 1}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setConfig((prev) => {
                      const list = [...(prev.cultivation.customTasks || [])];
                      list[idx] = { ...list[idx], tierPointsMultiplier: v };
                      return {
                        ...prev,
                        cultivation: { ...prev.cultivation, customTasks: list },
                      };
                    });
                  }}
                />
              </label>
              <button
                type="button"
                style={{ ...styles.deleteButton, justifySelf: "end" }}
                onClick={() => {
                  setConfig((prev) => ({
                    ...prev,
                    cultivation: {
                      ...prev.cultivation,
                      customTasks: (prev.cultivation.customTasks || []).filter((_, i) => i !== idx),
                    },
                  }));
                }}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            style={{ ...styles.addButton, alignSelf: "start" }}
            onClick={() => {
              setConfig((prev) => ({
                ...prev,
                cultivation: {
                  ...prev.cultivation,
                  customTasks: [
                    ...(prev.cultivation.customTasks || []),
                    {
                      id: makeId("cult-task"),
                      label: "",
                      rewardsEligible: true,
                      tierPointsMultiplier: 1,
                      stages: [],
                    },
                  ],
                },
              }));
            }}
          >
            Add cultivation task
          </button>
        </div>

        <h4 style={{ ...styles.subTitle, fontSize: 16, marginTop: 20, marginBottom: 8 }}>
          Cultivation schedule templates
        </h4>
        <p style={{ color: "#94a3b8", fontSize: 14, marginTop: 0, marginBottom: 12, lineHeight: 1.5 }}>
          Tasks below are added to the <b>Cultivation → Schedule</b> calendar for each active batch.{" "}
          <b>Clone</b> rows use the batch clone date. <b>Veg</b> rows use the first logged move-to-veg date.{" "}
          <b>Flower</b> rows use the first logged move-to-flower date. Offsets are whole days after that anchor.
          Operators can still edit or move a generated row on the calendar; those edits are not overwritten by sync.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
          {(config.cultivation.scheduleTemplates || []).map((row, idx) => (
            <div
              key={row.id || `cult-st-${idx}`}
              style={{
                ...styles.grid,
                border: "1px solid #334155",
                borderRadius: 10,
                padding: 10,
                alignItems: "center",
              }}
            >
              <label style={{ ...styles.label, margin: 0 }}>
                Stage
                <select
                  style={styles.input}
                  value={row.stage}
                  onChange={(e) => {
                    const v = e.target.value as "clone" | "veg" | "flower";
                    setConfig((prev) => {
                      const list = [...(prev.cultivation.scheduleTemplates || [])];
                      list[idx] = { ...list[idx], stage: v };
                      return {
                        ...prev,
                        cultivation: { ...prev.cultivation, scheduleTemplates: list },
                      };
                    });
                  }}
                >
                  <option value="clone">Clone (from clone date)</option>
                  <option value="veg">Veg (from first veg move date)</option>
                  <option value="flower">Flower (from first flower move date)</option>
                </select>
              </label>
              <input
                style={styles.input}
                placeholder="Calendar task title"
                value={row.title}
                onChange={(e) => {
                  const v = e.target.value;
                  setConfig((prev) => {
                    const list = [...(prev.cultivation.scheduleTemplates || [])];
                    list[idx] = { ...list[idx], title: v };
                    return {
                      ...prev,
                      cultivation: { ...prev.cultivation, scheduleTemplates: list },
                    };
                  });
                }}
              />
              <label style={styles.label}>
                Days after stage start
                <input
                  style={styles.input}
                  type="number"
                  step={1}
                  value={Number.isFinite(row.daysFromStageStart) ? row.daysFromStageStart : 0}
                  onChange={(e) => {
                    const v = Math.trunc(Number(e.target.value));
                    setConfig((prev) => {
                      const list = [...(prev.cultivation.scheduleTemplates || [])];
                      list[idx] = {
                        ...list[idx],
                        daysFromStageStart: Number.isFinite(v) ? v : 0,
                      };
                      return {
                        ...prev,
                        cultivation: { ...prev.cultivation, scheduleTemplates: list },
                      };
                    });
                  }}
                />
              </label>
              <input
                style={styles.input}
                placeholder="Default notes (optional)"
                value={row.defaultNotes ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setConfig((prev) => {
                    const list = [...(prev.cultivation.scheduleTemplates || [])];
                    list[idx] = { ...list[idx], defaultNotes: v || undefined };
                    return {
                      ...prev,
                      cultivation: { ...prev.cultivation, scheduleTemplates: list },
                    };
                  });
                }}
              />
              <button
                type="button"
                style={{ ...styles.deleteButton, justifySelf: "end" }}
                onClick={() => {
                  setConfig((prev) => ({
                    ...prev,
                    cultivation: {
                      ...prev.cultivation,
                      scheduleTemplates: (prev.cultivation.scheduleTemplates || []).filter((_, i) => i !== idx),
                    },
                  }));
                }}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            style={{ ...styles.addButton, alignSelf: "start" }}
            onClick={() => {
              setConfig((prev) => ({
                ...prev,
                cultivation: {
                  ...prev.cultivation,
                  scheduleTemplates: [
                    ...(prev.cultivation.scheduleTemplates || []),
                    {
                      id: makeId("cult-stpl"),
                      stage: "clone",
                      title: "",
                      daysFromStageStart: 0,
                    },
                  ],
                },
              }));
            }}
          >
            Add schedule template
          </button>
        </div>

        <h4 style={{ ...styles.subTitle, fontSize: 16, marginBottom: 8 }}>Extraction</h4>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
          {(config.extraction.customTasks || []).map((row, idx) => (
            <div
              key={row.id || `ext-ct-${idx}`}
              style={{
                ...styles.grid,
                border: "1px solid #334155",
                borderRadius: 10,
                padding: 10,
                alignItems: "center",
              }}
            >
              <input
                style={styles.input}
                placeholder="Task name"
                value={row.label}
                onChange={(e) => {
                  const v = e.target.value;
                  setConfig((prev) => {
                    const list = [...(prev.extraction.customTasks || [])];
                    list[idx] = { ...list[idx], label: v };
                    return {
                      ...prev,
                      extraction: { ...prev.extraction, customTasks: list },
                    };
                  });
                }}
              />
              <label style={{ ...styles.label, margin: 0 }}>
                Rewards
                <input
                  type="checkbox"
                  checked={row.rewardsEligible !== false}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setConfig((prev) => {
                      const list = [...(prev.extraction.customTasks || [])];
                      list[idx] = { ...list[idx], rewardsEligible: v };
                      return {
                        ...prev,
                        extraction: { ...prev.extraction, customTasks: list },
                      };
                    });
                  }}
                />
              </label>
              <label style={styles.label}>
                Tier pts ×
                <input
                  style={styles.input}
                  type="number"
                  step={0.25}
                  min={0}
                  value={row.tierPointsMultiplier ?? 1}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setConfig((prev) => {
                      const list = [...(prev.extraction.customTasks || [])];
                      list[idx] = { ...list[idx], tierPointsMultiplier: v };
                      return {
                        ...prev,
                        extraction: { ...prev.extraction, customTasks: list },
                      };
                    });
                  }}
                />
              </label>
              <button
                type="button"
                style={{ ...styles.deleteButton, justifySelf: "end" }}
                onClick={() => {
                  setConfig((prev) => ({
                    ...prev,
                    extraction: {
                      ...prev.extraction,
                      customTasks: (prev.extraction.customTasks || []).filter((_, i) => i !== idx),
                    },
                  }));
                }}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            style={{ ...styles.addButton, alignSelf: "start" }}
            onClick={() => {
              setConfig((prev) => ({
                ...prev,
                extraction: {
                  ...prev.extraction,
                  customTasks: [
                    ...(prev.extraction.customTasks || []),
                    {
                      id: makeId("ext-task"),
                      label: "",
                      rewardsEligible: true,
                      tierPointsMultiplier: 1,
                    },
                  ],
                },
              }));
            }}
          >
            Add extraction task
          </button>
        </div>

        <h4 style={{ ...styles.subTitle, fontSize: 16, marginBottom: 8 }}>Packaging</h4>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
          {(config.packaging.customTasks || []).map((row, idx) => (
            <div
              key={row.id || `pkg-ct-${idx}`}
              style={{
                ...styles.grid,
                border: "1px solid #334155",
                borderRadius: 10,
                padding: 10,
                alignItems: "center",
              }}
            >
              <input
                style={styles.input}
                placeholder="Task name"
                value={row.label}
                onChange={(e) => {
                  const v = e.target.value;
                  setConfig((prev) => {
                    const list = [...(prev.packaging.customTasks || [])];
                    list[idx] = { ...list[idx], label: v };
                    return {
                      ...prev,
                      packaging: { ...prev.packaging, customTasks: list },
                    };
                  });
                }}
              />
              <label style={{ ...styles.label, margin: 0 }}>
                Rewards
                <input
                  type="checkbox"
                  checked={row.rewardsEligible !== false}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setConfig((prev) => {
                      const list = [...(prev.packaging.customTasks || [])];
                      list[idx] = { ...list[idx], rewardsEligible: v };
                      return {
                        ...prev,
                        packaging: { ...prev.packaging, customTasks: list },
                      };
                    });
                  }}
                />
              </label>
              <label style={styles.label}>
                Tier pts ×
                <input
                  style={styles.input}
                  type="number"
                  step={0.25}
                  min={0}
                  value={row.tierPointsMultiplier ?? 1}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setConfig((prev) => {
                      const list = [...(prev.packaging.customTasks || [])];
                      list[idx] = { ...list[idx], tierPointsMultiplier: v };
                      return {
                        ...prev,
                        packaging: { ...prev.packaging, customTasks: list },
                      };
                    });
                  }}
                />
              </label>
              <button
                type="button"
                style={{ ...styles.deleteButton, justifySelf: "end" }}
                onClick={() => {
                  setConfig((prev) => ({
                    ...prev,
                    packaging: {
                      ...prev.packaging,
                      customTasks: (prev.packaging.customTasks || []).filter((_, i) => i !== idx),
                    },
                  }));
                }}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            style={{ ...styles.addButton, alignSelf: "start" }}
            onClick={() => {
              setConfig((prev) => ({
                ...prev,
                packaging: {
                  ...prev.packaging,
                  customTasks: [
                    ...(prev.packaging.customTasks || []),
                    {
                      id: makeId("pkg-task"),
                      label: "",
                      rewardsEligible: true,
                      tierPointsMultiplier: 1,
                    },
                  ],
                },
              }));
            }}
          >
            Add packaging task
          </button>
        </div>
        </div>

        <div style={styles.configSubCardLast}>
        <h3 style={{ ...styles.subTitle, marginTop: 0 }}>Labor — breaks & lunch (facility clock)</h3>
        <p style={{ color: "#94a3b8", fontSize: 14, marginTop: 0, marginBottom: 12, lineHeight: 1.5 }}>
          When operators log cultivation tasks using <b>start / end time</b>, overlaps with these windows are subtracted
          from net labor (person-minutes). Use 24-hour times (e.g. lunch <code>12:00</code>–<code>13:00</code>). Same
          calendar day only; overnight breaks should be split into two rows.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {(config.company.settings.laborBreaks || []).map((row, idx) => (
            <div
              key={row.id || `lb-${idx}`}
              style={{
                ...styles.grid,
                border: "1px solid #334155",
                borderRadius: 10,
                padding: 10,
                margin: 0,
              }}
            >
              <input
                style={styles.input}
                placeholder="Label (e.g. Lunch)"
                value={row.label}
                onChange={(e) => {
                  const v = e.target.value;
                  setConfig((prev) => {
                    const list = [...(prev.company.settings.laborBreaks || [])];
                    list[idx] = { ...list[idx], label: v };
                    return {
                      ...prev,
                      company: {
                        ...prev.company,
                        settings: { ...prev.company.settings, laborBreaks: list },
                      },
                    };
                  });
                }}
              />
              <label style={styles.label}>
                Start (HH:mm)
                <input
                  style={styles.input}
                  type="time"
                  value={row.start}
                  onChange={(e) => {
                    const v = e.target.value;
                    setConfig((prev) => {
                      const list = [...(prev.company.settings.laborBreaks || [])];
                      list[idx] = { ...list[idx], start: v };
                      return {
                        ...prev,
                        company: {
                          ...prev.company,
                          settings: { ...prev.company.settings, laborBreaks: list },
                        },
                      };
                    });
                  }}
                />
              </label>
              <label style={styles.label}>
                End (HH:mm)
                <input
                  style={styles.input}
                  type="time"
                  value={row.end}
                  onChange={(e) => {
                    const v = e.target.value;
                    setConfig((prev) => {
                      const list = [...(prev.company.settings.laborBreaks || [])];
                      list[idx] = { ...list[idx], end: v };
                      return {
                        ...prev,
                        company: {
                          ...prev.company,
                          settings: { ...prev.company.settings, laborBreaks: list },
                        },
                      };
                    });
                  }}
                />
              </label>
              <button
                type="button"
                style={{ ...styles.deleteButton, alignSelf: "end" }}
                onClick={() => {
                  setConfig((prev) => ({
                    ...prev,
                    company: {
                      ...prev.company,
                      settings: {
                        ...prev.company.settings,
                        laborBreaks: (prev.company.settings.laborBreaks || []).filter((_, i) => i !== idx),
                      },
                    },
                  }));
                }}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            style={{ ...styles.saveButton, alignSelf: "flex-start" }}
            onClick={() =>
              setConfig((prev) => ({
                ...prev,
                company: {
                  ...prev.company,
                  settings: {
                    ...prev.company.settings,
                    laborBreaks: [
                      ...(prev.company.settings.laborBreaks || []),
                      { id: makeId("lb"), label: "Break", start: "10:00", end: "10:15" },
                    ],
                  },
                },
              }))
            }
          >
            + Add break / lunch window
          </button>
        </div>
        <LeafLinkConfigCard />
        <MarketplaceLeafLinkSyncCard />
        </div>
      </CollapsibleConfigSection>

      <CollapsibleConfigSection
        sectionStyle={{ ...styles.card, marginTop: 18 }}
        sectionNumber="2"
        title="Sales"
        summaryCollapsed={
          <>
            Contact:{" "}
            <b style={{ color: "#e2e8f0" }}>
              {(config.sales.primaryContactName || "").trim() || "—"}
            </b>
            {(config.sales.primaryContactEmail || "").trim()
              ? ` · ${(config.sales.primaryContactEmail || "").trim()}`
              : ""}
            {" · "}
            LeafLink categories mapped:{" "}
            <b style={{ color: "#e2e8f0" }}>{config.sales.leafLinkCategoryLabels.length}</b>
            {(config.sales.inventoryPrintLogoUrl || "").trim() ? (
              <>
                {" · "}
                Print logo: <b style={{ color: "#86efac" }}>set</b>
              </>
            ) : null}
          </>
        }
      >
        <div style={styles.configSubCard}>
          <p style={{ color: "#94a3b8", fontSize: 14, marginTop: 0, marginBottom: 14, lineHeight: 1.55 }}>
            Wholesale and order reference for your team. This does not change LeafLink — it is stored in NexBatch
            company config for internal use.
          </p>
          <div style={styles.grid}>
            <label style={styles.label}>
              Primary contact name
              <input
                style={styles.input}
                value={config.sales.primaryContactName}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    sales: { ...prev.sales, primaryContactName: e.target.value },
                  }))
                }
              />
            </label>
            <label style={styles.label}>
              Email
              <input
                style={styles.input}
                type="email"
                autoComplete="off"
                value={config.sales.primaryContactEmail}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    sales: { ...prev.sales, primaryContactEmail: e.target.value },
                  }))
                }
              />
            </label>
            <label style={styles.label}>
              Phone
              <input
                style={styles.input}
                autoComplete="off"
                value={config.sales.primaryContactPhone}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    sales: { ...prev.sales, primaryContactPhone: e.target.value },
                  }))
                }
              />
            </label>
            <label style={{ ...styles.label, gridColumn: "1 / -1" }}>
              Default payment terms
              <input
                style={styles.input}
                placeholder="e.g. Net 30, COD, prepay"
                value={config.sales.defaultPaymentTerms}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    sales: { ...prev.sales, defaultPaymentTerms: e.target.value },
                  }))
                }
              />
            </label>
            <label style={{ ...styles.label, gridColumn: "1 / -1" }}>
              Wholesale / ordering portal URL (optional)
              <input
                style={styles.input}
                placeholder="https://…"
                spellCheck={false}
                value={config.sales.wholesalePortalUrl}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    sales: { ...prev.sales, wholesalePortalUrl: e.target.value },
                  }))
                }
              />
            </label>
            <label style={{ ...styles.label, gridColumn: "1 / -1" }}>
              Fulfillment &amp; order policy notes
              <textarea
                style={{ ...styles.input, minHeight: 100, resize: "vertical" as const }}
                placeholder="Cutoff times, minimums, delivery regions, etc."
                value={config.sales.fulfillmentNotes}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    sales: { ...prev.sales, fulfillmentNotes: e.target.value },
                  }))
                }
              />
            </label>
          </div>

          <h3 style={{ ...styles.subTitle, marginTop: 22, marginBottom: 8 }}>Inventory print branding</h3>
          <p style={{ color: "#94a3b8", fontSize: 14, marginTop: 0, marginBottom: 14, lineHeight: 1.55 }}>
            Optional logo for the <b style={{ color: "#cbd5e1" }}>Printable menu</b> on the Inventory page. Upload
            adds the file on the API server; click <b style={{ color: "#cbd5e1" }}>Save Config</b> below to store the
            URL in company settings. In production, persistent object storage (S3/R2) must be configured on the API.
            Use <b style={{ color: "#cbd5e1" }}>max height</b> for tall marks; leave it at 0 for wide logos (width only).
          </p>
          <h4 style={{ color: "#cbd5e1", fontSize: 13, fontWeight: 800, margin: "0 0 8px" }}>
            App header (next to NexBatch)
          </h4>
          <p style={{ color: "#94a3b8", fontSize: 13, marginTop: 0, marginBottom: 10, lineHeight: 1.5 }}>
            Leave at <b style={{ color: "#cbd5e1" }}>0</b> to keep the default size (works well for wide horizontal
            logos). Set height and/or width when a mark is too small—tall logos often need a higher max height and a
            wider max width.
          </p>
          <div style={{ ...styles.grid, marginBottom: 12 }}>
            <label style={styles.label}>
              Header logo max height (px, 0 = default 56/64)
              <input
                style={styles.input}
                type="number"
                min={0}
                max={160}
                step={4}
                value={config.sales.companyHeaderLogoMaxHeightPx}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    sales: {
                      ...prev.sales,
                      companyHeaderLogoMaxHeightPx: clampCompanyHeaderLogoMaxHeightPx(Number(e.target.value)),
                    },
                  }))
                }
              />
            </label>
            <label style={styles.label}>
              Header logo max width (px, 0 = auto from height)
              <input
                style={styles.input}
                type="number"
                min={0}
                max={720}
                step={8}
                value={config.sales.companyHeaderLogoMaxWidthPx}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    sales: {
                      ...prev.sales,
                      companyHeaderLogoMaxWidthPx: clampCompanyHeaderLogoMaxWidthPx(Number(e.target.value)),
                    },
                  }))
                }
              />
            </label>
          </div>
          <h4 style={{ color: "#cbd5e1", fontSize: 13, fontWeight: 800, margin: "12px 0 8px" }}>
            Buyer marketplace (your logo on buyer catalog)
          </h4>
          <p style={{ color: "#94a3b8", fontSize: 13, marginTop: 0, marginBottom: 10, lineHeight: 1.5 }}>
            Leave both at <b style={{ color: "#cbd5e1" }}>0</b> for the compact default (fits wide BudFox-style wordmarks).
            Set heights only for marks that need more room—other sellers are unchanged.
          </p>
          <div style={{ ...styles.grid, marginBottom: 12 }}>
            <label style={styles.label}>
              Product card logo max height (px, 0 = default 36)
              <input
                style={styles.input}
                type="number"
                min={0}
                max={120}
                step={4}
                value={config.sales.marketplaceBuyerCardLogoMaxHeightPx}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    sales: {
                      ...prev.sales,
                      marketplaceBuyerCardLogoMaxHeightPx: clampMarketplaceBuyerCardLogoMaxHeightPx(
                        Number(e.target.value),
                      ),
                    },
                  }))
                }
              />
            </label>
            <label style={styles.label}>
              Company chip logo max height (px, 0 = default 44)
              <input
                style={styles.input}
                type="number"
                min={0}
                max={120}
                step={4}
                value={config.sales.marketplaceBuyerChipLogoMaxHeightPx}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    sales: {
                      ...prev.sales,
                      marketplaceBuyerChipLogoMaxHeightPx: clampMarketplaceBuyerChipLogoMaxHeightPx(
                        Number(e.target.value),
                      ),
                    },
                  }))
                }
              />
            </label>
          </div>
          <h4 style={{ color: "#cbd5e1", fontSize: 13, fontWeight: 800, margin: "0 0 8px" }}>
            Printable inventory menu
          </h4>
          <div style={{ ...styles.grid, marginBottom: 8 }}>
            <label style={styles.label}>
              Logo max width on print (px, 48–720)
              <input
                style={styles.input}
                type="number"
                min={48}
                max={720}
                step={8}
                value={config.sales.inventoryPrintLogoMaxWidthPx}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    sales: {
                      ...prev.sales,
                      inventoryPrintLogoMaxWidthPx: clampInventoryLogoMaxWidthPx(Number(e.target.value)),
                    },
                  }))
                }
              />
            </label>
            <label style={styles.label}>
              Logo max height on print (px, 0 = no cap)
              <input
                style={styles.input}
                type="number"
                min={0}
                max={560}
                step={8}
                value={config.sales.inventoryPrintLogoMaxHeightPx}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    sales: {
                      ...prev.sales,
                      inventoryPrintLogoMaxHeightPx: clampInventoryLogoMaxHeightPx(Number(e.target.value)),
                    },
                  }))
                }
              />
            </label>
            <div style={{ gridColumn: "1 / -1", display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
              <input
                ref={companyLogoFileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void uploadInventoryPrintLogo(f);
                }}
              />
              <button
                type="button"
                style={styles.saveButton}
                disabled={companyLogoUploading}
                onClick={() => companyLogoFileRef.current?.click()}
              >
                {companyLogoUploading ? "Uploading…" : "Upload logo image"}
              </button>
              <button
                type="button"
                style={styles.deleteButton}
                disabled={!(config.sales.inventoryPrintLogoUrl || "").trim()}
                onClick={() =>
                  setConfig((prev) => ({
                    ...prev,
                    sales: { ...prev.sales, inventoryPrintLogoUrl: "" },
                  }))
                }
              >
                Clear logo URL
              </button>
            </div>
            {(config.sales.inventoryPrintLogoUrl || "").trim() ? (
              <div style={{ gridColumn: "1 / -1" }}>
                <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 8 }}>Preview</div>
                <img
                  src={resolveCompanyLogoImgSrc(
                    (config.sales.inventoryPrintLogoUrl || "").trim(),
                    API_BASE_URL,
                  )}
                  alt="Company logo preview"
                  style={{
                    maxWidth: Math.min(640, config.sales.inventoryPrintLogoMaxWidthPx),
                    maxHeight:
                      config.sales.inventoryPrintLogoMaxHeightPx > 0
                        ? config.sales.inventoryPrintLogoMaxHeightPx
                        : 240,
                    width: "auto",
                    height: "auto",
                    objectFit: "contain",
                    borderRadius: 8,
                    border: "1px solid rgba(148,163,184,0.35)",
                  }}
                />
              </div>
            ) : null}
          </div>

          <h3 style={{ ...styles.subTitle, marginTop: 22, marginBottom: 8 }}>LeafLink category names</h3>
          <p style={{ color: "#94a3b8", fontSize: 14, marginTop: 0, marginBottom: 14, lineHeight: 1.55 }}>
            LeafLink often sends numeric category ids (shown as <b style={{ color: "#cbd5e1" }}>Category #5</b> in
            Inventory). Map each id to the real category name (Flower, Concentrates, …). Save config, then refresh
            Inventory to see the names in filters and the table.
          </p>
          <div style={{ display: "grid", gap: 10 }}>
            {(config.sales.leafLinkCategoryLabels || []).map((row, idx) => (
              <div
                key={`${row.id}-${idx}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) auto",
                  gap: 10,
                  alignItems: "end",
                }}
              >
                <label style={styles.label}>
                  LeafLink category id
                  <input
                    style={styles.input}
                    placeholder="e.g. 5 or Category #5"
                    value={row.id}
                    onChange={(e) => {
                      const v = e.target.value;
                      setConfig((prev) => ({
                        ...prev,
                        sales: {
                          ...prev.sales,
                          leafLinkCategoryLabels: prev.sales.leafLinkCategoryLabels.map((r, i) =>
                            i === idx ? { ...r, id: v } : r,
                          ),
                        },
                      }));
                    }}
                  />
                </label>
                <label style={styles.label}>
                  Display name
                  <input
                    style={styles.input}
                    placeholder="e.g. Concentrates"
                    value={row.displayName}
                    onChange={(e) => {
                      const v = e.target.value;
                      setConfig((prev) => ({
                        ...prev,
                        sales: {
                          ...prev.sales,
                          leafLinkCategoryLabels: prev.sales.leafLinkCategoryLabels.map((r, i) =>
                            i === idx ? { ...r, displayName: v } : r,
                          ),
                        },
                      }));
                    }}
                  />
                </label>
                <button
                  type="button"
                  style={{ ...styles.deleteButton, marginBottom: 2 }}
                  onClick={() =>
                    setConfig((prev) => ({
                      ...prev,
                      sales: {
                        ...prev.sales,
                        leafLinkCategoryLabels: prev.sales.leafLinkCategoryLabels.filter((_, i) => i !== idx),
                      },
                    }))
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              style={{ ...styles.saveButton, alignSelf: "flex-start" }}
              onClick={() =>
                setConfig((prev) => ({
                  ...prev,
                  sales: {
                    ...prev.sales,
                    leafLinkCategoryLabels: [
                      ...prev.sales.leafLinkCategoryLabels,
                      { id: "", displayName: "" },
                    ],
                  },
                }))
              }
            >
              + Add LeafLink category mapping
            </button>
          </div>
        </div>
      </CollapsibleConfigSection>

      <CollapsibleConfigSection
        sectionStyle={{ ...styles.card, marginTop: 18 }}
        sectionNumber="3"
        title="Products"
        summaryCollapsed={
          <>
            Merchandising notes:{" "}
            <b style={{ color: "#e2e8f0" }}>
              {(config.products.notes || "").trim() ? "set" : "—"}
            </b>
          </>
        }
      >
        <div style={styles.configSubCard}>
          <p style={{ color: "#94a3b8", fontSize: 14, marginTop: 0, marginBottom: 14, lineHeight: 1.55 }}>
            Internal notes for SKUs, naming, or merchandising. LeafLink category display names are configured under{" "}
            <b style={{ color: "#cbd5e1" }}>Sales</b>.
          </p>
          <label style={{ ...styles.label, gridColumn: "1 / -1" }}>
            Product / merchandising notes (internal)
            <textarea
              style={{ ...styles.input, minHeight: 88, resize: "vertical" as const }}
              placeholder="Optional context for SKUs, naming conventions, etc."
              value={config.products.notes}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  products: { ...prev.products, notes: e.target.value },
                }))
              }
            />
          </label>
        </div>
      </CollapsibleConfigSection>

      <CollapsibleConfigSection
        sectionStyle={{ ...styles.card, marginTop: 18 }}
        sectionNumber="4"
        title="Climate control"
        summaryCollapsed={
          <>
            Autogrow:{" "}
            <b style={{ color: "#e2e8f0" }}>
              {config.company.climateControl.autogrow.integrationEnabled ? "enabled" : "disabled"}
            </b>
            {config.company.climateControl.autogrow.deviceUuid.trim()
              ? ` · UUID …${config.company.climateControl.autogrow.deviceUuid.trim().slice(-8)}`
              : ""}
          </>
        }
      >
        <div style={styles.configSubCard}>
        <h3 style={{ ...styles.subTitle, marginTop: 0 }}>Autogrow (MultiGrow)</h3>
        <p style={{ color: "#94a3b8", fontSize: 14, marginTop: 0, marginBottom: 14, lineHeight: 1.55 }}>
          API key from{" "}
          <a href="https://my.autogrow.com/" target="_blank" rel="noopener noreferrer" style={{ color: "#93c5fd" }}>
            my.autogrow.com
          </a>
          ; device UUID from your MultiGrow controller. Readings are fetched server-side (~750 ms between compartments) —
          enable only when configured.
        </p>

        <label style={{ ...styles.label, display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={config.company.climateControl.autogrow.integrationEnabled}
            onChange={(e) =>
              setConfig((prev) => ({
                ...prev,
                company: {
                  ...prev.company,
                  climateControl: {
                    ...prev.company.climateControl,
                    autogrow: {
                      ...prev.company.climateControl.autogrow,
                      integrationEnabled: e.target.checked,
                    },
                  },
                },
              }))
            }
          />
          Enable Autogrow reads for cultivation room stats (server-side)
        </label>

        <div style={styles.grid}>
          <label style={{ ...styles.label, gridColumn: "1 / -1" }}>
            MultiGrow device UUID
            <input
              style={styles.input}
              placeholder="e.g. 4dca6b5579d9629db95db54764b3cd29"
              spellCheck={false}
              autoComplete="off"
              value={config.company.climateControl.autogrow.deviceUuid}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  company: {
                    ...prev.company,
                    climateControl: {
                      ...prev.company.climateControl,
                      autogrow: { ...prev.company.climateControl.autogrow, deviceUuid: e.target.value },
                    },
                  },
                }))
              }
            />
          </label>
        </div>

        <label style={{ ...styles.label, display: "flex", alignItems: "center", gap: 10, marginBottom: 12, marginTop: 8 }}>
          <input
            type="checkbox"
            checked={showAutogrowSecrets}
            onChange={(e) => setShowAutogrowSecrets(e.target.checked)}
          />
          Show Autogrow API key on screen
        </label>

        <label style={{ ...styles.label, gridColumn: "1 / -1" }}>
          API key (Bearer)
          {showAutogrowSecrets ? (
            <textarea
              style={{
                ...styles.textarea,
                minHeight: 72,
                fontFamily: "ui-monospace, monospace",
                wordBreak: "break-all",
              }}
              rows={3}
              spellCheck={false}
              autoComplete="off"
              value={config.company.climateControl.autogrow.apiKey}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  company: {
                    ...prev.company,
                    climateControl: {
                      ...prev.company.climateControl,
                      autogrow: { ...prev.company.climateControl.autogrow, apiKey: e.target.value },
                    },
                  },
                }))
              }
            />
          ) : (
            <input
              style={styles.input}
              type="password"
              autoComplete="off"
              value={config.company.climateControl.autogrow.apiKey}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  company: {
                    ...prev.company,
                    climateControl: {
                      ...prev.company.climateControl,
                      autogrow: { ...prev.company.climateControl.autogrow, apiKey: e.target.value },
                    },
                  },
                }))
              }
            />
          )}
        </label>

        <label style={{ ...styles.label, gridColumn: "1 / -1", marginTop: 8 }}>
          Internal notes (not sent to Autogrow)
          <textarea
            style={{ ...styles.textarea, minHeight: 56 }}
            value={config.company.climateControl.autogrow.notes}
            onChange={(e) =>
              setConfig((prev) => ({
                ...prev,
                company: {
                  ...prev.company,
                  climateControl: {
                    ...prev.company.climateControl,
                    autogrow: { ...prev.company.climateControl.autogrow, notes: e.target.value },
                  },
                },
              }))
            }
          />
        </label>
        </div>

        <div style={styles.configSubCard}>
        <h4 style={{ ...styles.subTitle, fontSize: 16, marginTop: 0 }}>Zone labels (`comps` index)</h4>
        <p style={{ color: "#94a3b8", fontSize: 13, marginTop: 0, marginBottom: 10 }}>
          Optional friendly names per compartment index for the Room stats pages.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {(config.company.climateControl.autogrow.compLabels || []).map((row, idx) => (
            <div
              key={`ag-cl-${idx}-${row.compIndex}`}
              style={{ ...styles.grid, border: "1px solid #334155", borderRadius: 10, padding: 10, alignItems: "center" }}
            >
              <label style={styles.label}>
                Comp #
                <input
                  style={styles.input}
                  type="number"
                  min={0}
                  step={1}
                  value={row.compIndex}
                  onChange={(e) => {
                    const v = Math.max(0, Math.floor(Number(e.target.value) || 0));
                    setConfig((prev) => {
                      const list = [...(prev.company.climateControl.autogrow.compLabels || [])];
                      list[idx] = { ...list[idx], compIndex: v };
                      return {
                        ...prev,
                        company: {
                          ...prev.company,
                          climateControl: {
                            ...prev.company.climateControl,
                            autogrow: { ...prev.company.climateControl.autogrow, compLabels: list },
                          },
                        },
                      };
                    });
                  }}
                />
              </label>
              <label style={{ ...styles.label, gridColumn: "span 2" }}>
                Display name
                <input
                  style={styles.input}
                  value={row.label}
                  placeholder="Flower 3"
                  onChange={(e) => {
                    const v = e.target.value;
                    setConfig((prev) => {
                      const list = [...(prev.company.climateControl.autogrow.compLabels || [])];
                      list[idx] = { ...list[idx], label: v };
                      return {
                        ...prev,
                        company: {
                          ...prev.company,
                          climateControl: {
                            ...prev.company.climateControl,
                            autogrow: { ...prev.company.climateControl.autogrow, compLabels: list },
                          },
                        },
                      };
                    });
                  }}
                />
              </label>
              <button
                type="button"
                style={{ ...styles.deleteButton, justifySelf: "end" }}
                onClick={() =>
                  setConfig((prev) => ({
                    ...prev,
                    company: {
                      ...prev.company,
                      climateControl: {
                        ...prev.company.climateControl,
                        autogrow: {
                          ...prev.company.climateControl.autogrow,
                          compLabels: (prev.company.climateControl.autogrow.compLabels || []).filter((_, i) => i !== idx),
                        },
                      },
                    },
                  }))
                }
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            style={{ ...styles.addButton, alignSelf: "start" }}
            onClick={() =>
              setConfig((prev) => ({
                ...prev,
                company: {
                  ...prev.company,
                  climateControl: {
                    ...prev.company.climateControl,
                    autogrow: {
                      ...prev.company.climateControl.autogrow,
                      compLabels: [
                        ...(prev.company.climateControl.autogrow.compLabels || []),
                        { compIndex: 0, label: "" },
                      ],
                    },
                  },
                },
              }))
            }
          >
            + Add zone label
          </button>
        </div>
        </div>

        <div style={styles.configSubCard}>
          <h3 style={{ ...styles.subTitle, marginTop: 0 }}>Climate alerts (temperature &amp; humidity)</h3>
          <p style={{ color: "#94a3b8", fontSize: 14, marginTop: 0, marginBottom: 14, lineHeight: 1.5 }}>
            Uses live readings from <b style={{ color: "#e2e8f0" }}>Autogrow</b> (configured above). Each row targets the same{" "}
            <b style={{ color: "#e2e8f0" }}>comp #</b> as <b style={{ color: "#e2e8f0" }}>Zone labels</b>{" "}
            above and cultivation room stats — alert messages use that room name. When a reading crosses a limit, subscribed employees get an
            app notification. Point a scheduler at{" "}
            <code style={{ color: "#86efac" }}>POST /api/internal/jobs/cultivation-climate-alerts</code> with{" "}
            <code style={{ color: "#86efac" }}>Authorization: Bearer CRON_SECRET</code> (same as other internal jobs).
          </p>
          <label style={{ ...styles.label, display: "flex", alignItems: "center", gap: 10 }}>
            <input
              type="checkbox"
              checked={(config.cultivation.climateAlerts ?? defaultCultivationClimateAlerts).enabled === true}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  cultivation: {
                    ...prev.cultivation,
                    climateAlerts: {
                      ...(prev.cultivation.climateAlerts ?? { ...defaultCultivationClimateAlerts }),
                      enabled: e.target.checked,
                    },
                  },
                }))
              }
            />
            Enable climate threshold alerts
          </label>
          <label style={{ ...styles.label, marginTop: 12 }}>
            Cooldown between repeat alerts (minutes)
            <input
              style={styles.input}
              type="number"
              min={5}
              max={1440}
              value={(config.cultivation.climateAlerts ?? defaultCultivationClimateAlerts).cooldownMinutes}
              onChange={(e) => {
                const n = Number(e.target.value);
                setConfig((prev) => ({
                  ...prev,
                  cultivation: {
                    ...prev.cultivation,
                    climateAlerts: {
                      ...(prev.cultivation.climateAlerts ?? { ...defaultCultivationClimateAlerts }),
                      cooldownMinutes: Number.isFinite(n) && n >= 5 ? Math.round(n) : 45,
                    },
                  },
                }));
              }}
            />
          </label>
          <div style={{ marginTop: 16 }}>
            <div style={{ color: "#cbd5e1", fontWeight: 800, marginBottom: 8 }}>Zones</div>
            <p style={{ color: "#64748b", fontSize: 13, margin: "0 0 10px" }}>
              Leave a field empty for no limit on that side. Temperatures are °F; humidity is % RH. If you use{" "}
              <b style={{ color: "#94a3b8" }}>Zone labels</b> above, pick the room here; otherwise enter a comp #.
            </p>
            {(config.cultivation.climateAlerts ?? defaultCultivationClimateAlerts).zones.map((z, idx) => {
              const sortedAlertCompLabels = [
                ...(config.company.climateControl.autogrow.compLabels ?? []),
              ].sort((a, b) => a.compIndex - b.compIndex);
              const inListedCompLabels = sortedAlertCompLabels.some(
                (l) => Number(l.compIndex) === z.compIndex,
              );
              const roomTitle = labelForAutogrowComp(
                z.compIndex,
                config.company.climateControl.autogrow.compLabels,
              );
              return (
              <div
                key={`cz-${idx}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))",
                  gap: 10,
                  alignItems: "end",
                  marginBottom: 10,
                  padding: 12,
                  borderRadius: 12,
                  border: "1px solid rgba(51, 65, 85, 0.9)",
                  background: "rgba(15, 23, 42, 0.5)",
                }}
              >
                {sortedAlertCompLabels.length > 0 ? (
                  <label style={{ ...styles.label, gridColumn: "1 / -1" }}>
                    Room (labels above)
                    <select
                      style={styles.input}
                      value={inListedCompLabels ? String(z.compIndex) : "__other"}
                      onChange={(e) => {
                        const v = e.target.value;
                        setConfig((prev) => {
                          const ca = prev.cultivation.climateAlerts ?? { ...defaultCultivationClimateAlerts };
                          const zones = [...ca.zones];
                          if (v === "__other") {
                            const nextIdx =
                              sortedAlertCompLabels.length > 0
                                ? Math.max(...sortedAlertCompLabels.map((l) => l.compIndex)) + 1
                                : zones[idx]?.compIndex ?? 0;
                            zones[idx] = {
                              ...zones[idx],
                              compIndex: Number.isFinite(nextIdx) ? Math.max(0, nextIdx) : 0,
                            };
                          } else {
                            zones[idx] = {
                              ...zones[idx],
                              compIndex: Math.max(0, Math.floor(Number(v))),
                            };
                          }
                          return {
                            ...prev,
                            cultivation: { ...prev.cultivation, climateAlerts: { ...ca, zones } },
                          };
                        });
                      }}
                    >
                      {sortedAlertCompLabels.map((l) => (
                        <option key={l.compIndex} value={String(l.compIndex)}>
                          Comp {l.compIndex}
                          {String(l.label || "").trim() ? ` — ${String(l.label).trim()}` : ""}
                        </option>
                      ))}
                      <option value="__other">Other comp # (manual entry)…</option>
                    </select>
                    {inListedCompLabels ? (
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 6, lineHeight: 1.35 }}>
                        Notifications use this name:{" "}
                        <span style={{ color: "#a5b4fc", fontWeight: 700 }}>{roomTitle}</span>
                      </div>
                    ) : null}
                  </label>
                ) : null}
                {!sortedAlertCompLabels.length || !inListedCompLabels ? (
                  <label style={styles.label}>
                    {sortedAlertCompLabels.length ? "Comp # (manual)" : "Comp # (zone index)"}
                    <input
                      style={styles.input}
                      type="number"
                      min={0}
                      value={z.compIndex}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setConfig((prev) => {
                          const ca = prev.cultivation.climateAlerts ?? { ...defaultCultivationClimateAlerts };
                          const zones = [...ca.zones];
                          zones[idx] = {
                            ...zones[idx],
                            compIndex: Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0,
                          };
                          return {
                            ...prev,
                            cultivation: { ...prev.cultivation, climateAlerts: { ...ca, zones } },
                          };
                        });
                      }}
                    />
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 4, lineHeight: 1.35 }}>
                      Notifications use: <span style={{ color: "#a5b4fc", fontWeight: 700 }}>{roomTitle}</span>
                      {sortedAlertCompLabels.length ? (
                        <>
                          {" "}
                          (add a <b style={{ color: "#94a3b8" }}>Zone label</b> above to replace &quot;Zone{" "}
                          {z.compIndex}&quot;)
                        </>
                      ) : null}
                    </div>
                  </label>
                ) : null}
                <label style={styles.label}>
                  Temp min °F
                  <input
                    style={styles.input}
                    type="number"
                    placeholder="—"
                    value={z.tempMinF ?? ""}
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      setConfig((prev) => {
                        const ca = prev.cultivation.climateAlerts ?? { ...defaultCultivationClimateAlerts };
                        const zones = [...ca.zones];
                        const n = raw === "" ? null : Number(raw);
                        zones[idx] = {
                          ...zones[idx],
                          tempMinF: n != null && Number.isFinite(n) ? n : null,
                        };
                        return {
                          ...prev,
                          cultivation: { ...prev.cultivation, climateAlerts: { ...ca, zones } },
                        };
                      });
                    }}
                  />
                </label>
                <label style={styles.label}>
                  Temp max °F
                  <input
                    style={styles.input}
                    type="number"
                    placeholder="—"
                    value={z.tempMaxF ?? ""}
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      setConfig((prev) => {
                        const ca = prev.cultivation.climateAlerts ?? { ...defaultCultivationClimateAlerts };
                        const zones = [...ca.zones];
                        const n = raw === "" ? null : Number(raw);
                        zones[idx] = {
                          ...zones[idx],
                          tempMaxF: n != null && Number.isFinite(n) ? n : null,
                        };
                        return {
                          ...prev,
                          cultivation: { ...prev.cultivation, climateAlerts: { ...ca, zones } },
                        };
                      });
                    }}
                  />
                </label>
                <label style={styles.label}>
                  RH min %
                  <input
                    style={styles.input}
                    type="number"
                    placeholder="—"
                    value={z.rhMinPct ?? ""}
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      setConfig((prev) => {
                        const ca = prev.cultivation.climateAlerts ?? { ...defaultCultivationClimateAlerts };
                        const zones = [...ca.zones];
                        const n = raw === "" ? null : Number(raw);
                        zones[idx] = {
                          ...zones[idx],
                          rhMinPct: n != null && Number.isFinite(n) ? n : null,
                        };
                        return {
                          ...prev,
                          cultivation: { ...prev.cultivation, climateAlerts: { ...ca, zones } },
                        };
                      });
                    }}
                  />
                </label>
                <label style={styles.label}>
                  RH max %
                  <input
                    style={styles.input}
                    type="number"
                    placeholder="—"
                    value={z.rhMaxPct ?? ""}
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      setConfig((prev) => {
                        const ca = prev.cultivation.climateAlerts ?? { ...defaultCultivationClimateAlerts };
                        const zones = [...ca.zones];
                        const n = raw === "" ? null : Number(raw);
                        zones[idx] = {
                          ...zones[idx],
                          rhMaxPct: n != null && Number.isFinite(n) ? n : null,
                        };
                        return {
                          ...prev,
                          cultivation: { ...prev.cultivation, climateAlerts: { ...ca, zones } },
                        };
                      });
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setConfig((prev) => {
                      const ca = prev.cultivation.climateAlerts ?? { ...defaultCultivationClimateAlerts };
                      const zones = ca.zones.filter((_, j) => j !== idx);
                      return {
                        ...prev,
                        cultivation: { ...prev.cultivation, climateAlerts: { ...ca, zones } },
                      };
                    })
                  }
                  style={{
                    ...styles.deleteButton,
                    height: 40,
                    alignSelf: "end",
                  }}
                >
                  Remove
                </button>
              </div>
            );
            })}
            <button
              type="button"
              style={{ ...styles.cultivationBtnSecondary, marginTop: 6 }}
              onClick={() =>
                setConfig((prev) => {
                  const ca = prev.cultivation.climateAlerts ?? { ...defaultCultivationClimateAlerts };
                  const labels = prev.company.climateControl.autogrow.compLabels ?? [];
                  const sorted = [...labels].sort((a, b) => a.compIndex - b.compIndex);
                  const used = new Set(ca.zones.map((x) => x.compIndex));
                  const nextFromLabels = sorted.find((l) => !used.has(l.compIndex));
                  const nextComp =
                    nextFromLabels != null
                      ? nextFromLabels.compIndex
                      : ca.zones.length
                        ? Math.max(...ca.zones.map((x) => x.compIndex)) + 1
                        : 0;
                  return {
                    ...prev,
                    cultivation: {
                      ...prev.cultivation,
                      climateAlerts: {
                        ...ca,
                        zones: [
                          ...ca.zones,
                          {
                            compIndex: nextComp,
                            tempMinF: null,
                            tempMaxF: null,
                            rhMinPct: null,
                            rhMaxPct: null,
                          },
                        ],
                      },
                    },
                  };
                })
              }
            >
              + Add zone row
            </button>
          </div>
        </div>

        <div style={styles.configSubCardLast}>
        <h3 style={{ ...styles.subTitle, marginTop: 0, opacity: 0.85 }}>More climate systems</h3>
        <p style={{ color: "#64748b", fontSize: 13, marginBottom: 0 }}>
          Additional vendor integrations will appear here beside Autogrow.
        </p>
        </div>
      </CollapsibleConfigSection>

      <CollapsibleConfigSection
        sectionStyle={{ ...styles.card, marginTop: 18 }}
        sectionNumber="5"
        title="Cultivation"
        summaryCollapsed={
          <>
            {config.cultivation.strains.length} strain{config.cultivation.strains.length === 1 ? "" : "s"} ·{" "}
            {config.cultivation.rooms.vegRooms.length} veg · {config.cultivation.rooms.flowerRooms.length} flower ·{" "}
            {(config.cultivation.supplies || []).length} supply rows
            {(config.cultivation.freshFrozenGramsPerBundle ?? 0) > 0
              ? ` · FF ${config.cultivation.freshFrozenGramsPerBundle} g/bundle`
              : ""}
          </>
        }
      >
        <div style={{ ...styles.configSubCard, marginBottom: 16 }}>
          <h3 style={{ ...styles.subTitle, marginTop: 0 }}>Fresh Frozen harvest</h3>
          <p style={{ color: "#94a3b8", fontSize: 14, marginTop: 0, marginBottom: 12, lineHeight: 1.5 }}>
            Set the standard <b>grams per bundle</b> for Fresh Frozen. When greater than zero, the Cultivation harvest form
            auto-calculates bundle count from total grams (whole bundles only; operators can override). Extraction shows
            package weight as lbs, grams, and bundles on source cards.
          </p>
          <label style={styles.label}>
            Grams per bundle (0 = off, manual entry only)
            <input
              style={styles.input}
              type="number"
              min={0}
              step={1}
              value={config.cultivation.freshFrozenGramsPerBundle ?? 0}
              onChange={(e) => {
                const v = Math.max(0, Math.floor(Number(e.target.value) || 0));
                setConfig((prev) => ({
                  ...prev,
                  cultivation: { ...prev.cultivation, freshFrozenGramsPerBundle: v },
                }));
              }}
            />
          </label>
        </div>

        <details style={styles.cultivationStrainsOuter}>
          <summary style={styles.cultivationStrainsSummary}>
            <span>Add Strains</span>
            <span style={styles.cultivationStrainsSummaryMeta}>
              {config.cultivation.strains.length} strain{config.cultivation.strains.length === 1 ? "" : "s"}
            </span>
          </summary>
          <div style={styles.cultivationStrainsBody}>
        <details style={{ marginBottom: 8, color: "#94a3b8", fontSize: 12 }}>
          <summary style={{ cursor: "pointer", color: "#cbd5e1", fontWeight: 600 }}>
            How potency &amp; yield labels update from lab rollups
          </summary>
          <p style={{ margin: "6px 0 0", lineHeight: 1.45 }}>
            When cultivation data is rolled up, <b>Potency</b> and <b>Average yield</b> on each strain update from lab
            THC% and dry g/sq ft averages (defaults: THC under 16 = Low, 16–22 Medium, 22–28 High, 28+ Very High;
            yield under 18 g/sq ft Light, 18–42 Medium, over 42 Heavy). <b>Dominance</b> is not changed. Auto averages
            in each row are read-only snapshots from the same rollups.
          </p>
        </details>

        <div style={styles.cultivationFormGrid}>
          <input
            style={styles.cultivationField}
            placeholder="Strain Name"
            value={strainForm.name}
            onChange={(e) =>
              setStrainForm((prev) => ({ ...prev, name: e.target.value }))
            }
          />

          <input
            style={styles.cultivationField}
            placeholder="Acronym"
            value={strainForm.acronym}
            onChange={(e) =>
              setStrainForm((prev) => ({ ...prev, acronym: e.target.value }))
            }
          />

          <select
            style={styles.cultivationField}
            value={strainForm.dominance}
            onChange={(e) =>
              setStrainForm((prev) => ({ ...prev, dominance: e.target.value }))
            }
          >
            <option>Indica</option>
            <option>Sativa</option>
            <option>Hybrid</option>
            <option>Indica Hybrid</option>
            <option>Sativa Hybrid</option>
          </select>

          <select
            style={styles.cultivationField}
            value={strainForm.potency}
            onChange={(e) =>
              setStrainForm((prev) => ({ ...prev, potency: e.target.value }))
            }
          >
            <option>Low</option>
            <option>Medium</option>
            <option>High</option>
            <option>Very High</option>
          </select>

          <select
            style={styles.cultivationField}
            value={strainForm.averageYield}
            onChange={(e) =>
              setStrainForm((prev) => ({
                ...prev,
                averageYield: e.target.value,
              }))
            }
          >
            <option>Light</option>
            <option>Medium</option>
            <option>Heavy</option>
          </select>

          <div
            style={{
              gridColumn: "1 / -1",
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <button type="button" style={styles.cultivationBtnAdd} onClick={saveStrain}>
              {editingStrainId ? "Update strain" : "Add strain"}
            </button>
            {editingStrainId ? (
              <button type="button" style={styles.cultivationBtnSecondary} onClick={cancelStrainEdit}>
                Cancel edit
              </button>
            ) : null}
          </div>
        </div>

        <div style={styles.cultivationList}>
          {cultivationStrainsAlphabetical.map((strain) => (
            <div
              key={strain.id}
              style={{
                ...styles.cultivationRow,
                ...(editingStrainId === strain.id
                  ? {
                      borderColor: "#2563eb",
                      boxShadow: "0 0 0 1px rgba(37, 99, 235, 0.5)",
                    }
                  : {}),
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "baseline",
                  gap: "4px 8px",
                  flex: 1,
                  minWidth: 0,
                  fontSize: 13,
                  lineHeight: 1.4,
                }}
              >
                <span>
                  <strong>{strain.name}</strong> ({strain.acronym}) — {strain.dominance}, {strain.potency},{" "}
                  {strain.averageYield} yield
                </span>
                {(strain.autoAvgPotencyPct != null || strain.autoAvgDryYieldGPerSqFt != null) ? (
                  <span style={{ color: "#64748b", fontSize: 12 }}>
                    Auto{" "}
                    {strain.autoAvgPotencyPct != null ? `${strain.autoAvgPotencyPct}% THC` : "— potency"}
                    {" · "}
                    {strain.autoAvgDryYieldGPerSqFt != null
                      ? `${strain.autoAvgDryYieldGPerSqFt} g/sq ft`
                      : "— yield"}
                    {strain.autoMetricsSampleCount != null ? ` (n=${strain.autoMetricsSampleCount})` : ""}
                    {strain.autoMetricsUpdatedAt ? ` · ${strain.autoMetricsUpdatedAt.slice(0, 10)}` : ""}
                  </span>
                ) : null}
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
                <button type="button" style={styles.cultivationBtnSecondary} onClick={() => startEditStrain(strain)}>
                  Edit
                </button>
                <button type="button" style={styles.cultivationBtnDelete} onClick={() => removeStrain(strain.id)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
          </div>
        </details>

        <div style={styles.configSubCard}>
        <h3 style={{ ...styles.subTitle, marginTop: 0 }}>Cultivation Supplies & Cost</h3>

        <SupplyForm
          form={cultivationSupplyForm}
          setForm={setCultivationSupplyForm}
          onAdd={() => addSupply("cultivation")}
        />

        <SupplyList
          supplies={config.cultivation.supplies}
          onRemove={(id) => removeSupply("cultivation", id)}
        />
        </div>

        <div style={{ ...styles.configSubCard, padding: "12px 14px" }}>
        <h3 style={{ ...styles.subTitle, marginTop: 0, fontSize: 16 }}>Veg Rooms / Bays / Tables</h3>

        <details style={{ marginBottom: 8, color: "#94a3b8", fontSize: 12 }}>
          <summary style={{ cursor: "pointer", color: "#cbd5e1", fontWeight: 600 }}>
            Layout &amp; where veg locations appear
          </summary>
          <p style={{ margin: "6px 0 0", lineHeight: 1.45 }}>
            Same pattern as flower: <strong>Add room with layout</strong> names a veg room and creates bays (A, B, C, …)
            with numbered tables per bay. Those locations show when operators log <strong>Clone → Veg</strong>.
          </p>
        </details>

        <div style={{ ...styles.cultivationFormGrid, gridTemplateColumns: "repeat(auto-fill, minmax(112px, 1fr))" }}>
          <input
            style={styles.cultivationField}
            placeholder="Room name"
            value={vegRoomName}
            onChange={(e) => setVegRoomName(e.target.value)}
          />
          <input
            style={styles.cultivationField}
            placeholder="Bays #"
            inputMode="numeric"
            title="Number of bays"
            value={vegQuickBayCount}
            onChange={(e) => setVegQuickBayCount(e.target.value)}
          />
          <input
            style={styles.cultivationField}
            placeholder="Tables/bay"
            inputMode="numeric"
            title="Tables per bay"
            value={vegQuickTablesPerBay}
            onChange={(e) => setVegQuickTablesPerBay(e.target.value)}
          />
          <button
            type="button"
            title="Add room with bays and tables"
            style={styles.cultivationBtnAdd}
            onClick={addVegRoomWithLayout}
          >
            + Layout
          </button>
          <button
            type="button"
            title="Add empty room (add bays manually)"
            style={styles.cultivationBtnSecondary}
            onClick={addVegRoom}
          >
            + Empty
          </button>
        </div>

        <CultivationRoomAccordionList
          rooms={config.cultivation.rooms.vegRooms}
          onOpenAddBay={(roomId) => openAddBayModal("vegRooms", roomId)}
          onRemoveRoom={removeVegRoom}
          onOpenAddTable={(roomId, bayId) => openAddTableModal("vegRooms", roomId, bayId)}
          onEditTable={(roomId, bayId, tableId) => openEditTableModal("vegRooms", roomId, bayId, tableId)}
          onRemoveBay={(roomId, bayId) => removeBay("vegRooms", roomId, bayId)}
          onRemoveTable={(roomId, bayId, tableId) => removeTable("vegRooms", roomId, bayId, tableId)}
        />
        </div>

        <div style={{ ...styles.configSubCardLast, padding: "12px 14px" }}>
        <h3 style={{ ...styles.subTitle, marginTop: 0, fontSize: 16 }}>Flower Rooms / Bays / Tables</h3>

        <details style={{ marginBottom: 8, color: "#94a3b8", fontSize: 12 }}>
          <summary style={{ cursor: "pointer", color: "#cbd5e1", fontWeight: 600 }}>
            Layout &amp; where flower locations appear
          </summary>
          <p style={{ margin: "6px 0 0", lineHeight: 1.45 }}>
            <strong>Add room with layout</strong> names a flower room and creates bays with tables. Locations appear on{" "}
            <strong>Move to Flower</strong>. You can still add an empty room and edit bays/tables below.
          </p>
        </details>

        <div style={{ ...styles.cultivationFormGrid, gridTemplateColumns: "repeat(auto-fill, minmax(112px, 1fr))" }}>
          <input
            style={styles.cultivationField}
            placeholder="Room name"
            value={flowerRoomName}
            onChange={(e) => setFlowerRoomName(e.target.value)}
          />
          <input
            style={styles.cultivationField}
            placeholder="Bays #"
            inputMode="numeric"
            title="Number of bays"
            value={flowerQuickBayCount}
            onChange={(e) => setFlowerQuickBayCount(e.target.value)}
          />
          <input
            style={styles.cultivationField}
            placeholder="Tables/bay"
            inputMode="numeric"
            title="Tables per bay"
            value={flowerQuickTablesPerBay}
            onChange={(e) => setFlowerQuickTablesPerBay(e.target.value)}
          />
          <button
            type="button"
            title="Add room with bays and tables"
            style={styles.cultivationBtnAdd}
            onClick={addFlowerRoomWithLayout}
          >
            + Layout
          </button>
          <button
            type="button"
            title="Add empty room (add bays manually)"
            style={styles.cultivationBtnSecondary}
            onClick={addFlowerRoom}
          >
            + Empty
          </button>
        </div>

        <CultivationRoomAccordionList
          rooms={config.cultivation.rooms.flowerRooms}
          onOpenAddBay={(roomId) => openAddBayModal("flowerRooms", roomId)}
          onRemoveRoom={removeFlowerRoom}
          onOpenAddTable={(roomId, bayId) => openAddTableModal("flowerRooms", roomId, bayId)}
          onEditTable={(roomId, bayId, tableId) => openEditTableModal("flowerRooms", roomId, bayId, tableId)}
          onRemoveBay={(roomId, bayId) => removeBay("flowerRooms", roomId, bayId)}
          onRemoveTable={(roomId, bayId, tableId) =>
            removeTable("flowerRooms", roomId, bayId, tableId)
          }
        />
        </div>
      </CollapsibleConfigSection>

      <CollapsibleConfigSection
        sectionStyle={{ ...styles.card, marginTop: 18 }}
        sectionNumber="6"
        title="Extraction"
        summaryCollapsed={
          <>
            {config.extraction.productNames.length} product name
            {config.extraction.productNames.length === 1 ? "" : "s"} · {(config.extraction.supplies || []).length}{" "}
            supplies
          </>
        }
      >
        <div style={styles.configSubCard}>
        <div style={styles.inline}>
          <button type="button" style={styles.secondaryButton} onClick={() => void openAiPromptModal()}>
            Configure AI naming
          </button>
          <span style={{ color: "#94a3b8", fontSize: 13 }}>
            {extractionAiNamingStatusLine(config.extraction)}
          </span>
        </div>
        </div>

        <div style={styles.configSubCard}>
        <h3 style={{ ...styles.subTitle, marginTop: 0 }}>Product Name Database</h3>

        <div style={styles.grid}>
          <input
            style={styles.input}
            placeholder="Source Package Mix"
            value={productNameForm.sourceMix}
            onChange={(e) =>
              setProductNameForm((prev) => ({
                ...prev,
                sourceMix: e.target.value,
              }))
            }
          />

          <input
            style={styles.input}
            placeholder="Saved Product Name"
            value={productNameForm.productName}
            onChange={(e) =>
              setProductNameForm((prev) => ({
                ...prev,
                productName: e.target.value,
              }))
            }
          />

          <button style={styles.addButton} onClick={addProductName}>
            Add Name
          </button>
        </div>

        <div style={styles.list}>
          {config.extraction.productNames.map((item) => (
            <div key={item.id} style={styles.row}>
              <span>
                <strong>{item.sourceMix}</strong> = {item.productName}
              </span>
              <button
                style={styles.deleteButton}
                onClick={() => removeProductName(item.id)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        </div>

        <div style={styles.configSubCard}>
        <h3 style={{ ...styles.subTitle, marginTop: 0 }}>Previously Used Blend Names</h3>

        <div style={styles.list}>
          {config.extraction.blendNameHistory.length === 0 ? (
            <div style={styles.row}>
              <span style={{ color: "#94a3b8" }}>
                No blend-name history saved yet.
              </span>
            </div>
          ) : (
            config.extraction.blendNameHistory.map((item) => (
              <div key={item.id} style={styles.row}>
                <span>
                  <strong>{item.blendLabel || item.blendKey || "Blend"}</strong> ={" "}
                  {item.productName}
                  {item.lastUsedAt ? (
                    <span style={{ color: "#94a3b8" }}>
                      {" "}
                      (Last used: {formatCompanyTimestamp(item.lastUsedAt)})
                    </span>
                  ) : null}
                </span>
                <button
                  style={styles.deleteButton}
                  onClick={() =>
                    setConfig((prev) => ({
                      ...prev,
                      extraction: {
                        ...prev.extraction,
                        blendNameHistory: prev.extraction.blendNameHistory.filter(
                          (row) => row.id !== item.id
                        ),
                      },
                    }))
                  }
                >
                  Remove
                </button>
              </div>
            ))
          )}
        </div>
        </div>

        <div style={styles.configSubCardLast}>
        <h3 style={{ ...styles.subTitle, marginTop: 0 }}>Extraction Supplies & Cost</h3>

        <SupplyForm
          form={extractionSupplyForm}
          setForm={setExtractionSupplyForm}
          onAdd={() => addSupply("extraction")}
        />

        <SupplyList
          supplies={config.extraction.supplies}
          onRemove={(id) => removeSupply("extraction", id)}
        />
        </div>
      </CollapsibleConfigSection>

      <CollapsibleConfigSection
        sectionStyle={{ ...styles.card, marginTop: 18 }}
        sectionNumber="7"
        title="Packaging"
        summaryCollapsed={
          <>
            {(config.packaging.supplies || []).length} supply row{(config.packaging.supplies || []).length === 1 ? "" : "s"}
          </>
        }
      >
        <div style={styles.configSubCardLast}>
        <h3 style={{ ...styles.subTitle, marginTop: 0 }}>Packaging Supplies & Cost</h3>

        <SupplyForm
          form={packagingSupplyForm}
          setForm={setPackagingSupplyForm}
          onAdd={() => addSupply("packaging")}
        />

        <SupplyList
          supplies={config.packaging.supplies}
          onRemove={(id) => removeSupply("packaging", id)}
        />
        </div>
      </CollapsibleConfigSection>

      {cultivationFieldModal.kind !== "closed" ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cultivation-field-modal-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 20001,
            background: "rgba(2,6,23,0.88)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeCultivationFieldModal();
          }}
        >
          <div
            style={{
              ...styles.card,
              maxWidth: 440,
              width: "100%",
              margin: 0,
              border: "1px solid #334155",
              boxShadow: "0 24px 48px rgba(0,0,0,0.45)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id="cultivation-field-modal-title"
              style={{ ...styles.sectionTitle, marginBottom: 8, marginTop: 0 }}
            >
              {cultivationFieldModal.kind === "addBay"
                ? "Add bay"
                : cultivationFieldModal.kind === "editTable"
                  ? "Edit table"
                  : "Add table"}
            </h3>
            <p style={{ color: "#94a3b8", fontSize: 14, marginTop: 0, lineHeight: 1.5 }}>
              {cultivationFieldModal.kind === "addBay"
                ? cultivationFieldModal.suite === "flowerRooms"
                  ? "Enter a label for this bay (often a letter). It appears when staff assign plants to flower locations."
                  : "Enter a label for this bay (often a letter). It appears when staff assign plants to veg locations."
                : cultivationFieldModal.kind === "editTable"
                  ? "Update the label and square footage for this table. Use 0 for sq ft when not tracking area."
                  : "Name or number this table, then optional square footage over the table (use 0 if not tracking)."}
            </p>

            {fieldModalError ? (
              <p style={{ color: "#fca5a5", fontSize: 14, marginTop: 0 }}>{fieldModalError}</p>
            ) : null}

            {cultivationFieldModal.kind === "addBay" ? (
              <label style={{ ...styles.label, display: "block", marginTop: 8 }}>
                Bay name
                <input
                  style={styles.input}
                  autoFocus
                  placeholder="e.g. A, B, or C"
                  value={fieldModalBayName}
                  onChange={(e) => setFieldModalBayName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      confirmCultivationFieldModal();
                    }
                  }}
                />
              </label>
            ) : (
              <>
                <label style={{ ...styles.label, display: "block", marginTop: 8 }}>
                  Table name or number
                  <input
                    style={styles.input}
                    autoFocus
                    placeholder="e.g. 1 or Table North"
                    value={fieldModalTableName}
                    onChange={(e) => setFieldModalTableName(e.target.value)}
                  />
                </label>
                <label style={{ ...styles.label, display: "block", marginTop: 12 }}>
                  Square footage over this table
                  <input
                    style={styles.input}
                    placeholder="Optional — e.g. 48 or 0"
                    value={fieldModalSquareFeet}
                    onChange={(e) => setFieldModalSquareFeet(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        confirmCultivationFieldModal();
                      }
                    }}
                  />
                </label>
              </>
            )}

            <div style={{ ...styles.inline, marginTop: 20, flexWrap: "wrap", gap: 10 }}>
              <button type="button" style={styles.deleteButton} onClick={closeCultivationFieldModal}>
                Cancel
              </button>
              <button type="button" style={styles.saveButton} onClick={confirmCultivationFieldModal}>
                {cultivationFieldModal.kind === "addBay"
                  ? "Add bay"
                  : cultivationFieldModal.kind === "editTable"
                    ? "Save changes"
                    : "Add table"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {timeZoneModalOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="facility-tz-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 20003,
            background: "rgba(2,6,23,0.88)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setTimeZoneModalOpen(false);
          }}
        >
          <div
            style={{
              ...styles.card,
              maxWidth: 520,
              width: "100%",
              margin: 0,
              border: "1px solid #334155",
              boxShadow: "0 24px 48px rgba(0,0,0,0.45)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="facility-tz-title" style={{ ...styles.sectionTitle, marginTop: 0, marginBottom: 8 }}>
              Facility time zone
            </h3>
            <p style={{ color: "#94a3b8", fontSize: 14, marginTop: 0, lineHeight: 1.5 }}>
              Choose the IANA time zone used for every timestamp in this company (activity logs, labor entries,
              packaging history, and related screens). Times are still stored in UTC; this only affects display.
            </p>

            <label style={{ ...styles.label, marginTop: 14 }}>
              Filter list
              <input
                style={styles.input}
                value={timeZoneFilter}
                onChange={(e) => setTimeZoneFilter(e.target.value)}
                placeholder="e.g. Denver, New_York, Europe"
                autoComplete="off"
              />
            </label>

            <label style={{ ...styles.label, marginTop: 12 }}>
              Time zone
              <select
                size={10}
                style={{
                  ...styles.input,
                  width: "100%",
                  minHeight: 200,
                  fontFamily: "ui-monospace, monospace",
                  fontSize: 13,
                }}
                value={displayTimezoneDraft}
                onChange={(e) => setDisplayTimezoneDraft(e.target.value)}
              >
                <option value="">— Browser default (this device) —</option>
                {filteredTimeZones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </label>

            <p style={{ color: "#cbd5e1", fontSize: 14, marginTop: 10 }}>
              <b>Preview (now):</b> {previewFacilityTime(displayTimezoneDraft)}
            </p>

            <p style={{ color: "#94a3b8", fontSize: 12, marginTop: 6 }}>
              Click <b>Apply</b> to use this zone in the app immediately, then <b>Save Config</b> to store it for
              everyone in this company.
            </p>

            <div style={{ ...styles.inline, justifyContent: "flex-end", marginTop: 20, flexWrap: "wrap" }}>
              <button type="button" style={styles.deleteButton} onClick={() => setTimeZoneModalOpen(false)}>
                Cancel
              </button>
              <button type="button" style={styles.saveButton} onClick={applyFacilityTimezoneFromModal}>
                Apply
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {saveSuccessModalOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="save-config-success-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 20002,
            background: "rgba(2,6,23,0.88)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setSaveSuccessModalOpen(false);
          }}
        >
          <div
            style={{
              ...styles.card,
              maxWidth: 560,
              width: "100%",
              margin: 0,
              border: "1px solid #334155",
              boxShadow: "0 24px 48px rgba(0,0,0,0.45)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id="save-config-success-title"
              style={{ ...styles.sectionTitle, marginTop: 0, marginBottom: 8 }}
            >
              Config saved
            </h3>
            <p style={{ color: "#94a3b8", fontSize: 14, marginTop: 0, lineHeight: 1.5 }}>
              Company settings were saved successfully.
            </p>
            <div style={{ ...styles.inline, justifyContent: "flex-end", marginTop: 16 }}>
              <button
                type="button"
                style={styles.saveButton}
                onClick={() => setSaveSuccessModalOpen(false)}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {aiPromptModalOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 20000,
            background: "rgba(2,6,23,0.85)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            style={{
              ...styles.card,
              maxWidth: 900,
              width: "100%",
              maxHeight: "92vh",
              overflow: "auto",
              margin: 0,
            }}
          >
            <h3 style={{ ...styles.sectionTitle, marginBottom: 8 }}>AI extraction product naming</h3>

            {aiPromptModalError ? (
              <p style={{ color: "#fca5a5", fontSize: 14 }}>{aiPromptModalError}</p>
            ) : null}

            {aiPromptModalLoading ? (
              <p style={{ color: "#94a3b8" }}>Loading built-in prompt…</p>
            ) : (
              <>
                <div style={{ ...styles.inline, marginBottom: 12, gap: 8 }}>
                  <button
                    type="button"
                    style={
                      aiPromptModalTab === "simple"
                        ? { ...styles.addButton, opacity: 1 }
                        : styles.secondaryButton
                    }
                    onClick={() => setAiPromptModalTab("simple")}
                  >
                    Simple
                  </button>
                  <button
                    type="button"
                    style={
                      aiPromptModalTab === "advanced"
                        ? { ...styles.addButton, opacity: 1 }
                        : styles.secondaryButton
                    }
                    onClick={() => setAiPromptModalTab("advanced")}
                  >
                    Advanced (full prompt)
                  </button>
                </div>
                <p style={{ color: "#64748b", fontSize: 12, marginTop: 0, marginBottom: 14 }}>
                  Only the <strong style={{ color: "#94a3b8" }}>active</strong> tab is saved when you click Apply.
                  Switching tabs does not save.
                </p>

                {aiPromptModalTab === "simple" ? (
                  <>
                    <p style={{ color: "#94a3b8", fontSize: 14, marginTop: 0, lineHeight: 1.5 }}>
                      Write in plain language. The app injects the batch&apos;s strains and keeps the required JSON
                      response format for you—no templates or code.
                    </p>
                    <label style={{ ...styles.label, display: "block", marginBottom: 8 }}>
                      Tone and style (optional)
                      <textarea
                        style={{ ...styles.textarea, minHeight: 100, fontFamily: "inherit", fontSize: 14 }}
                        placeholder="Example: Short, premium-sounding names. Prefer two words. No puns."
                        value={aiGuidedIntroDraft}
                        onChange={(e) => setAiGuidedIntroDraft(e.target.value)}
                      />
                    </label>
                    <label style={{ ...styles.label, display: "block", marginBottom: 8 }}>
                      Extra preferences (optional)
                      <textarea
                        style={{ ...styles.textarea, minHeight: 140, fontFamily: "inherit", fontSize: 14 }}
                        placeholder="Example: Avoid strain acronyms in the product name. Mention &quot;blend&quot; when multiple strains."
                        value={aiGuidedExtraDraft}
                        onChange={(e) => setAiGuidedExtraDraft(e.target.value)}
                      />
                    </label>
                    <div style={{ ...styles.inline, marginTop: 12, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        style={styles.secondaryButton}
                        onClick={() => {
                          setAiGuidedIntroDraft("");
                          setAiGuidedExtraDraft("");
                        }}
                      >
                        Clear simple wording
                      </button>
                      <button type="button" style={styles.deleteButton} onClick={() => setAiPromptModalOpen(false)}>
                        Cancel
                      </button>
                      <button type="button" style={styles.saveButton} onClick={applyAiPromptModalToConfig}>
                        Apply &amp; close
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p style={{ color: "#94a3b8", fontSize: 14, marginTop: 0, lineHeight: 1.5 }}>
                      This Markdown becomes the OpenAI <strong style={{ color: "#e5e7eb" }}>user</strong> message when
                      operators use Create new name (AI). You may put{" "}
                      <code style={{ color: "#7dd3fc" }}>{`{{STRAIN_LIST}}`}</code> where strain labels should appear; if
                      you omit it, strains are appended automatically. Keep JSON output compatible with the app
                      (suggestions array) or naming may fail.
                    </p>
                    <textarea
                      style={{ ...styles.textarea, minHeight: 340, fontFamily: "ui-monospace, monospace", fontSize: 13 }}
                      value={aiPromptDraft}
                      onChange={(e) => setAiPromptDraft(e.target.value)}
                      spellCheck={false}
                    />

                    <div style={{ ...styles.inline, marginTop: 12, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        style={styles.addButton}
                        onClick={() => setAiPromptDraft(aiPromptShippedDefault)}
                        disabled={!aiPromptShippedDefault}
                      >
                        Reset to built-in prompt
                      </button>
                      <button
                        type="button"
                        style={styles.secondaryButton}
                        onClick={() => setAiPromptDraft("")}
                      >
                        Clear Markdown override
                      </button>
                      <button type="button" style={styles.deleteButton} onClick={() => setAiPromptModalOpen(false)}>
                        Cancel
                      </button>
                      <button type="button" style={styles.saveButton} onClick={applyAiPromptModalToConfig}>
                        Apply &amp; close
                      </button>
                    </div>
                  </>
                )}
                <p style={{ color: "#64748b", fontSize: 12, marginTop: 10 }}>
                  &quot;Apply &amp; close&quot; updates this page only — click Save Config when ready to persist to the server.
                </p>
              </>
            )}
          </div>
        </div>
      ) : null}
    </main>
  );
}

function SupplyForm({
  form,
  setForm,
  onAdd,
}: {
  form: { name: string; cost: string; unit: string };
  setForm: React.Dispatch<
    React.SetStateAction<{ name: string; cost: string; unit: string }>
  >;
  onAdd: () => void;
}) {
  return (
    <div style={styles.grid}>
      <input
        style={styles.input}
        placeholder="Supply Name"
        value={form.name}
        onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
      />

      <input
        style={styles.input}
        placeholder="Cost"
        value={form.cost}
        onChange={(e) => setForm((prev) => ({ ...prev, cost: e.target.value }))}
      />

      <input
        style={styles.input}
        placeholder="Unit, example: each, lb, gal"
        value={form.unit}
        onChange={(e) => setForm((prev) => ({ ...prev, unit: e.target.value }))}
      />

      <button style={styles.addButton} onClick={onAdd}>
        Add Supply
      </button>
    </div>
  );
}

function SupplyList({
  supplies,
  onRemove,
}: {
  supplies: Supply[];
  onRemove: (id: string) => void;
}) {
  return (
    <div style={styles.list}>
      {supplies.map((supply) => (
        <div key={supply.id} style={styles.row}>
          <span>
            <strong>{supply.name}</strong> — ${supply.cost}
            {supply.unit ? ` / ${supply.unit}` : ""}
          </span>
          <button style={styles.deleteButton} onClick={() => onRemove(supply.id)}>
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

function CultivationRoomAccordionList({
  rooms,
  onOpenAddBay,
  onRemoveRoom,
  onOpenAddTable,
  onEditTable,
  onRemoveBay,
  onRemoveTable,
}: {
  rooms: RoomWithBayLayout[];
  onOpenAddBay: (roomId: string) => void;
  onRemoveRoom: (roomId: string) => void;
  onOpenAddTable: (roomId: string, bayId: string) => void;
  onEditTable: (roomId: string, bayId: string, tableId: string) => void;
  onRemoveBay: (roomId: string, bayId: string) => void;
  onRemoveTable: (roomId: string, bayId: string, tableId: string) => void;
}) {
  const n = rooms.length;
  if (n === 0) {
    return (
      <p style={{ color: "#64748b", fontSize: 12, marginTop: 6, marginBottom: 0 }}>
        No rooms yet — use + Layout or + Empty above.
      </p>
    );
  }
  return (
    <div style={styles.cultivationList}>
      {rooms.map((room, ri) => {
        const roomShellStyle = ri === n - 1 ? styles.cultivationRoomDisclosureLast : styles.cultivationRoomDisclosure;
        return (
          <details key={room.id} style={roomShellStyle}>
            <summary style={styles.cultivationRoomSummary}>
              <span>{room.name || "Untitled room"}</span>
              <span style={{ ...styles.inlineSmall, gap: 6 }}>
                <button
                  type="button"
                  title="Add bay"
                  style={styles.cultivationBtnAdd}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onOpenAddBay(room.id);
                  }}
                >
                  + Bay
                </button>
                <button
                  type="button"
                  style={styles.cultivationBtnDelete}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onRemoveRoom(room.id);
                  }}
                >
                  Remove room
                </button>
              </span>
            </summary>
            <div style={styles.cultivationRoomBody}>
              {room.bays.length === 0 ? (
                <p style={{ color: "#64748b", fontSize: 12, margin: "4px 0 0" }}>No bays yet — use + Bay.</p>
              ) : (
                room.bays.map((bay) => (
                  <details key={bay.id} style={styles.cultivationBayDisclosure}>
                    <summary style={styles.cultivationBaySummary}>
                      <span>
                        Bay {bay.name} ({bay.tables.length} table{bay.tables.length === 1 ? "" : "s"})
                      </span>
                      <span style={{ ...styles.inlineSmall, gap: 6 }}>
                        <button
                          type="button"
                          title="Add table"
                          style={styles.cultivationBtnAdd}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onOpenAddTable(room.id, bay.id);
                          }}
                        >
                          + Table
                        </button>
                        <button
                          type="button"
                          style={styles.cultivationBtnDelete}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onRemoveBay(room.id, bay.id);
                          }}
                        >
                          Remove bay
                        </button>
                      </span>
                    </summary>
                    <div style={styles.cultivationBayBody}>
                      {bay.tables.length === 0 ? (
                        <p style={{ color: "#64748b", fontSize: 12, margin: 0 }}>No tables — use + Table.</p>
                      ) : (
                        bay.tables.map((table) => (
                          <div key={table.id} style={styles.cultivationRow}>
                            <span style={{ fontSize: 13 }}>
                              T{table.name} · {table.squareFeet} sq ft
                            </span>
                            <span style={{ ...styles.inlineSmall, gap: 6 }}>
                              <button
                                type="button"
                                title="Edit table"
                                style={styles.cultivationBtnSecondary}
                                onClick={() => onEditTable(room.id, bay.id, table.id)}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                style={styles.cultivationBtnDelete}
                                onClick={() => onRemoveTable(room.id, bay.id, table.id)}
                              >
                                Remove
                              </button>
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </details>
                ))
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#020617",
    color: "#e5e7eb",
    padding: 24,
  },
  header: {
    maxWidth: 1200,
    margin: "24px auto",
    display: "flex",
    justifyContent: "space-between",
    gap: 16,
    alignItems: "center",
  },
  title: {
    fontSize: 34,
    fontWeight: 900,
    margin: 0,
  },
  subtitle: {
    color: "#94a3b8",
    marginTop: 8,
  },
  card: {
    maxWidth: 1200,
    margin: "20px auto",
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: 18,
    padding: 22,
    boxShadow: "0 12px 30px rgba(0,0,0,0.35)",
  },
  sectionTitle: {
    fontSize: 24,
    marginTop: 0,
  },
  subTitle: {
    marginTop: 26,
    fontSize: 18,
    color: "#bfdbfe",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 12,
    marginTop: 12,
  },
  inline: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    flexWrap: "wrap",
  },
  inlineSmall: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
  },
  label: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    color: "#cbd5e1",
    fontSize: 14,
  },
  input: {
    background: "#020617",
    color: "#e5e7eb",
    border: "1px solid #475569",
    borderRadius: 10,
    padding: "10px 12px",
    minHeight: 42,
  },
  textarea: {
    background: "#020617",
    color: "#e5e7eb",
    border: "1px solid #475569",
    borderRadius: 10,
    padding: "10px 12px",
    minHeight: 100,
    marginTop: 8,
  },
  saveButton: {
    background: "#22c55e",
    color: "#052e16",
    border: "none",
    borderRadius: 12,
    padding: "12px 18px",
    fontWeight: 900,
    cursor: "pointer",
  },
  addButton: {
    background: "#2563eb",
    color: "white",
    border: "none",
    borderRadius: 10,
    padding: "10px 14px",
    fontWeight: 800,
    cursor: "pointer",
  },
  secondaryButton: {
    background: "#334155",
    color: "#e2e8f0",
    border: "1px solid #475569",
    borderRadius: 10,
    padding: "10px 14px",
    fontWeight: 800,
    cursor: "pointer",
  },
  deleteButton: {
    background: "#dc2626",
    color: "white",
    border: "none",
    borderRadius: 10,
    padding: "8px 12px",
    fontWeight: 800,
    cursor: "pointer",
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    marginTop: 14,
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    background: "#020617",
    border: "1px solid #334155",
    borderRadius: 12,
    padding: 12,
  },
  nestedBox: {
    background: "#111827",
    border: "1px solid #334155",
    borderRadius: 14,
    padding: 14,
  },
  bayBox: {
    background: "#020617",
    border: "1px solid #1e40af",
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
  },
  configSubCard: {
    border: "1px solid #334155",
    borderRadius: 14,
    padding: "16px 18px",
    marginBottom: 18,
    background: "#020617",
  },
  configSubCardLast: {
    border: "1px solid #334155",
    borderRadius: 14,
    padding: "16px 18px",
    marginBottom: 0,
    background: "#020617",
  },
  /** Dense UI for cultivation strain + room layout blocks */
  cultivationField: {
    background: "#020617",
    color: "#e5e7eb",
    border: "1px solid #475569",
    borderRadius: 8,
    padding: "6px 10px",
    minHeight: 34,
    fontSize: 13,
  },
  cultivationFormGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
    gap: 8,
    marginTop: 8,
    marginBottom: 0,
  },
  cultivationList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    marginTop: 8,
  },
  cultivationRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: 8,
    padding: "8px 10px",
  },
  cultivationBtnAdd: {
    background: "#2563eb",
    color: "white",
    border: "none",
    borderRadius: 8,
    padding: "7px 12px",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
  },
  cultivationBtnSecondary: {
    background: "#334155",
    color: "#e2e8f0",
    border: "1px solid #475569",
    borderRadius: 8,
    padding: "7px 12px",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
  },
  cultivationBtnDelete: {
    background: "#dc2626",
    color: "white",
    border: "none",
    borderRadius: 8,
    padding: "6px 10px",
    fontWeight: 700,
    fontSize: 12,
    cursor: "pointer",
  },
  cultivationStrainsOuter: {
    border: "1px solid #334155",
    borderRadius: 14,
    background: "#020617",
    overflow: "hidden",
  },
  cultivationStrainsSummary: {
    cursor: "pointer",
    padding: "12px 14px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    fontWeight: 800,
    fontSize: 15,
    color: "#bfdbfe",
    listStyle: "none",
  },
  cultivationStrainsSummaryMeta: {
    fontWeight: 600,
    fontSize: 12,
    color: "#64748b",
    flexShrink: 0,
  },
  cultivationStrainsBody: {
    padding: "0 14px 14px",
    borderTop: "1px solid #1e293b",
  },
  cultivationRoomDisclosure: {
    border: "1px solid #475569",
    borderRadius: 10,
    marginBottom: 8,
    background: "#111827",
    overflow: "hidden",
  },
  cultivationRoomDisclosureLast: {
    border: "1px solid #475569",
    borderRadius: 10,
    marginBottom: 0,
    background: "#111827",
    overflow: "hidden",
  },
  cultivationRoomSummary: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "10px 12px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 14,
    color: "#e2e8f0",
    listStyle: "none",
  },
  cultivationRoomBody: {
    padding: "8px 10px 10px",
    borderTop: "1px solid #1e293b",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  cultivationBayDisclosure: {
    border: "1px solid #334155",
    borderRadius: 8,
    background: "#0f172a",
    overflow: "hidden",
  },
  cultivationBaySummary: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "8px 10px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 13,
    color: "#93c5fd",
    listStyle: "none",
  },
  cultivationBayBody: {
    padding: "6px 10px 10px",
    borderTop: "1px solid #1e293b",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
};