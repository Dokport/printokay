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
  printersPath: process.env.BAMBUDDY_PRINTERS_PATH || "/api/v1/printers/",
  archivesPath: process.env.BAMBUDDY_ARCHIVES_PATH || "/api/v1/archives/",
  archivesLimit: Number(process.env.BAMBUDDY_ARCHIVES_LIMIT || 200),
  uploadField: process.env.BAMBUDDY_UPLOAD_FIELD || "file",
  // Default printer for send-to-print when a request doesn't name one.
  defaultPrinterId: process.env.DEFAULT_PRINTER_ID || "",
  // Bambuddy archive `cost` is in major currency units (kr); shop stores øre.
  costToOere: Number(process.env.BAMBUDDY_COST_TO_OERE || 100),
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

// ── Session-level state (resets on container restart) ────────────────────────
// In-memory hashes so we skip the shop POST entirely when data hasn't changed.
// This avoids even the Blob READ that the server-side write-guard would trigger.
let lastSpoolsJson = null;
let lastPrintersJson = null;
// Products that failed rename with 403 (API key lacks folder-rename permission).
// We warn once per session instead of spamming the log every loop.
const renameWarned = new Set();

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

  // Skip the shop POST (and the server-side Blob READ it triggers) when the
  // spool list is identical to what we last sent. Resets on container restart.
  const spoolsJson = JSON.stringify(spools);
  if (spoolsJson === lastSpoolsJson) return; // nothing changed

  const res = await shop("/api/sync/filaments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ spools }),
  }).then((r) => r.json());

  lastSpoolsJson = spoolsJson;
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
  const { toUpload, withFiles, toRename } = await shop("/api/sync/models").then((r) => r.json());

  for (const m of toUpload || []) {
    try {
      await uploadModel(m);
    } catch (e) {
      err(`model upload (${m.name}):`, e.message);
    }
  }

  for (const m of toRename || []) {
    try {
      await renameModel(m);
    } catch (e) {
      err(`model rename (${m.id}):`, e.message);
    }
  }

  for (const m of withFiles || []) {
    try {
      await fetchFileStats(m);
    } catch (e) {
      err(`file stats (${m.id}):`, e.message);
    }
  }

  // Clean up empty duplicate folders left by the earlier tree-search bug.
  try { await cleanupEmptyFolders(); } catch (e) { err("folder cleanup:", e.message); }
}

// Delete empty stray folders under the printOKAY root (file_count 0, no children).
// Category folders always contain product subfolders and product folders always
// contain files, so any empty folder under the root is a duplicate to remove.
async function cleanupEmptyFolders() {
  const all = await bam(cfg.foldersPath).then((r) => r.json());
  const tree = Array.isArray(all) ? all : all.folders || all.items || all.data || [];
  const roots = tree.filter((f) => f.name === cfg.rootFolder);

  let removed = 0;
  const removeEmpty = async (nodes) => {
    for (const n of nodes || []) {
      const children = Array.isArray(n.children) ? n.children : [];
      // Depth-first so a parent that becomes empty after pruning is also caught.
      await removeEmpty(children);
      const stillHasChildren = children.some((c) => !c._deleted);
      if (!stillHasChildren && (num(n.file_count) ?? 0) === 0) {
        try {
          await bam(`${cfg.foldersPath}${n.id}`, { method: "DELETE" });
          n._deleted = true;
          removed++;
        } catch { /* ignore, retry next run */ }
      }
    }
  };
  // Only prune *inside* each printOKAY root, never the root itself.
  for (const root of roots) await removeEmpty(root.children || []);
  if (removed) log(`folder cleanup: ${removed} tomme mapper slettet`);
}

const isSuccessfulPrint = (a) => {
  const s = String(a.status || "").toLowerCase();
  if (["failed", "cancelled", "canceled", "aborted", "error"].includes(s)) return false;
  if (a.failure_reason) return false;
  return s === "completed" || s === "success" || s === "finished" || s === "done" || !!a.completed_at;
};

// Bambuddy is the source of truth for print data. We don't need a Project: the
// library file itself carries print_count + last_printed_at, and the real prints
// live in /archives matched to the file by hash (fallback: filename).
async function fetchFileStats(m) {
  if (!m.fileId) return;
  const file = await bam(`${cfg.filesPath}/${m.fileId}`).then((r) => r.json());
  const fileHash = file.file_hash || file.content_hash;
  const fileName = file.filename;

  // Find this file's real prints among the archives (match by hash, then name).
  let archives = [];
  try {
    const raw = await bam(`${cfg.archivesPath}?limit=${cfg.archivesLimit}`).then((r) => r.json());
    const all = Array.isArray(raw) ? raw : raw.archives || raw.items || raw.data || [];
    archives = all.filter((a) => {
      if (fileHash && a.content_hash) return a.content_hash === fileHash;
      if (fileName && a.filename) return a.filename === fileName;
      return false;
    });
  } catch (e) {
    err(`archives lookup (${m.id}):`, e.message);
  }

  const done = archives.filter(isSuccessfulPrint);

  // ── Aggregated history ──
  let count = 0, totalGrams = 0, totalCostOre = 0, lastPrintedAt = null;
  for (const a of done) {
    const qty = num(a.quantity) ?? 1;
    count += qty;
    totalGrams += (num(a.filament_used_grams) ?? 0) * qty;
    totalCostOre += (num(a.cost) ?? 0) * cfg.costToOere * qty;
    const when = a.completed_at || a.created_at;
    if (when && (!lastPrintedAt || when > lastPrintedAt)) lastPrintedAt = when;
  }
  // Fall back to the file's own counters if archive matching found nothing.
  if (count === 0 && num(file.print_count)) count = num(file.print_count);
  if (!lastPrintedAt && file.last_printed_at) lastPrintedAt = file.last_printed_at;

  // Blob-saving: if the real print count hasn't changed and the product already
  // has its stats, there's nothing new to write — skip the shop callbacks.
  const countChanged = count !== (num(m.knownCount) ?? 0);
  if (!countChanged && m.hasActual) {
    log(`file: "${m.id}" — ${count} prints, uændret — springer over`);
    return;
  }
  if (!countChanged && !m.needEstimate && count === 0) return;

  if (count > 0 || lastPrintedAt) {
    await shop("/api/sync/models/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId: m.id,
        printStats: {
          count,
          ...(totalGrams > 0 ? { totalGrams: Math.round(totalGrams * 100) / 100 } : {}),
          ...(totalCostOre > 0 ? { totalCost: Math.round(totalCostOre) } : {}),
          lastPrintedAt,
        },
      }),
    });
  }

  // ── Authoritative stats: most recent real print overrides the estimate ──
  if (done.length) {
    const latest = done.reduce((a, b) =>
      (b.completed_at || b.created_at || "") > (a.completed_at || a.created_at || "") ? b : a
    );
    const sec = num(latest.actual_time_seconds) ?? num(latest.print_time_seconds);
    const printMinutes = sec != null ? Math.round(sec / 60) : null;
    const filamentGrams = num(latest.filament_used_grams);
    const cost = num(latest.cost);
    const materialCost = cost != null ? Math.round(cost * cfg.costToOere) : null;
    if (printMinutes != null || filamentGrams != null || materialCost != null) {
      await shop("/api/sync/models/stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: m.id, printMinutes, filamentGrams, materialCost, source: "actual" }),
      });
    }
    log(`file: "${m.id}" — ${count} prints, ${Math.round(totalGrams)} g (faktiske stats)`);
    return;
  }

  // ── No real print yet: backfill estimate from the sliced file detail ──
  if (m.needEstimate) {
    const sec = num(file.print_time_seconds);
    const printMinutes = sec != null ? Math.round(sec / 60) : null;
    const filamentGrams = num(file.filament_used_grams);
    if (printMinutes != null || filamentGrams != null) {
      await shop("/api/sync/models/stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: m.id, printMinutes, filamentGrams, source: "estimate" }),
      });
      log(`file: "${m.id}" — estimat fra sliced fil (tid=${printMinutes}, gram=${filamentGrams})`);
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

  // 2. Forsøg at oprette et Bambuddy-Project (kræver admin-tilladelse — valgfrit).
  let project = null;
  try {
    project = await createProject({
      name: safe,
      notes: `Shop-produkt: ${shopLink}\nKategori: ${categoryName}`,
    });
  } catch (e) {
    log(`model: project-oprettelse sprunget over (${e.message}) — bruger kun mappe`);
  }

  // 3. Produktets egen mappe (linket til project hvis det lykkedes).
  const productFolder = await ensureFolder(safe, categoryFolder.id, project?.id ?? null);

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
      bambuddy: {
        ...(project?.id != null ? { projectId: project.id } : {}),
        folderId: productFolder.id,
        projectFileId,
        printFileId,
      },
    }),
  });
  log(
    `model: "${m.name}" → Bambuddy folder=${productFolder.id}` +
      (project?.id ? `, project=${project.id}` : "") +
      `, projekt=${projectFileId || "—"}, print=${printFileId || "—"}`
  );
}

// Product renamed/recategorised in the shop → rename the Bambuddy folder + files
// (and re-parent on a category change) so the library stays human-readable.
async function renameModel(m) {
  const safe = (m.name || "model").replace(/[^a-zA-Z0-9æøåÆØÅ._ -]/g, "_").trim() || "model";

  // Re-parent the folder if the category changed.
  let parentId;
  if (m.categoryChanged) {
    const root = await ensureFolder(cfg.rootFolder, null);
    const category = await ensureFolder((m.category || "Ukategoriseret").trim(), root.id);
    parentId = category.id;
  }

  try {
    await bam(`${cfg.foldersPath}${m.folderId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: safe, ...(parentId != null ? { parent_id: Number(parentId) } : {}) }),
    });
  } catch (e) {
    // API keys lack folder-rename permission (Bambuddy returns 403). Log once per
    // product per session and return silently — the id-based link still works, the
    // Bambuddy folder just keeps its old name until an admin renames it manually.
    if (e.message.includes("403")) {
      if (!renameWarned.has(m.id)) {
        log(`model rename: API-nøgle mangler mappe-rettighed i Bambuddy — "${safe}" omdøbes ikke automatisk (gøres manuelt i Bambuddy eller tilføj mappe-tilladelse til API-nøglen)`);
        renameWarned.add(m.id);
      }
      return; // skip file renames + callback too
    }
    throw e;
  }

  if (m.projectFileId) await renameFile(m.projectFileId, `${safe} - projekt.3mf`);
  if (m.printFileId) await renameFile(m.printFileId, `${safe} - print.gcode.3mf`);

  await shop("/api/sync/models/renamed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productId: m.id }),
  });
  log(`model: omdøbt i Bambuddy → "${safe}"${m.categoryChanged ? " (+ flyttet)" : ""}`);
}

async function renameFile(fileId, filename) {
  await bam(`${cfg.filesPath}/${fileId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename }),
  });
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
  const tree = Array.isArray(all) ? all : all.folders || all.items || all.data || [];
  // GET /library/folders returns a TREE (FolderTreeItem[] with `children`), not a
  // flat list — so we must flatten before searching, or nested category folders
  // are never found and get re-created on every product (lots of empty dupes).
  const list = [];
  const walk = (nodes) => {
    for (const n of nodes || []) {
      list.push(n);
      if (Array.isArray(n.children)) walk(n.children);
    }
  };
  walk(tree);
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

// ── Flow 3: printers Bambuddy → shop, and send-to-print shop → Bambuddy ───────
async function syncPrinters() {
  const raw = await bam(cfg.printersPath).then((r) => r.json());
  const list = Array.isArray(raw) ? raw : raw.printers || raw.items || raw.data || [];
  const printers = list
    .filter((p) => p && p.id != null)
    .map((p) => ({
      id: String(p.id),
      name: p.name || `Printer ${p.id}`,
      model: p.model || undefined,
      isActive: p.is_active != null ? !!p.is_active : undefined,
    }));

  // Skip the shop POST when the printer list hasn't changed (same as filaments).
  const printersJson = JSON.stringify(printers);
  if (printersJson === lastPrintersJson) return; // nothing changed

  await shop("/api/sync/printers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ printers }),
  });

  lastPrintersJson = printersJson;
  log(`printers: ${printers.length} synket til shop`);
}

async function handlePrintRequests() {
  const { requests } = await shop("/api/print-requests").then((r) => r.json());
  for (const r of requests || []) {
    try {
      const printerId = r.printerId || cfg.defaultPrinterId;
      if (!printerId) throw new Error("ingen printer valgt og DEFAULT_PRINTER_ID mangler");

      const qty = Math.max(1, Number(r.quantity) || 1);
      for (let i = 0; i < qty; i++) {
        const path = `${cfg.filesPath}/${r.printFileId}/print?printer_id=${encodeURIComponent(printerId)}`;
        await bam(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}), // defaults: bed_levelling, use_ams, etc.
        });
      }

      await shop("/api/print-requests/done", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: r.id, status: "done" }),
      });
      log(`print: request ${r.id} → printer ${printerId} (×${qty})`);
    } catch (e) {
      err(`print request ${r.id}:`, e.message);
      await shop("/api/print-requests/done", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: r.id, status: "failed", error: e.message }),
      }).catch(() => {});
    }
  }
}

// Custom keyrings from shop orders → Bambuddy (their 2-colour 3MF, into a
// "Nøgleringe" folder). Same upload machinery as products; once synced they drop
// off the list so this does nothing in a steady loop.
async function syncKeyrings() {
  const { toUpload } = await shop("/api/sync/keyrings").then((r) => r.json());
  if (!toUpload || !toUpload.length) return;

  const root = await ensureFolder(cfg.rootFolder, null);
  const folder = await ensureFolder("Nøgleringe", root.id);

  for (const k of toUpload) {
    try {
      const safe = (k.name || "Nøglering").replace(/[^a-zA-Z0-9æøåÆØÅ._ ()-]/g, "_").trim() || "Nøglering";
      const fileId = await uploadFileFromShop(k.downloadPath, `${safe}.3mf`, folder.id);
      await shop("/api/sync/keyrings/done", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stlId: k.stlId, bambuddy: { fileId, folderId: folder.id } }),
      });
      log(`nøglering: "${k.name}" → Bambuddy folder=${folder.id}, fil=${fileId}`);
    } catch (e) {
      err(`nøglering (${k.stlId}):`, e.message);
    }
  }
}

async function runOnce() {
  try { await syncFilaments(); } catch (e) { err("filament-sync:", e.message); }
  try { await syncModels(); } catch (e) { err("model-sync:", e.message); }
  try { await syncKeyrings(); } catch (e) { err("nøgle-sync:", e.message); }
  try { await syncPrinters(); } catch (e) { err("printer-sync:", e.message); }
  try { await handlePrintRequests(); } catch (e) { err("print-requests:", e.message); }
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
