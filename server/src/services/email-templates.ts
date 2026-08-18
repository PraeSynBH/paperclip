// ---------------------------------------------------------------------------
// Email template rendering for notification emails.
//
// Produces a branded HTML email (Voyonder) with a plain-text fallback and a
// click-through action button. All HTML is built from static strings with
// explicit escaping — no template injection surface.
// ---------------------------------------------------------------------------

const BRAND_NAME = "Voyonder";

/** Escape user-controlled text for safe embedding in HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeUrl(value: string): string {
  // Only allow http(s) URLs; anything else becomes a dead link.
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return escapeHtml(parsed.toString());
    }
  } catch {
    // fall through
  }
  return "#";
}

export interface EmailTemplateContext {
  /** Display name shown in the greeting line (defaults to "there"). */
  recipientName?: string | null;
  /** Company name shown in the header/footer. */
  companyName?: string;
  /** Optional primary action button. */
  action?: { label: string; url: string };
  /** Optional secondary line under the body. */
  footerNote?: string;
}

function baseLayout(innerHtml: string, ctx: EmailTemplateContext): string {
  const companyName = escapeHtml(ctx.companyName?.trim() || "your Voyonder workspace");
  const actionHtml = ctx.action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px;"><tr><td style="border-radius:6px;background:#4f46e5;padding:10px 18px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;"><a href="${escapeUrl(ctx.action.url)}" style="color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;display:inline-block;">${escapeHtml(ctx.action.label)}</a></td></tr></table>`
    : "";
  const footerNoteHtml = ctx.footerNote
    ? `<p style="margin:16px 0 0;font-size:12px;color:#6b7280;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">${escapeHtml(ctx.footerNote)}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(ctx.action?.label ?? "Voyonder notification")}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:10px;border:1px solid #e5e7eb;overflow:hidden;">
<tr><td style="padding:20px 28px;background:#111827;">
<span style="color:#ffffff;font-size:16px;font-weight:700;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">${BRAND_NAME}</span>
</td></tr>
<tr><td style="padding:28px;">
${innerHtml}
${actionHtml}
${footerNoteHtml}
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #f3f4f6;">
<p style="margin:0;font-size:12px;color:#9ca3af;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">
You received this because an agent in <strong>${companyName}</strong> asked for your attention. You can change when these emails are sent in your notification preferences.
</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export function renderNotificationEmail(opts: {
  recipientName?: string | null;
  companyName?: string;
  title: string;
  body: string;
  linkUrl?: string | null;
}): { subject: string; text: string; html: string } {
  const greeting = opts.recipientName?.trim()
    ? `Hi ${escapeHtml(opts.recipientName.trim())},`
    : "Hi there,";
  const subject = opts.title.slice(0, 140);

  const text = [
    `${opts.title}`,
    "",
    opts.body,
    "",
    opts.linkUrl ? `Open: ${opts.linkUrl}` : null,
    "",
    `— ${BRAND_NAME}`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  const html = baseLayout(
    `
<p style="margin:0 0 16px;font-size:14px;color:#374151;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">${greeting}</p>
<h2 style="margin:0 0 12px;font-size:18px;color:#111827;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">${escapeHtml(opts.title)}</h2>
<p style="margin:0;font-size:14px;line-height:1.6;color:#374151;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;white-space:pre-wrap;">${escapeHtml(opts.body)}</p>
`,
    {
      recipientName: opts.recipientName,
      companyName: opts.companyName,
      action: opts.linkUrl
        ? { label: "Open in board", url: opts.linkUrl }
        : undefined,
      footerNote: opts.linkUrl
        ? "If the button does not work, copy this link into your browser: " + opts.linkUrl
        : undefined,
    },
  );

  return { subject, text, html };
}

export function renderDigestEmail(opts: {
  recipientName?: string | null;
  companyName?: string;
  frequency: "daily" | "weekly";
  items: Array<{ title: string; body: string; linkUrl?: string | null }>;
}): { subject: string; text: string; html: string } {
  const frequencyLabel = opts.frequency === "daily" ? "Daily" : "Weekly";
  const dateLabel = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const subject = `${frequencyLabel} summary — ${dateLabel}`;

  const itemTexts = opts.items.map(
    (item) => `• ${item.title}: ${item.body}${item.linkUrl ? ` (${item.linkUrl})` : ""}`,
  );
  const text = [
    `${frequencyLabel} summary — ${dateLabel}`,
    "",
    ...itemTexts,
    "",
    `— ${BRAND_NAME}`,
  ].join("\n");

  const itemHtml = opts.items
    .map(
      (item) => `
<tr><td style="padding:12px 0;border-bottom:1px solid #f3f4f6;">
<h3 style="margin:0 0 4px;font-size:14px;color:#111827;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">${escapeHtml(item.title)}</h3>
<p style="margin:0;font-size:13px;line-height:1.5;color:#374151;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">${escapeHtml(item.body)}</p>
${item.linkUrl ? `<p style="margin:6px 0 0;"><a href="${escapeUrl(item.linkUrl)}" style="font-size:13px;color:#4f46e5;text-decoration:none;">Open in board</a></p>` : ""}
</td></tr>`,
    )
    .join("\n");

  const html = baseLayout(
    `
<p style="margin:0 0 16px;font-size:14px;color:#374151;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">Here's what happened in <strong>${escapeHtml(opts.companyName?.trim() || "your workspace")}</strong> since your last ${opts.frequency} digest:</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${itemHtml}
</table>
`,
    {
      recipientName: opts.recipientName,
      companyName: opts.companyName,
      footerNote: "You are receiving this digest based on your notification preferences.",
    },
  );

  return { subject, text, html };
}
