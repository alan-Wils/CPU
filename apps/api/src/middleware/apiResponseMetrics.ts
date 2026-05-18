import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { logInfo } from "../lib/logger.js";
import { getScopedCompanyId, type JwtAuthPayload } from "./companyScope.js";

type Sample = {
    path: string;
    bytes: number;
    ms: number;
    status: number;
    companyKey: string;
};

const recentSamples: Sample[] = [];
const RECENT_CAP = 400;
let sampleCounter = 0;

function companyKeyForLog(req: Request): string {
    const id = getScopedCompanyId(req as Request & { auth?: JwtAuthPayload });
    if (!id)
        return "(none)";
    if (id.length <= 10)
        return "(short)";
    return `${id.slice(0, 8)}…`;
}

function recordSample(sample: Sample) {
    if (!env.API_TRANSFER_METRICS)
        return;
    recentSamples.push(sample);
    if (recentSamples.length > RECENT_CAP)
        recentSamples.splice(0, recentSamples.length - RECENT_CAP);
    sampleCounter++;
    if (sampleCounter % 120 !== 0)
        return;
    const top = [...recentSamples].sort((a, b) => b.bytes - a.bytes).slice(0, 10);
    logInfo("api_transfer_top10_recent_window", {
        windowSize: recentSamples.length,
        top: top.map((t) => ({
            path: t.path,
            bytes: t.bytes,
            ms: t.ms,
            status: t.status,
            companyKey: t.companyKey,
        })),
    });
}

/**
 * Measures JSON bodies passed to `res.json` (pre-compression size) and optional production metrics.
 */
export function apiResponseMetricsMiddleware(req: Request, res: Response, next: NextFunction): void {
    const started = Date.now();
    const routePath = `${req.baseUrl || ""}${req.path || ""}`.replace(/\/+/g, "/") || req.path || "";
    const origJson = res.json.bind(res);

    res.json = function patchedJson(body: unknown) {
        let bytes = 0;
        try {
            bytes = Buffer.byteLength(JSON.stringify(body), "utf8");
        }
        catch {
            bytes = 0;
        }
        const ms = Date.now() - started;
        const status = res.statusCode;
        const ck = companyKeyForLog(req);
        const methodPath = `${String(req.method || "GET").toUpperCase()} ${routePath}`;

        if (env.NODE_ENV === "development" && bytes >= 20_000) {
            logInfo("api_response_size_dev", {
                path: methodPath,
                bytes,
                ms,
                status,
                companyKey: ck,
            });
        }

        if (ms >= 500 || bytes >= 75_000) {
            logInfo("api_slow_or_large_response", {
                path: methodPath,
                bytes,
                ms,
                status,
                companyKey: ck,
            });
        }

        if (env.API_TRANSFER_METRICS && (bytes >= 25_000 || ms >= 2000)) {
            logInfo("api_transfer_sample", {
                path: methodPath,
                bytes,
                ms,
                status,
                companyKey: ck,
            });
        }

        recordSample({
            path: methodPath,
            bytes,
            ms,
            status,
            companyKey: ck,
        });

        return origJson(body);
    };

    next();
}
