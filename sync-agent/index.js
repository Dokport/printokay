/**
 * printokay sync-agent — runs inside the home network (next to Bambuddy).
 *
 * All connections are OUTBOUND (the home server never accepts inbound traffic):
 *   - Bambuddy  : reached over the local Docker network, authed with X-API-Key
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

  // Bambuddy paths (override if /docs shows different ones)
  spoolsPath: process.env.BAMBUDDY_SPOOLS_PATH || "/api/v1/spools",
  uploadPath: process.env.BAMBUDDY_UPLOAD_PATH || "/api/v1/library/files/upload",
  filesPath: process.env.BAMBUDDY_FILES_PATH || "/api/v1/library/files",
  uploadField: process.env.BAMBUDDY_UPLOAD_FIELD || "file",

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

const bamHeaders = { "X-API-Key": cfg.bambuddyKey };
const shopHeaders = { "x-sync-token": cfg.syncToken };

const log = (...a) => console.log(new Date().toISOString(), ...a);
const err = (...a) => console.error(new Date().toISOString(), ...a);

// Remember cost/kg per material from the last filament pull, to compute model
// material cost if Bambuddy's file API doesn't return a price directly.
let costPerKgByMaterial = {};

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

  // Cache cost/kg for the model-stats fallback.
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

function mapSpool(s) {
  const remainingGrams = num(s.remaining_weight ?? s.remainingWeight ?? s.remaining ?? s.remaining_grams);
  const lowThreshold = num(s.low_stock_threshold ?? s.lowStockThreshold ?? 0);
  const costPerKgOre = (() => {
    const perKg = num(s.cost_per_kg ?? s.costPerKg ?? s.cost);
    return perKg ? Math.round(perKg * 100) : undefined;
  })();
  return {
    sourceId: String(s.id ?? s.spool_id ?? s.uuid ?? ""),
    name: s.name || [s.brand, s.subtype, s.color_name].filter(Boolean).join(" ") || "Filament",
    material: s.material || s.filament_type || "PLA",
    colorHex: normHex(s.color_hex ?? s.colorHex ?? s.color ?? "#888888"),
    remainingGrams: remainingGrams ?? undefined,
    costPerKg: costPerKgOre,
    inStock: remainingGrams != null ? remainingGrams > lowThreshold : true,
  };
}

// ── Flow 2: models shop → Bambuddy, then stats back ─────────────────────────
async function syncModels() {
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

async function uploadModel(m) {
  // Download the model file from the shop.
  const fileRes = await shop(m.downloadPath);
  const buf = Buffer.from(await fileRes.arrayBuffer());
  const filename = (m.name || "model").replace(/[^a-zA-Z0-9._-]/g, "_") + guessExt(fileRes);

  // Upload into Bambuddy's library.
  const fd = new FormData();
  fd.append(cfg.uploadField, new Blob([buf]), filename);
  const up = await bam(cfg.uploadPath, { method: "POST", body: fd }).then((r) => r.json());
  const bambuddyId = String(up.id ?? up.file_id ?? up.fileId ?? up.uuid ?? "");

  await shop("/api/sync/models/done", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productId: m.id, bambuddyId }),
  });
  log(`model: "${m.name}" uploadet til Bambuddy (id=${bambuddyId || "?"})`);
}

async function fetchStats(m) {
  const file = await bam(`${cfg.filesPath}/${m.bambuddyId}`).then((r) => r.json());

  const printMinutes = extractMinutes(file);
  const filamentGrams = num(
    file.filament_weight ?? file.filamentWeight ?? file.total_weight ?? file.weight
  );
  let materialCost = num(file.cost ?? file.price ?? file.material_cost); // already currency units?
  // If Bambuddy returns a currency figure, convert to øre; else compute from grams × cost/kg.
  if (materialCost != null) {
    materialCost = Math.round(materialCost * 100);
  } else if (filamentGrams != null) {
    const rate = pickCostPerKg(file);
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

function pickCostPerKg(file) {
  const mat = file.material || file.filament_type;
  if (mat && costPerKgByMaterial[mat]) return costPerKgByMaterial[mat];
  const vals = Object.values(costPerKgByMaterial);
  if (vals.length) return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  return cfg.fallbackCostPerKg || 0;
}

function extractMinutes(file) {
  const sec = num(file.print_time ?? file.printTime ?? file.estimated_time ?? file.duration);
  if (sec != null) return Math.round(sec / 60); // assume seconds
  const min = num(file.print_minutes ?? file.printMinutes);
  return min != null ? Math.round(min) : null;
}

// ── helpers ─────────────────────────────────────────────────────────────────
function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function normHex(c) {
  if (!c) return "#888888";
  let h = String(c).trim();
  if (!h.startsWith("#")) h = "#" + h;
  return h.slice(0, 7);
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
