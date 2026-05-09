"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  API_BASE_URL,
  fetchCompanyWithServices,
  salesLeafLinkSyncInventory,
  salesSellerOrders,
  salesSellerOrderSetStatus,
  salesSellerProductCreate,
  salesSellerProductDelete,
  salesSellerProductPatch,
  salesSellerProducts,
  salesSellerProductUploadImage,
  type CompanyServicesDto,
  type MarketplaceProductDto,
} from "@/lib/api";
import { fileToImageUploadPayload } from "@/lib/imageUploadPayload";
import { isLoggedIn } from "@/lib/auth";
import MarketplaceProductImageFrame from "@/components/MarketplaceProductImageFrame";

const placeholderImg =
  "linear-gradient(135deg, rgba(30,41,59,0.95), rgba(15,23,42,0.98))";

type OrderRow = {
  id: string;
  status: string;
  total: number;
  createdAt: string;
  buyerCompany?: { name: string; slug: string };
  items: Array<{ productNameSnapshot: string; quantity: number; lineTotal: number }>;
};

export default function SellerPlatformPage() {
  const [services, setServices] = useState<CompanyServicesDto | null>(null);
  const [servicesErr, setServicesErr] = useState("");
  const [products, setProducts] = useState<MarketplaceProductDto[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");
  const [availFilter, setAvailFilter] = useState<string>("");
  const [syncBusy, setSyncBusy] = useState(false);
  const [orderBusyId, setOrderBusyId] = useState<string>("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  /** Local file chosen in modal; preview uses `url` until revoked. */
  const [imagePick, setImagePick] = useState<{ file: File; url: string } | null>(null);
  /** Product row when opening edit — used for modal image preview before a new file is chosen. */
  const [editSnapshot, setEditSnapshot] = useState<MarketplaceProductDto | null>(null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    category: "",
    productType: "",
    strainName: "",
    flavorName: "",
    sku: "",
    unitSize: "",
    price: "",
    quantityAvailable: "",
    potencyLabel: "",
    strainDominance: "",
    availabilityStatus: "INTERNAL" as "AVAILABLE" | "INTERNAL" | "NOT_AVAILABLE",
    imageDisplayMode: "AUTO" as "AUTO" | "CONTAIN" | "COVER",
  });

  const loadData = useCallback(async () => {
    setErr("");
    setLoading(true);
    setServicesErr("");
    try {
      const svcOut = await fetchCompanyWithServices();
      const s = (svcOut.services as CompanyServicesDto) || null;
      setServices(s);
      if (!s?.salesSellerEnabled) {
        setProducts([]);
        setOrders([]);
        setLoading(false);
        return;
      }
      const [pRes, oRes] = await Promise.all([
        salesSellerProducts({
          search: search.trim() || undefined,
          availabilityStatus: availFilter || undefined,
        }),
        salesSellerOrders("PENDING"),
      ]);
      setProducts(pRes.products || []);
      setOrders((oRes.orders || []) as OrderRow[]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not load seller data.";
      setErr(msg);
      setServicesErr(msg);
      setServices(null);
    } finally {
      setLoading(false);
    }
  }, [search, availFilter]);

  useEffect(() => {
    if (!isLoggedIn()) return;
    void loadData();
  }, [loadData]);

  const stats = useMemo(() => {
    let available = 0;
    let internal = 0;
    let notAvail = 0;
    for (const p of products) {
      if (p.availabilityStatus === "AVAILABLE") available += 1;
      else if (p.availabilityStatus === "INTERNAL") internal += 1;
      else notAvail += 1;
    }
    return { available, internal, notAvail, pendingOrders: orders.length };
  }, [products, orders]);

  function clearImagePick() {
    setImagePick((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
  }

  function openCreate() {
    setEditId(null);
    setEditSnapshot(null);
    clearImagePick();
    setForm({
      name: "",
      description: "",
      category: "",
      productType: "",
      strainName: "",
      flavorName: "",
      sku: "",
      unitSize: "",
      price: "",
      quantityAvailable: "",
      potencyLabel: "",
      strainDominance: "",
      availabilityStatus: "INTERNAL",
      imageDisplayMode: "AUTO",
    });
    setModalOpen(true);
  }

  function openEdit(p: MarketplaceProductDto) {
    setEditId(p.id);
    setEditSnapshot(p);
    clearImagePick();
    setForm({
      name: p.name,
      description: p.description || "",
      category: p.category || "",
      productType: p.productType || "",
      strainName: p.strainName || "",
      flavorName: p.flavorName || "",
      sku: p.sku || "",
      unitSize: p.unitSize || "",
      price: String(p.price),
      quantityAvailable: String(p.quantityAvailable),
      potencyLabel: p.potencyLabel || "",
      strainDominance: p.strainDominance || "",
      availabilityStatus: p.availabilityStatus as typeof form.availabilityStatus,
      imageDisplayMode: (p.imageDisplayMode as typeof form.imageDisplayMode) || "AUTO",
    });
    setModalOpen(true);
  }

  async function saveProduct() {
    const price = Number(form.price);
    const qty = Number(form.quantityAvailable);
    if (!form.name.trim()) {
      setErr("Product name is required.");
      return;
    }
    setSaveBusy(true);
    setErr("");
    try {
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        category: form.category.trim() || null,
        productType: form.productType.trim() || null,
        strainName: form.strainName.trim() || null,
        flavorName: form.flavorName.trim() || null,
        sku: form.sku.trim() || null,
        unitSize: form.unitSize.trim() || null,
        price,
        quantityAvailable: qty,
        availabilityStatus: form.availabilityStatus,
        imageDisplayMode: form.imageDisplayMode,
        potencyLabel: form.potencyLabel.trim() || null,
        strainDominance: form.strainDominance.trim() || null,
      };
      let productId = editId;
      if (editId) {
        await salesSellerProductPatch(editId, body);
      } else {
        const { product } = await salesSellerProductCreate(body);
        productId = product.id;
      }
      if (imagePick && productId) {
        const { mimeType, dataBase64 } = await fileToImageUploadPayload(imagePick.file);
        await salesSellerProductUploadImage(productId, { mimeType, dataBase64 });
      }
      clearImagePick();
      setEditSnapshot(null);
      setModalOpen(false);
      await loadData();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaveBusy(false);
    }
  }

  async function quickAvail(id: string, availabilityStatus: "AVAILABLE" | "INTERNAL" | "NOT_AVAILABLE") {
    try {
      await salesSellerProductPatch(id, { availabilityStatus });
      await loadData();
    } catch {
      /* ignore */
    }
  }

  async function removeProduct(id: string) {
    if (!confirm("Delete this product?")) return;
    try {
      await salesSellerProductDelete(id);
      await loadData();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Delete failed.");
    }
  }

  async function runLeafLinkSync() {
    setSyncBusy(true);
    setErr("");
    try {
      await salesLeafLinkSyncInventory();
      await loadData();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Sync failed.");
    } finally {
      setSyncBusy(false);
    }
  }

  async function setOrderStatus(orderId: string, status: "ACCEPTED" | "REJECTED" | "FULFILLED" | "CANCELLED") {
    setOrderBusyId(orderId);
    try {
      await salesSellerOrderSetStatus(orderId, status);
      await loadData();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Could not update order.");
    } finally {
      setOrderBusyId("");
    }
  }

  if (!isLoggedIn()) {
    return (
      <main style={{ padding: 32, color: "#e2e8f0" }}>
        <Link href="/login" style={{ color: "#93c5fd" }}>
          Sign in
        </Link>{" "}
        to use the Seller Platform.
      </main>
    );
  }

  if (loading && !services) {
    return (
      <main style={{ padding: 48, color: "#93c5fd", textAlign: "center" }}>
        Loading Seller Platform…
      </main>
    );
  }

  if (servicesErr && !services) {
    return (
      <main style={{ padding: 32, maxWidth: 560, margin: "0 auto", color: "#fecaca" }}>
        <h1 style={{ color: "#e2e8f0" }}>Seller Platform</h1>
        <p>{servicesErr}</p>
        <Link href="/" style={{ color: "#a78bfa" }}>
          Back to home
        </Link>
      </main>
    );
  }

  if (services && !services.salesSellerEnabled) {
    return (
      <main
        style={{
          minHeight: "70vh",
          padding: 32,
          maxWidth: 640,
          margin: "0 auto",
          color: "#e2e8f0",
        }}
      >
        <h1 style={{ fontSize: 28, fontWeight: 900 }}>Seller Platform</h1>
        <p style={{ color: "#94a3b8", lineHeight: 1.6 }}>
          {servicesErr ||
            "Seller Side is not enabled for this workspace. A NexBatch platform admin can turn it on from the portal under Workspace services."}
        </p>
        <Link href="/" style={{ color: "#a78bfa", fontWeight: 700 }}>
          {services.productionEnabled ? "Back to production" : "Back to home"}
        </Link>
      </main>
    );
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "24px 20px 48px",
        maxWidth: 1200,
        margin: "0 auto",
        color: "#e2e8f0",
      }}
    >
      {services?.productionEnabled ? (
        <div style={{ marginBottom: 18 }}>
          <Link
            href="/"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 16px",
              borderRadius: 12,
              border: "1px solid rgba(148, 163, 184, 0.4)",
              background: "rgba(15, 23, 42, 0.9)",
              color: "#cbd5e1",
              fontWeight: 800,
              fontSize: 14,
              textDecoration: "none",
            }}
          >
            ← Back to production
          </Link>
        </div>
      ) : null}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 28,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 32, fontWeight: 900, color: "#f8fafc" }}>Seller Platform</h1>
          <p style={{ margin: "10px 0 0", color: "#94a3b8", maxWidth: 520, lineHeight: 1.55 }}>
            List wholesale products for the NexBatch marketplace, manage availability, and fulfill buyer orders.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => openCreate()}
            style={{
              padding: "12px 20px",
              borderRadius: 14,
              border: "1px solid rgba(167, 139, 250, 0.55)",
              background: "linear-gradient(135deg, rgba(91,33,182,0.5), rgba(30,41,59,0.95))",
              color: "#fff",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Add product
          </button>
          {services?.leafLinkInventorySyncEnabled ? (
            <button
              type="button"
              disabled={syncBusy}
              onClick={() => void runLeafLinkSync()}
              style={{
                padding: "12px 20px",
                borderRadius: 14,
                border: "1px solid rgba(56, 189, 248, 0.45)",
                background: "rgba(8, 47, 73, 0.75)",
                color: "#7dd3fc",
                fontWeight: 800,
                cursor: syncBusy ? "wait" : "pointer",
              }}
            >
              {syncBusy ? "Syncing…" : "Sync LeafLink inventory"}
            </button>
          ) : null}
        </div>
      </div>

      {err ? (
        <div
          style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 12,
            background: "rgba(127, 29, 29, 0.4)",
            border: "1px solid rgba(248, 113, 113, 0.45)",
            color: "#fecaca",
          }}
        >
          {err}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 14,
          marginBottom: 28,
        }}
      >
        {[
          ["Available", stats.available, "#22c55e"],
          ["Internal", stats.internal, "#38bdf8"],
          ["Not available", stats.notAvail, "#f97316"],
          ["Pending orders", stats.pendingOrders, "#a78bfa"],
        ].map(([label, n, color]) => (
          <div
            key={String(label)}
            style={{
              padding: 16,
              borderRadius: 16,
              border: `1px solid ${color}55`,
              background: "#0f172a",
            }}
          >
            <div style={{ fontSize: 13, color: "#94a3b8", fontWeight: 700 }}>{label}</div>
            <div style={{ fontSize: 28, fontWeight: 900, color: String(color) }}>{n}</div>
          </div>
        ))}
      </div>

      <section style={{ marginBottom: 36 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 12 }}>Products</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onBlur={() => void loadData()}
            placeholder="Search name, SKU, description…"
            style={{
              flex: "1 1 220px",
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid rgba(148,163,184,0.35)",
              background: "#020617",
              color: "#fff",
            }}
          />
          <select
            value={availFilter}
            onChange={(e) => setAvailFilter(e.target.value)}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid rgba(148,163,184,0.35)",
              background: "#020617",
              color: "#fff",
            }}
          >
            <option value="">All availability</option>
            <option value="AVAILABLE">Available</option>
            <option value="INTERNAL">Internal</option>
            <option value="NOT_AVAILABLE">Not available</option>
          </select>
          <button
            type="button"
            onClick={() => void loadData()}
            style={{
              padding: "10px 16px",
              borderRadius: 10,
              border: "1px solid rgba(148,163,184,0.45)",
              background: "#1e293b",
              color: "#e2e8f0",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Apply
          </button>
        </div>
        {loading ? (
          <p style={{ color: "#93c5fd" }}>Loading products…</p>
        ) : products.length === 0 ? (
          <div
            style={{
              padding: 28,
              borderRadius: 16,
              border: "1px dashed rgba(148,163,184,0.35)",
              color: "#94a3b8",
              textAlign: "center",
            }}
          >
            No products yet. Add a manual product or run LeafLink sync (when enabled) to import inventory.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
            {products.map((p) => (
              <div
                key={p.id}
                style={{
                  borderRadius: 16,
                  border: "1px solid rgba(148,163,184,0.25)",
                  background: "#0f172a",
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <MarketplaceProductImageFrame
                  apiBaseUrl={API_BASE_URL}
                  imageUrl={p.imageUrl}
                  companyInventoryLogoUrl={p.companyInventoryLogoUrl}
                  imageDisplayMode={p.imageDisplayMode}
                  height={100}
                  placeholderBackground={placeholderImg}
                />
                <div style={{ padding: 14, flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ fontWeight: 800, fontSize: 16 }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: "#94a3b8" }}>
                    {(p.category || p.productType || "—") +
                      (p.sku ? ` · SKU ${p.sku}` : "") +
                      (p.unitSize ? ` · ${p.unitSize}` : "")}
                  </div>
                  <div style={{ fontWeight: 800, color: "#a5b4fc" }}>
                    ${p.price.toFixed(2)} · Qty {p.quantityAvailable}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 800,
                        padding: "4px 8px",
                        borderRadius: 8,
                        background: "rgba(34,197,94,0.2)",
                        color: "#86efac",
                      }}
                    >
                      {p.availabilityStatus}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 800,
                        padding: "4px 8px",
                        borderRadius: 8,
                        background: "rgba(148,163,184,0.2)",
                        color: "#cbd5e1",
                      }}
                    >
                      {p.source}
                    </span>
                  </div>
                  <select
                    value={p.availabilityStatus}
                    onChange={(e) =>
                      void quickAvail(p.id, e.target.value as typeof form.availabilityStatus)
                    }
                    style={{
                      marginTop: 4,
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: "1px solid rgba(148,163,184,0.35)",
                      background: "#020617",
                      color: "#fff",
                      fontSize: 13,
                    }}
                  >
                    <option value="AVAILABLE">Available</option>
                    <option value="INTERNAL">Internal</option>
                    <option value="NOT_AVAILABLE">Not available</option>
                  </select>
                  <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
                    <button
                      type="button"
                      onClick={() => openEdit(p)}
                      style={{
                        flex: 1,
                        padding: "8px 12px",
                        borderRadius: 10,
                        border: "1px solid rgba(167,139,250,0.45)",
                        background: "rgba(76,29,149,0.35)",
                        color: "#e9d5ff",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeProduct(p.id)}
                      style={{
                        padding: "8px 12px",
                        borderRadius: 10,
                        border: "1px solid rgba(248,113,113,0.45)",
                        background: "rgba(127,29,29,0.35)",
                        color: "#fecaca",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 12 }}>Pending NexBatch orders</h2>
        {orders.length === 0 ? (
          <p style={{ color: "#64748b" }}>No pending orders.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {orders.map((o) => (
              <div
                key={o.id}
                style={{
                  padding: 16,
                  borderRadius: 14,
                  border: "1px solid rgba(148,163,184,0.25)",
                  background: "#0f172a",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                  <div>
                    <div style={{ fontWeight: 800 }}>{o.buyerCompany?.name || "Buyer"}</div>
                    <div style={{ fontSize: 12, color: "#64748b" }}>{new Date(o.createdAt).toLocaleString()}</div>
                  </div>
                  <div style={{ fontWeight: 900, color: "#a5b4fc" }}>${Number(o.total).toFixed(2)}</div>
                </div>
                <ul style={{ margin: "10px 0", paddingLeft: 18, color: "#94a3b8", fontSize: 14 }}>
                  {o.items?.map((it, i) => (
                    <li key={i}>
                      {it.productNameSnapshot} × {it.quantity} (${Number(it.lineTotal).toFixed(2)})
                    </li>
                  ))}
                </ul>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    disabled={orderBusyId === o.id}
                    onClick={() => void setOrderStatus(o.id, "ACCEPTED")}
                    style={actionBtn("#22c55e")}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    disabled={orderBusyId === o.id}
                    onClick={() => void setOrderStatus(o.id, "REJECTED")}
                    style={actionBtn("#f87171")}
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    disabled={orderBusyId === o.id}
                    onClick={() => void setOrderStatus(o.id, "FULFILLED")}
                    style={actionBtn("#38bdf8")}
                  >
                    Mark fulfilled
                  </button>
                  <button
                    type="button"
                    disabled={orderBusyId === o.id}
                    onClick={() => void setOrderStatus(o.id, "CANCELLED")}
                    style={actionBtn("#94a3b8")}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {modalOpen ? (
        <div
          role="presentation"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.75)",
            zIndex: 2000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onMouseDown={() => {
            if (saveBusy) return;
            clearImagePick();
            setEditSnapshot(null);
            setModalOpen(false);
          }}
        >
          <div
            role="dialog"
            style={{
              width: "100%",
              maxWidth: 480,
              maxHeight: "90vh",
              overflowY: "auto",
              background: "#0f172a",
              border: "1px solid rgba(148,163,184,0.35)",
              borderRadius: 16,
              padding: 22,
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>{editId ? "Edit product" : "Add product"}</h3>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, color: "#94a3b8", fontWeight: 700, marginBottom: 6 }}>Product photo</div>
              <div
                style={{
                  marginBottom: 8,
                  border: "1px solid rgba(148,163,184,0.25)",
                  borderRadius: 12,
                  overflow: "hidden",
                }}
              >
                <MarketplaceProductImageFrame
                  apiBaseUrl={API_BASE_URL}
                  imageUrl={editSnapshot?.imageUrl ?? null}
                  companyInventoryLogoUrl={
                    editSnapshot?.companyInventoryLogoUrl ?? products[0]?.companyInventoryLogoUrl ?? null
                  }
                  imageDisplayMode={form.imageDisplayMode}
                  directSrc={imagePick?.url ?? null}
                  height={96}
                  placeholderBackground={placeholderImg}
                />
              </div>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  setImagePick((prev) => {
                    if (prev?.url) URL.revokeObjectURL(prev.url);
                    return { file, url: URL.createObjectURL(file) };
                  });
                }}
                style={{ fontSize: 13, color: "#cbd5e1" }}
              />
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 6, lineHeight: 1.45 }}>
                Optional. Until you upload, buyers see your company inventory print logo from workspace config (if
                set).
              </div>
              <label style={{ display: "block", marginTop: 12, fontSize: 13 }}>
                <span style={{ color: "#94a3b8", fontWeight: 700 }}>Photo fit on cards</span>
                <select
                  value={form.imageDisplayMode}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      imageDisplayMode: e.target.value as typeof f.imageDisplayMode,
                    }))
                  }
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: 4,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid rgba(148,163,184,0.35)",
                    background: "#020617",
                    color: "#fff",
                  }}
                >
                  <option value="AUTO">Auto — photos fill the card; logos shrink to fit without cropping</option>
                  <option value="CONTAIN">Show full image — letterbox if needed</option>
                  <option value="COVER">Fill frame — may crop</option>
                </select>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 6, lineHeight: 1.45 }}>
                  Applies to seller grid and buyer marketplace. Auto uses a full-bleed look for uploaded photos and a
                  contained look when only your inventory logo is shown.
                </div>
              </label>
            </div>
            {[
              ["name", "Name", "text"],
              ["description", "Description", "text"],
              ["category", "Category", "text"],
              ["productType", "Product type", "text"],
              ["strainName", "Strain", "text"],
              ["flavorName", "Flavor", "text"],
              ["potencyLabel", "Potency (buyers)", "text"],
              ["strainDominance", "Dominance (buyers)", "text"],
              ["sku", "SKU", "text"],
              ["unitSize", "Unit size", "text"],
              ["price", "Price", "number"],
              ["quantityAvailable", "Quantity available", "number"],
            ].map(([key, label, type]) => (
              <label key={key} style={{ display: "block", marginBottom: 10, fontSize: 13 }}>
                <span style={{ color: "#94a3b8", fontWeight: 700 }}>{label}</span>
                <input
                  type={type}
                  value={(form as Record<string, string>)[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  style={{
                    display: "block",
                    width: "100%",
                    marginTop: 4,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid rgba(148,163,184,0.35)",
                    background: "#020617",
                    color: "#fff",
                    boxSizing: "border-box",
                  }}
                />
              </label>
            ))}
            <label style={{ display: "block", marginBottom: 14, fontSize: 13 }}>
              <span style={{ color: "#94a3b8", fontWeight: 700 }}>Availability</span>
              <select
                value={form.availabilityStatus}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    availabilityStatus: e.target.value as typeof form.availabilityStatus,
                  }))
                }
                style={{
                  display: "block",
                  width: "100%",
                  marginTop: 4,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid rgba(148,163,184,0.35)",
                  background: "#020617",
                  color: "#fff",
                }}
              >
                <option value="AVAILABLE">Available (marketplace)</option>
                <option value="INTERNAL">Internal only</option>
                <option value="NOT_AVAILABLE">Not available</option>
              </select>
            </label>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                disabled={saveBusy}
                onClick={() => {
                  clearImagePick();
                  setEditSnapshot(null);
                  setModalOpen(false);
                }}
                style={{ ...actionBtn("#64748b"), opacity: saveBusy ? 0.6 : 1 }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saveBusy}
                onClick={() => void saveProduct()}
                style={{ ...actionBtn("#a78bfa"), opacity: saveBusy ? 0.6 : 1 }}
              >
                {saveBusy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function actionBtn(color: string): CSSProperties {
  return {
    padding: "8px 14px",
    borderRadius: 10,
    border: `1px solid ${color}`,
    background: `${color}22`,
    color: "#fff",
    fontWeight: 700,
    cursor: "pointer",
  };
}

