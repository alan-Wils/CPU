import dns from "node:dns/promises";
import net from "node:net";
import nodemailer from "nodemailer";
import { env } from "../config/env.js";

/**
 * Railway/container hosts often lack working IPv6 egress; Gmail AAAA resolves first
 * can yield ENETUNREACH. Prefer a single IPv4 address and keep TLS SNI on the real hostname.
 */
async function smtpIpv4ConnectionTarget(hostname: string): Promise<{
  connectHost: string;
  tlsServername?: string;
}> {
  const name = hostname.trim();
  if (net.isIP(name)) {
    return { connectHost: name };
  }
  try {
    const { address } = await dns.lookup(name, { family: 4 });
    return { connectHost: address, tlsServername: name };
  } catch {
    console.warn(
      `[mail] Could not resolve ${name} to IPv4; using hostname (may hit IPv6 ENETUNREACH on some hosts)`
    );
    return { connectHost: name };
  }
}

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
  const { connectHost, tlsServername } = await smtpIpv4ConnectionTarget(
    String(env.SMTP_HOST),
  );

  const transporter = nodemailer.createTransport({
    host: connectHost,
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
    tls: tlsServername ? { servername: tlsServername } : undefined,
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
