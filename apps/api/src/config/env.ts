import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** `npm run dev` runs with cwd `apps/api`; load repo-root env like the legacy backend. */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.resolve(__dirname, "../../../..");
config({ path: path.join(monorepoRoot, ".env") });
config({ path: path.join(monorepoRoot, ".env.local"), override: true });
const envSchema = z
    .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    /** Local dev: 24+ chars. Production: validated below (32+). */
    JWT_SECRET: z.string().min(24),
    JWT_EXPIRES_IN: z.string().default("15m"),
    PORT: z.coerce.number().int().positive().default(4000),
    CORS_ORIGIN: z.string().default("*"),
    /** Browser app origin for pages like /accept-invite — not the Railway API hostname. Required in production. */
    APP_URL: z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : v), z.string().url().optional()),
    OWNER_BOOTSTRAP_EMAIL: z.string().email().optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().optional(),
    SMTP_USER: z.string().optional(),
    /** Gmail app passwords are sometimes pasted with spaces; strip for auth. */
    SMTP_PASS: z.preprocess((v) => (typeof v === "string" ? v.replace(/\s+/g, "") : v), z.string().optional()),
    EMAIL_FROM: z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : v), z.string().email().optional()),
    SMTP_FROM: z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : v), z.string().email().optional()),
    /** HTTPS API (works on hosts that block SMTP egress, e.g. some Railway plans). */
    RESEND_API_KEY: z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().optional()),
    /** Resend `from`: plain email or `Name <email@domain>` (Zod `.email()` rejects the latter). */
    RESEND_FROM: z.preprocess(
        (v) => (v === "" || v === null || v === undefined ? undefined : String(v).trim()),
        z
            .union([
                z.undefined(),
                z
                    .string()
                    .max(320)
                    .refine((val) => {
                        const m = /<([^>]+)>\s*$/.exec(val.trim());
                        const addr = (m ? m[1] : val).trim();
                        return z.string().email().safeParse(addr).success;
                    }, "RESEND_FROM must be a valid email or Name <email>"),
            ]),
    ),
    OCR_SPACE_API_KEY: z.string().optional(),
    CHECK_UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(8 * 1024 * 1024),
    /**
     * S3-compatible object storage (Railway, R2, AWS). When all bucket + credentials are set,
     * check/cash receipt uploads use the bucket instead of ephemeral local disk.
     */
    /** Trim — pasted Railway values often include trailing newlines, which break S3/R2 request signatures. */
    S3_BUCKET: z.preprocess((v) => {
        if (typeof v !== "string")
            return undefined;
        const t = v.trim();
        return t === "" ? undefined : t;
    }, z.string().min(1).optional()),
    AWS_ACCESS_KEY_ID: z.preprocess((v) => {
        if (typeof v !== "string")
            return undefined;
        const t = v.trim();
        return t === "" ? undefined : t;
    }, z.string().optional()),
    AWS_SECRET_ACCESS_KEY: z.preprocess((v) => {
        if (typeof v !== "string")
            return undefined;
        const t = v.trim();
        return t === "" ? undefined : t;
    }, z.string().optional()),
    S3_REGION: z.preprocess((v) => {
        if (typeof v !== "string")
            return undefined;
        const t = v.trim();
        return t === "" ? undefined : t;
    }, z.string().min(1).optional()),
    S3_ENDPOINT: z.preprocess((v) => {
        if (typeof v !== "string")
            return undefined;
        const t = v.trim();
        return t === "" ? undefined : t;
    }, z.string().url().optional()),
    /** Some providers (e.g. MinIO, R2) need path-style addressing. Default: true when `S3_ENDPOINT` is set. */
    S3_FORCE_PATH_STYLE: z.preprocess((v) => {
        if (v === undefined || v === null || v === "")
            return undefined;
        if (typeof v === "boolean")
            return v;
        const s = String(v).trim().toLowerCase();
        if (s === "true" || s === "1" || s === "yes")
            return true;
        if (s === "false" || s === "0" || s === "no")
            return false;
        return undefined;
    }, z.boolean().optional())
})
    .superRefine((data, ctx) => {
    if (data.NODE_ENV !== "production")
        return;
    if (data.CORS_ORIGIN.trim() === "*") {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["CORS_ORIGIN"],
            message: "CORS_ORIGIN cannot be * in production. Set to your Vercel URL or comma-separated HTTPS origins (e.g. https://app.vercel.app)."
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
    const hasAnySmtp =
        data.SMTP_HOST ||
        data.SMTP_PORT ||
        data.SMTP_USER ||
        data.SMTP_PASS ||
        data.SMTP_FROM ||
        data.EMAIL_FROM;
    if (hasAnySmtp) {
        const hasFrom = Boolean(data.SMTP_FROM || data.EMAIL_FROM);
        if (!data.SMTP_HOST || !data.SMTP_PORT || !hasFrom) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["SMTP_HOST"],
                message: "If SMTP is enabled, set SMTP_HOST, SMTP_PORT, SMTP_FROM or EMAIL_FROM, and SMTP_USER/SMTP_PASS for authenticated SMTP."
            });
        }
    }
    const s3Fields = [data.S3_BUCKET, data.AWS_ACCESS_KEY_ID, data.AWS_SECRET_ACCESS_KEY].filter(Boolean).length;
    if (s3Fields > 0 && s3Fields < 3) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["S3_BUCKET"],
            message: "For persistent uploads, set all of S3_BUCKET, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY (optional: S3_ENDPOINT, S3_REGION, S3_FORCE_PATH_STYLE). Omit all to use local disk only."
        });
    }
});
export const env = envSchema.parse(process.env);
