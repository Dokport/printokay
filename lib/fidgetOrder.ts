/**
 * Rebuild a fidget's 3MF from what an order recorded.
 *
 * Shared by the admin download and the Bambuddy sync so the two can never drift.
 * Nothing is cached: the file is made from the stored configuration each time, and
 * therefore always carries the current geometry and the calibrated stem width.
 */
import { generateFidget3mf } from "./fidget3mf";
import { loadPricing } from "./pricing";
import type { OrderItemFidget } from "./orders";

export async function buildFidget3mfFor(fidget: OrderItemFidget): Promise<Buffer> {
  let crossWidthMm: number | undefined;
  try {
    crossWidthMm = (await loadPricing()).settings.fidget?.crossWidthMm;
  } catch {
    // Settings unreadable — the built-in default is still a printable slot.
  }

  const { file } = generateFidget3mf(
    {
      cols: fidget.cols,
      rows: fidget.rows,
      labels: fidget.labels,
      keyring: fidget.keyring,
      boxFilamentId: "", capFilamentId: "", textFilamentId: "",
    },
    { box: fidget.boxColorHex, cap: fidget.capColorHex, text: fidget.textColorHex },
    crossWidthMm
  );
  return file;
}

/** A filename a human can recognise in a downloads folder. */
export function fidgetFileName(fidget: OrderItemFidget): string {
  const written = fidget.labels.filter(Boolean).join("-").replace(/[^A-Za-z0-9ÆØÅæøå-]/g, "_");
  return `${fidget.fileId}_${fidget.cols}x${fidget.rows}${written ? `_${written}` : ""}.3mf`.slice(0, 100);
}
