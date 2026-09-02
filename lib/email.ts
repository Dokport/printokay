/**
 * Order-confirmation email — sent once per order, right after `finalizeOrder`
 * creates it (both from the Stripe webhook and the success-page fallback, but
 * guarded so only the FIRST caller to see the order actually sends).
 *
 * Uses Resend (https://resend.com) — no SMTP setup, good deliverability, a
 * generous free tier. Requires:
 *   RESEND_API_KEY     — from the Resend dashboard
 *   RESEND_FROM_EMAIL   — must be on a domain verified in Resend, e.g.
 *                         "printOKAY <bestilling@printokay.dk>"
 * Both are optional at runtime: if either is missing, sending is skipped (logged,
 * not thrown) so a missing/misconfigured key never blocks order fulfillment.
 */
import { Resend } from "resend";
import type { Order, OrderItem } from "./orders";
import { formatPrice } from "./products";
import type { SiteSettings } from "./settings";
import { mergeSettings } from "./settingsMerge";
import { readJsonFile } from "./storage";
import { formatPromoCode, normalizePromoCode } from "./promos";

function itemDescription(item: OrderItem): string | null {
  if (item.keyring) {
    const k = item.keyring;
    return `${k.baseFilamentName} bund, ${k.textFilamentName} tekst · ${k.config.font.replace(/-/g, " ")}`;
  }
  if (item.colorChoices?.length) {
    return item.colorChoices.map((c) => `${c.slotLabel}: ${c.filamentName}`).join(" · ");
  }
  return item.description || null;
}

function escapeHtml(s: string): string {
  return s.replace(/[<>&"']/g, (ch) =>
    ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === "&" ? "&amp;" : ch === '"' ? "&quot;" : "&#39;"
  );
}

function renderItemRow(item: OrderItem): string {
  const desc = itemDescription(item);
  const lineTotal = formatPrice(item.unitAmount * item.quantity);
  return `
    <tr>
      <td style="padding:14px 0;border-bottom:1px solid #f1f1f4;vertical-align:top;">
        <div style="font-size:28px;line-height:1;width:44px;text-align:center;">${item.emoji ?? "🖨️"}</div>
      </td>
      <td style="padding:14px 12px;border-bottom:1px solid #f1f1f4;vertical-align:top;">
        <div style="font-weight:600;color:#1f2937;font-size:15px;">${escapeHtml(item.name)}</div>
        ${desc ? `<div style="color:#6b7280;font-size:13px;margin-top:2px;">${escapeHtml(desc)}</div>` : ""}
        ${item.note ? `<div style="color:#9ca3af;font-size:12px;margin-top:2px;font-style:italic;">"${escapeHtml(item.note)}"</div>` : ""}
        <div style="color:#9ca3af;font-size:12px;margin-top:2px;">Antal: ${item.quantity}</div>
      </td>
      <td style="padding:14px 0;border-bottom:1px solid #f1f1f4;vertical-align:top;text-align:right;white-space:nowrap;">
        <div style="font-weight:600;color:#1f2937;font-size:15px;">${lineTotal}</div>
      </td>
    </tr>`;
}

function renderOrderEmailHtml(order: Order, settings: SiteSettings): string {
  const primary = settings.primaryColor || "#7c3aed";
  const siteName = settings.siteName || "printOKAY";
  const customerName = order.customer?.name?.split(" ")[0] || "der";
  const rows = order.items.map(renderItemRow).join("");
  const itemsSubtotal = order.items.reduce((s, it) => s + it.unitAmount * it.quantity, 0);
  const discount = order.promo?.discount ?? 0;
  // Items are stored at full price and the promo shown as its own line, so the
  // discount has to be added back before the remainder can be called shipping.
  const shipping = Math.max(0, order.total - itemsSubtotal + discount);

  return `<!doctype html>
<html lang="da">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Din bestilling hos ${escapeHtml(siteName)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">

          <!-- Header -->
          <tr>
            <td style="background:${primary};padding:32px 32px 28px;text-align:center;">
              <div style="font-size:32px;line-height:1;margin-bottom:8px;">${escapeHtml(settings.logoEmoji || "🖨️")}</div>
              <div style="color:#ffffff;font-size:20px;font-weight:700;">${escapeHtml(siteName)}</div>
            </td>
          </tr>

          <!-- Confirmation message -->
          <tr>
            <td style="padding:32px 32px 8px;">
              <div style="font-size:22px;font-weight:700;color:#1f2937;margin-bottom:8px;">Tak for din bestilling, ${escapeHtml(customerName)}! 🎉</div>
              <p style="color:#6b7280;font-size:14px;line-height:1.6;margin:0;">
                Vi har modtaget din betaling og går straks i gang med at printe. Herunder kan du se en oversigt over din ordre.
              </p>
            </td>
          </tr>

          <!-- Order meta -->
          <tr>
            <td style="padding:20px 32px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:12px;padding:16px;">
                <tr>
                  <td style="padding:4px 16px;font-size:13px;color:#6b7280;">Ordrenummer</td>
                  <td style="padding:4px 16px;font-size:13px;color:#1f2937;font-weight:600;text-align:right;">${escapeHtml(order.id)}</td>
                </tr>
                <tr>
                  <td style="padding:4px 16px;font-size:13px;color:#6b7280;">Dato</td>
                  <td style="padding:4px 16px;font-size:13px;color:#1f2937;font-weight:600;text-align:right;">${new Date(order.createdAt).toLocaleDateString("da-DK", { day: "numeric", month: "long", year: "numeric" })}</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Items -->
          <tr>
            <td style="padding:24px 32px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${rows}
              </table>
            </td>
          </tr>

          <!-- Totals -->
          <tr>
            <td style="padding:16px 32px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:4px 0;font-size:13px;color:#6b7280;">Varer</td>
                  <td style="padding:4px 0;font-size:13px;color:#1f2937;text-align:right;">${formatPrice(itemsSubtotal)}</td>
                </tr>
                ${discount > 0 ? `<tr>
                  <td style="padding:4px 0;font-size:13px;color:#16a34a;">Promokode ${escapeHtml(order.promo?.code ?? "")}</td>
                  <td style="padding:4px 0;font-size:13px;color:#16a34a;text-align:right;">\u2212${formatPrice(discount)}</td>
                </tr>` : ""}
                <tr>
                  <td style="padding:4px 0;font-size:13px;color:#6b7280;">Fragt</td>
                  <td style="padding:4px 0;font-size:13px;color:#1f2937;text-align:right;">${shipping > 0 ? formatPrice(shipping) : "Gratis"}</td>
                </tr>
                <tr>
                  <td style="padding:12px 0 0;font-size:16px;font-weight:700;color:#1f2937;border-top:1px solid #f1f1f4;">I alt</td>
                  <td style="padding:12px 0 0;font-size:16px;font-weight:700;color:${primary};text-align:right;border-top:1px solid #f1f1f4;">${formatPrice(order.total)}</td>
                </tr>
              </table>
            </td>
          </tr>

          ${order.customer?.address ? `
          <!-- Shipping address -->
          <tr>
            <td style="padding:24px 32px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:12px;padding:16px;">
                <tr>
                  <td style="padding:0 16px;">
                    <div style="font-size:12px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.03em;margin-bottom:6px;">Leveringsadresse</div>
                    <div style="font-size:14px;color:#1f2937;line-height:1.5;">
                      ${order.customer.name ? `${escapeHtml(order.customer.name)}<br/>` : ""}
                      ${escapeHtml(order.customer.address)}
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>` : ""}

          <!-- Delivery note -->
          ${settings.deliveryText ? `
          <tr>
            <td style="padding:24px 32px 0;">
              <p style="color:#9ca3af;font-size:12px;line-height:1.6;margin:0;white-space:pre-line;">${escapeHtml(settings.deliveryText)}</p>
            </td>
          </tr>` : ""}

          <!-- Footer -->
          <tr>
            <td style="padding:32px;text-align:center;">
              <div style="height:1px;background:#f1f1f4;margin-bottom:24px;"></div>
              <p style="color:#9ca3af;font-size:12px;margin:0 0 4px;">Spørgsmål til din ordre? Svar bare på denne mail.</p>
              <p style="color:#c4c7cf;font-size:11px;margin:12px 0 0;">${escapeHtml(settings.footerText || `${siteName} · Håndlavet 3D-print`)}</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function renderOrderEmailText(order: Order, settings: SiteSettings): string {
  const siteName = settings.siteName || "printOKAY";
  const lines = order.items.map(
    (it) => `- ${it.name} x${it.quantity} — ${formatPrice(it.unitAmount * it.quantity)}${itemDescription(it) ? ` (${itemDescription(it)})` : ""}`
  );
  const promoLine = order.promo
    ? `Promokode ${order.promo.code}: -${formatPrice(order.promo.discount)}`
    : null;
  return [
    `Tak for din bestilling hos ${siteName}!`,
    ``,
    `Ordrenummer: ${order.id}`,
    `Dato: ${new Date(order.createdAt).toLocaleDateString("da-DK")}`,
    ``,
    ...lines,
    ``,
    ...(promoLine ? [promoLine] : []),
    `I alt: ${formatPrice(order.total)}`,
    ``,
    order.customer?.address ? `Leveringsadresse:\n${order.customer.address}\n` : "",
    settings.deliveryText ?? "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Send the order-confirmation email. Never throws — a missing API key, a bad
 * address, or a Resend outage must never block order fulfillment; failures are
 * logged so they show up in Vercel's function logs.
 */
export async function sendOrderConfirmation(order: Order): Promise<void> {
  const to = order.customer?.email;
  if (!to) return; // Stripe session had no email on it — nothing to send to.

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    console.warn(`Bekræftelsesmail sprunget over for ${order.id}: RESEND_API_KEY/RESEND_FROM_EMAIL ikke sat`);
    return;
  }

  try {
    const stored = await readJsonFile<Partial<SiteSettings>>("settings.json", {});
    const settings = mergeSettings(stored);

    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from,
      to,
      replyTo: settings.aboutEmail || undefined,
      subject: `Ordrebekræftelse — ${settings.siteName || "printOKAY"} (${order.id})`,
      html: renderOrderEmailHtml(order, settings),
      text: renderOrderEmailText(order, settings),
    });
    if (error) console.error(`Resend-fejl for ordre ${order.id}:`, error);
  } catch (err) {
    console.error(`Kunne ikke sende bekræftelsesmail for ordre ${order.id}:`, err);
  }
}

/**
 * Send a promo code to a customer.
 *
 * Unlike the order confirmation, this one THROWS on failure. An order must never
 * be held up by mail trouble, but a promo code the shop believes it sent — and
 * has marked as sent — while the customer got nothing is worse than an error the
 * admin can see and act on.
 */
export async function sendPromoCodeEmail(
  code: string,
  to: string,
  expiresAt?: string
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    throw new Error("RESEND_API_KEY/RESEND_FROM_EMAIL er ikke sat — kan ikke sende mail");
  }

  const stored = await readJsonFile<Partial<SiteSettings>>("settings.json", {});
  const settings = mergeSettings(stored);
  const primary = settings.primaryColor || "#7c3aed";
  const siteName = settings.siteName || "printOKAY";
  const pretty = formatPromoCode(normalizePromoCode(code));
  const base = process.env.NEXT_PUBLIC_BASE_URL || "";
  const expiryNote = expiresAt
    ? `Koden gælder til og med ${new Date(expiresAt).toLocaleDateString("da-DK", { day: "numeric", month: "long", year: "numeric" })}.`
    : "Koden gælder indtil den er brugt.";

  const html = `<!doctype html>
<html lang="da">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Din promokode til ${escapeHtml(siteName)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
        <tr>
          <td style="background:${primary};padding:32px;text-align:center;">
            <div style="font-size:32px;line-height:1;margin-bottom:8px;">${escapeHtml(settings.logoEmoji || "🖨️")}</div>
            <div style="color:#ffffff;font-size:20px;font-weight:700;">${escapeHtml(siteName)}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 32px 8px;text-align:center;">
            <div style="font-size:22px;font-weight:700;color:#1f2937;margin-bottom:8px;">Du har fået en gratis nøglering! 🔑</div>
            <p style="color:#6b7280;font-size:14px;line-height:1.6;margin:0;">
              Design den præcis som du vil have den — navn, form, skrifttype og farver — og indtast koden i kurven.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 32px;">
            <div style="border:2px dashed ${primary};border-radius:14px;padding:20px;text-align:center;background:#faf9ff;">
              <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#6b7280;margin-bottom:8px;">Din promokode</div>
              <div style="font-size:26px;font-weight:700;letter-spacing:3px;color:${primary};font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">${escapeHtml(pretty)}</div>
            </div>
          </td>
        </tr>
        ${base ? `<tr><td style="padding:0 32px 8px;text-align:center;">
          <a href="${escapeHtml(base)}/noglering" style="display:inline-block;background:${primary};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 28px;border-radius:12px;">Design din nøglering</a>
        </td></tr>` : ""}
        <tr>
          <td style="padding:16px 32px 32px;">
            <p style="color:#9ca3af;font-size:12px;line-height:1.6;margin:0;text-align:center;">
              ${escapeHtml(expiryNote)} Den kan bruges én gang og dækker én nøglering.<br />Fragt betales som normalt — vælger du afhentning, er der intet at betale.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    `Du har fået en gratis nøglering hos ${siteName}!`,
    ``,
    `Din promokode: ${pretty}`,
    ``,
    `Design nøgleringen${base ? ` på ${base}/noglering` : ""} og indtast koden i kurven.`,
    `${expiryNote} Den kan bruges én gang og dækker én nøglering.`,
    `Fragt betales som normalt — vælger du afhentning, er der intet at betale.`,
  ].join("\n");

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to,
    replyTo: settings.aboutEmail || undefined,
    subject: `Din gratis nøglering hos ${siteName} 🔑`,
    html,
    text,
  });
  if (error) throw new Error(typeof error === "string" ? error : JSON.stringify(error));
}
