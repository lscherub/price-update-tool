import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isValidEmail } from "@/lib/calendar";
import { sendViaSmtp2go } from "@/lib/smtp2go";

export const runtime = "nodejs";

/**
 * Admin-only endpoint to send a single safe test email to an explicitly typed
 * test address so operators can verify SMTP2GO credentials & sender verification
 * before enabling REMINDER_EMAILS_ENABLED="true".
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Admin access is required to send test emails." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const testRecipient = String(body.to ?? "").trim().toLowerCase();
  if (!isValidEmail(testRecipient)) {
    return NextResponse.json({ error: "Enter a valid test recipient email address." }, { status: 400 });
  }

  const result = await sendViaSmtp2go({
    to: [testRecipient],
    subject: "Test Email: Genesis Nutrition Price Update Calendar",
    textBody: [
      "Hello,",
      "",
      "This is a test email from the Genesis Pricing Application (Price Update Calendar & Notifications).",
      "",
      `Triggered by: ${session.email}`,
      `Sent at (UTC): ${new Date().toISOString()}`,
      "",
      "If you received this email, your SMTP2GO API key and verified sender configuration are working.",
      "",
      "Genesis Nutrition",
    ].join("\n"),
    htmlBody: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:20px;border:1px solid #e2e8f0;border-radius:10px;">
      <h2 style="margin:0 0 12px;color:#0f172a;">Genesis Pricing Application — Test Email</h2>
      <p style="color:#334155;font-size:14px;line-height:1.5;">Your SMTP2GO integration is configured and accepted this test message.</p>
      <p style="color:#64748b;font-size:12px;">Triggered by ${session.email} at ${new Date().toISOString()}</p>
    </div>`,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, requestId: result.requestId ?? null },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    requestId: result.requestId,
    emailId: result.emailId,
    message: `SMTP2GO accepted the test email for ${testRecipient}.`,
  });
}
