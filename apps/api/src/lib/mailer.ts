import nodemailer from "nodemailer";
import { env } from "../config/env.js";

function smtpFullyConfigured(): boolean {
  return Boolean(
    env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASS,
  );
}

export function inviteFromAddress(): string {
  return env.EMAIL_FROM || env.SMTP_FROM || env.SMTP_USER || "";
}

/**
 * Sends invite mail when SMTP is fully configured; otherwise logs the URL (Railway/logs).
 */
export async function sendInviteEmail(opts: {
  to: string;
  inviteUrl: string;
  companyName: string;
  role: string;
}): Promise<void> {
  const from = inviteFromAddress();

  if (!smtpFullyConfigured()) {
    console.warn(
      "[mail] SMTP incomplete (needs SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS on the API host). Invite URL:",
      opts.inviteUrl,
    );
    return;
  }

  if (!from) {
    console.warn(
      "[mail] Set EMAIL_FROM or SMTP_FROM (or SMTP_USER). Invite URL:",
      opts.inviteUrl,
    );
    return;
  }

  const secure = process.env.SMTP_SECURE?.toLowerCase() === "true";

  const port = Number(env.SMTP_PORT ?? 587);
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure,
    /** Avoid hanging requests when SMTP is blocked or TLS stalls (default can be ~minutes). */
    connectionTimeout: 12_000,
    greetingTimeout: 12_000,
    socketTimeout: 20_000,
    requireTLS: port === 587 && !secure,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  });

  try {
    await transporter.sendMail({
      from,
      to: opts.to,
      subject: `You're invited to ${opts.companyName}`,
      html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2>You were invited to ${escapeHtml(opts.companyName)}</h2>
        <p>Your role: <strong>${escapeHtml(opts.role)}</strong></p>
        <p>Accept your invite and set your password:</p>
        <p><a href="${opts.inviteUrl}">Accept invite</a></p>
        <p style="font-size: 12px; color: #666;">${escapeHtml(opts.inviteUrl)}</p>
      </div>
    `,
    });
  } finally {
    transporter.close();
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
