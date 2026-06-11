/**
 * printokay sync-agent — runs inside the home network (next to Bambuddy).
 *
 * All connections are OUTBOUND (the home server never accepts inbound traffic):
 *   - Bambuddy  : reached over the local Docker network, authed with Bearer token
 *   - Webshop   : reached over public HTTPS, authed with x-sync-token
 *
 * Two flows per loop:
 *   1. Filament  Bambuddy → shop  (Bambuddy authoritative for stock)
 *   2. Models    shop → Bambuddy  (upload), then Bambuddy → shop (print stats)
 *
 * Failures are logged but never crash the loop, so the shop is unaffected if
 * Bambuddy is down. Everything is idempotent.
 *
 * NOTE: a few Bambuddy endpoint paths / response field names are confirmed
 * against the running instance's Swagger (`/docs`). They're env-overridable so
 * no code change is needed if they differ — see README.
 */

const cfg = {
  bambuddyUrl: required("BAMBUDDY_URL").replace(/\/$/, ""),
  bambuddyKey: required("BAMBUDDY_API_KEY"),
  shopUrl: required("SHOP_URL").replace(/\/$/, ""),
  syncToken: required("SHOP_SYNC_TOKEN"),
  intervalSec: Number(process.env.SYNC_INTERVAL || 600),

  // Bambuddy paths — confirmed against this instance's openapi.json.
  spoolsPath: process.env.BAMBUDDY_SPOOLS_PATH || "/api/v1/inventory/spools",
  uploadPath: process.env.BAMBUDDY_UPLOAD_PATH || "/api/v1/library/files",
  filesPath: process.env.BAMBUDDY_FILES_PATH || "/api/v1/library/files",
  foldersPath: process.env.BAMBUDDY_FOLDERS_PATH || "/api/v1/library/folders/",
  projectsPath: process.env.BAMBUDDY_PROJECTS_PATH || "/api/v1/projects/",
  uploadField: process.env.BAMBUDDY_UPLOAD_FIELD || "file",
  // Top-level Bambuddy folder all shop products live under.
  rootFolder: process.env.BAMBUDDY_ROOT_FOLDER || "printOKAY",

  // Fallback material-cost rate (øre per kg) if neither the file API nor the
  // synced spool carries a cost. 0 = skip cost when unknown.
  fallbackCostPerKg: Number(process.env.FALLBACK_COST_PER_KG_ORE || 0),
};

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[fatal] missing env var ${name}`);
    process.exit(1);
  }
  return v;
}

// Bambuddy uses HTTP Bearer auth (Authorization: Bearer <key>).
const bamHeaders = { Authorization: `Bearer ${cfg.bambuddyKey}` };
const shopHeaders = { "x-sync-token": cfg.syncToken };

const log = (...a) => console.log(new Date().toISOString(), ...a);
const err = (...a) => console.error(new Date().toISOString(), ...a);

// Remembered from the last filament pull, to compute model material cost
// (Bambuddy's file API doesn't return a price directly).
let costPerKgByMaterial = {};
let syncedSpools = []; // [{ material, colorHex, costPerKg }] with a known cost

async function bam(path, init) {
  const r = await fetch(cfg.bambuddyUrl + path, {
    ...init,
    headers: { ...bamHeaders, ...(init?.headers || {}) },
  });
  if (!r.ok) throw new Error(`Bambuddy ${path} → ${r.status}`);
  return r;
}

async function shop(path, init) {
  const r = await fetch(cfg.shopUrl + path, {
    ...init,
    headers: { ...shopHeaders, ...(init?.headers || {}) },
  });
  if (!r.ok) throw new Error(`Shop ${path} → ${r.status}`);
  return r;
}

// ── Flow 1: filament Bambuddy → shop ────────────────────────────────────────
async function syncFilaments() {
  const raw = await bam(cfg.spoolsPath).then((r) => r.json());
  const list = Array.isArray(raw) ? raw : raw.spools || raw.items || raw.data || [];

  const spools = list.map(mapSpool).filter((s) => s.sourceId);

  // Cache spool costs for model material-cost computation:
  //  - full list (match by material + colour for precision)
  //  - per-material map + overall average (fallbacks)
  syncedSpools = spools.filter((s) => s.costPerKg);
  costPerKgByMaterial = {};
  for (const s of spools) {
    if (s.costPerKg && s.material) costPerKgByMaterial[s.material] = s.costPerKg;
  }

  const res = await shop("/api/sync/filaments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ spools }),
  }).then((r) => r.json());

  log(`filament: ${spools.length} spoler sendt (synced=${res.synced}, manual=${res.manual})`);
}

// Maps Bambuddy /api/v1/inventory/spools rows → shop FilamentSpool shape.
function mapSpool(s) {
  // remaining filament = advertised net weight − consumed
  const labelWeight = num(s.label_weight);
  const used = num(s.weight_used) ?? 0;
  const remainingGrams = labelWeight != null ? Math.max(0, labelWeight - used) : null;

  const perKg = num(s.cost_per_kg);
  const costPerKgOre = perKg != null ? Math.round(perKg * 100) : undefined;

  const archived = !!s.archived_at;

  return {
    sourceId: String(s.id ?? ""),
    name:
      s.slicer_filament_name ||
      [s.brand, s.subtype, s.color_name].filter(Boolean).join(" ") ||
      s.material ||
      "Filament",
    material: s.material || "PLA",
    colorHex: normHex(s.rgba),
    remainingGrams: remainingGrams ?? undefined,
    costPerKg: costPerKgOre,
    // No explicit stock flag in Bambuddy → in stock if not archived and filament remains.
    inStock: !archived && (remainingGrams == null || remainingGrams > 0),
  };
}

// ── Flow 2: models shop → Bambuddy, then stats back ─────────────────────────
async function syncModels() {
  folderCache.clear(); // re-resolve folders each run (they may change externally)
  const { toUpload, awaitingStats } = await shop("/api/sync/models").then((r) => r.json());

  for (const m of toUpload || []) {
    try {
      await uploadModel(m);
    } catch (e) {
      err(`model upload (${m.name}):`, e.message);
    }
  }

  for (const m of awaitingStats || []) {
    try {
      await fetchStats(m);
    } catch (e) {
      err(`model stats (${m.id}):`, e.message);
    }
  }
}

// Create one Bambuddy Project per shop product, with a linked library folder
// printOKAY/<Kategori>/<Produkt> holding BOTH the project and sliced files.
// Bambuddy then becomes the single source of truth for this product's prints.
async function uploadModel(m) {
  const safe = (m.name || "model").replace(/[^a-zA-Z0-9æøåÆØÅ._ -]/g, "_").trim() || "model";
  const shopLink = `${cfg.shopUrl}/#${m.id}`;

  // 1. Folder hierarchy: printOKAY / <Kategori>
  const rootFolder = await ensureFolder(cfg.rootFolder, null);
  const categoryName = (m.category || "Ukategoriseret").trim();
  const categoryFolder = await ensureFolder(categoryName, rootFolder.id);

  // 2. A Project to group all of this product's prints (notes link back to shop).
  const project = await createProject({
    name: safe,
    notes: `Shop-produkt: ${shopLink}\nKategori: ${categoryName}`,
  });

  // 3. The product's own folder, linked to the project.
  const productFolder = await ensureFolder(safe, categoryFolder.id, project.id);

  // 4. Upload both files into the product folder.
  let projectFileId, printFileId;
  if (m.projectPath) {
    projectFileId = await uploadFileFromShop(m.projectPath, `${safe} - projekt.3mf`, productFolder.id);
  }
  if (m.printPath) {
    printFileId = await uploadFileFromShop(m.printPath, `${safe} - print.gcode.3mf`, productFolder.id);
  }

  await shop("/api/sync/models/done", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      productId: m.id,
      bambuddy: { projectId: project.id, folderId: productFolder.id, projectFileId, printFileId },
    }),
  });
  log(
    `model: "${m.name}" → Bambuddy project=${project.id}, folder=${productFolder.id}, ` +
      `projekt=${projectFileId || "—"}, print=${printFileId || "—"}`
  );
}

// Download a file from the shop and upload it into a Bambuddy folder. Returns id.
async function uploadFileFromShop(downloadPath, filename, folderId) {
  const res = await shop(downloadPath);
  const buf = Buffer.from(await res.arrayBuffer());
  const fd = new FormData();
  fd.append(cfg.uploadField, new Blob([buf]), filename);
  const path = `${cfg.uploadPath}?folder_id=${encodeURIComponent(folderId)}`;
  const up = await bam(path, { method: "POST", body: fd }).then((r) => r.json());
  return String(up.id ?? up.file_id ?? up.fileId ?? up.uuid ?? "");
}

// Find a folder by name (+ parent) or create it. Caches within a sync run.
const folderCache = new Map();
async function ensureFolder(name, parentId, projectId) {
  const key = `${parentId ?? "root"}/${name}`;
  if (folderCache.has(key)) return folderCache.get(key);

  const all = await bam(cfg.foldersPath).then((r) => r.json());
  const list = Array.isArray(all) ? all : all.folders || all.items || all.data || [];
  const norm = (v) => (v == null ? null : String(v));
  let folder = list.find(
    (f) => f.name === name && norm(f.parent_id) === norm(parentId)
  );

  if (!folder) {
    folder = await bam(cfg.foldersPath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        ...(parentId != null ? { parent_id: Number(parentId) } : {}),
        ...(projectId != null ? { project_id: Number(projectId) } : {}),
      }),
    }).then((r) => r.json());
  }
  folderCache.set(key, folder);
  return folder;
}

async function createProject({ name, notes }) {
  return bam(cfg.projectsPath, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, notes }),
  }).then((r) => r.json());
}

async function fetchStats(m) {
  const file = await bam(`${cfg.filesPath}/${m.bambuddyId}`).then((r) => r.json());

  // Bambuddy file detail: print_time_seconds + filament_used_grams (null until sliced).
  const sec = num(file.print_time_seconds);
  const printMinutes = sec != null ? Math.round(sec / 60) : null;
  let filamentGrams = num(file.filament_used_grams);

  // Material cost: prefer the per-filament breakdown (accurate for multi-colour),
  // matching each filament to a spool by material + colour. Falls back to total
  // grams × material/avg rate if the breakdown isn't available.
  let materialCost = null;
  let reqs = null;
  try {
    reqs = await bam(`${cfg.filesPath}/${m.bambuddyId}/filament-requirements`).then((r) => r.json());
  } catch { /* endpoint optional */ }

  const filaments = reqs?.filaments;
  if (Array.isArray(filaments) && filaments.length) {
    let cost = 0;
    let grams = 0;
    for (const f of filaments) {
      const g = num(f.used_grams) ?? 0;
      grams += g;
      cost += (g / 1000) * rateForFilament(f.type, f.color);
    }
    materialCost = Math.round(cost);
    if (filamentGrams == null) filamentGrams = Math.round(grams * 100) / 100;
  } else if (filamentGrams != null) {
    const rate = rateForFilament(file.filament_type, file.filament_color);
    if (rate) materialCost = Math.round((filamentGrams / 1000) * rate);
  }

  // Not ready yet (Bambuddy still slicing) — skip, retry next cycle.
  if (printMinutes == null && filamentGrams == null && materialCost == null) {
    log(`model: stats for ${m.id} ikke klar endnu`);
    return;
  }

  await shop("/api/sync/models/stats", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productId: m.id, printMinutes, filamentGrams, materialCost }),
  });
  log(`model: stats skrevet for ${m.id} (tid=${printMinutes}min, gram=${filamentGrams}, pris=${materialCost}øre)`);
}

// Cost/kg (øre) for a given filament type+colour, most specific match first:
// material+colour → material → overall average → configured fallback.
function rateForFilament(type, color) {
  const hex = color ? normHex(color) : null;
  if (type && hex) {
    const exact = syncedSpools.find((s) => s.material === type && s.colorHex.toUpperCase() === hex.toUpperCase());
    if (exact) return exact.costPerKg;
  }
  if (type && costPerKgByMaterial[type]) return costPerKgByMaterial[type];
  const vals = Object.values(costPerKgByMaterial);
  if (vals.length) return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  return cfg.fallbackCostPerKg || 0;
}

// ── helpers ─────────────────────────────────────────────────────────────────
function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
// Bambuddy stores colour as `rgba`. Handle "RRGGBB", "RRGGBBAA", "#RRGGBB" and
// "rgba(r,g,b,a)" forms → "#RRGGBB".
function normHex(c) {
  if (!c) return "#888888";
  let h = String(c).trim();
  const m = h.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) {
    const hex = m.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, "0")).join("");
    return "#" + hex;
  }
  h = h.replace(/^#/, "");
  if (h.length >= 6) return "#" + h.slice(0, 6);
  return "#888888";
}
function guessExt(res) {
  const cd = res.headers.get("content-disposition") || "";
  const m = cd.match(/\.(3mf|stl)"/i);
  return m ? "." + m[1].toLowerCase() : ".3mf";
}

async function runOnce() {
  try { await syncFilaments(); } catch (e) { err("filament-sync:", e.message); }
  try { await syncModels(); } catch (e) { err("model-sync:", e.message); }
}

async function main() {
  log(`sync-agent startet — interval ${cfg.intervalSec}s, shop=${cfg.shopUrl}, bambuddy=${cfg.bambuddyUrl}`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await runOnce();
    await new Promise((r) => setTimeout(r, cfg.intervalSec * 1000));
  }
}

main();
