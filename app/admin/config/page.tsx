"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import Nav from "@/components/Nav";
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
import { sortStrainsAlphabetically } from "@/lib/sortStrainsAlphabetically";

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
    metrc: {
      apiKey: string;
      userKey: string;
      licenseNumber: string;
      facilityName: string;
      notes: string;
    };
    settings: {
      companyWideNotes: string;
      /** IANA time zone for every facility-facing timestamp. Empty = browser default. */
      displayTimezone?: string;
      /** Facility-day wall times (24h HH:mm). Subtracts from start→end cultivation labor when overlap applies. */
      laborBreaks?: { id: string; label: string; start: string; end: string }[];
    };
  };
  cultivation: {
    strains: Strain[];
    supplies: Supply[];
    rooms: {
      vegRooms: VegRoom[];
      flowerRooms: FlowerRoom[];
    };
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
  };
  packaging: {
    supplies: Supply[];
  };
};

const emptyConfig: AppConfig = {
  company: {
    metrc: {
      apiKey: "",
      userKey: "",
      licenseNumber: "",
      facilityName: "",
      notes: "",
    },
    settings: {
      companyWideNotes: "",
      displayTimezone: "",
      laborBreaks: [],
    },
  },
  cultivation: {
    strains: [],
    supplies: [],
    rooms: {
      vegRooms: [],
      flowerRooms: [],
    },
  },
  extraction: {
    productNames: [],
    blendNameHistory: [],
    supplies: [],
  },
  packaging: {
    supplies: [],
  },
};

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
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
  | { kind: "addTable"; suite: "vegRooms" | "flowerRooms"; roomId: string; bayId: string };

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

  const [strainForm, setStrainForm] = useState({
    name: "",
    acronym: "",
    dominance: "Hybrid",
    potency: "Medium",
    averageYield: "Medium",
  });

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
            ...emptyConfig.company.metrc,
            ...(data.company?.metrc || {}),
          },
          settings: {
            ...emptyConfig.company.settings,
            ...(data.company?.settings || {}),
          },
        },
        cultivation: {
          ...emptyConfig.cultivation,
          ...(data.cultivation || {}),
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
        },
        packaging: {
          ...emptyConfig.packaging,
          ...(data.packaging || {}),
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
      const res = await fetch(`${API_BASE_URL}${path}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(config),
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
            ...emptyConfig.company.metrc,
            ...(data.company?.metrc || {}),
          },
          settings: {
            ...emptyConfig.company.settings,
            ...(data.company?.settings || {}),
          },
        },
        cultivation: {
          ...emptyConfig.cultivation,
          ...(data.cultivation || {}),
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
        },
        packaging: {
          ...emptyConfig.packaging,
          ...(data.packaging || {}),
        },
      });
      syncCompanyTimezoneFromConfigPayload(data);
      setSaveSuccessModalOpen(true);
    } catch (error) {
      console.error(error);
      alert("Could not save config");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    void loadConfig();
  }, [pathname]);

  function addStrain() {
    if (!strainForm.name.trim() || !strainForm.acronym.trim()) {
      alert("Strain name and acronym are required");
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

    setStrainForm({
      name: "",
      acronym: "",
      dominance: "Hybrid",
      potency: "Medium",
      averageYield: "Medium",
    });
  }

  function removeStrain(id: string) {
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
      cultivationFieldModal.kind === "addBay" || cultivationFieldModal.kind === "addTable"
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

    if (cultivationFieldModal.kind !== "addTable") return;

    const tableName = fieldModalTableName.trim();
    const squareFeet = fieldModalSquareFeet.trim();
    if (!tableName) {
      setFieldModalError("Enter a table name or number.");
      return;
    }
    const { roomId, bayId } = cultivationFieldModal;
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
                          tables: [
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
            Admin-only company settings for METRC, cultivation, extraction, and packaging.
          </p>
        </div>

        <button style={styles.saveButton} onClick={saveConfig} disabled={saving}>
          {saving ? "Saving..." : "Save Config"}
        </button>
      </div>

      <section style={styles.card}>
        <div style={{ ...styles.inline, alignItems: "center", marginBottom: 4 }}>
          <h2 style={{ ...styles.sectionTitle, marginBottom: 0 }}>1. Company</h2>
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

        <div style={styles.grid}>
          <label style={styles.label}>
            METRC API Key
            <input
              style={styles.input}
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
          </label>

          <label style={styles.label}>
            METRC User Key
            <input
              style={styles.input}
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
          </label>

          <label style={styles.label}>
            License Number
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
            Facility Name
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

        <h3 style={styles.subTitle}>Labor — breaks & lunch (facility clock)</h3>
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
      </section>

      <section style={styles.card}>
        <h2 style={styles.sectionTitle}>2. Cultivation</h2>

        <h3 style={styles.subTitle}>Strain List</h3>
        <p style={{ color: "#94a3b8", fontSize: 14, marginTop: 0, marginBottom: 14 }}>
          When cultivation data is rolled up, <b>Potency</b> and <b>Average yield</b> on each strain update from lab
          THC% and dry g/sq ft averages (defaults: THC under 16 = Low, 16–22 Medium, 22–28 High, 28+ Very High; yield
          under 18 g/sq ft Light, 18–42 Medium, over 42 Heavy). <b>Dominance</b> is not changed. Auto numeric lines below
          are read-only snapshots from the same rollups.
        </p>

        <div style={styles.grid}>
          <input
            style={styles.input}
            placeholder="Strain Name"
            value={strainForm.name}
            onChange={(e) =>
              setStrainForm((prev) => ({ ...prev, name: e.target.value }))
            }
          />

          <input
            style={styles.input}
            placeholder="Acronym"
            value={strainForm.acronym}
            onChange={(e) =>
              setStrainForm((prev) => ({ ...prev, acronym: e.target.value }))
            }
          />

          <select
            style={styles.input}
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
            style={styles.input}
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
            style={styles.input}
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

          <button style={styles.addButton} onClick={addStrain}>
            Add Strain
          </button>
        </div>

        <div style={styles.list}>
          {cultivationStrainsAlphabetical.map((strain) => (
            <div key={strain.id} style={styles.row}>
              <span>
                <strong>{strain.name}</strong> ({strain.acronym}) —{" "}
                {strain.dominance}, {strain.potency}, {strain.averageYield} Yield
                {(strain.autoAvgPotencyPct != null || strain.autoAvgDryYieldGPerSqFt != null) && (
                  <span style={{ display: "block", marginTop: 6, color: "#94a3b8", fontSize: 13 }}>
                    Auto avg:{" "}
                    {strain.autoAvgPotencyPct != null
                      ? `${strain.autoAvgPotencyPct}% THC`
                      : "— potency"}
                    {" · "}
                    {strain.autoAvgDryYieldGPerSqFt != null
                      ? `${strain.autoAvgDryYieldGPerSqFt} g/sq ft dry`
                      : "— yield"}
                    {strain.autoMetricsSampleCount != null
                      ? ` (n=${strain.autoMetricsSampleCount})`
                      : ""}
                    {strain.autoMetricsUpdatedAt
                      ? ` · updated ${strain.autoMetricsUpdatedAt.slice(0, 10)}`
                      : ""}
                  </span>
                )}
              </span>
              <button style={styles.deleteButton} onClick={() => removeStrain(strain.id)}>
                Remove
              </button>
            </div>
          ))}
        </div>

        <h3 style={styles.subTitle}>Cultivation Supplies & Cost</h3>

        <SupplyForm
          form={cultivationSupplyForm}
          setForm={setCultivationSupplyForm}
          onAdd={() => addSupply("cultivation")}
        />

        <SupplyList
          supplies={config.cultivation.supplies}
          onRemove={(id) => removeSupply("cultivation", id)}
        />

        <h3 style={styles.subTitle}>Veg Rooms / Bays / Tables</h3>

        <p style={{ color: "#94a3b8", fontSize: 14, marginTop: 0, lineHeight: 1.5 }}>
          Same layout as flower: use <strong style={{ color: "#e5e7eb" }}>Add room with layout</strong> to name a
          veg room and generate bays (A, B, C, …) with numbered tables (1, 2, …) per bay. Locations appear when
          operators log <strong style={{ color: "#e5e7eb" }}>Clone → Veg</strong> on the Cultivation page.
        </p>

        <div style={{ ...styles.grid, marginBottom: 12 }}>
          <input
            style={styles.input}
            placeholder="Veg room name"
            value={vegRoomName}
            onChange={(e) => setVegRoomName(e.target.value)}
          />
          <input
            style={styles.input}
            placeholder="Number of bays"
            inputMode="numeric"
            value={vegQuickBayCount}
            onChange={(e) => setVegQuickBayCount(e.target.value)}
          />
          <input
            style={styles.input}
            placeholder="Tables per bay"
            inputMode="numeric"
            value={vegQuickTablesPerBay}
            onChange={(e) => setVegQuickTablesPerBay(e.target.value)}
          />
          <button style={styles.addButton} type="button" onClick={addVegRoomWithLayout}>
            Add room with layout
          </button>
          <button style={styles.secondaryButton} type="button" onClick={addVegRoom}>
            Add empty room
          </button>
        </div>

        <div style={styles.list}>
          {config.cultivation.rooms.vegRooms.map((room) => (
            <div key={room.id} style={styles.nestedBox}>
              <div style={styles.row}>
                <strong>{room.name}</strong>
                <div style={styles.inlineSmall}>
                  <button style={styles.addButton} type="button" onClick={() => openAddBayModal("vegRooms", room.id)}>
                    Add Bay
                  </button>
                  <button style={styles.deleteButton} type="button" onClick={() => removeVegRoom(room.id)}>
                    Remove Room
                  </button>
                </div>
              </div>

              {room.bays.map((bay) => (
                <div key={bay.id} style={styles.bayBox}>
                  <div style={styles.row}>
                    <strong>Bay {bay.name}</strong>
                    <div style={styles.inlineSmall}>
                      <button
                        style={styles.addButton}
                        type="button"
                        onClick={() => openAddTableModal("vegRooms", room.id, bay.id)}
                      >
                        Add Table
                      </button>
                      <button
                        style={styles.deleteButton}
                        type="button"
                        onClick={() => removeBay("vegRooms", room.id, bay.id)}
                      >
                        Remove Bay
                      </button>
                    </div>
                  </div>

                  {bay.tables.map((table) => (
                    <div key={table.id} style={styles.row}>
                      <span>
                        Table {table.name} — {table.squareFeet} sq ft
                      </span>
                      <button
                        style={styles.deleteButton}
                        type="button"
                        onClick={() => removeTable("vegRooms", room.id, bay.id, table.id)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>

        <h3 style={styles.subTitle}>Flower Rooms / Bays / Tables</h3>

        <p style={{ color: "#94a3b8", fontSize: 14, marginTop: 0, lineHeight: 1.5 }}>
          Use <strong style={{ color: "#e5e7eb" }}>Add room with layout</strong> to name a flower room and generate bays
          (A, B, C, …) with numbered tables (1, 2, …) per bay. Those locations appear when operators log{" "}
          <strong style={{ color: "#e5e7eb" }}>Move to Flower</strong> on the Cultivation page. You can still add an empty
          room or edit bays and tables below.
        </p>

        <div style={{ ...styles.grid, marginBottom: 12 }}>
          <input
            style={styles.input}
            placeholder="Flower room name"
            value={flowerRoomName}
            onChange={(e) => setFlowerRoomName(e.target.value)}
          />
          <input
            style={styles.input}
            placeholder="Number of bays"
            inputMode="numeric"
            value={flowerQuickBayCount}
            onChange={(e) => setFlowerQuickBayCount(e.target.value)}
          />
          <input
            style={styles.input}
            placeholder="Tables per bay"
            inputMode="numeric"
            value={flowerQuickTablesPerBay}
            onChange={(e) => setFlowerQuickTablesPerBay(e.target.value)}
          />
          <button style={styles.addButton} type="button" onClick={addFlowerRoomWithLayout}>
            Add room with layout
          </button>
          <button style={styles.secondaryButton} type="button" onClick={addFlowerRoom}>
            Add empty room
          </button>
        </div>

        <div style={styles.list}>
          {config.cultivation.rooms.flowerRooms.map((room) => (
            <div key={room.id} style={styles.nestedBox}>
              <div style={styles.row}>
                <strong>{room.name}</strong>
                <div style={styles.inlineSmall}>
                  <button style={styles.addButton} onClick={() => openAddBayModal("flowerRooms", room.id)}>
                    Add Bay
                  </button>
                  <button
                    style={styles.deleteButton}
                    onClick={() => removeFlowerRoom(room.id)}
                  >
                    Remove Room
                  </button>
                </div>
              </div>

              {room.bays.map((bay) => (
                <div key={bay.id} style={styles.bayBox}>
                  <div style={styles.row}>
                    <strong>Bay {bay.name}</strong>
                    <div style={styles.inlineSmall}>
                      <button
                        style={styles.addButton}
                        onClick={() => openAddTableModal("flowerRooms", room.id, bay.id)}
                      >
                        Add Table
                      </button>
                      <button
                        style={styles.deleteButton}
                        onClick={() => removeBay("flowerRooms", room.id, bay.id)}
                      >
                        Remove Bay
                      </button>
                    </div>
                  </div>

                  {bay.tables.map((table) => (
                    <div key={table.id} style={styles.row}>
                      <span>
                        Table {table.name} — {table.squareFeet} sq ft
                      </span>
                      <button
                        style={styles.deleteButton}
                        onClick={() => removeTable("flowerRooms", room.id, bay.id, table.id)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section style={styles.card}>
        <h2 style={styles.sectionTitle}>3. Extraction</h2>

        <div style={styles.inline}>
          <button type="button" style={styles.secondaryButton} onClick={() => void openAiPromptModal()}>
            Configure AI naming
          </button>
          <span style={{ color: "#94a3b8", fontSize: 13 }}>
            {extractionAiNamingStatusLine(config.extraction)}
          </span>
        </div>

        <h3 style={styles.subTitle}>Product Name Database</h3>

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

        <h3 style={styles.subTitle}>Previously Used Blend Names</h3>

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

        <h3 style={styles.subTitle}>Extraction Supplies & Cost</h3>

        <SupplyForm
          form={extractionSupplyForm}
          setForm={setExtractionSupplyForm}
          onAdd={() => addSupply("extraction")}
        />

        <SupplyList
          supplies={config.extraction.supplies}
          onRemove={(id) => removeSupply("extraction", id)}
        />
      </section>

      <section style={styles.card}>
        <h2 style={styles.sectionTitle}>4. Packaging</h2>

        <h3 style={styles.subTitle}>Packaging Supplies & Cost</h3>

        <SupplyForm
          form={packagingSupplyForm}
          setForm={setPackagingSupplyForm}
          onAdd={() => addSupply("packaging")}
        />

        <SupplyList
          supplies={config.packaging.supplies}
          onRemove={(id) => removeSupply("packaging", id)}
        />
      </section>

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
              {cultivationFieldModal.kind === "addBay" ? "Add bay" : "Add table"}
            </h3>
            <p style={{ color: "#94a3b8", fontSize: 14, marginTop: 0, lineHeight: 1.5 }}>
              {cultivationFieldModal.kind === "addBay"
                ? cultivationFieldModal.suite === "flowerRooms"
                  ? "Enter a label for this bay (often a letter). It appears when staff assign plants to flower locations."
                  : "Enter a label for this bay (often a letter). It appears when staff assign plants to veg locations."
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
                {cultivationFieldModal.kind === "addBay" ? "Add bay" : "Add table"}
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
};