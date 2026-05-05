"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Nav from "@/components/Nav";
import {
  API_BASE_URL,
  apiRequest,
  appendCompanyIdQuery,
  getSelectedCompanyId,
} from "@/lib/api";
import { getAuthToken } from "@/lib/auth";

type Strain = {
  id: string;
  name: string;
  acronym: string;
  dominance: string;
  potency: string;
  averageYield: string;
};

type Supply = {
  id: string;
  name: string;
  cost: string;
  unit: string;
};

type VegRoom = {
  id: string;
  name: string;
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

type FlowerRoom = {
  id: string;
  name: string;
  bays: BayConfig[];
};

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
    /** Custom Markdown for AI product naming; optional `{{STRAIN_LIST}}` (strain labels). Empty uses server default file. */
    productNameAiPromptMarkdown?: string;
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

export default function ConfigPage() {
  const pathname = usePathname();
  const [config, setConfig] = useState<AppConfig>(emptyConfig);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [aiPromptModalOpen, setAiPromptModalOpen] = useState(false);
  const [aiPromptDraft, setAiPromptDraft] = useState("");
  const [aiPromptShippedDefault, setAiPromptShippedDefault] = useState("");
  const [aiPromptModalLoading, setAiPromptModalLoading] = useState(false);
  const [aiPromptModalError, setAiPromptModalError] = useState("");

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
      setConfig(data);
      alert("Config saved");
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

  function addBay(roomId: string) {
    const bayName = prompt("Bay name, like A, B, or C");
    if (!bayName) return;

    setConfig((prev) => ({
      ...prev,
      cultivation: {
        ...prev.cultivation,
        rooms: {
          ...prev.cultivation.rooms,
          flowerRooms: prev.cultivation.rooms.flowerRooms.map((room) =>
            room.id === roomId
              ? {
                  ...room,
                  bays: [
                    ...room.bays,
                    {
                      id: makeId("bay"),
                      name: bayName.trim(),
                      tables: [],
                    },
                  ],
                }
              : room
          ),
        },
      },
    }));
  }

  function removeBay(roomId: string, bayId: string) {
    setConfig((prev) => ({
      ...prev,
      cultivation: {
        ...prev.cultivation,
        rooms: {
          ...prev.cultivation.rooms,
          flowerRooms: prev.cultivation.rooms.flowerRooms.map((room) =>
            room.id === roomId
              ? {
                  ...room,
                  bays: room.bays.filter((bay) => bay.id !== bayId),
                }
              : room
          ),
        },
      },
    }));
  }

  function addTable(roomId: string, bayId: string) {
    const tableName = prompt("Table name or number");
    if (!tableName) return;

    const squareFeet = prompt("Square footage over this table");
    if (!squareFeet) return;

    setConfig((prev) => ({
      ...prev,
      cultivation: {
        ...prev.cultivation,
        rooms: {
          ...prev.cultivation.rooms,
          flowerRooms: prev.cultivation.rooms.flowerRooms.map((room) =>
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
                              name: tableName.trim(),
                              squareFeet: squareFeet.trim(),
                            },
                          ],
                        }
                      : bay
                  ),
                }
              : room
          ),
        },
      },
    }));
  }

  function removeTable(roomId: string, bayId: string, tableId: string) {
    setConfig((prev) => ({
      ...prev,
      cultivation: {
        ...prev.cultivation,
        rooms: {
          ...prev.cultivation.rooms,
          flowerRooms: prev.cultivation.rooms.flowerRooms.map((room) =>
            room.id === roomId
              ? {
                  ...room,
                  bays: room.bays.map((bay) =>
                    bay.id === bayId
                      ? {
                          ...bay,
                          tables: bay.tables.filter((t) => t.id !== tableId),
                        }
                      : bay
                  ),
                }
              : room
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

  function applyAiPromptDraftToConfig() {
    const trimmed = aiPromptDraft.trim();
    setConfig((prev) => ({
      ...prev,
      extraction: {
        ...prev.extraction,
        productNameAiPromptMarkdown: trimmed,
      },
    }));
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
        <h2 style={styles.sectionTitle}>1. Company</h2>

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
      </section>

      <section style={styles.card}>
        <h2 style={styles.sectionTitle}>2. Cultivation</h2>

        <h3 style={styles.subTitle}>Strain List</h3>

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
          {config.cultivation.strains.map((strain) => (
            <div key={strain.id} style={styles.row}>
              <span>
                <strong>{strain.name}</strong> ({strain.acronym}) —{" "}
                {strain.dominance}, {strain.potency}, {strain.averageYield} Yield
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

        <h3 style={styles.subTitle}>Veg Rooms</h3>

        <div style={styles.inline}>
          <input
            style={styles.input}
            placeholder="Veg Room Name"
            value={vegRoomName}
            onChange={(e) => setVegRoomName(e.target.value)}
          />
          <button style={styles.addButton} onClick={addVegRoom}>
            Add Veg Room
          </button>
        </div>

        <div style={styles.list}>
          {config.cultivation.rooms.vegRooms.map((room) => (
            <div key={room.id} style={styles.row}>
              <strong>{room.name}</strong>
              <button style={styles.deleteButton} onClick={() => removeVegRoom(room.id)}>
                Remove
              </button>
            </div>
          ))}
        </div>

        <h3 style={styles.subTitle}>Flower Rooms / Bays / Tables</h3>

        <div style={styles.inline}>
          <input
            style={styles.input}
            placeholder="Flower Room Name"
            value={flowerRoomName}
            onChange={(e) => setFlowerRoomName(e.target.value)}
          />
          <button style={styles.addButton} onClick={addFlowerRoom}>
            Add Flower Room
          </button>
        </div>

        <div style={styles.list}>
          {config.cultivation.rooms.flowerRooms.map((room) => (
            <div key={room.id} style={styles.nestedBox}>
              <div style={styles.row}>
                <strong>{room.name}</strong>
                <div style={styles.inlineSmall}>
                  <button style={styles.addButton} onClick={() => addBay(room.id)}>
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
                        onClick={() => addTable(room.id, bay.id)}
                      >
                        Add Table
                      </button>
                      <button
                        style={styles.deleteButton}
                        onClick={() => removeBay(room.id, bay.id)}
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
                        onClick={() => removeTable(room.id, bay.id, table.id)}
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
            Edit AI product-name prompt
          </button>
          <span style={{ color: "#94a3b8", fontSize: 13 }}>
            {String(config.extraction.productNameAiPromptMarkdown || "").trim()
              ? "Custom prompt is configured (Save Config to persist)."
              : "Using built-in server prompt until you save a custom one."}
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
                      (Last used: {new Date(item.lastUsedAt).toLocaleString()})
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
            <h3 style={{ ...styles.sectionTitle, marginBottom: 8 }}>AI extraction product-name prompt</h3>
            <p style={{ color: "#94a3b8", fontSize: 14, marginTop: 0, lineHeight: 1.5 }}>
              This Markdown becomes the OpenAI <strong style={{ color: "#e5e7eb" }}>user</strong> message when
              operators use Create new name (AI). Put{" "}
              <code style={{ color: "#7dd3fc" }}>{`{{STRAIN_LIST}}`}</code> where the current
              batch&apos;s strain labels should appear (comma-separated). If you omit it, strains are appended
              automatically so batch info always reaches the model. Keep JSON output expectations compatible with the
              app (suggestions array) or naming may fail.
            </p>

            {aiPromptModalError ? (
              <p style={{ color: "#fca5a5", fontSize: 14 }}>{aiPromptModalError}</p>
            ) : null}

            {aiPromptModalLoading ? (
              <p style={{ color: "#94a3b8" }}>Loading built-in prompt…</p>
            ) : (
              <>
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
                    Clear override (use built-in)
                  </button>
                  <button type="button" style={styles.deleteButton} onClick={() => setAiPromptModalOpen(false)}>
                    Cancel
                  </button>
                  <button type="button" style={styles.saveButton} onClick={applyAiPromptDraftToConfig}>
                    Apply &amp; close
                  </button>
                </div>
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