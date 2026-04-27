import { config } from "dotenv";
import { z } from "zod";

config();

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    /** Local dev: 24+ chars. Production: validated below (32+). */
    JWT_SECRET: z.string().min(24),
    JWT_EXPIRES_IN: z.string().default("15m"),
    PORT: z.coerce.number().int().positive().default(4000),
    CORS_ORIGIN: z.string().default("*"),
    /** Public web app (Vercel) base URL; required when NODE_ENV=production. */
    APP_URL: z.preprocess(
      (v) => (v === "" || v === null || v === undefined ? undefined : v),
      z.string().url().optional()
    ),
    OWNER_BOOTSTRAP_EMAIL: z.string().email().optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    SMTP_FROM: z.preprocess(
      (v) => (v === "" || v === null || v === undefined ? undefined : v),
      z.string().email().optional()
    ),
    OCR_SPACE_API_KEY: z.string().optional(),
    CHECK_UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(8 * 1024 * 1024)
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV !== "production") return;

    if (data.CORS_ORIGIN.trim() === "*") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CORS_ORIGIN"],
        message:
          "CORS_ORIGIN cannot be * in production. Set to your Vercel URL or comma-separated HTTPS origins (e.g. https://app.vercel.app)."
      });
    }
    if (data.JWT_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["JWT_SECRET"],
        message: "JWT_SECRET must be at least 32 characters in production (use openssl rand -base64 48 or similar)."
      });
    }
    if (data.DATABASE_URL.startsWith("file:")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DATABASE_URL"],
        message: "Production requires PostgreSQL; DATABASE_URL must not be a SQLite file: URL."
      });
    }
    if (!data.APP_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["APP_URL"],
        message: "APP_URL (https://...) is required in production for consistent invite/reset and absolute URLs."
      });
    }
    const hasAnySmtp = data.SMTP_HOST || data.SMTP_PORT || data.SMTP_USER || data.SMTP_PASS || data.SMTP_FROM;
    if (hasAnySmtp) {
      if (!data.SMTP_HOST || !data.SMTP_PORT || !data.SMTP_FROM) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["SMTP_HOST"],
          message: "If SMTP is enabled, set SMTP_HOST, SMTP_PORT, SMTP_FROM, and (if required) SMTP_USER / SMTP_PASS."
        });
      }
    }
  });

export const env = envSchema.parse(process.env);
