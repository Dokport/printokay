"use client";

import { useEffect, useRef, useState } from "react";
import { Product, formatPrice, formatPrintTime, MATERIALS } from "@/lib/products";
import { SiteSettings, ShippingOption, FilamentSpool, DEFAULT_SETTINGS, COLOR_THEMES } from "@/lib/settings";
import { DEFAULT_KEYRING_SETTINGS, KEYRING_FONTS, KEYRING_SHAPES, KEYRING_HOLE_POSITIONS } from "@/lib/keyring";
import type { Order } from "@/lib/orders";
import type { ColorZone } from "@/lib/products";
import { parseThreeMf, parseThreeMfMeta, parseSlicedStats } from "@/lib/threemf";
import { upload } from "@vercel/blob/client";
import ZoneMapper from "@/components/ZoneMapper";
import Image from "next/image";

const EMOJIS = ["🦕", "🐉", "🦊", "🐼", "🐸", "🎲", "⭕", "🌀", "🎯", "🌸", "🔑", "🖨️", "⭐", "🎁", "🧩"];
const LOGO_EMOJIS = ["🖨️", "⭐", "🌟", "🎨", "🛍️", "✨", "🎁", "🎀", "🌈", "🦋", "🌸", "💎", "🔮", "🎪", "🏷️"];
const CAT_EMOJIS = ["🦕", "🎲", "🔧", "🌸", "🐉", "🎯", "⭐", "🎁", "🧩", "🔑", "🌀", "🦊", "🐼", "🎀", "💎"];
const EMPTY_FORM = { name: "", description: "", price: "", emoji: "🖨️", category: "", image: "", images: [] as string[], material: "", modelUrl: "", colorSlots: [] as { id: string; label: string }[], printHours: "", printMins: "", filamentGrams: "", materialCost: "", modelFile: "", printFile: "", colorZones: [] as ColorZone[], previewModel: "" };
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
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [showPrinted, setShowPrinted] = useState(false);

  async function downloadStl(stlId: string, text: string) {
    const r = await authedFetch(`/api/orders/${stlId}/stl`);
    if (!r.ok) return;
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safe = (text || "noglering").replace(/[^a-zA-Z0-9æøåÆØÅ]/g, "_").slice(0, 20);
    a.download = `noglering_${safe}_${stlId}.stl`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Products state
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [productMsg, setProductMsg] = useState("");
  const [uploading, setUploading] = useState(false);
  const [modelUploading, setModelUploading] = useState(false);
  const [previewUploading, setPreviewUploading] = useState(false);
  const [productMode, setProductMode] = useState<"auto" | "manual">("auto");
  const [parsingModel, setParsingModel] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const modelFileRef = useRef<HTMLInputElement>(null);
  const projectFileRef = useRef<HTMLInputElement>(null);
  const previewFileRef = useRef<HTMLInputElement>(null);

  // Settings state
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SETTINGS);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState("");

  // New category form
  const [newCat, setNewCat] = useState({ label: "", emoji: "🎁" });

  // Logo upload
  const logoFileRef = useRef<HTMLInputElement>(null);
  const [logoUploading, setLogoUploading] = useState(false);

  // About image upload
  const aboutImageRef = useRef<HTMLInputElement>(null);
  const [aboutImageUploading, setAboutImageUploading] = useState(false);

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
    if (data.url) {
      setForm((f) => {
        const imgs = [...(f.images ?? []), data.url];
        return { ...f, images: imgs, image: imgs[0] };
      });
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  function removeImage(url: string) {
    setForm((f) => {
      const imgs = (f.images ?? []).filter((u) => u !== url);
      return { ...f, images: imgs, image: imgs[0] ?? "" };
    });
  }

  // Store a (possibly large) model file. Big .3mf exceed the ~4.5 MB serverless
  // body limit, so on Blob we upload straight from the browser; locally (no Blob)
  // we fall back to the function endpoint. Returns the stored pathname.
  async function uploadModelToStorage(file: File): Promise<string> {
    const ext = file.name.split(".").pop()?.toLowerCase() || "3mf";
    const pathname = `models/${Date.now()}.${ext}`;
    try {
      const blob = await upload(pathname, file, {
        access: "private",
        handleUploadUrl: "/api/blob-upload",
        clientPayload: getStoredPw() ?? "",
      });
      return blob.pathname;
    } catch {
      // Local dev / no Blob token → function upload (no size limit locally).
      const fd = new FormData();
      fd.append("file", file);
      const res = await authedFetch("/api/upload-model", { method: "POST", body: fd });
      const d = await res.json();
      if (!d.path) throw new Error(d.error ?? "Upload fejlede");
      return d.path;
    }
  }

  // Upload an extracted thumbnail (small) as the product image. Returns its URL.
  async function uploadThumbnail(bytes: Uint8Array): Promise<string> {
    const tf = new File([bytes as BlobPart], "thumb.png", { type: "image/png" });
    const fd = new FormData();
    fd.append("file", tf);
    const res = await authedFetch("/api/upload", { method: "POST", body: fd });
    const d = await res.json();
    return d.url ?? "";
  }

  // Material cost (øre) from the sliced file's per-filament usage × cost/kg,
  // matching each filament to the nearest in-stock spool by colour.
  function computeMaterialCost(filaments: { type: string; color: string; usedGrams: number }[]): number | undefined {
    const spools = settings.filaments ?? [];
    if (!spools.length) return undefined;
    const toRgb = (h: string): [number, number, number] => {
      const s = h.replace("#", "");
      return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
    };
    let totalOre = 0, anyCost = false;
    for (const f of filaments) {
      const t = toRgb(f.color);
      let best: FilamentSpool | null = null, bd = Infinity;
      for (const s of spools) {
        if (f.type && s.material && s.material !== f.type) continue;
        const c = toRgb(s.colorHex);
        const d = (c[0] - t[0]) ** 2 + (c[1] - t[1]) ** 2 + (c[2] - t[2]) ** 2;
        if (d < bd) { bd = d; best = s; }
      }
      if (best?.costPerKg) { totalOre += (f.usedGrams / 1000) * best.costPerKg; anyCost = true; }
    }
    return anyCost ? Math.round(totalOre) : undefined;
  }

  // Auto mode: drop BOTH the project (.3mf, mesh → 3D) and the sliced
  // (.gcode.3mf → print + stats) file. We classify each by content, upload both,
  // and pre-fill everything (incl. instant print stats) — all in the browser.
  async function handleProjectUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setParsingModel(true);
    setProductMsg("");
    try {
      let projectBytes: Uint8Array | null = null, projectFile: File | null = null;
      let slicedBytes: Uint8Array | null = null, slicedFile: File | null = null;

      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (parseThreeMf(bytes).zones.length > 0) { projectBytes = bytes; projectFile = file; }
        else if (parseSlicedStats(bytes)) { slicedBytes = bytes; slicedFile = file; }
      }

      if (!projectFile && !slicedFile) throw new Error("Genkendte hverken projekt- eller sliced-fil");

      const next: Partial<typeof EMPTY_FORM> = {};

      // Project file → 3D mesh + metadata.
      if (projectFile && projectBytes) {
        const { zones } = parseThreeMf(projectBytes);
        const meta = parseThreeMfMeta(projectBytes);
        next.colorSlots = zones.map((_, i) => ({ id: `slot-${i + 1}`, label: `Farve ${i + 1}` }));
        next.colorZones = zones.map((z, i) => ({ key: z.key, slotId: `slot-${i + 1}`, color: z.color }));
        next.modelFile = await uploadModelToStorage(projectFile);
        if (meta.title) next.name = meta.title;
        if (meta.description) next.description = meta.description;
        if (meta.material) next.material = meta.material;
        if (meta.thumbnail?.length) {
          try { const img = await uploadThumbnail(meta.thumbnail); next.image = img; next.images = [img]; } catch { /* optional */ }
        }
      }

      // Sliced file → printable in Bambuddy + instant stats.
      let statsMsg = "";
      if (slicedFile && slicedBytes) {
        const stats = parseSlicedStats(slicedBytes)!;
        next.printFile = await uploadModelToStorage(slicedFile);
        if (stats.printMinutes != null) { next.printHours = String(Math.floor(stats.printMinutes / 60)); next.printMins = String(stats.printMinutes % 60); }
        if (stats.filamentGrams != null) next.filamentGrams = String(stats.filamentGrams);
        const cost = computeMaterialCost(stats.filaments);
        if (cost != null) next.materialCost = (cost / 100).toFixed(2);
        statsMsg = ` · ${stats.printMinutes} min · ${stats.filamentGrams} g${cost != null ? ` · ${(cost / 100).toFixed(2)} kr` : ""}`;
      }

      setForm((f) => ({ ...f, ...next }));
      const have = [projectFile && "projekt", slicedFile && "sliced"].filter(Boolean).join(" + ");
      setProductMsg(`✓ Indlæst: ${have}${statsMsg}`);
      setTimeout(() => setProductMsg(""), 8000);
    } catch (err) {
      setProductMsg("Kunne ikke læse filerne: " + (err instanceof Error ? err.message : "ukendt fejl"));
      setTimeout(() => setProductMsg(""), 6000);
    }
    setParsingModel(false);
    if (projectFileRef.current) projectFileRef.current.value = "";
  }

  // Manual mode: just upload the model file (no auto-fill).
  async function handleModelUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setModelUploading(true);
    try {
      const modelFile = await uploadModelToStorage(file);
      setForm((f) => ({ ...f, modelFile }));
    } catch (err) {
      setProductMsg("Model-upload fejlede: " + (err instanceof Error ? err.message : ""));
      setTimeout(() => setProductMsg(""), 4000);
    }
    setModelUploading(false);
    if (modelFileRef.current) modelFileRef.current.value = "";
  }

  // Optional posed/light preview model for the shop's 3D view (same colour zones).
  async function handlePreviewUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreviewUploading(true);
    try {
      const previewModel = await uploadModelToStorage(file);
      setForm((f) => ({ ...f, previewModel }));
    } catch (err) {
      setProductMsg("Preview-upload fejlede: " + (err instanceof Error ? err.message : ""));
      setTimeout(() => setProductMsg(""), 4000);
    }
    setPreviewUploading(false);
    if (previewFileRef.current) previewFileRef.current.value = "";
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

  async function handleAboutImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAboutImageUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    const res = await authedFetch("/api/upload", { method: "POST", body: fd });
    const data = await res.json();
    if (data.url) setSettings((s) => ({ ...s, aboutImage: data.url }));
    setAboutImageUploading(false);
    if (aboutImageRef.current) aboutImageRef.current.value = "";
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
    const imgs = product.images && product.images.length > 0
      ? product.images
      : product.image ? [product.image] : [];
    const pm = product.printMinutes ?? 0;
    setForm({ name: product.name, description: product.description, price: (product.price / 100).toString(), emoji: product.emoji, category: product.category, image: imgs[0] ?? "", images: imgs, material: product.material ?? "", modelUrl: product.modelUrl ?? "", colorSlots: product.colorSlots ?? [], printHours: pm ? String(Math.floor(pm / 60)) : "", printMins: pm ? String(pm % 60) : "", filamentGrams: product.filamentGrams ? String(product.filamentGrams) : "", materialCost: product.materialCost ? (product.materialCost / 100).toFixed(2) : "", modelFile: product.modelFile ?? "", printFile: product.printFile ?? "", colorZones: product.colorZones ?? [], previewModel: product.previewModel ?? "" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() { setEditingId(null); setForm(EMPTY_FORM); }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setProductMsg("");
    const url = editingId ? `/api/products/${editingId}` : "/api/products";
    const printMinutes = (Number(form.printHours) * 60 + Number(form.printMins)) || undefined;
    const payload = { ...form, printMinutes };
    const res = await authedFetch(url, { method: editingId ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
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

  // Optional posed/light preview-model upload (reused in Auto + Manual forms).
  const previewField = (
    <div className="flex flex-col gap-1">
      <label className="text-sm text-gray-600 font-medium">
        🎞️ 3D preview-fil <span className="text-gray-400 font-normal">(valgfri — poseret/let .3mf fra samme projekt, kun til visningen)</span>
      </label>
      <div className="flex items-center gap-3 flex-wrap">
        <label className={`flex items-center gap-2 px-4 py-2 rounded-xl border cursor-pointer text-sm font-medium transition-colors ${previewUploading ? "border-purple-300 bg-purple-50 text-purple-400" : "border-gray-200 hover:border-purple-400 hover:bg-purple-50 text-gray-600"}`}>
          {previewUploading ? "Uploader…" : form.previewModel ? "Skift preview-fil" : "Upload preview-fil"}
          <input ref={previewFileRef} type="file" accept=".3mf,.stl" className="hidden" onChange={handlePreviewUpload} disabled={previewUploading} />
        </label>
        {form.previewModel && (
          <>
            <span className="text-xs text-green-600">✓ poseret preview aktiv</span>
            <button type="button" onClick={() => setForm((f) => ({ ...f, previewModel: "" }))} className="text-xs text-red-400 hover:text-red-600">Fjern</button>
          </>
        )}
      </div>
    </div>
  );

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
            <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
              <h2 className="text-lg font-semibold text-gray-800">{editingId ? "✏️ Rediger produkt" : "➕ Tilføj nyt produkt"}</h2>
              {!editingId && (
                <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                  {(["auto", "manual"] as const).map((m) => (
                    <button key={m} type="button" onClick={() => setProductMode(m)}
                      className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${productMode === m ? "bg-white shadow text-gray-800" : "text-gray-500 hover:text-gray-700"}`}>
                      {m === "auto" ? "⚡ Auto" : "✏️ Manuel"}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ── AUTO MODE: upload a Bambu project, shop fills the rest ── */}
            {productMode === "auto" && !editingId ? (
              !form.modelFile && !form.printFile ? (
                <label className={`flex flex-col items-center justify-center gap-2 py-12 rounded-2xl border-2 border-dashed cursor-pointer transition-colors ${parsingModel ? "border-purple-300 bg-purple-50" : "border-gray-300 hover:border-purple-400 hover:bg-purple-50"}`}>
                  <span className="text-4xl">{parsingModel ? "⏳" : "📦"}</span>
                  <span className="font-medium text-gray-700">{parsingModel ? "Læser filer…" : "Upload projekt + sliced fil"}</span>
                  <span className="text-xs text-gray-400 text-center px-4">Vælg <b>begge</b> filer: projekt-.3mf (3D) og plate-sliced .gcode.3mf (print + stats). Navn, billede, zoner og stats udfyldes automatisk.</span>
                  <input ref={projectFileRef} type="file" accept=".3mf,.gcode,.gcode.3mf,.stl" multiple className="hidden" onChange={handleProjectUpload} disabled={parsingModel} />
                </label>
              ) : (
                <form onSubmit={handleSave} className="flex flex-col gap-4">
                  <div className="flex gap-4 items-start flex-wrap">
                    {form.image && (
                      <div className="relative w-28 h-28 rounded-2xl overflow-hidden border border-gray-200 flex-shrink-0">
                        <Image src={form.image} alt="" fill className="object-cover" unoptimized />
                      </div>
                    )}
                    <div className="flex-1 min-w-[200px] flex flex-col gap-1">
                      <div className="flex flex-wrap gap-2 text-xs font-medium">
                        <span className={form.modelFile ? "text-green-600" : "text-amber-600"}>{form.modelFile ? "✓ Projekt (3D)" : "⚠ Mangler projekt-fil (3D)"}</span>
                        <span className={form.printFile ? "text-green-600" : "text-amber-600"}>{form.printFile ? "✓ Sliced (print + stats)" : "⚠ Mangler sliced-fil (print/stats)"}</span>
                      </div>
                      {(Number(form.printHours) > 0 || Number(form.printMins) > 0 || form.filamentGrams) && (
                        <span className="text-xs text-gray-500">🕐 {form.printHours||0}t {form.printMins||0}m · 🧵 {form.filamentGrams||"?"} g{form.materialCost ? ` · 💰 ${form.materialCost} kr` : ""}</span>
                      )}
                      <span className="text-xs text-gray-400">Udfyld pris og kategori og gem.</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {(form.colorZones ?? []).map((z, i) => (
                          <span key={i} className="inline-flex items-center gap-1 text-xs bg-gray-50 border border-gray-200 rounded-full px-2 py-0.5">
                            <span className="w-3 h-3 rounded-full border border-gray-200" style={{ backgroundColor: z.color || "#ccc" }} />
                            {form.colorSlots.find((s) => s.id === z.slotId)?.label ?? z.slotId}
                          </span>
                        ))}
                      </div>
                      <label className="text-xs text-purple-600 hover:text-purple-800 cursor-pointer w-fit mt-1">
                        + Tilføj manglende fil
                        <input type="file" accept=".3mf,.gcode,.gcode.3mf,.stl" multiple className="hidden" onChange={handleProjectUpload} disabled={parsingModel} />
                      </label>
                      <button type="button" onClick={() => setForm(EMPTY_FORM)} className="text-xs text-gray-400 hover:text-red-500 w-fit">Start forfra</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2 flex flex-col gap-1">
                      <label className="text-sm text-gray-600 font-medium">Navn</label>
                      <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                        className="border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-400" />
                    </div>
                    <div className="sm:col-span-2 flex flex-col gap-1">
                      <label className="text-sm text-gray-600 font-medium">Beskrivelse</label>
                      <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                        className="border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-400 resize-none" rows={3} />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-sm text-gray-600 font-medium">Pris (kr)</label>
                      <input required type="number" min="1" step="0.5" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })}
                        className="border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-400" placeholder="fx 99" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-sm text-gray-600 font-medium">Kategori</label>
                      <select required value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                        className="border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-400">
                        <option value="">— Vælg kategori —</option>
                        {settings.categories.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>)}
                      </select>
                    </div>
                  </div>
                  {previewField}
                  <div className="flex gap-3 items-center">
                    <button type="submit" disabled={saving} className="bg-purple-600 text-white px-6 py-2.5 rounded-xl font-semibold hover:bg-purple-700 transition-colors disabled:opacity-60">
                      {saving ? "Gemmer…" : "Gem produkt"}
                    </button>
                    {productMsg && <span className="text-green-600 font-medium text-sm">{productMsg}</span>}
                  </div>
                </form>
              )
            ) : (
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

              {/* Model file upload + Bambuddy sync status */}
              <div className="sm:col-span-2 flex flex-col gap-2">
                <label className="text-sm text-gray-600 font-medium">
                  📦 Modelfil <span className="text-gray-400 font-normal">(.3mf fra MakerWorld eller .stl — sendes til Bambuddy)</span>
                </label>
                <div className="flex items-center gap-3 flex-wrap">
                  <label className={`flex items-center gap-2 px-4 py-2 rounded-xl border cursor-pointer text-sm font-medium transition-colors ${modelUploading ? "border-purple-300 bg-purple-50 text-purple-400" : "border-gray-200 hover:border-purple-400 hover:bg-purple-50 text-gray-600"}`}>
                    {modelUploading ? "Uploader…" : form.modelFile ? "Skift modelfil" : "Upload modelfil"}
                    <input ref={modelFileRef} type="file" accept=".3mf,.stl" className="hidden" onChange={handleModelUpload} disabled={modelUploading} />
                  </label>
                  {form.modelFile && (
                    <>
                      <span className="text-xs text-gray-500 font-mono truncate max-w-[200px]">{form.modelFile.split("/").pop()}</span>
                      <button type="button" onClick={() => setForm((f) => ({ ...f, modelFile: "" }))}
                        className="text-xs text-red-400 hover:text-red-600">Fjern</button>
                    </>
                  )}
                  {/* Sync status + print history (only when editing an existing product) */}
                  {editingId && (() => {
                    const ep = products.find((p) => p.id === editingId);
                    if (!ep || (!ep.modelFile && !ep.printFile)) return null;
                    const synced = ep.bambuddy?.syncedAt || ep.modelSyncedAt;
                    const st = ep.printStats;
                    return (
                      <>
                        {ep.statsSource === "actual" ? (
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full font-medium">✓ Faktiske stats</span>
                        ) : synced ? (
                          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full font-medium">✓ I Bambuddy</span>
                        ) : (
                          <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full font-medium">⏳ Afventer Bambuddy</span>
                        )}
                        {st && st.count > 0 && (
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full font-medium">
                            🖨️ Printet {st.count}×
                            {st.totalGrams != null ? ` · ${st.totalGrams.toFixed(0)} g` : ""}
                            {st.totalCost != null ? ` · ${(st.totalCost / 100).toFixed(0)} kr` : ""}
                            {st.lastPrintedAt ? ` · sidst ${new Date(st.lastPrintedAt).toLocaleDateString("da-DK")}` : ""}
                          </span>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* Optional posed/light preview model for the shop's 3D view */}
              {form.modelFile && <div className="sm:col-span-2">{previewField}</div>}

              {/* Color zone → slot mapping (only for saved products with an uploaded model) */}
              {editingId && form.modelFile && products.find((p) => p.id === editingId)?.modelFile && (
                <div className="sm:col-span-2 flex flex-col gap-2">
                  <label className="text-sm text-gray-600 font-medium">
                    🎨 Farvezoner <span className="text-gray-400 font-normal">(kobl modellens farver til farveområder kunden vælger)</span>
                  </label>
                  {form.colorSlots.length === 0 ? (
                    <p className="text-xs text-amber-600">Tilføj mindst ét farveområde ovenfor for at mappe modellens zoner.</p>
                  ) : (
                    <ZoneMapper
                      productId={editingId}
                      version={form.modelFile}
                      slots={form.colorSlots}
                      value={form.colorZones}
                      onChange={(zones) => setForm((f) => ({ ...f, colorZones: zones }))}
                    />
                  )}
                </div>
              )}

              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-600 font-medium">
                  🕐 Printtid <span className="text-gray-400 font-normal">(vises i bestillinger)</span>
                  {editingId && products.find((p) => p.id === editingId)?.bambuddyStatsAt && (
                    <span className="ml-2 text-xs text-blue-500 font-normal">auto fra Bambuddy</span>
                  )}
                </label>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    <input
                      type="number" min="0" step="1"
                      value={form.printHours}
                      onChange={(e) => setForm({ ...form, printHours: e.target.value })}
                      placeholder="0"
                      className="w-16 border border-gray-200 rounded-xl px-3 py-2.5 text-center focus:outline-none focus:ring-2 focus:ring-purple-400"
                    />
                    <span className="text-sm text-gray-500">t</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <input
                      type="number" min="0" max="59" step="1"
                      value={form.printMins}
                      onChange={(e) => setForm({ ...form, printMins: e.target.value })}
                      placeholder="0"
                      className="w-16 border border-gray-200 rounded-xl px-3 py-2.5 text-center focus:outline-none focus:ring-2 focus:ring-purple-400"
                    />
                    <span className="text-sm text-gray-500">min</span>
                  </div>
                  {(Number(form.printHours) > 0 || Number(form.printMins) > 0) && (
                    <span className="text-sm text-gray-400">
                      = {formatPrintTime(Number(form.printHours) * 60 + Number(form.printMins))}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-600 font-medium">
                  🧵 Filamentforbrug <span className="text-gray-400 font-normal">(gram)</span>
                  {editingId && products.find((p) => p.id === editingId)?.bambuddyStatsAt && (
                    <span className="ml-2 text-xs text-blue-500 font-normal">auto fra Bambuddy</span>
                  )}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number" min="0" step="0.1"
                    value={form.filamentGrams}
                    onChange={(e) => setForm({ ...form, filamentGrams: e.target.value })}
                    placeholder="fx 12"
                    className="w-32 border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-400"
                  />
                  {form.filamentGrams && Number(form.filamentGrams) > 0 && (
                    <span className="text-sm text-gray-500">{Number(form.filamentGrams).toFixed(1)} g</span>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-600 font-medium">
                  💰 Materialepris <span className="text-gray-400 font-normal">(kr — intern kostpris)</span>
                  {editingId && products.find((p) => p.id === editingId)?.bambuddyStatsAt && (
                    <span className="ml-2 text-xs text-blue-500 font-normal">auto fra Bambuddy</span>
                  )}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number" min="0" step="0.5"
                    value={form.materialCost}
                    onChange={(e) => setForm({ ...form, materialCost: e.target.value })}
                    placeholder="fx 3.50"
                    className="w-32 border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-400"
                  />
                  {form.materialCost && Number(form.materialCost) > 0 && form.price && Number(form.price) > 0 && (
                    <span className="text-sm text-gray-500">
                      → margin {(Number(form.price) - Number(form.materialCost)).toFixed(2)} kr
                    </span>
                  )}
                </div>
              </div>

              <div className="sm:col-span-2 flex flex-col gap-2">
                <label className="text-sm text-gray-600 font-medium">
                  Produktbilleder
                  <span className="text-gray-400 font-normal ml-1">(første billede vises som primært)</span>
                </label>
                <div className="flex flex-wrap items-start gap-3">
                  {(form.images ?? []).map((url, idx) => (
                    <div key={url} className="relative w-28 h-28 rounded-2xl overflow-hidden border border-gray-200 flex-shrink-0 group">
                      <Image src={url} alt={`Billede ${idx + 1}`} fill className="object-cover" unoptimized />
                      {idx === 0 && (
                        <span className="absolute top-1 left-1 bg-purple-600 text-white text-xs px-1.5 py-0.5 rounded-full font-medium">1.</span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeImage(url)}
                        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-500 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >×</button>
                    </div>
                  ))}
                  {/* Add image button */}
                  <label className={`flex flex-col items-center justify-center w-28 h-28 rounded-2xl border-2 border-dashed cursor-pointer transition-colors flex-shrink-0 ${uploading ? "border-purple-300 bg-purple-50" : "border-gray-200 hover:border-purple-400 hover:bg-purple-50"}`}>
                    {uploading ? (
                      <span className="text-purple-500 text-xs font-medium text-center px-2">Uploader...</span>
                    ) : (
                      <><span className="text-3xl mb-1">📷</span><span className="text-xs text-gray-400 text-center px-2">Tilføj billede</span></>
                    )}
                    <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploading} />
                  </label>
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
            )}
          </div>

          <div className="flex flex-col gap-3">
            {products.map((p) => (
              <div key={p.id} className="bg-white rounded-2xl px-5 py-4 shadow-sm flex items-center gap-4">
                <div className="relative w-12 h-12 rounded-xl overflow-hidden bg-purple-50 flex-shrink-0 flex items-center justify-center">
                  {(() => { const thumb = (p.images?.[0]) || p.image; return thumb && thumb !== "/products/placeholder.jpg" ? (
                    <Image src={thumb} alt={p.name} fill className="object-cover" unoptimized />
                  ) : <span className="text-2xl">{p.emoji}</span>; })()}
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


          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-800">📬 Bestillinger</h2>
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
                <p className="text-sm mt-1">Bestillinger dukker op her når kunder køber noget</p>
              </div>
            ) : (() => {
              const byStatus = (status: string) =>
                orders.filter((o) => o.status === status)
                      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
              const pending = byStatus("pending");
              const printed = byStatus("printed");

              const renderOrder = (order: Order) => {
                  const date = new Date(order.createdAt);
                  const dateStr = date.toLocaleDateString("da-DK", { day: "numeric", month: "short", year: "numeric" });
                  const timeStr = date.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" });
                  const items = order.items ?? [];
                  const itemCount = items.reduce((n, it) => n + (it.quantity ?? 1), 0);
                  const c = order.customer;

                  // Total print time, grams and material cost across all items
                  const totalPrintMinutes = items.reduce((sum, it) => {
                    const prod = products.find((p) => p.name === it.name);
                    return sum + (prod?.printMinutes ?? 0) * (it.quantity ?? 1);
                  }, 0);
                  const totalGrams = items.reduce((sum, it) => {
                    const prod = products.find((p) => p.name === it.name);
                    return sum + (prod?.filamentGrams ?? 0) * (it.quantity ?? 1);
                  }, 0);
                  const totalMatCost = items.reduce((sum, it) => {
                    const prod = products.find((p) => p.name === it.name);
                    return sum + (prod?.materialCost ?? 0) * (it.quantity ?? 1);
                  }, 0);

                return (
                    <div key={order.id} className="border border-gray-100 rounded-2xl p-4">
                      <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-gray-800">
                            {itemCount} {itemCount === 1 ? "vare" : "varer"}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${order.status === "printed" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                            {order.status === "printed" ? "✓ Færdig" : "⏳ Afventer"}
                          </span>
                          <span className="text-sm text-gray-500">📅 {dateStr} kl. {timeStr}</span>
                          <span className="font-bold text-gray-800">{((order.total ?? 0) / 100).toFixed(0)} kr</span>
                          {totalPrintMinutes > 0 && (
                            <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium">
                              🕐 {formatPrintTime(totalPrintMinutes)}
                            </span>
                          )}
                          {totalGrams > 0 && (
                            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-medium">
                              🧵 {totalGrams.toFixed(1)} g
                            </span>
                          )}
                          {totalMatCost > 0 && (
                            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-medium">
                              💰 {(totalMatCost / 100).toFixed(2)} kr
                            </span>
                          )}
                        </div>
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
                          className={`text-xs px-3 py-2 rounded-xl font-semibold transition-colors text-center flex-shrink-0 ${order.status === "printed" ? "bg-gray-100 text-gray-600 hover:bg-amber-50 hover:text-amber-600" : "bg-green-100 text-green-700 hover:bg-green-200"}`}
                        >
                          {order.status === "printed" ? "Markér som afventer" : "✓ Markér færdig"}
                        </button>
                      </div>

                      {/* Line items */}
                      <div className="flex flex-col gap-2">
                        {items.map((item, i) => {
                          const k = item.keyring;
                          const twoColors = k && k.baseColorHex !== k.textColorHex;
                          const itemProduct = products.find((p) => p.name === item.name);
                          const itemPrintMin = itemProduct?.printMinutes;
                          const itemGrams = itemProduct?.filamentGrams;
                          const itemMatCost = itemProduct?.materialCost;
                          return (
                            <div key={i} className="bg-gray-50 rounded-xl p-3">
                              <div className="flex items-start justify-between gap-3 flex-wrap">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    {item.emoji && <span>{item.emoji}</span>}
                                    <span className="font-medium text-gray-800">{item.name}</span>
                                    {item.quantity > 1 && (
                                      <span className="text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full">×{item.quantity}</span>
                                    )}
                                    {itemPrintMin && (
                                      <span className="text-xs text-blue-500">
                                        🕐 {formatPrintTime(itemPrintMin * (item.quantity ?? 1))}
                                      </span>
                                    )}
                                    {itemGrams && (
                                      <span className="text-xs text-gray-400">
                                        🧵 {(itemGrams * (item.quantity ?? 1)).toFixed(1)} g
                                      </span>
                                    )}
                                    {itemMatCost && (
                                      <span className="text-xs text-gray-400">
                                        💰 {((itemMatCost / 100) * (item.quantity ?? 1)).toFixed(2)} kr
                                      </span>
                                    )}
                                  </div>
                                  {item.description && (
                                    <p className="text-xs text-gray-400 mt-0.5">{item.description}</p>
                                  )}

                                  {/* Keyring colors */}
                                  {k && (
                                    <div className="flex items-center gap-3 mt-1.5">
                                      <div className="flex items-center gap-1.5">
                                        <div className="w-4 h-4 rounded-full border border-gray-200 flex-shrink-0" style={{ backgroundColor: k.baseColorHex }} />
                                        <span className="text-xs text-gray-500">{k.baseFilamentName} (basis)</span>
                                      </div>
                                      {twoColors && (
                                        <>
                                          <span className="text-gray-300">+</span>
                                          <div className="flex items-center gap-1.5">
                                            <div className="w-4 h-4 rounded-full border border-gray-200 flex-shrink-0" style={{ backgroundColor: k.textColorHex }} />
                                            <span className="text-xs text-gray-500">{k.textFilamentName} (tekst)</span>
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  )}

                                  {/* Product color choices */}
                                  {item.colorChoices && item.colorChoices.length > 0 && (
                                    <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                                      {item.colorChoices.map((cc, j) => (
                                        <div key={j} className="flex items-center gap-1.5">
                                          <div className="w-4 h-4 rounded-full border border-gray-200 flex-shrink-0" style={{ backgroundColor: cc.filamentColor }} />
                                          <span className="text-xs text-gray-500">{cc.filamentName} ({cc.slotLabel})</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}

                                  {item.note && (
                                    <p className="text-xs text-gray-500 mt-1.5 italic">📝 {item.note}</p>
                                  )}
                                </div>

                                {/* Per-item STL download (keyrings only) */}
                                {k && (
                                  k.stlGenerated ? (
                                    <button
                                      type="button"
                                      onClick={() => downloadStl(k.stlId, k.config.text)}
                                      className="bg-blue-600 text-white text-xs px-3 py-2 rounded-xl font-semibold hover:bg-blue-700 transition-colors flex-shrink-0"
                                    >
                                      ⬇️ STL
                                    </button>
                                  ) : (
                                    <span className="text-xs text-gray-400 italic flex-shrink-0">STL ikke klar</span>
                                  )
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Customer / shipping */}
                      {c && (c.name || c.email || c.address) && (
                        <div className="text-xs text-gray-600 bg-purple-50/60 rounded-xl px-3 py-2 space-y-0.5 mt-3">
                          {c.name && <p><span className="text-gray-400">Navn:</span> {c.name}</p>}
                          {c.email && <p><span className="text-gray-400">Email:</span> {c.email}</p>}
                          {c.phone && <p><span className="text-gray-400">Tlf:</span> {c.phone}</p>}
                          {c.address && <p><span className="text-gray-400">Adresse:</span> {c.address}</p>}
                        </div>
                      )}

                      <p className="font-mono text-[10px] text-gray-300 mt-2">{order.id}</p>
                    </div>
                  );
              };

              return (
                <div className="flex flex-col gap-6">
                  {/* Afventer */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-sm font-semibold text-amber-700 bg-amber-100 px-3 py-1 rounded-full">
                        ⏳ Afventer — {pending.length}
                      </span>
                    </div>
                    {pending.length === 0 ? (
                      <p className="text-sm text-gray-400 italic px-1">Ingen afventende bestillinger 🎉</p>
                    ) : (
                      <div className="flex flex-col gap-3">
                        {pending.map(renderOrder)}
                      </div>
                    )}
                  </div>

                  {/* Færdige */}
                  {printed.length > 0 && (
                    <div>
                      <button
                        type="button"
                        onClick={() => setShowPrinted((v) => !v)}
                        className="flex items-center gap-2 mb-3 group"
                      >
                        <span className="text-sm font-semibold text-green-700 bg-green-100 px-3 py-1 rounded-full">
                          ✓ Færdige — {printed.length}
                        </span>
                        <span className="text-xs text-gray-400 group-hover:text-gray-600 transition-colors">
                          {showPrinted ? "▲ Skjul" : "▼ Vis"}
                        </span>
                      </button>
                      {showPrinted && (
                        <div className="flex flex-col gap-3">
                          {printed.map(renderOrder)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
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
                <label className="text-sm text-gray-600 font-medium">Profilbillede</label>
                <div className="flex items-center gap-4">
                  {settings.aboutImage ? (
                    <div className="relative w-24 h-24 rounded-2xl overflow-hidden border border-gray-200 flex-shrink-0">
                      <Image src={settings.aboutImage} alt="Profilbillede" fill className="object-cover" unoptimized />
                      <button
                        type="button"
                        onClick={() => setSettings((s) => ({ ...s, aboutImage: "" }))}
                        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center text-xs hover:bg-red-600"
                      >×</button>
                    </div>
                  ) : (
                    <div className="w-24 h-24 rounded-2xl border-2 border-dashed border-gray-200 flex items-center justify-center text-gray-300 text-3xl flex-shrink-0">👤</div>
                  )}
                  <label className={`flex items-center gap-2 px-4 py-2 rounded-xl border cursor-pointer text-sm font-medium transition-colors ${aboutImageUploading ? "border-purple-300 bg-purple-50 text-purple-400" : "border-gray-200 hover:border-purple-400 hover:bg-purple-50 text-gray-600"}`}>
                    {aboutImageUploading ? "Uploader…" : settings.aboutImage ? "Skift billede" : "Upload billede"}
                    <input ref={aboutImageRef} type="file" accept="image/*" className="hidden" onChange={handleAboutImageUpload} disabled={aboutImageUploading} />
                  </label>
                </div>
              </div>
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
