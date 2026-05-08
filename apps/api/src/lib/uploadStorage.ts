import "../polyfills/nodeWebCryptoGlobal.js";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { unlink } from "fs/promises";
import path from "path";
import type { Express, Request, Response } from "express";
import { env } from "../config/env.js";
import { AppError } from "../errors/AppError.js";
import { logError } from "./logger.js";

let s3Client: S3Client | null = null;

/** True when bucket + credentials are set — uploads persist across Railway/container restarts. */
export function uploadsUseS3(): boolean {
    return Boolean(
        env.S3_BUCKET?.trim() &&
            env.AWS_ACCESS_KEY_ID?.trim() &&
            env.AWS_SECRET_ACCESS_KEY?.trim()
    );
}

/**
 * Container filesystem (e.g. Railway) is wiped on redeploy. In production, refuse to write uploads to disk
 * unless S3-compatible storage is configured — otherwise every save “works” until the next deploy.
 */
export function requirePersistentUploadsInProduction(): void {
    if (env.NODE_ENV !== "production")
        return;
    if (uploadsUseS3())
        return;
    throw new AppError(
        "Upload storage is not configured on this server. Set S3_BUCKET, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY on the API service (Railway → Variables). For Cloudflare R2 add S3_ENDPOINT (and usually S3_REGION=auto). Without these, files cannot persist across deploys.",
        503,
        "UPLOAD_STORAGE_NOT_CONFIGURED"
    );
}

function getS3Client(): S3Client {
    if (!s3Client) {
        const endpoint = env.S3_ENDPOINT?.trim() || undefined;
        s3Client = new S3Client({
            region: env.S3_REGION?.trim() || "us-east-1",
            endpoint,
            credentials: {
                accessKeyId: env.AWS_ACCESS_KEY_ID!,
                secretAccessKey: env.AWS_SECRET_ACCESS_KEY!
            },
            forcePathStyle: env.S3_FORCE_PATH_STYLE === undefined ? Boolean(endpoint) : env.S3_FORCE_PATH_STYLE
        });
    }
    return s3Client;
}

export type UploadKind = "checks" | "cash-receipts" | "company-logos" | "marketplace-products";

export function parseUploadsPath(pathname: string): { kind: UploadKind; companyId: string; fileName: string } | null {
    const m = String(pathname || "").match(
        /^\/uploads\/(checks|cash-receipts|company-logos|marketplace-products)\/([^/]+)\/([^/]+)$/,
    );
    if (!m)
        return null;
    const kind = m[1] as UploadKind;
    const companyId = m[2];
    const rawName = m[3];
    const fileName = path.basename(rawName);
    if (!fileName || fileName !== rawName || rawName.includes(".."))
        return null;
    return { kind, companyId, fileName };
}

export function objectKeyFromParts(kind: UploadKind, companyId: string, fileName: string): string {
    return `${kind}/${companyId}/${fileName}`;
}

function contentTypeForExt(ext: string): string {
    if (ext === "png")
        return "image/png";
    if (ext === "webp")
        return "image/webp";
    return "image/jpeg";
}

/** Normalize AWS SDK v3 / R2 errors into a short, log-safe string. */
function readS3LikeError(err: unknown): { code: string; message: string; httpStatus?: number } {
    if (!err || typeof err !== "object") {
        return { code: "UNKNOWN", message: String(err) };
    }
    const e = err as Record<string, unknown>;
    const meta = e.$metadata as { httpStatusCode?: number } | undefined;
    const httpStatus = meta?.httpStatusCode;
    const name = typeof e.name === "string" ? e.name : "";
    const code =
        typeof e.Code === "string"
            ? e.Code
            : typeof e.code === "string"
              ? e.code
              : name || "S3Error";
    let msg = typeof e.message === "string" ? e.message : "";
    if (!msg)
        msg = "Unknown error";
    msg = msg.replace(/\s+/g, " ").trim().slice(0, 400);
    return { code, message: msg, httpStatus };
}

/**
 * Turn S3/R2 failures into {@link AppError} so clients see a useful message (not generic 500).
 */
export function toAppErrorFromS3(err: unknown, operation: string): AppError {
    const { code, message, httpStatus } = readS3LikeError(err);
    logError("s3_operation_failed", { operation, code, httpStatus, message });
    const hint =
        "Check Railway variables: S3_BUCKET, AWS_ACCESS_KEY_ID (full R2 access key id), AWS_SECRET_ACCESS_KEY, S3_ENDPOINT, S3_REGION=auto, S3_FORCE_PATH_STYLE=true. R2 token needs Object Read & Write on this bucket.";
    const status =
        httpStatus === 403 || code === "AccessDenied" || /access denied/i.test(message)
            ? 403
            : httpStatus === 404 || code === "NoSuchKey"
              ? 404
              : 502;
    return new AppError(`${operation} (${code}): ${message}. ${hint}`, status, "S3_OPERATION_FAILED", {
        code,
        httpStatus
    });
}

export async function putUploadObject(
    key: string,
    body: Buffer,
    mimeType: string
): Promise<void> {
    const bucket = env.S3_BUCKET!.trim();
    try {
        await getS3Client().send(
            new PutObjectCommand({
                Bucket: bucket,
                Key: key,
                Body: body,
                ContentType: mimeType || contentTypeForExt(path.extname(key).slice(1).toLowerCase() || "jpg")
            })
        );
    }
    catch (err: unknown) {
        throw toAppErrorFromS3(err, "Upload to object storage");
    }
}

export async function deleteUploadObject(key: string): Promise<void> {
    const bucket = env.S3_BUCKET!.trim();
    await getS3Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/**
 * Remove file backing a stored `imageUrl` (S3 or local `uploads/`).
 * Safe no-op for unknown URLs.
 */
export async function removeStoredUpload(imageUrl: string | null | undefined): Promise<void> {
    if (!imageUrl || typeof imageUrl !== "string")
        return;
    try {
        const u = new URL(imageUrl);
        const parsed = parseUploadsPath(u.pathname);
        if (!parsed)
            return;
        const key = objectKeyFromParts(parsed.kind, parsed.companyId, parsed.fileName);
        if (uploadsUseS3()) {
            await deleteUploadObject(key).catch(() => {});
            return;
        }
        const fullPath = path.join(process.cwd(), "uploads", parsed.kind, parsed.companyId, parsed.fileName);
        await unlink(fullPath).catch(() => {});
    }
    catch {
        /* invalid URL */
    }
}

async function streamS3ObjectToResponse(req: Request, res: Response, key: string): Promise<void> {
    const bucket = env.S3_BUCKET!.trim();
    const out = await getS3Client().send(
        new GetObjectCommand({
            Bucket: bucket,
            Key: key
        })
    );
    const body = out.Body;
    if (!body) {
        res.status(404).type("text/plain").send("Not found");
        return;
    }
    const ct = out.ContentType || "application/octet-stream";
    res.setHeader("Content-Type", ct);
    res.setHeader("Cache-Control", "public, max-age=3600");
    const stream = body as NodeJS.ReadableStream;
    stream.on("error", (err: unknown) => {
        logError("upload_s3_stream_error", { key, err });
        if (!res.headersSent)
            res.status(500).end();
    });
    stream.pipe(res);
}

/**
 * Register GET handlers for `/uploads/checks/...` and `/uploads/cash-receipts/...` **before** `express.static`.
 * When S3 is enabled, serves objects from the bucket; otherwise calls `next()` so disk files are served.
 */
export function registerUploadStreamRoutes(app: Express): void {
    const handler =
        (kind: UploadKind) =>
        async (req: Request, res: Response, next: (err?: unknown) => void) => {
            if (!uploadsUseS3())
                return next();
            const cid = String(req.params.companyId || "");
            const fn = String(req.params.fileName || "");
            if (!cid || !fn || path.basename(fn) !== fn || fn.includes("..")) {
                res.status(400).type("text/plain").send("Bad path");
                return;
            }
            const key = objectKeyFromParts(kind, cid, fn);
            try {
                await streamS3ObjectToResponse(req, res, key);
            }
            catch (err: unknown) {
                const meta = (err as { $metadata?: { httpStatusCode?: number }; name?: string; Code?: string })?.$metadata;
                const code = (err as { Code?: string })?.Code;
                const status = meta?.httpStatusCode;
                if (status === 404 || code === "NoSuchKey" || (err as { name?: string })?.name === "NotFound") {
                    res.status(404).type("text/plain").send("Cannot GET " + req.path);
                    return;
                }
                next(toAppErrorFromS3(err, `Read object ${key}`));
            }
        };

    app.get("/uploads/checks/:companyId/:fileName", handler("checks"));
    app.get("/uploads/cash-receipts/:companyId/:fileName", handler("cash-receipts"));
    app.get("/uploads/company-logos/:companyId/:fileName", handler("company-logos"));
    app.get("/uploads/marketplace-products/:companyId/:fileName", handler("marketplace-products"));
}
