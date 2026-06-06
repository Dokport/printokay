"use client";

import { useEffect, useRef, useState } from "react";
import { Product, formatPrice, MATERIALS } from "@/lib/products";
import { SiteSettings, ShippingOption, FilamentSpool, DEFAULT_SETTINGS, COLOR_THEMES } from "@/lib/settings";
import { DEFAULT_KEYRING_SETTINGS, KEYRING_FONTS, KEYRING_SHAPES } from "@/lib/keyring";
import type { KeyringOrder } from "@/lib/orders";
import Image from "next/image";

const EMOJIS = ["🦕", "🐉", "🦊", "🐼", "🐸", "🎲", "⭕", "🌀", "🎯", "🌸", "🔑", "🖨️", "⭐", "🎁", "🧩"];
const LOGO_EMOJIS = ["🖨️", "⭐", "🌟", "🎨", "🛍️", "✨", "🎁", "🎀", "🌈", "🦋", "🌸", "💎", "🔮", "🎪", "🏷️"];
const CAT_EMOJIS = ["🦕", "🎲", "🔧", "🌸", "🐉", "🎯", "⭐", "🎁", "🧩", "🔑", "🌀", "🦊", "🐼", "🎀", "💎"];
const EMPTY_FORM = { name: "", description: "", price: "", emoji: "🖨️", category: "", image: "", material: "", modelUrl: "", colorSlots: [] as { id: string; label: string }[] };
const SESSION_KEY = "po_adm";

function getStoredPw(): string | null {
  return typeof window !== "undefined" ? sessionStorage.getItem(SESSION_KEY) : null;
}

function authHeaders(): Record<string, string> {
  const pw = getStoredPw();
  return pw ? { "x-admin-token": pw } : {};
}

function authedFetch(url: string, opts: RequestInit = {}) {
  return fetch(url, {
    ...opts,
    headers: { ...(opts.headers as Record<string, string> ?? {}), ...authHeaders() },
  });
}

export default function AdminPage() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [tab, setTab] = useState<"produkter" | "lager" | "bestillinger" | "indstillinger">("produkter");

  // Orders state
  const [orders, setOrders] = useState<KeyringOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);

  // Test G-code state
  const EMPTY_TEST = { text: "Emma", font: "Roboto-Bold", shapeType: "auto", sizeId: "medium", baseColorHex: "#7c3aed", textColorHex: "#ffffff", baseFilamentName: "Lilla PLA", textFilamentName: "Hvid PLA" };
  const [testGcode, setTestGcode] = useState(EMPTY_TEST);
  const [testGenerating, setTestGenerating] = useState(false);
  const [testError, setTestError] = useState("");

  // Products state
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [productMsg, setProductMsg] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Settings state
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SETTINGS);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState("");

  // New category form
  const [newCat, setNewCat] = useState({ label: "", emoji: "🎁" });

  // Logo upload
  const logoFileRef = useRef<HTMLInputElement>(null);
  const [logoUploading, setLogoUploading] = useState(false);

  // New shipping form
  const EMPTY_SHIPPING = { name: "", price: "", minDays: "3", maxDays: "7" };
  const [newShipping, setNewShipping] = useState(EMPTY_SHIPPING);

  // Filament state
  const EMPTY_FILAMENT = { name: "", material: "PLA", colorHex: "#7c3aed" };
  const [newFilament, setNewFilament] = useState(EMPTY_FILAMENT);
  const [filamentSaving, setFilamentSaving] = useState(false);

  useEffect(() => {
    const pw = sessionStorage.getItem(SESSION_KEY);
    if (pw) setLoggedIn(true);
    fetch("/api/settings").then((r) => r.json()).then((d) => { if (d.siteName) setSettings(d); });
  }, []);

  useEffect(() => {
    if (!loggedIn) return;
    fetch("/api/products").then((r) => r.json()).then((d) => { if (Array.isArray(d)) setProducts(d); });
    fetch("/api/settings").then((r) => r.json()).then((d) => { if (d.siteName) setSettings(d); });
  }, [loggedIn]);

  useEffect(() => {
    if (!loggedIn || tab !== "bestillinger") return;
    setOrdersLoading(true);
    authedFetch("/api/orders")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setOrders(d); })
      .finally(() => setOrdersLoading(false));
  }, [loggedIn, tab]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError("Kontakter server...");
    try {
      const res = await fetch("/api/admin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (res.ok && data.token) {
        setLoginError("✓ OK — logger ind...");
        sessionStorage.setItem(SESSION_KEY, data.token);
        setLoggedIn(true);
      } else {
        setLoginError(`Fejl ${res.status}: ${data.error ?? "Forkert adgangskode"}`);
      }
    } catch (err) {
      setLoginError(`Netværksfejl: ${String(err)}`);
    }
  }

  function handleLogout() {
    sessionStorage.removeItem(SESSION_KEY);
    setLoggedIn(false);
    setPassword("");
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    const res = await authedFetch("/api/upload", { method: "POST", body: fd });
    const data = await res.json();
    if (data.url) setForm((f) => ({ ...f, image: data.url }));
    setUploading(false);
  }

  async function saveFilaments(filaments: FilamentSpool[]) {
    setFilamentSaving(true);
    await authedFetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...settings, filaments }),
    });
    setSettings((s) => ({ ...s, filaments }));
    setFilamentSaving(false);
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    const res = await authedFetch("/api/upload", { method: "POST", body: fd });
    const data = await res.json();
    if (data.url) setSettings((s) => ({ ...s, logoImage: data.url }));
    setLogoUploading(false);
    if (logoFileRef.current) logoFileRef.current.value = "";
  }

  function startEdit(product: Product) {
    setEditingId(product.id);
    setForm({ name: product.name, description: product.description, price: (product.price / 100).toString(), emoji: product.emoji, category: product.category, image: product.image, material: product.material ?? "", modelUrl: product.modelUrl ?? "", colorSlots: product.colorSlots ?? [] });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() { setEditingId(null); setForm(EMPTY_FORM); }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setProductMsg("");
    const url = editingId ? `/api/products/${editingId}` : "/api/products";
    const res = await authedFetch(url, { method: editingId ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    if (res.ok) {
      const updated = await authedFetch("/api/products").then((r) => r.json());
      setProducts(updated); setForm(EMPTY_FORM); setEditingId(null);
      if (fileRef.current) fileRef.current.value = "";
      setProductMsg(editingId ? "✓ Produkt opdateret!" : "✓ Produkt tilføjet!");
      setTimeout(() => setProductMsg(""), 3000);
    } else { setProductMsg("Noget gik galt."); }
    setSaving(false);
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Slet "${name}"?`)) return;
    await authedFetch(`/api/products/${id}`, { method: "DELETE" });
    setProducts((prev) => prev.filter((p) => p.id !== id));
  }

  async function handleSettingsSave(e: React.FormEvent) {
    e.preventDefault(); setSettingsSaving(true); setSettingsMsg("");
    const res = await authedFetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
    if (res.ok) {
      setSettingsMsg("✓ Indstillinger gemt! Genindlæs siden for at se ændringer.");
      setTimeout(() => setSettingsMsg(""), 4000);
    } else { setSettingsMsg("Noget gik galt."); }
    setSettingsSaving(false);
  }

  function applyTheme(theme: typeof COLOR_THEMES[0]) {
    setSettings((s) => ({ ...s, primaryColor: theme.primary, accentColor: theme.accent, bgColor: theme.bg }));
  }

  if (!loggedIn) {
    return (
      <div className="max-w-sm mx-auto mt-24">
        <div className="bg-white rounded-2xl p-8 shadow-sm">
          <h1 className="text-2xl font-bold text-purple-800 mb-6 text-center">🔒 Admin</h1>
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <input type="password" placeholder="Adgangskode" value={password} onChange={(e) => setPassword(e.target.value)}
              className="border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-purple-400" autoFocus />
            {loginError && <p className="text-red-500 text-sm">{loginError}</p>}
            <button className="bg-purple-600 text-white py-3 rounded-xl font-semibold hover:bg-purple-700 transition-colors">Log ind</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-purple-800">⚙️ Admin</h1>
        <button onClick={handleLogout} className="text-gray-400 hover:text-red-500 text-sm transition-colors">Log ud</button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1 w-fit flex-wrap">
        {(["produkter", "lager", "bestillinger", "indstillinger"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2 rounded-lg font-medium text-sm transition-all ${tab === t ? "bg-white shadow text-gray-800" : "text-gray-500 hover:text-gray-700"}`}>
            {t === "produkter" ? "📦 Produkter" : t === "lager" ? "🧵 Lager" : t === "bestillinger" ? "📬 Bestillinger" : "🎨 Udseende"}
          </button>
        ))}
      </div>

      {/* ── PRODUCTS TAB ── */}
      {tab === "produkter" && (
        <div>
          <div className="bg-white rounded-2xl p-6 shadow-sm mb-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">{editingId ? "✏️ Rediger produkt" : "➕ Tilføj nyt produkt"}</h2>
            <form onSubmit={handleSave} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-600 font-medium">Navn</label>
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-400" placeholder="fx Drage" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-600 font-medium">Pris (kr)</label>
                <input required type="number" min="1" step="0.5" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })}
                  className="border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-400" placeholder="fx 49" />
              </div>
              <div className="sm:col-span-2 flex flex-col gap-1">
                <label className="text-sm text-gray-600 font-medium">Beskrivelse</label>
                <textarea required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-400 resize-none" rows={2} placeholder="Beskriv produktet..." />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-600 font-medium">Kategori</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-400">
                  <option value="">— Vælg kategori —</option>
                  {settings.categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-600 font-medium">Emoji</label>
                <div className="flex gap-2 flex-wrap">
                  {EMOJIS.map((e) => (
                    <button type="button" key={e} onClick={() => setForm({ ...form, emoji: e })}
                      className={`text-2xl p-1 rounded-lg transition-all ${form.emoji === e ? "bg-purple-100 ring-2 ring-purple-400" : "hover:bg-gray-100"}`}>
                      {e}
                    </button>
                  ))}
                </div>
              </div>
              <div className="sm:col-span-2 flex flex-col gap-2">
                <label className="text-sm text-gray-600 font-medium">
                  Farveområder
                  <span className="text-gray-400 font-normal ml-1">(kunden vælger filament per område)</span>
                </label>
                <div className="flex flex-col gap-2">
                  {form.colorSlots.map((slot, i) => (
                    <div key={slot.id} className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 w-5 text-right flex-shrink-0">{i + 1}.</span>
                      <input
                        value={slot.label}
                        onChange={(e) => setForm((f) => ({
                          ...f,
                          colorSlots: f.colorSlots.map((s) => s.id === slot.id ? { ...s, label: e.target.value } : s)
                        }))}
                        placeholder="fx Krop, Øjne, Base..."
                        className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                      />
                      <button type="button"
                        onClick={() => setForm((f) => ({ ...f, colorSlots: f.colorSlots.filter((s) => s.id !== slot.id) }))}
                        className="text-gray-300 hover:text-red-400 transition-colors text-lg flex-shrink-0">✕</button>
                    </div>
                  ))}
                  <button type="button"
                    onClick={() => setForm((f) => ({
                      ...f,
                      colorSlots: [...f.colorSlots, { id: `slot-${Date.now()}`, label: "" }]
                    }))}
                    className="text-sm text-purple-600 hover:text-purple-800 font-medium w-fit">
                    + Tilføj farveområde
                  </button>
                  {form.colorSlots.length === 0 && (
                    <p className="text-xs text-gray-400 italic">Ingen farveområder — farvevalg slået fra for dette produkt.</p>
                  )}
                </div>
              </div>

              <div className="sm:col-span-2 flex flex-col gap-2">
                <label className="text-sm text-gray-600 font-medium">Materiale</label>
                <div className="flex gap-2 flex-wrap items-center">
                  {MATERIALS.map((m) => (
                    <button type="button" key={m}
                      onClick={() => setForm((f) => ({ ...f, material: f.material === m ? "" : m }))}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-all ${form.material === m ? "bg-purple-600 text-white border-purple-600" : "border-gray-200 text-gray-600 hover:border-purple-400 hover:text-purple-600"}`}>
                      {m}
                    </button>
                  ))}
                  <input
                    type="text"
                    placeholder="Andet materiale..."
                    value={MATERIALS.includes(form.material) ? "" : form.material}
                    onChange={(e) => setForm((f) => ({ ...f, material: e.target.value }))}
                    className="border border-gray-200 rounded-full px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 w-40"
                  />
                </div>
              </div>

              <div className="sm:col-span-2 flex flex-col gap-1">
                <label className="text-sm text-gray-600 font-medium">Link til 3D model <span className="text-gray-400 font-normal">(Printables, Thingiverse osv.) — kun synligt i admin</span></label>
                <input type="url" value={form.modelUrl} onChange={(e) => setForm({ ...form, modelUrl: e.target.value })}
                  placeholder="https://www.printables.com/model/..."
                  className="border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-400" />
              </div>

              <div className="sm:col-span-2 flex flex-col gap-2">
                <label className="text-sm text-gray-600 font-medium">Produktbillede</label>
                <div className="flex items-start gap-4">
                  <label className={`flex flex-col items-center justify-center w-36 h-36 rounded-2xl border-2 border-dashed cursor-pointer transition-colors ${uploading ? "border-purple-300 bg-purple-50" : "border-gray-200 hover:border-purple-400 hover:bg-purple-50"}`}>
                    {uploading ? (
                      <span className="text-purple-500 text-sm font-medium">Uploader...</span>
                    ) : form.image ? (
                      <div className="relative w-full h-full rounded-2xl overflow-hidden">
                        <Image src={form.image} alt="Preview" fill className="object-cover" unoptimized />
                      </div>
                    ) : (
                      <><span className="text-3xl mb-1">📷</span><span className="text-xs text-gray-400 text-center px-2">Klik for at uploade billede</span></>
                    )}
                    <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                  </label>
                  {form.image && (
                    <button type="button" onClick={() => { setForm((f) => ({ ...f, image: "" })); if (fileRef.current) fileRef.current.value = ""; }}
                      className="text-sm text-red-400 hover:text-red-600 mt-2">Fjern billede</button>
                  )}
                </div>
              </div>
              <div className="sm:col-span-2 flex gap-3 items-center">
                <button type="submit" disabled={saving || uploading}
                  className="bg-purple-600 text-white px-6 py-2.5 rounded-xl font-semibold hover:bg-purple-700 transition-colors disabled:opacity-60">
                  {saving ? "Gemmer..." : editingId ? "Gem ændringer" : "Tilføj produkt"}
                </button>
                {editingId && <button type="button" onClick={cancelEdit} className="text-gray-500 hover:text-gray-700 text-sm">Annuller</button>}
                {productMsg && <span className="text-green-600 font-medium text-sm">{productMsg}</span>}
              </div>
            </form>
          </div>

          <div className="flex flex-col gap-3">
            {products.map((p) => (
              <div key={p.id} className="bg-white rounded-2xl px-5 py-4 shadow-sm flex items-center gap-4">
                <div className="relative w-12 h-12 rounded-xl overflow-hidden bg-purple-50 flex-shrink-0 flex items-center justify-center">
                  {p.image && p.image !== "/products/placeholder.jpg" ? (
                    <Image src={p.image} alt={p.name} fill className="object-cover" unoptimized />
                  ) : <span className="text-2xl">{p.emoji}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-800">{p.name}</p>
                  <p className="text-sm text-gray-500 truncate">{p.description}</p>
                </div>
                <span className="text-purple-700 font-bold whitespace-nowrap">{formatPrice(p.price)}</span>
                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">
                  {settings.categories.find((c) => c.id === p.category)?.emoji} {settings.categories.find((c) => c.id === p.category)?.label ?? p.category}
                </span>
                {p.material && (
                  <span className="text-xs bg-purple-50 text-purple-700 px-2 py-1 rounded-full font-mono">{p.material}</span>
                )}
                {p.modelUrl && (
                  <a href={p.modelUrl} target="_blank" rel="noopener noreferrer"
                    className="text-gray-400 hover:text-blue-500 transition-colors" title="Åbn 3D model">
                    🔗
                  </a>
                )}
                <button onClick={() => startEdit(p)} className="text-blue-400 hover:text-blue-600 text-sm font-medium">Rediger</button>
                <button onClick={() => handleDelete(p.id, p.name)} className="text-red-400 hover:text-red-600 text-lg" aria-label="Slet">✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── LAGER TAB ── */}
      {tab === "lager" && (
        <div className="flex flex-col gap-6">

          {/* Filament list */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-800">🧵 Filament på lager</h2>
              {filamentSaving && <span className="text-xs text-gray-400">Gemmer...</span>}
            </div>

            {(settings.filaments ?? []).length === 0 && (
              <p className="text-sm text-gray-400 italic mb-4">Ingen filament tilføjet endnu. Tilføj din første rulle herunder.</p>
            )}

            <div className="flex flex-col gap-2 mb-6">
              {(settings.filaments ?? []).map((f) => (
                <div key={f.id} className="flex items-center gap-3 rounded-xl px-4 py-3 border border-gray-100">
                  <div className="w-8 h-8 rounded-full border-2 border-white shadow flex-shrink-0"
                    style={{ backgroundColor: f.colorHex }} />
                  <div className="flex-1">
                    <p className="font-medium text-gray-800">{f.name}</p>
                    <p className="text-xs text-gray-400 font-mono">{f.material}</p>
                  </div>
                  {/* In stock toggle */}
                  <button
                    type="button"
                    onClick={() => {
                      const updated = (settings.filaments ?? []).map((s) =>
                        s.id === f.id ? { ...s, inStock: !s.inStock } : s
                      );
                      saveFilaments(updated);
                    }}
                    className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${f.inStock ? "bg-green-100 text-green-700 hover:bg-red-50 hover:text-red-600" : "bg-red-100 text-red-600 hover:bg-green-50 hover:text-green-700"}`}>
                    {f.inStock ? "✓ På lager" : "✗ Udsolgt"}
                  </button>
                  <button
                    type="button"
                    onClick={() => saveFilaments((settings.filaments ?? []).filter((s) => s.id !== f.id))}
                    className="text-gray-300 hover:text-red-500 transition-colors text-lg ml-1"
                    aria-label="Slet">✕</button>
                </div>
              ))}
            </div>

            {/* Add new filament */}
            <div className="border-t pt-5">
              <p className="text-sm font-medium text-gray-700 mb-3">Tilføj filamentrulle</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
                <div className="col-span-2 flex flex-col gap-1">
                  <label className="text-xs text-gray-500">Navn</label>
                  <input value={newFilament.name} onChange={(e) => setNewFilament((f) => ({ ...f, name: e.target.value }))}
                    placeholder="fx Galaxy Black" className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-500">Materiale</label>
                  <select value={newFilament.material} onChange={(e) => setNewFilament((f) => ({ ...f, material: e.target.value }))}
                    className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400">
                    {MATERIALS.map((m) => <option key={m} value={m}>{m}</option>)}
                    <option value="Andet">Andet</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-500">Farve</label>
                  <div className="flex gap-2 items-center">
                    <input type="color" value={newFilament.colorHex} onChange={(e) => setNewFilament((f) => ({ ...f, colorHex: e.target.value }))}
                      className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer p-0.5 flex-shrink-0" />
                    <input type="text" value={newFilament.colorHex} onChange={(e) => setNewFilament((f) => ({ ...f, colorHex: e.target.value }))}
                      className="w-full border border-gray-200 rounded-xl px-2 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-400" />
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="mt-3 bg-purple-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-purple-700 transition-colors disabled:opacity-60"
                disabled={filamentSaving || !newFilament.name.trim()}
                onClick={() => {
                  if (!newFilament.name.trim()) return;
                  const spool: FilamentSpool = {
                    id: `fil-${Date.now()}`,
                    name: newFilament.name.trim(),
                    material: newFilament.material,
                    colorHex: newFilament.colorHex,
                    inStock: true,
                  };
                  saveFilaments([...(settings.filaments ?? []), spool]);
                  setNewFilament(EMPTY_FILAMENT);
                }}>
                + Tilføj rulle
              </button>
            </div>
          </div>

          {/* Summary */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h2 className="font-semibold text-gray-800 mb-3">📊 Overblik</h2>
            <div className="grid grid-cols-3 gap-4 text-center">
              {["PLA", "PETG", "TPU"].map((mat) => {
                const spools = (settings.filaments ?? []).filter((f) => f.material === mat);
                const inStock = spools.filter((f) => f.inStock).length;
                return (
                  <div key={mat} className="bg-gray-50 rounded-xl p-3">
                    <p className="text-xs text-gray-500 font-mono mb-1">{mat}</p>
                    <p className="text-2xl font-bold text-gray-800">{inStock}</p>
                    <p className="text-xs text-gray-400">af {spools.length} på lager</p>
                  </div>
                );
              })}
            </div>
          </div>

        </div>
      )}

      {/* ── BESTILLINGER TAB ── */}
      {tab === "bestillinger" && (
        <div className="flex flex-col gap-6">

          {/* ── Test G-code generator ── */}
          <div className="bg-white rounded-2xl p-6 shadow-sm border-2 border-dashed border-purple-200">
            <h2 className="font-semibold text-gray-800 mb-1">🧪 Test G-code generator</h2>
            <p className="text-sm text-gray-500 mb-4">Generer G-code direkte uden at gå igennem checkout — brug dette til at tjekke filen inden shoppen er live.</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              {/* Text */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-600">Tekst</label>
                <input value={testGcode.text} onChange={(e) => setTestGcode((t) => ({ ...t, text: e.target.value }))}
                  placeholder="fx Emma" maxLength={20}
                  className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
              </div>

              {/* Size */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-600">Størrelse</label>
                <select value={testGcode.sizeId} onChange={(e) => setTestGcode((t) => ({ ...t, sizeId: e.target.value }))}
                  className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400">
                  {(settings.keyring?.sizes ?? DEFAULT_KEYRING_SETTINGS.sizes).map((s) => (
                    <option key={s.id} value={s.id}>{s.label} ({s.widthMm}×{s.heightMm}mm)</option>
                  ))}
                </select>
              </div>

              {/* Font */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-600">Skrifttype</label>
                <select value={testGcode.font} onChange={(e) => setTestGcode((t) => ({ ...t, font: e.target.value }))}
                  className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400">
                  {KEYRING_FONTS.map((f) => (
                    <option key={f.id} value={f.id}>{f.label}</option>
                  ))}
                </select>
              </div>

              {/* Shape */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-600">Form</label>
                <select value={testGcode.shapeType} onChange={(e) => setTestGcode((t) => ({ ...t, shapeType: e.target.value }))}
                  className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400">
                  {KEYRING_SHAPES.map((s) => (
                    <option key={s.id} value={s.id}>{s.emoji} {s.label}</option>
                  ))}
                </select>
              </div>

              {/* Base color */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-600">Base-farve</label>
                <div className="flex gap-2 items-center">
                  <input type="color" value={testGcode.baseColorHex} onChange={(e) => setTestGcode((t) => ({ ...t, baseColorHex: e.target.value }))}
                    className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer p-0.5 flex-shrink-0" />
                  <input value={testGcode.baseFilamentName} onChange={(e) => setTestGcode((t) => ({ ...t, baseFilamentName: e.target.value }))}
                    placeholder="Filament navn (til G-code kommentar)"
                    className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
                </div>
              </div>

              {/* Text color */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-600">Tekst-farve</label>
                <div className="flex gap-2 items-center">
                  <input type="color" value={testGcode.textColorHex} onChange={(e) => setTestGcode((t) => ({ ...t, textColorHex: e.target.value }))}
                    className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer p-0.5 flex-shrink-0" />
                  <input value={testGcode.textFilamentName} onChange={(e) => setTestGcode((t) => ({ ...t, textFilamentName: e.target.value }))}
                    placeholder="Filament navn (til G-code kommentar)"
                    className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
                </div>
              </div>
            </div>

            {testError && (
              <p className="text-red-500 text-sm mb-3">❌ {testError}</p>
            )}

            <button
              type="button"
              disabled={testGenerating || !testGcode.text.trim()}
              onClick={async () => {
                setTestGenerating(true);
                setTestError("");
                try {
                  const size = (settings.keyring?.sizes ?? DEFAULT_KEYRING_SETTINGS.sizes).find((s) => s.id === testGcode.sizeId) ?? DEFAULT_KEYRING_SETTINGS.sizes[1];
                  const res = await authedFetch("/api/orders/test-stl", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      ...testGcode,
                      fontSize: 0, // auto-calculated in STL generator
                    }),
                  });
                  if (!res.ok) {
                    const err = await res.json();
                    setTestError(err.error ?? "Ukendt fejl");
                    return;
                  }
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `test_noglering_${testGcode.text}.zip`;
                  a.click();
                  URL.revokeObjectURL(url);
                } catch (err) {
                  setTestError(String(err));
                } finally {
                  setTestGenerating(false);
                }
              }}
              className="bg-purple-600 text-white px-6 py-2.5 rounded-xl font-semibold hover:bg-purple-700 transition-colors disabled:opacity-60 flex items-center gap-2"
            >
              {testGenerating ? (
                <><span className="animate-spin">⚙️</span> Genererer STL...</>
              ) : (
                <>⬇️ Generer og download STL (ZIP)</>
              )}
            </button>
          </div>

          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-800">📬 Nøglering-bestillinger</h2>
              <button
                type="button"
                onClick={() => {
                  setOrdersLoading(true);
                  authedFetch("/api/orders")
                    .then((r) => r.json())
                    .then((d) => { if (Array.isArray(d)) setOrders(d); })
                    .finally(() => setOrdersLoading(false));
                }}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                {ordersLoading ? "Indlæser..." : "↻ Genindlæs"}
              </button>
            </div>

            {ordersLoading && orders.length === 0 ? (
              <p className="text-sm text-gray-400 italic">Indlæser bestillinger...</p>
            ) : orders.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <p className="text-4xl mb-3">📭</p>
                <p className="font-medium">Ingen bestillinger endnu</p>
                <p className="text-sm mt-1">Bestillinger dukker op her når kunder køber nøgleringe</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {orders.map((order) => {
                  const date = new Date(order.createdAt);
                  const dateStr = date.toLocaleDateString("da-DK", { day: "numeric", month: "short", year: "numeric" });
                  const timeStr = date.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" });
                  const twoColors = order.baseColorHex !== order.textColorHex;

                  return (
                    <div key={order.id} className="border border-gray-100 rounded-2xl p-4">
                      <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div className="flex-1 min-w-0">
                          {/* Order header */}
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <span className="text-lg font-bold text-gray-800">
                              &ldquo;{order.config?.text}&rdquo;
                            </span>
                            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-mono">
                              {order.size?.label ?? order.config?.sizeId}
                            </span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${order.status === "printed" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                              {order.status === "printed" ? "✓ Printet" : "⏳ Afventer"}
                            </span>
                          </div>

                          {/* Details row */}
                          <div className="flex items-center gap-4 text-sm text-gray-500 flex-wrap">
                            <span>📅 {dateStr} kl. {timeStr}</span>
                            <span className="font-mono text-xs text-gray-400">{order.id}</span>
                            <span className="font-semibold text-gray-700">{((order.pricePaid ?? 0) / 100).toFixed(0)} kr</span>
                          </div>

                          {/* Font & shape */}
                          <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                            <span>Font: {order.config?.font?.replace(/-/g, " ")}</span>
                            <span>Form: {order.config?.shapeType}</span>
                          </div>

                          {/* Color swatches */}
                          <div className="flex items-center gap-3 mt-2">
                            <div className="flex items-center gap-1.5">
                              <div className="w-4 h-4 rounded-full border border-gray-200 flex-shrink-0"
                                style={{ backgroundColor: order.baseColorHex }} />
                              <span className="text-xs text-gray-500">{order.baseFilamentName} (basis)</span>
                            </div>
                            {twoColors && (
                              <>
                                <span className="text-gray-300">+</span>
                                <div className="flex items-center gap-1.5">
                                  <div className="w-4 h-4 rounded-full border border-gray-200 flex-shrink-0"
                                    style={{ backgroundColor: order.textColorHex }} />
                                  <span className="text-xs text-gray-500">{order.textFilamentName} (tekst)</span>
                                </div>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex flex-col gap-2 flex-shrink-0">
                          {order.stlGenerated ? (
                            <a
                              href={`/api/orders/${order.id}/stl`}
                              download
                              onClick={(e) => {
                                // Add auth header via fetch + blob download
                                e.preventDefault();
                                authedFetch(`/api/orders/${order.id}/stl`)
                                  .then((r) => r.blob())
                                  .then((blob) => {
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement("a");
                                    a.href = url;
                                    a.download = `noglering_${order.config?.text ?? "unknown"}_${order.id}.zip`;
                                    a.click();
                                    URL.revokeObjectURL(url);
                                  });
                              }}
                              className="bg-blue-600 text-white text-xs px-3 py-2 rounded-xl font-semibold hover:bg-blue-700 transition-colors text-center"
                            >
                              ⬇️ Download STL
                            </a>
                          ) : (
                            <span className="text-xs text-gray-400 italic text-center">STL ikke klar</span>
                          )}
                          <button
                            type="button"
                            onClick={async () => {
                              const newStatus = order.status === "pending" ? "printed" : "pending";
                              await authedFetch("/api/orders", {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ orderId: order.id, status: newStatus }),
                              });
                              setOrders((prev) => prev.map((o) =>
                                o.id === order.id ? { ...o, status: newStatus } : o
                              ));
                            }}
                            className={`text-xs px-3 py-2 rounded-xl font-semibold transition-colors text-center ${order.status === "printed" ? "bg-gray-100 text-gray-600 hover:bg-amber-50 hover:text-amber-600" : "bg-green-100 text-green-700 hover:bg-green-200"}`}
                          >
                            {order.status === "printed" ? "Markér som afventer" : "✓ Markér printet"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Keyring price settings */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h2 className="font-semibold text-gray-800 mb-4">💰 Nøglering priser</h2>
            <p className="text-sm text-gray-500 mb-4">Indstil priser for nøgleringe. Gem via knappen herunder.</p>
            <div className="flex flex-col gap-3 mb-4">
              {(settings.keyring?.sizes ?? DEFAULT_KEYRING_SETTINGS.sizes).map((size, i) => (
                <div key={size.id} className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3">
                  <span className="font-medium text-gray-700 w-20">{size.label}</span>
                  <span className="text-xs text-gray-400">{size.widthMm}×{size.heightMm}mm</span>
                  <div className="flex items-center gap-2 ml-auto">
                    <label className="text-xs text-gray-500">Pris (kr):</label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={(size.basePrice / 100).toFixed(0)}
                      onChange={(e) => {
                        const newPrice = Math.round(parseFloat(e.target.value) * 100) || 0;
                        setSettings((s) => ({
                          ...s,
                          keyring: {
                            ...(s.keyring ?? DEFAULT_KEYRING_SETTINGS),
                            sizes: (s.keyring?.sizes ?? DEFAULT_KEYRING_SETTINGS.sizes).map((sz, idx) =>
                              idx === i ? { ...sz, basePrice: newPrice } : sz
                            ),
                          },
                        }));
                      }}
                      className="w-20 border border-gray-200 rounded-xl px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 text-right"
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3 mb-4">
              <span className="font-medium text-gray-700">2-farve tillæg</span>
              <div className="flex items-center gap-2 ml-auto">
                <label className="text-xs text-gray-500">Tillæg (kr):</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={((settings.keyring?.twoColorSurcharge ?? DEFAULT_KEYRING_SETTINGS.twoColorSurcharge) / 100).toFixed(0)}
                  onChange={(e) => {
                    const val = Math.round(parseFloat(e.target.value) * 100) || 0;
                    setSettings((s) => ({
                      ...s,
                      keyring: { ...(s.keyring ?? DEFAULT_KEYRING_SETTINGS), twoColorSurcharge: val },
                    }));
                  }}
                  className="w-20 border border-gray-200 rounded-xl px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 text-right"
                />
              </div>
            </div>
            <button
              type="button"
              disabled={settingsSaving}
              onClick={async () => {
                setSettingsSaving(true);
                await authedFetch("/api/settings", {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(settings),
                });
                setSettingsSaving(false);
                setSettingsMsg("✓ Priser gemt!");
                setTimeout(() => setSettingsMsg(""), 3000);
              }}
              className="bg-purple-600 text-white px-6 py-2.5 rounded-xl font-semibold hover:bg-purple-700 transition-colors disabled:opacity-60"
            >
              {settingsSaving ? "Gemmer..." : "Gem nøglering-priser"}
            </button>
            {settingsMsg && <span className="ml-3 text-green-600 font-medium text-sm">{settingsMsg}</span>}
          </div>
        </div>
      )}

      {/* ── SETTINGS TAB ── */}
      {tab === "indstillinger" && (
        <form onSubmit={handleSettingsSave} className="flex flex-col gap-6">

          {/* Live preview bar */}
          <div className="rounded-2xl p-4 flex items-center gap-3 shadow-sm" style={{ backgroundColor: settings.primaryColor }}>
            <span className="text-2xl">{settings.logoEmoji}</span>
            <span className="text-white font-bold text-lg">{settings.siteName}</span>
            <span className="ml-auto text-white opacity-70 text-sm">Forhåndsvisning</span>
          </div>

          {/* Farvetema */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h2 className="font-semibold text-gray-800 mb-4">🎨 Farvetema</h2>
            <div className="flex gap-3 flex-wrap mb-5">
              {COLOR_THEMES.map((theme) => (
                <button type="button" key={theme.name} onClick={() => applyTheme(theme)}
                  className="flex flex-col items-center gap-1 group">
                  <div className="w-10 h-10 rounded-full border-4 border-white shadow-md transition-transform group-hover:scale-110"
                    style={{ backgroundColor: theme.primary,
                      outline: settings.primaryColor === theme.primary ? `3px solid ${theme.primary}` : "none",
                      outlineOffset: "2px" }} />
                  <span className="text-xs text-gray-500">{theme.name}</span>
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-600 font-medium">Primær farve</label>
                <div className="flex gap-2 items-center">
                  <input type="color" value={settings.primaryColor} onChange={(e) => setSettings((s) => ({ ...s, primaryColor: e.target.value }))}
                    className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer p-0.5" />
                  <input type="text" value={settings.primaryColor} onChange={(e) => setSettings((s) => ({ ...s, primaryColor: e.target.value }))}
                    className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-400" />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-600 font-medium">Accent farve</label>
                <div className="flex gap-2 items-center">
                  <input type="color" value={settings.accentColor} onChange={(e) => setSettings((s) => ({ ...s, accentColor: e.target.value }))}
                    className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer p-0.5" />
                  <input type="text" value={settings.accentColor} onChange={(e) => setSettings((s) => ({ ...s, accentColor: e.target.value }))}
                    className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-400" />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-600 font-medium">Baggrundsfarve</label>
                <div className="flex gap-2 items-center">
                  <input type="color" value={settings.bgColor} onChange={(e) => setSettings((s) => ({ ...s, bgColor: e.target.value }))}
                    className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer p-0.5" />
                  <input type="text" value={settings.bgColor} onChange={(e) => setSettings((s) => ({ ...s, bgColor: e.target.value }))}
                    className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-400" />
                </div>
              </div>
            </div>
          </div>

          {/* Logo & navn */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h2 className="font-semibold text-gray-800 mb-4">🏷️ Logo & navn</h2>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-600 font-medium">Butiksnavn</label>
                <input value={settings.siteName} onChange={(e) => setSettings((s) => ({ ...s, siteName: e.target.value }))}
                  className="border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-400" />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm text-gray-600 font-medium">Logo billede <span className="text-gray-400 font-normal">(erstatter emoji hvis sat)</span></label>
                <div className="flex items-center gap-4">
                  <label className={`flex flex-col items-center justify-center w-24 h-24 rounded-2xl border-2 border-dashed cursor-pointer transition-colors ${logoUploading ? "border-purple-300 bg-purple-50" : "border-gray-200 hover:border-purple-400 hover:bg-purple-50"}`}>
                    {logoUploading ? (
                      <span className="text-purple-500 text-xs font-medium">Uploader...</span>
                    ) : settings.logoImage ? (
                      <div className="relative w-full h-full rounded-2xl overflow-hidden">
                        <Image src={settings.logoImage} alt="Logo" fill className="object-cover" unoptimized />
                      </div>
                    ) : (
                      <><span className="text-3xl mb-1">🖼️</span><span className="text-xs text-gray-400 text-center px-1">Upload logo</span></>
                    )}
                    <input ref={logoFileRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                  </label>
                  {settings.logoImage && (
                    <button type="button" onClick={() => { setSettings((s) => ({ ...s, logoImage: "" })); if (logoFileRef.current) logoFileRef.current.value = ""; }}
                      className="text-sm text-red-400 hover:text-red-600">Fjern billede</button>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-600 font-medium">Logo emoji <span className="text-gray-400 font-normal">(bruges hvis intet billede)</span></label>
                <div className="flex gap-2 flex-wrap">
                  {LOGO_EMOJIS.map((e) => (
                    <button type="button" key={e} onClick={() => setSettings((s) => ({ ...s, logoEmoji: e }))}
                      className={`text-2xl p-1 rounded-lg transition-all ${settings.logoEmoji === e ? "bg-purple-100 ring-2 ring-purple-400" : "hover:bg-gray-100"}`}>
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Tekster */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h2 className="font-semibold text-gray-800 mb-4">✍️ Tekster</h2>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-600 font-medium">Titel på forsiden</label>
                <input value={settings.heroTitle} onChange={(e) => setSettings((s) => ({ ...s, heroTitle: e.target.value }))}
                  className="border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-400" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-600 font-medium">Undertitel / tagline</label>
                <textarea value={settings.tagline} onChange={(e) => setSettings((s) => ({ ...s, tagline: e.target.value }))}
                  className="border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-400 resize-none" rows={2} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-600 font-medium">Footer-tekst</label>
                <input value={settings.footerText} onChange={(e) => setSettings((s) => ({ ...s, footerText: e.target.value }))}
                  className="border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-400" />
              </div>
            </div>
          </div>

          {/* Om mig */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h2 className="font-semibold text-gray-800 mb-4">👋 Om mig-siden</h2>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-600 font-medium">Dit navn</label>
                <input value={settings.aboutName} onChange={(e) => setSettings((s) => ({ ...s, aboutName: e.target.value }))}
                  className="border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-400" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-600 font-medium">Introduktion</label>
                <textarea value={settings.aboutIntro} onChange={(e) => setSettings((s) => ({ ...s, aboutIntro: e.target.value }))}
                  className="border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-400 resize-none" rows={3} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-600 font-medium">Ekstra tekst (valgfri)</label>
                <textarea value={settings.aboutExtra} onChange={(e) => setSettings((s) => ({ ...s, aboutExtra: e.target.value }))}
                  className="border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-400 resize-none" rows={2} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-600 font-medium">Email</label>
                <input type="email" value={settings.aboutEmail} onChange={(e) => setSettings((s) => ({ ...s, aboutEmail: e.target.value }))}
                  className="border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-400" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-600 font-medium">Levering & retur (én linje per punkt)</label>
                <textarea value={settings.deliveryText} onChange={(e) => setSettings((s) => ({ ...s, deliveryText: e.target.value }))}
                  className="border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-400 resize-none font-mono text-sm" rows={4} />
              </div>
            </div>
          </div>

          {/* Categories */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h2 className="font-semibold text-gray-800 mb-4">🗂️ Kategorier</h2>

            {/* Existing categories */}
            <div className="flex flex-col gap-2 mb-4">
              {settings.categories.map((cat) => (
                <div key={cat.id} className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-2.5">
                  <span className="text-xl">{cat.emoji}</span>
                  <span className="font-medium text-gray-700 flex-1">{cat.label}</span>
                  <span className="text-xs text-gray-400 font-mono">{cat.id}</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (products.some((p) => p.category === cat.id)) {
                        alert(`Kan ikke slette "${cat.label}" — der er produkter i denne kategori.`);
                        return;
                      }
                      setSettings((s) => ({ ...s, categories: s.categories.filter((c) => c.id !== cat.id) }));
                    }}
                    className="text-red-400 hover:text-red-600 transition-colors text-lg ml-2"
                    aria-label="Slet kategori"
                  >✕</button>
                </div>
              ))}
            </div>

            {/* Add new category */}
            <div className="border-t pt-4">
              <p className="text-sm text-gray-600 font-medium mb-3">Tilføj ny kategori</p>
              <div className="flex gap-3 flex-wrap items-end">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-500">Navn</label>
                  <input
                    value={newCat.label}
                    onChange={(e) => setNewCat((c) => ({ ...c, label: e.target.value }))}
                    placeholder="fx Nøgleringe"
                    className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 w-40"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-500">Emoji</label>
                  <div className="flex gap-1 flex-wrap max-w-xs">
                    {CAT_EMOJIS.map((e) => (
                      <button type="button" key={e} onClick={() => setNewCat((c) => ({ ...c, emoji: e }))}
                        className={`text-xl p-0.5 rounded-lg transition-all ${newCat.emoji === e ? "bg-purple-100 ring-2 ring-purple-400" : "hover:bg-gray-100"}`}>
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (!newCat.label.trim()) return;
                    const id = newCat.label.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
                    if (settings.categories.some((c) => c.id === id)) {
                      alert("En kategori med det navn findes allerede.");
                      return;
                    }
                    setSettings((s) => ({ ...s, categories: [...s.categories, { id, label: newCat.label.trim(), emoji: newCat.emoji }] }));
                    setNewCat({ label: "", emoji: "🎁" });
                  }}
                  className="bg-purple-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-purple-700 transition-colors self-end"
                >
                  + Tilføj
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-2">Kategorier gemmes når du klikker "Gem indstillinger"</p>
            </div>
          </div>

          {/* Fragt */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h2 className="font-semibold text-gray-800 mb-4">🚚 Fragtmuligheder</h2>

            <div className="flex flex-col gap-2 mb-4">
              {(settings.shippingOptions ?? []).map((opt) => (
                <div key={opt.id} className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3">
                  <div className="flex-1">
                    <p className="font-medium text-gray-800">{opt.name}</p>
                    <p className="text-xs text-gray-400">{opt.minDays}–{opt.maxDays} hverdage</p>
                  </div>
                  <span className="font-bold text-gray-700">{opt.price === 0 ? "Gratis" : formatPrice(opt.price)}</span>
                  <button type="button"
                    onClick={() => setSettings((s) => ({ ...s, shippingOptions: (s.shippingOptions ?? []).filter((o) => o.id !== opt.id) }))}
                    className="text-red-400 hover:text-red-600 transition-colors text-lg ml-2" aria-label="Slet">✕</button>
                </div>
              ))}
              {(settings.shippingOptions ?? []).length === 0 && (
                <p className="text-sm text-gray-400 italic">Ingen fragtmuligheder endnu.</p>
              )}
            </div>

            <div className="border-t pt-4">
              <p className="text-sm text-gray-600 font-medium mb-3">Tilføj fragtmulighed</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="col-span-2 sm:col-span-2 flex flex-col gap-1">
                  <label className="text-xs text-gray-500">Navn</label>
                  <input value={newShipping.name} onChange={(e) => setNewShipping((s) => ({ ...s, name: e.target.value }))}
                    placeholder="fx GLS Pakke" className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-500">Pris (kr)</label>
                  <input type="number" min="0" step="1" value={newShipping.price} onChange={(e) => setNewShipping((s) => ({ ...s, price: e.target.value }))}
                    placeholder="fx 49" className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-500">Dage (min–max)</label>
                  <div className="flex gap-1 items-center">
                    <input type="number" min="1" value={newShipping.minDays} onChange={(e) => setNewShipping((s) => ({ ...s, minDays: e.target.value }))}
                      className="w-14 border border-gray-200 rounded-xl px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 text-center" />
                    <span className="text-gray-400 text-sm">–</span>
                    <input type="number" min="1" value={newShipping.maxDays} onChange={(e) => setNewShipping((s) => ({ ...s, maxDays: e.target.value }))}
                      className="w-14 border border-gray-200 rounded-xl px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 text-center" />
                  </div>
                </div>
              </div>
              <button type="button" className="mt-3 bg-purple-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-purple-700 transition-colors"
                onClick={() => {
                  if (!newShipping.name.trim() || newShipping.price === "") return;
                  const id = newShipping.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") + "-" + Date.now();
                  const opt: ShippingOption = {
                    id,
                    name: newShipping.name.trim(),
                    price: Math.round(parseFloat(newShipping.price) * 100),
                    minDays: parseInt(newShipping.minDays) || 1,
                    maxDays: parseInt(newShipping.maxDays) || 7,
                  };
                  setSettings((s) => ({ ...s, shippingOptions: [...(s.shippingOptions ?? []), opt] }));
                  setNewShipping(EMPTY_SHIPPING);
                }}>
                + Tilføj
              </button>
              <p className="text-xs text-gray-400 mt-2">Fragtmuligheder gemmes når du klikker "Gem indstillinger"</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button type="submit" disabled={settingsSaving}
              className="bg-purple-600 text-white px-8 py-3 rounded-xl font-semibold hover:bg-purple-700 transition-colors disabled:opacity-60">
              {settingsSaving ? "Gemmer..." : "Gem indstillinger"}
            </button>
            {settingsMsg && <span className="text-green-600 font-medium text-sm">{settingsMsg}</span>}
          </div>
        </form>
      )}
    </div>
  );
}
