"use client";

import { useEffect, useRef, useState } from "react";
import { Product, formatPrice } from "@/lib/products";
import { SiteSettings, DEFAULT_SETTINGS, COLOR_THEMES } from "@/lib/settings";
import Image from "next/image";

const EMOJIS = ["🦕", "🐉", "🦊", "🐼", "🐸", "🎲", "⭕", "🌀", "🎯", "🌸", "🔑", "🖨️", "⭐", "🎁", "🧩"];
const LOGO_EMOJIS = ["🖨️", "⭐", "🌟", "🎨", "🛍️", "✨", "🎁", "🎀", "🌈", "🦋", "🌸", "💎", "🔮", "🎪", "🏷️"];
const CAT_EMOJIS = ["🦕", "🎲", "🔧", "🌸", "🐉", "🎯", "⭐", "🎁", "🧩", "🔑", "🌀", "🦊", "🐼", "🎀", "💎"];
const EMPTY_FORM = { name: "", description: "", price: "", emoji: "🖨️", category: "", image: "" };
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
  const [tab, setTab] = useState<"produkter" | "indstillinger">("produkter");

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

  function startEdit(product: Product) {
    setEditingId(product.id);
    setForm({ name: product.name, description: product.description, price: (product.price / 100).toString(), emoji: product.emoji, category: product.category, image: product.image });
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
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1 w-fit">
        {(["produkter", "indstillinger"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2 rounded-lg font-medium text-sm transition-all capitalize ${tab === t ? "bg-white shadow text-gray-800" : "text-gray-500 hover:text-gray-700"}`}>
            {t === "produkter" ? "📦 Produkter" : "🎨 Udseende"}
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
                <button onClick={() => startEdit(p)} className="text-blue-400 hover:text-blue-600 text-sm font-medium">Rediger</button>
                <button onClick={() => handleDelete(p.id, p.name)} className="text-red-400 hover:text-red-600 text-lg" aria-label="Slet">✕</button>
              </div>
            ))}
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-600 font-medium">Butiksnavn</label>
                <input value={settings.siteName} onChange={(e) => setSettings((s) => ({ ...s, siteName: e.target.value }))}
                  className="border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-400" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-600 font-medium">Logo emoji</label>
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
