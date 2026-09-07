"use client";

/**
 * Design a fidget clicker: how many switches, what colours, what is written on each
 * cap.
 *
 * Same shape as the keyring configurator — a preview that stays in view while the
 * settings scroll beside it — because the two are the same job and a customer who
 * has used one should not have to learn the other.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCart } from "@/lib/cartContext";
import { formatPrice } from "@/lib/products";
import { detectWebGL } from "@/lib/webgl";
import { getAdminToken } from "@/lib/adminSession";
import {
  MAX_CAP_CHARS, MAX_COLS, MAX_ROWS,
  calcFidgetPrice, exampleLabel, fidgetFilaments, switchCount, validateFidget,
  DEFAULT_FIDGET_SETTINGS, type FidgetConfig, type FidgetSettings,
} from "@/lib/fidget";
import type { FidgetMesh } from "@/lib/fidgetMesh";
import type { FilamentSpool } from "@/lib/settings";

const FidgetPreview3D = dynamic(() => import("@/components/FidgetPreview3D"), {
  ssr: false,
  loading: () => (
    <div className="w-full aspect-[4/3] rounded-2xl bg-gray-50 flex items-center justify-center text-sm text-gray-400">
      Indlæser 3D-model…
    </div>
  ),
});

type Settings = {
  primaryColor: string;
  fidget: FidgetSettings;
  filaments: FilamentSpool[];
};

const mm = (v: number) => (v / 10).toFixed(1).replace(".", ",");

export default function FidgetConfigurator() {
  const { addItem } = useCart();
  const [settings, setSettings] = useState<Settings>({
    primaryColor: "#7c3aed",
    fidget: DEFAULT_FIDGET_SETTINGS,
    filaments: [],
  });

  const [cols, setCols] = useState(2);
  const [rows, setRows] = useState(2);
  const [keyring, setKeyring] = useState(false);
  const [labels, setLabels] = useState<string[]>([]);
  /**
   * Which cap fields the customer has taken over from the examples. Needed so an
   * emptied field stays empty instead of falling back to its example.
   */
  const [touched, setTouched] = useState<Set<number>>(new Set());
  // null = the customer hasn't chosen yet, so a sensible default stands in. Derived
  // rather than written into state on load: writing it would mean a second render
  // for every visitor, and would make "unchosen" indistinguishable from "chose the
  // colour that happened to be the default".
  const [boxPick, setBoxPick] = useState<string | null>(null);
  const [capPick, setCapPick] = useState<string | null>(null);
  const [textPick, setTextPick] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const [webglOk, setWebglOk] = useState(true);
  /** Opt-in size reference: a real house key laid beside the clicker. */
  const [showScale, setShowScale] = useState(false);
  const [mesh, setMesh] = useState<FidgetMesh | null>(null);

  // Admin-only test download. Stays null for every normal visitor, and the token is
  // only trusted once the SERVER has confirmed it — the download route enforces the
  // same check independently, so this is about not showing controls that aren't
  // yours, not about guarding the files.
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [testDl, setTestDl] = useState<"idle" | "busy" | "err">("idle");
  useEffect(() => {
    const token = getAdminToken();
    if (!token) return;
    let cancelled = false;
    fetch("/api/admin-check", { headers: { "x-admin-token": token } })
      .then((res) => { if (!cancelled && res.ok) setAdminToken(token); })
      .catch(() => { /* not admin — leave hidden */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        if (!d?.fidget) return;
        setSettings({
          primaryColor: d.primaryColor ?? "#7c3aed",
          fidget: { ...DEFAULT_FIDGET_SETTINGS, ...d.fidget },
          filaments: Array.isArray(d.filaments) ? d.filaments : [],
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => { setWebglOk(detectWebGL()); }, []);

  const { primaryColor, fidget, filaments } = settings;
  // Only what the shop offers for this product — the plate prints in three colours
  // at once, so the choice is what is loaded, not the whole shelf.
  const inStock = useMemo(
    () => fidgetFilaments(fidget, filaments),
    [fidget, filaments]
  );

  // Sensible starting colours once stock is known: a dark box, a light cap, and a
  // text colour that is not the cap.
  const defaults = useMemo(() => {
    if (!inStock.length) return { box: "", cap: "", text: "" };
    const lum = (hex: string) => {
      const h = hex.replace("#", "");
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) || 0);
      return 0.299 * r + 0.587 * g + 0.114 * b;
    };
    const sorted = [...inStock].sort((a, b) => lum(a.colorHex) - lum(b.colorHex));
    const dark = sorted[0], light = sorted[sorted.length - 1];
    return {
      box: dark.id,
      cap: light.id,
      text: (sorted.find((f) => f.id !== light.id) ?? dark).id,
    };
  }, [inStock]);

  const boxFilamentId = boxPick ?? defaults.box;
  const capFilamentId = capPick ?? defaults.cap;
  const textFilamentId = textPick ?? defaults.text;

  const n = cols * rows;
  // An untouched field shows its example, and the example is what gets ordered if
  // the customer leaves it — it is a real, printable label, not a placeholder.
  const capLabels = useMemo(
    () => Array.from({ length: n }, (_, i) => (touched.has(i) ? labels[i] ?? "" : exampleLabel(i))),
    [labels, touched, n]
  );

  const config: FidgetConfig = useMemo(
    () => ({ cols, rows, keyring, labels: capLabels, boxFilamentId, capFilamentId, textFilamentId }),
    [cols, rows, keyring, capLabels, boxFilamentId, capFilamentId, textFilamentId]
  );

  const colourOf = (id: string) => inStock.find((f) => f.id === id)?.colorHex ?? "#cccccc";
  const nameOf = (id: string) => inStock.find((f) => f.id === id)?.name ?? "";

  const validation = validateFidget(config, filaments, fidget);
  const price = calcFidgetPrice(config, fidget);
  const canBuy = validation.ok;

  const setLabel = (i: number, value: string) => {
    setTouched((prev) => (prev.has(i) ? prev : new Set(prev).add(i)));
    setLabels((prev) => {
      const next = [...prev];
      while (next.length < n) next.push("");
      // Upper-cased here so what is stored matches what is shown; the CSS
      // transform alone would send a lower-case letter to the printer.
      next[i] = value.toLocaleUpperCase("da-DK").slice(0, MAX_CAP_CHARS);
      return next;
    });
  };


  // The preview hands back the mesh it built; the read-out is measured, not guessed.
  const onMeasure = useCallback((m: FidgetMesh) => setMesh(m), []);

  /** Build the current design — or the stem comb — without cart or checkout. */
  async function downloadTestFile(tolerance = false) {
    if (!adminToken) return;
    setTestDl("busy");
    try {
      const res = await fetch("/api/fidget/test", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": adminToken },
        body: JSON.stringify(
          tolerance
            ? { tolerance: true, capColorHex: colourOf(capFilamentId), textColorHex: colourOf(textFilamentId) }
            : {
                cols, rows, keyring, labels: capLabels,
                boxColorHex: colourOf(boxFilamentId),
                capColorHex: colourOf(capFilamentId),
                textColorHex: colourOf(textFilamentId),
              }
        ),
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      const blob = await res.blob();
      const name =
        res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "test_fidget.3mf";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      setTestDl("idle");
    } catch (err) {
      console.error("Testfil fejlede:", err);
      setTestDl("err");
    }
  }

  function handleAddToCart() {
    if (!canBuy) return;
    const product = {
      id: "fidget",
      name: "Custom Fidget Clicker",
      description: `${cols}×${rows} — ${switchCount(config)} switches${keyring ? ", med nøglering" : ""}`,
      price,
      image: "",
      emoji: "",
      category: "fidget",
      material: "PLA",
      modelUrl: "",
      colorSlots: [],
    };
    addItem(product, {
      fidgetData: {
        cols, rows, keyring,
        labels: capLabels,
        boxFilamentId, boxFilamentName: nameOf(boxFilamentId), boxColorHex: colourOf(boxFilamentId),
        capFilamentId, capFilamentName: nameOf(capFilamentId), capColorHex: colourOf(capFilamentId),
        textFilamentId, textFilamentName: nameOf(textFilamentId), textColorHex: colourOf(textFilamentId),
        switchLabel: fidget.switchLabel,
        price,
      },
    });
    setAdded(true);
    setTimeout(() => setAdded(false), 1800);
  }

  const colourPicker = (
    label: string,
    value: string,
    onChange: (id: string) => void
  ) => (
    <div>
      <label className="text-sm font-semibold text-gray-700 mb-2 block">{label}</label>
      <div className="flex flex-wrap gap-2">
        {inStock.map((f) => {
          const on = value === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => onChange(f.id)}
              title={f.name}
              aria-label={f.name}
              aria-pressed={on}
              className="w-9 h-9 rounded-full border-2 transition-transform hover:scale-110"
              style={{
                backgroundColor: f.colorHex,
                borderColor: on ? primaryColor : "#e5e7eb",
                boxShadow: on ? `0 0 0 3px ${primaryColor}33` : undefined,
              }}
            />
          );
        })}
      </div>
      {value && <p className="text-xs text-gray-400 mt-1.5">{nameOf(value)}</p>}
    </div>
  );

  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start lg:gap-8">
      {/* Preview — sticky, so the result of every change stays in view. */}
      <div className="sticky top-16 lg:top-20 z-20 -mx-4 px-4 pt-3 pb-3 bg-white shadow-md border-b border-gray-100 lg:col-start-1 lg:mx-0 lg:rounded-2xl lg:border lg:border-gray-100 lg:p-5 lg:shadow-sm">
        <p className="hidden lg:block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
          Forhåndsvisning
        </p>
        {webglOk ? (
          <FidgetPreview3D
            config={config}
            boxColor={colourOf(boxFilamentId)}
            capColor={colourOf(capFilamentId)}
            textColor={colourOf(textFilamentId)}
            crossWidthMm={fidget.crossWidthMm}
            showScale={showScale}
            onMeasure={onMeasure}
          />
        ) : (
          <div className="w-full aspect-[4/3] rounded-2xl bg-gray-50 flex items-center justify-center text-sm text-gray-400 text-center px-6">
            Din enhed kan ikke vise 3D — resten fungerer som normalt.
          </div>
        )}

        {mesh && (
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-xs text-gray-500 mt-2">
            <span>
              Kasse <strong className="text-gray-700">{mm(mesh.boxMm.w)} × {mm(mesh.boxMm.h)} cm</strong>
              {" · "}{switchCount(config)} {fidget.switchLabel.toLowerCase()}
              {switchCount(config) === 1 ? "" : "es"}
            </span>
            <button
              type="button"
              onClick={() => setShowScale((v) => !v)}
              aria-pressed={showScale}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-medium transition-colors ${
                showScale
                  ? "border-gray-300 bg-gray-100 text-gray-700"
                  : "border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700"
              }`}
            >
              🔑 Tjek størrelse
            </button>
          </div>
        )}
        {showScale && (
          <p className="text-center text-[11px] text-gray-400 mt-1">
            Nøglen er en helt almindelig husnøgle — vist i rigtig størrelse til sammenligning
          </p>
        )}

        <div className="hidden lg:flex items-center justify-between gap-3 mt-3 pt-3 border-t border-gray-100">
          <div className="text-sm text-gray-500">
            I alt{" "}
            <span className="font-bold text-base" style={{ color: primaryColor }}>
              {formatPrice(price)}
            </span>
          </div>
          <button
            onClick={handleAddToCart}
            disabled={!canBuy}
            className="px-5 py-2.5 rounded-xl font-semibold text-white text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: added ? "#22c55e" : primaryColor }}
          >
            {added ? "Lagt i kurv!" : "Læg i kurv"}
          </button>
        </div>
      </div>

      {/* Settings */}
      <div className="flex flex-col gap-5 lg:col-start-2">
        {/* Grid */}
        <div>
          <label className="text-sm font-semibold text-gray-700 mb-2 block">Antal knapper</label>
          <div className="flex flex-col gap-2">
            {[1, 2].slice(0, MAX_ROWS).map((r) => (
              <div key={r} className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-16 shrink-0">
                  {r === 1 ? "1 række" : `${r} rækker`}
                </span>
                <div className="flex gap-2 flex-wrap">
                  {Array.from({ length: MAX_COLS }, (_, i) => i + 1).map((c) => {
                    const on = cols === c && rows === r;
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => { setCols(c); setRows(r); }}
                        className="px-3 py-2 rounded-xl border-2 text-sm font-semibold transition-all"
                        style={{
                          borderColor: on ? primaryColor : "#e5e7eb",
                          color: on ? primaryColor : "#374151",
                          backgroundColor: on ? `color-mix(in srgb, ${primaryColor} 8%, white)` : "white",
                        }}
                      >
                        {c * r}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-1.5">
            {switchCount(config)} × {fidget.switchLabel.toLowerCase()} — leveres samlet og klar til brug
          </p>
        </div>

        {/* Keyring option */}
        <label className="flex items-start gap-3 rounded-2xl border-2 p-4 cursor-pointer transition-all"
          style={{
            borderColor: keyring ? primaryColor : "#e5e7eb",
            backgroundColor: keyring ? `color-mix(in srgb, ${primaryColor} 6%, white)` : "white",
          }}
        >
          <input
            type="checkbox"
            checked={keyring}
            onChange={(e) => setKeyring(e.target.checked)}
            className="mt-0.5 w-5 h-5 shrink-0 accent-current"
            style={{ color: primaryColor }}
          />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-gray-700">
              🔑 Med nøglering
              {fidget.keyringPrice > 0 && (
                <span className="font-normal text-gray-400"> — {formatPrice(fidget.keyringPrice)}</span>
              )}
            </span>
            <span className="block text-xs text-gray-500 mt-0.5">
              Et øje i enden af kassen med en løs nøglering, så den kan hænge på nøglebundtet.
            </span>
          </span>
        </label>

        {/* Cap labels, laid out as the grid they will be printed in */}
        <div>
          <label className="text-sm font-semibold text-gray-700 mb-2 block">
            Tekst på knapperne{" "}
            <span className="font-normal text-gray-400">
              — op til {MAX_CAP_CHARS} tegn på hver. Klik i et felt for at skrive dit eget.
            </span>
          </label>
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, maxWidth: `${cols * 5.5}rem` }}
          >
            {capLabels.map((value, i) => (
              <input
                key={i}
                type="text"
                value={value}
                onChange={(e) => setLabel(i, e.target.value)}
                // Select rather than clear: typing replaces the example, but
                // clicking in and back out leaves it intact — and nobody ends up
                // typing onto the end of it. The mouseup guard is what makes it
                // stick; without it the browser drops the caret where the click
                // landed, straight after focus, and the selection is gone again.
                onFocus={(e) => e.currentTarget.select()}
                onMouseUp={(e) => e.preventDefault()}
                maxLength={MAX_CAP_CHARS}
                aria-label={`Knap ${i + 1}`}
                className="w-full px-2 py-3 rounded-xl border-2 border-gray-200 bg-white text-center text-lg font-bold uppercase text-gray-800 focus:outline-none focus:ring-2"
                style={{ "--tw-ring-color": primaryColor } as React.CSSProperties}
              />
            ))}
          </div>
        </div>

        {colourPicker("Farve på kassen", boxFilamentId, setBoxPick)}
        {colourPicker("Farve på knapperne", capFilamentId, setCapPick)}
        {colourPicker("Farve på teksten", textFilamentId, setTextPick)}

        {!validation.ok && (
          <p className="text-sm text-amber-600 font-medium">{validation.error}</p>
        )}

        {/* Price */}
        <div className="bg-gray-50 rounded-2xl p-4 text-sm text-gray-600 flex flex-col gap-1">
          <div className="flex justify-between">
            <span>Kasse, låg og samling</span>
            <span>{formatPrice(fidget.basePrice)}</span>
          </div>
          <div className="flex justify-between">
            <span>{switchCount(config)} × switch med knap</span>
            <span>{formatPrice(switchCount(config) * fidget.pricePerSwitch)}</span>
          </div>
          {keyring && fidget.keyringPrice > 0 && (
            <div className="flex justify-between">
              <span>Nøglering</span>
              <span>{formatPrice(fidget.keyringPrice)}</span>
            </div>
          )}
          <div className="border-t border-gray-200 mt-1 pt-2 flex justify-between font-bold text-base" style={{ color: primaryColor }}>
            <span>I alt</span>
            <span>{formatPrice(price)}</span>
          </div>
        </div>

        <button
          onClick={handleAddToCart}
          disabled={!canBuy}
          className="w-full py-3.5 rounded-2xl font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed text-base"
          style={{ backgroundColor: added ? "#22c55e" : primaryColor }}
        >
          {added ? "Lagt i kurv!" : `Læg i kurv — ${formatPrice(price)}`}
        </button>

        {added && (
          <Link href="/kurv" className="text-center text-sm font-medium" style={{ color: primaryColor }}>
            Se kurv →
          </Link>
        )}

        {/* Admin-only: grab the model as a print file without placing an order. */}
        {adminToken && (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
              Admin · testprint
            </p>
            <p className="text-xs text-gray-500 mb-3">
              Henter modellen præcis som den står nu — ingen ordre, kurv eller betaling.
              Knapper og kasse ligger som hvert sit objekt, så den kan sliced med
              &quot;by object&quot;.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => downloadTestFile(false)}
                disabled={testDl === "busy"}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ backgroundColor: primaryColor }}
              >
                {testDl === "busy" ? "Genererer…" : "⬇ 3MF af denne"}
              </button>
              <button
                onClick={() => downloadTestFile(true)}
                disabled={testDl === "busy"}
                className="px-4 py-2 rounded-xl text-sm font-semibold border border-gray-300 text-gray-600 bg-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ⬇ Stem-tolerance
              </button>
            </div>
            {testDl === "err" && (
              <p className="text-xs text-red-500 mt-2">
                Kunne ikke generere filen — se konsollen. Er admin-login udløbet?
              </p>
            )}
          </div>
        )}

        <div className="bg-gray-50 rounded-2xl p-4 text-sm text-gray-600 flex flex-col gap-1">
          <p>Printet i <strong>PLA</strong> på Bambu Lab X1 Carbon</p>
          <p>Rigtige Cherry MX-kompatible switches, monteret af os</p>
          <p>Tekst i egen farve, støbt ind i knappen — den kan ikke slides af</p>
        </div>
      </div>
    </div>
  );
}
