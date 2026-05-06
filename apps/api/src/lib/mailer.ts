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

function resendConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY?.trim());
}

/** Hide mailbox in logs; supports `noreply@dom` or `Name <noreply@dom>`. */
function maskFromForLog(raw: string): string {
  const t = raw.trim();
  const angled = /<([^>]+)>\s*$/.exec(t);
  const mailbox = angled ? angled[1].trim() : t.trim();
  const at = mailbox.indexOf("@");
  if (at < 1) return "***";
  return `${mailbox.slice(0, 1)}***${mailbox.slice(at)}`;
}

function resendSmtpFallbackEnabled(): boolean {
  return process.env.RESEND_FALLBACK_SMTP?.toLowerCase() !== "false";
}

/**
 * Resend 4xx means misconfiguration (domain/key/from), not egress — SMTP will not fix it on PaaS
 * and often burns ~60s on blocked Gmail ports. Skip unless overridden.
 */
function shouldRetrySmtpAfterResendError(err: unknown): boolean {
  if (process.env.RESEND_SMTP_AFTER_RESEND_4XX?.toLowerCase() === "true") {
    return true;
  }
  const msg = String(err instanceof Error ? err.message : err);
  return !/^Resend HTTP 4\d\d/.test(msg);
}

function parseResendErrorHint(bodyText: string): string | undefined {
  try {
    const j = JSON.parse(bodyText) as { message?: string; name?: string };
    const m =
      typeof j.message === "string" ? j.message : undefined;
    if (m) return m;
    if (typeof j.name === "string") return j.name;
  } catch {
    /* not JSON */
  }
  return undefined;
}

/** Outbound SMTP is often blocked on PaaS; Resend uses HTTPS (port 443). */
async function sendInviteViaResend(payload: {
  from: string;
  to: string;
  html: string;
  subject: string;
}): Promise<void> {
  const key = env.RESEND_API_KEY!.trim();
  const abortMs =
    Number(process.env.RESEND_TIMEOUT_MS) > 0
      ? Number(process.env.RESEND_TIMEOUT_MS)
      : 30_000;

  console.log(
    JSON.stringify({
      level: "info",
      event: "mail_resend_attempt",
      ts: new Date().toISOString(),
      to: payload.to,
      fromMasked: maskFromForLog(payload.from),
    }),
  );

  const ctl = new AbortController();
  const timer = setTimeout(
    () => ctl.abort(new Error(`Resend request timeout (${abortMs}ms)`)),
    abortMs,
  );
  let res: Response;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: payload.from,
        to: [payload.to],
        subject: payload.subject,
        html: payload.html,
      }),
      signal: ctl.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const bodyText = await res.text();
  if (!res.ok) {
    const hint = parseResendErrorHint(bodyText);
    console.error(
      JSON.stringify({
        level: "error",
        event: "mail_resend_failed",
        ts: new Date().toISOString(),
        httpStatus: res.status,
        resendHint: hint ?? null,
        bodySnippet: bodyText.slice(0, 800),
      }),
    );
    throw new Error(
      `Resend HTTP ${res.status}${hint ? `: ${hint}` : `: ${bodyText.slice(0, 500)}`}`,
    );
  }
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
      "Set RESEND_API_KEY + RESEND_FROM (HTTPS), or try SMTP_PORT=465 & SMTP_SECURE=true. " +
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
 * Generic HTML email (digests, etc.) — same Resend / SMTP stack as invites.
 */
export async function sendHtmlEmail(opts: {
  to: string;
  subject: string;
  html: string;
  /** Shown in logs when transports are misconfigured (e.g. invite URL). */
  logContext?: string;
}): Promise<void> {
  const ref = opts.logContext || opts.to;

  if (resendConfigured()) {
    const resendFrom =
      env.RESEND_FROM?.trim() ||
      inviteFromAddress();
    if (!resendFrom) {
      console.warn(
        "[mail] RESEND_API_KEY set but need RESEND_FROM or EMAIL_FROM / SMTP_FROM. Context:",
        ref,
      );
    } else {
      try {
        await sendInviteViaResend({
          from: resendFrom,
          to: opts.to,
          subject: opts.subject,
          html: opts.html,
        });
        console.log("[mail] HTML email sent via Resend to", opts.to);
        return;
      } catch (err) {
        console.error(
          "[mail] Resend send failed; will try SMTP if configured:",
          err,
        );
        if (!resendSmtpFallbackEnabled()) {
          console.warn(
            "[mail] SMTP fallback disabled (RESEND_FALLBACK_SMTP=false); fix Resend/domain or unset this. Context:",
            ref,
          );
          throw new Error("Resend failed and SMTP fallback is disabled.");
        }
        if (!shouldRetrySmtpAfterResendError(err)) {
          console.warn(
            "[mail] Skipping SMTP after Resend 4xx — fix domain/key/from in Resend (set RESEND_SMTP_AFTER_RESEND_4XX=true to force SMTP). Context:",
            ref,
          );
          throw err instanceof Error ? err : new Error(String(err));
        }
      }
    }
  }

  const from = inviteFromAddress();

  if (!smtpFullyConfigured()) {
    console.warn(
      "[mail] No email transport: set RESEND_API_KEY + RESEND_FROM, or SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS. Context:",
      ref,
    );
    throw new Error("No email transport configured.");
  }

  if (!from) {
    console.warn(
      "[mail] Set EMAIL_FROM or SMTP_FROM (or SMTP_USER). Context:",
      ref,
    );
    throw new Error("Email sender address is not configured.");
  }

  const secure = process.env.SMTP_SECURE?.toLowerCase() === "true";
  const textualHost = String(env.SMTP_HOST).trim();
  const port = Number(env.SMTP_PORT ?? 587);
  const { connectHost, tlsServername } =
    await smtpIpv4ConnectionTarget(textualHost);

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
        html: opts.html,
        subject: opts.subject,
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

/**
 * Sends invite mail via Resend (HTTPS) when configured, else SMTP when fully configured;
 * otherwise logs the invite URL for operators.
 */
export async function sendPasswordResetEmail(opts: {
  to: string;
  resetUrl: string;
}): Promise<void> {
  const subject = "Reset your NexBatch password";
  const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2>Password reset</h2>
        <p>Someone requested a password reset for your account. Use the link below to choose a new password.</p>
        <p>This link expires in about one hour.</p>
        <p><a href="${opts.resetUrl}">Reset password</a></p>
        <p style="font-size: 12px; color: #666;">${escapeHtml(opts.resetUrl)}</p>
        <p style="font-size: 12px; color: #666;">If you did not request this, you can ignore this email.</p>
      </div>
    `;

  await sendHtmlEmail({
    to: opts.to,
    subject,
    html,
    logContext: opts.resetUrl,
  });
}

export async function sendInviteEmail(opts: {
  to: string;
  inviteUrl: string;
  companyName: string;
  role: string;
}): Promise<void> {
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

  await sendHtmlEmail({
    to: opts.to,
    subject,
    html,
    logContext: opts.inviteUrl,
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
