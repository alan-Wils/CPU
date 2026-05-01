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

const CONN_MS = Number(process.env.SMTP_CONNECTION_MS) || 28_000;
const GREET_MS = Number(process.env.SMTP_GREETING_MS) || 18_000;
const SOCK_MS = Number(process.env.SMTP_SOCKET_MS) || 45_000;

function isTcpTimeoutLike(err: unknown): boolean {
  const e = err as NodeJS.ErrnoException | undefined;
  const code = e?.code;
  const msg = String((e as Error)?.message ?? err ?? "");
  return (
    code === "ETIMEDOUT" ||
    code === "ESOCKET" ||
    /timeout|timed out/i.test(msg)
  );
}

/** smtp.gmail.com:587 is often filtered from cloud egress; :465 implicit TLS sometimes works. */
function gmailAlternateImplicitTls(profile: {
  host: string;
  port: number;
  secure: boolean;
}) {
  const h = profile.host.trim().toLowerCase();
  if (h !== "smtp.gmail.com") return null;
  if (profile.secure || profile.port !== 587) return null;
  return { port: 465, secure: true as const };
}

function explainSmtpConnectivityFailure(err: unknown): void {
  if (!isTcpTimeoutLike(err)) return;
  console.error(
    "[mail] SMTP TCP timed out — outbound 587/465 may be blocked from this host, or Gmail is delaying. " +
      "Try: SMTP_PORT=465 & SMTP_SECURE=true, or switch to an HTTP email API (Resend/SendGrid/Postmark). " +
      "Optional: SMTP_CONNECTION_MS=45000.",
  );
}

async function deliverOnce(opts: {
  from: string;
  to: string;
  html: string;
  subject: string;
  connectHost: string;
  tlsServername: string | undefined;
  port: number;
  secure: boolean;
}) {
  const transporter = nodemailer.createTransport({
    host: opts.connectHost,
    port: opts.port,
    secure: opts.secure,
    connectionTimeout: CONN_MS,
    greetingTimeout: GREET_MS,
    socketTimeout: SOCK_MS,
    requireTLS: opts.port === 587 && !opts.secure,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
    tls: opts.tlsServername ? { servername: opts.tlsServername } : undefined,
  });

  console.log(
    JSON.stringify({
      level: "info",
      event: "mail_smtp_attempt",
      ts: new Date().toISOString(),
      connectHost: opts.connectHost,
      port: opts.port,
      secure: opts.secure,
      tlsSni: opts.tlsServername ?? null,
    }),
  );

  try {
    await transporter.sendMail({
      from: opts.from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    });
  } finally {
    transporter.close();
  }
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
  const textualHost = String(env.SMTP_HOST).trim();
  const port = Number(env.SMTP_PORT ?? 587);
  const { connectHost, tlsServername } =
    await smtpIpv4ConnectionTarget(textualHost);

  const subject = `You're invited to ${opts.companyName}`;
  const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2>You were invited to ${escapeHtml(opts.companyName)}</h2>
        <p>Your role: <strong>${escapeHtml(opts.role)}</strong></p>
        <p>Accept your invite and set your password:</p>
        <p><a href="${opts.inviteUrl}">Accept invite</a></p>
        <p style="font-size: 12px; color: #666;">${escapeHtml(opts.inviteUrl)}</p>
      </div>
    `;

  const profiles: Array<{ port: number; secure: boolean }> = [
    { port, secure },
  ];
  const alt = gmailAlternateImplicitTls({
    host: textualHost,
    port,
    secure,
  });
  if (alt) profiles.push(alt);

  for (let i = 0; i < profiles.length; i++) {
    const p = profiles[i];
    try {
      await deliverOnce({
        from,
        to: opts.to,
        html,
        subject,
        connectHost,
        tlsServername,
        port: p.port,
        secure: p.secure,
      });
      return;
    } catch (err) {
      explainSmtpConnectivityFailure(err);
      const retryNext =
        i === 0 &&
        profiles.length > 1 &&
        isTcpTimeoutLike(err);
      if (retryNext) {
        console.warn(
          "[mail] Retrying SMTP with implicit TLS on port 465 (Gmail fallback).",
        );
        continue;
      }
      throw err;
    }
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
