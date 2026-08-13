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
import { DEFAULT_SETTINGS, type SiteSettings } from "./settings";
import { readJsonFile } from "./storage";

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
  const shipping = Math.max(0, order.total - itemsSubtotal);

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
  return [
    `Tak for din bestilling hos ${siteName}!`,
    ``,
    `Ordrenummer: ${order.id}`,
    `Dato: ${new Date(order.createdAt).toLocaleDateString("da-DK")}`,
    ``,
    ...lines,
    ``,
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
    const settings = { ...DEFAULT_SETTINGS, ...stored } as SiteSettings;

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
