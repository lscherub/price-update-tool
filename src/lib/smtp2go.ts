/**
 * Server-only SMTP2GO API v3 client & reminder email template generator.
 *
 * Official endpoint: POST https://api.smtp2go.com/v3/email/send
 * Authentication: X-Smtp2go-Api-Key header (strictly server-side; never logged or sent to clients).
 * Sender requirement: SMTP2GO_FROM_EMAIL must match a verified single sender or verified sender domain (SPF/DKIM).
 */
import { diffDateKeysDays, formatDateKeyLong, todayDateKeyInTimezone } from "./calendar";

export const SMTP2GO_SEND_URL = "https://api.smtp2go.com/v3/email/send";

export type Smtp2goPublicStatus = {
  apiKeyConfigured: boolean;
  fromEmailConfigured: boolean;
  fromEmail: string;
  fromName: string;
  appBaseUrl: string;
  cronSecretConfigured: boolean;
  automatedSendingEnabled: boolean;
  readyToSend: boolean;
};

export function resolveAppBaseUrl(): string {
  const explicit = process.env.APP_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelProd) {
    return vercelProd.startsWith("http") ? vercelProd.replace(/\/+$/, "") : `https://${vercelProd.replace(/\/+$/, "")}`;
  }
  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) {
    return vercelUrl.startsWith("http") ? vercelUrl.replace(/\/+$/, "") : `https://${vercelUrl.replace(/\/+$/, "")}`;
  }
  return "http://localhost:3000";
}

/** Non-secret health/configuration snapshot safe to expose to authenticated Settings UI. */
export function getSmtp2goPublicStatus(): Smtp2goPublicStatus {
  const apiKeyConfigured = Boolean(process.env.SMTP2GO_API_KEY?.trim());
  const fromEmail = process.env.SMTP2GO_FROM_EMAIL?.trim() ?? "";
  const fromName = process.env.SMTP2GO_FROM_NAME?.trim() || "Genesis Nutrition";
  const fromEmailConfigured = Boolean(fromEmail);
  const cronSecretConfigured = Boolean(process.env.CRON_SECRET?.trim());
  const automatedSendingEnabled = process.env.REMINDER_EMAILS_ENABLED?.trim().toLowerCase() === "true";

  return {
    apiKeyConfigured,
    fromEmailConfigured,
    fromEmail,
    fromName,
    appBaseUrl: resolveAppBaseUrl(),
    cronSecretConfigured,
    automatedSendingEnabled,
    readyToSend: apiKeyConfigured && fromEmailConfigured,
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type ReminderEmailInput = {
  sessionId: string;
  vendor: string;
  worksheetName: string;
  effectiveDateKey: string;
  status: string;
  reminderType: string;
  timeZone: string;
  now?: Date;
  appBaseUrl?: string;
};

export function buildReminderEmailContent(input: ReminderEmailInput): {
  subject: string;
  textBody: string;
  htmlBody: string;
  worksheetUrl: string;
} {
  const baseUrl = (input.appBaseUrl ?? resolveAppBaseUrl()).replace(/\/+$/, "");
  const worksheetUrl = `${baseUrl}/sessions/${encodeURIComponent(input.sessionId)}`;
  const vendorLabel = input.vendor.trim() || "Vendor";
  const formattedEffective = formatDateKeyLong(input.effectiveDateKey);
  const todayKey = todayDateKeyInTimezone(input.timeZone, input.now ?? new Date());
  const daysUntil = diffDateKeysDays(todayKey, input.effectiveDateKey);

  let subject: string;
  let timingSentence: string;

  if (daysUntil === 1 || input.reminderType === "ONE_DAY_BEFORE" && daysUntil === 1) {
    subject = `Reminder: ${vendorLabel} Price Update Scheduled for Tomorrow`;
    timingSentence = "This is a reminder that the following vendor price update is scheduled to take effect tomorrow.";
  } else if (daysUntil === 2) {
    subject = `Reminder: ${vendorLabel} Price Update Scheduled in 2 Days (${formattedEffective})`;
    timingSentence = `This is a reminder that the following vendor price update is scheduled to take effect in 2 days (${formattedEffective}).`;
  } else if (daysUntil === 0) {
    subject = `Reminder: ${vendorLabel} Price Update Scheduled for Today`;
    timingSentence = "This is a reminder that the following vendor price update is scheduled to take effect today.";
  } else if (daysUntil > 2) {
    subject = `Reminder: ${vendorLabel} Price Update Scheduled for ${formattedEffective}`;
    timingSentence = `This is a reminder that the following vendor price update is scheduled to take effect in ${daysUntil} days (${formattedEffective}).`;
  } else {
    subject = `Reminder: ${vendorLabel} Price Update (${formattedEffective})`;
    timingSentence = `This is a reminder regarding the following vendor price update scheduled for ${formattedEffective}.`;
  }

  const textBody = [
    "Hello,",
    "",
    timingSentence,
    "",
    `Vendor: ${vendorLabel}`,
    `Worksheet: ${input.worksheetName}`,
    `Effective Date: ${formattedEffective}`,
    `Status: ${input.status}`,
    "",
    "Please review the worksheet and prepare for the upcoming price update.",
    "",
    "Open Price Update Worksheet:",
    worksheetUrl,
    "",
    "Note: Sign-in is required to open the worksheet.",
    "",
    "Genesis Nutrition",
  ].join("\n");

  const htmlBody = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:24px;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#0f172a;">
  <div style="max-width:580px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
    <div style="background:#0f172a;color:#ffffff;padding:18px 24px;">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;font-weight:700;">Genesis Nutrition · Price Update Reminder</div>
      <h1 style="margin:6px 0 0;font-size:18px;font-weight:700;line-height:1.35;">${escapeHtml(subject)}</h1>
    </div>
    <div style="padding:24px;font-size:14px;line-height:1.6;color:#334155;">
      <p style="margin:0 0 16px;">Hello,</p>
      <p style="margin:0 0 18px;">${escapeHtml(timingSentence)}</p>
      <table style="width:100%;border-collapse:collapse;margin:0 0 20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
        <tr>
          <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#64748b;border-bottom:1px solid #e2e8f0;width:140px;">Vendor</td>
          <td style="padding:10px 14px;font-size:14px;font-weight:600;color:#0f172a;border-bottom:1px solid #e2e8f0;">${escapeHtml(vendorLabel)}</td>
        </tr>
        <tr>
          <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#64748b;border-bottom:1px solid #e2e8f0;">Worksheet</td>
          <td style="padding:10px 14px;font-size:14px;color:#0f172a;border-bottom:1px solid #e2e8f0;">${escapeHtml(input.worksheetName)}</td>
        </tr>
        <tr>
          <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#64748b;border-bottom:1px solid #e2e8f0;">Effective Date</td>
          <td style="padding:10px 14px;font-size:14px;font-weight:600;color:#0f172a;border-bottom:1px solid #e2e8f0;">${escapeHtml(formattedEffective)}</td>
        </tr>
        <tr>
          <td style="padding:10px 14px;font-size:12px;font-weight:700;color:#64748b;">Status</td>
          <td style="padding:10px 14px;font-size:14px;color:#0f172a;">${escapeHtml(input.status)}</td>
        </tr>
      </table>
      <p style="margin:0 0 20px;">Please review the worksheet and prepare for the upcoming price update.</p>
      <p style="margin:0 0 20px;">
        <a href="${escapeHtml(worksheetUrl)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:8px;">Open Price Update Worksheet</a>
      </p>
      <p style="margin:0;font-size:12px;color:#64748b;">Direct link (sign-in required): <a href="${escapeHtml(worksheetUrl)}" style="color:#4f46e5;">${escapeHtml(worksheetUrl)}</a></p>
    </div>
    <div style="padding:14px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;">
      Genesis Nutrition · Automated Price Update Calendar Notification
    </div>
  </div>
</body>
</html>`;

  return { subject, textBody, htmlBody, worksheetUrl };
}

export type Smtp2goSendResult =
  | {
      ok: true;
      requestId: string | null;
      emailId: string | null;
      succeeded: number;
    }
  | {
      ok: false;
      error: string;
      retryable: boolean;
      requestId?: string | null;
    };

export type Smtp2goSender = (params: {
  to: string[];
  subject: string;
  textBody: string;
  htmlBody: string;
}) => Promise<Smtp2goSendResult>;

/**
 * Send an email via SMTP2GO REST API v3.
 * Checks both HTTP response status and SMTP2GO `data.succeeded` / `data.failed` payload.
 */
export async function sendViaSmtp2go(
  params: {
    to: string[];
    subject: string;
    textBody: string;
    htmlBody: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<Smtp2goSendResult> {
  const apiKey = process.env.SMTP2GO_API_KEY?.trim();
  const fromEmail = process.env.SMTP2GO_FROM_EMAIL?.trim();
  const fromName = process.env.SMTP2GO_FROM_NAME?.trim() || "Genesis Nutrition";

  if (!apiKey) {
    return {
      ok: false,
      error: "SMTP2GO_API_KEY is not configured on the server.",
      retryable: false,
    };
  }
  if (!fromEmail) {
    return {
      ok: false,
      error: "SMTP2GO_FROM_EMAIL is not configured on the server.",
      retryable: false,
    };
  }
  if (!params.to.length) {
    return {
      ok: false,
      error: "No valid recipient email addresses provided.",
      retryable: false,
    };
  }

  const safeFromName = fromName.replace(/[\r\n<>"]/g, "").trim();
  const sender = safeFromName ? `${safeFromName} <${fromEmail}>` : fromEmail;

  const payload = {
    sender,
    to: params.to,
    subject: params.subject,
    text_body: params.textBody,
    html_body: params.htmlBody,
  };

  let res: Response;
  try {
    const signal =
      typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(20_000)
        : undefined;
    res = await fetchImpl(SMTP2GO_SEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Smtp2go-Api-Key": apiKey,
      },
      body: JSON.stringify(payload),
      ...(signal ? { signal } : {}),
    });
  } catch (e) {
    const errName = (e as { name?: string })?.name ?? "";
    const detail = e instanceof Error ? e.message : "Network error";
    const isTimeout = errName === "TimeoutError" || errName === "AbortError" || /timed?\s*out|aborted/i.test(detail);
    if (isTimeout) {
      return {
        ok: false,
        error:
          "SMTP2GO request timed out before a response was received. Automatic retry was skipped to avoid potential duplicate delivery — check SMTP2GO Activity logs before resending.",
        retryable: false,
      };
    }
    return {
      ok: false,
      error: `Could not reach SMTP2GO API: ${detail}`,
      retryable: true,
    };
  }

  const json = (await res.json().catch(() => null)) as {
    request_id?: string;
    data?: {
      error?: string;
      error_code?: string;
      succeeded?: number;
      failed?: number;
      failures?: unknown[];
      email_id?: string;
    };
  } | null;

  const requestId = json?.request_id ?? null;

  if (!res.ok) {
    const apiErr = json?.data?.error || `SMTP2GO HTTP ${res.status}`;
    const retryable = res.status >= 500 || res.status === 429 || res.status === 408;
    return {
      ok: false,
      error: apiErr,
      retryable,
      requestId,
    };
  }

  const succeeded = Number(json?.data?.succeeded ?? 0);
  const failed = Number(json?.data?.failed ?? 0);
  const failures = Array.isArray(json?.data?.failures) ? json!.data!.failures : [];

  if (failed > 0 || succeeded <= 0) {
    const failureText = failures.length
      ? failures.map((f) => (typeof f === "string" ? f : JSON.stringify(f))).join("; ")
      : json?.data?.error || "SMTP2GO rejected one or more recipients.";
    return {
      ok: false,
      error: `SMTP2GO reported ${failed} failure(s): ${failureText}`,
      retryable: false,
      requestId,
    };
  }

  return {
    ok: true,
    requestId,
    emailId: json?.data?.email_id ?? null,
    succeeded,
  };
}
