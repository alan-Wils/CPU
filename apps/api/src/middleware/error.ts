import type { Request, Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { AppError } from "../errors/AppError.js";
import { logError } from "../lib/logger.js";

/** `instanceof` can fail if multiple @prisma/client copies exist; fall back to constructor name + shape. */
function readPrismaKnownRequest(err: unknown): { code: string; meta?: Record<string, unknown> } | null {
  if (typeof err !== "object" || err === null) return null;
  const ctor = (err as object).constructor?.name;
  const isKnownCtor = ctor === "PrismaClientKnownRequestError";
  if (!isKnownCtor && !(err instanceof Prisma.PrismaClientKnownRequestError)) return null;
  const code = (err as { code?: unknown }).code;
  if (typeof code !== "string" || !/^P[0-9]{4}$/.test(code)) return null;
  const meta = (err as { meta?: unknown }).meta;
  return {
    code,
    meta: typeof meta === "object" && meta !== null ? (meta as Record<string, unknown>) : undefined
  };
}

function readPrismaValidation(err: unknown): string | null {
  if (typeof err !== "object" || err === null) return null;
  const ctor = (err as object).constructor?.name;
  if (ctor !== "PrismaClientValidationError" && !(err instanceof Prisma.PrismaClientValidationError)) return null;
  const msg = (err as { message?: unknown }).message;
  return typeof msg === "string" ? msg : null;
}

function readPrismaInitialization(err: unknown): string | null {
  if (typeof err !== "object" || err === null) return null;
  const ctor = (err as object).constructor?.name;
  if (ctor !== "PrismaClientInitializationError") return null;
  const msg = (err as { message?: unknown }).message;
  return typeof msg === "string" ? msg : null;
}

function readPrismaUnknownRequest(err: unknown): string | null {
  if (typeof err !== "object" || err === null) return null;
  const ctor = (err as object).constructor?.name;
  if (ctor !== "PrismaClientUnknownRequestError" && !(err instanceof Prisma.PrismaClientUnknownRequestError)) {
    return null;
  }
  const msg = (err as { message?: unknown }).message;
  return typeof msg === "string" ? msg : null;
}

function logSerializedError(event: string, err: unknown, path: string): void {
  if (err instanceof Error) {
    logError(event, { path, name: err.name, message: err.message, stack: err.stack });
    return;
  }
  logError(event, { path, err: String(err) });
}

export function errorMiddleware(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_FAILED",
        message: "Validation failed",
        details: err.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))
      },
      message: "Validation failed",
      errors: err.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))
    });
    return;
  }

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logError("app_error", { message: err.message, details: err.details, path: req.path });
    }

    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details ?? undefined
      },
      message: err.message,
      details: err.details ?? undefined
    });
    return;
  }

  const prismaKnown = readPrismaKnownRequest(err);
  if (prismaKnown) {
    const { code, meta } = prismaKnown;
    if (code === "P2021" || code === "P2022") {
      logError("prisma_schema_mismatch", { code, meta, path: req.path });
      res.status(503).json({
        error: {
          code: "DATABASE_SCHEMA_MISMATCH",
          message:
            "The database is missing a table or column for this API version. Run: npx prisma migrate deploy --schema=prisma/schema.postgresql.prisma (with DATABASE_URL set).",
          details: meta
        },
        message: "Database schema is out of date."
      });
      return;
    }
    logError("prisma_client_error", { code, meta, path: req.path });
    res.status(500).json({
      error: {
        code: "DATABASE_ERROR",
        message: "A database error occurred.",
        details: { prismaCode: code, meta }
      },
      message: "A database error occurred."
    });
    return;
  }

  const prismaValidationMsg = readPrismaValidation(err);
  if (prismaValidationMsg !== null) {
    logError("prisma_validation", { message: prismaValidationMsg, path: req.path });
    res.status(400).json({
      error: {
        code: "DATABASE_VALIDATION_ERROR",
        message: "Invalid query or data shape for the database layer."
      },
      message: "Invalid query or data shape for the database layer."
    });
    return;
  }

  const prismaInitMsg = readPrismaInitialization(err);
  if (prismaInitMsg !== null) {
    logSerializedError("prisma_init_error", err, req.path);
    res.status(503).json({
      error: {
        code: "DATABASE_UNAVAILABLE",
        message: "Could not connect to the database. Check DATABASE_URL and pooler settings."
      },
      message: "Could not connect to the database."
    });
    return;
  }

  const prismaUnknownMsg = readPrismaUnknownRequest(err);
  if (prismaUnknownMsg !== null) {
    logSerializedError("prisma_unknown_request", err, req.path);
    res.status(503).json({
      error: {
        code: "DATABASE_QUERY_ERROR",
        message:
          "The database rejected a query (often connection pool / prepared-statement limits with Neon + PgBouncer). Try a direct (non-pooler) DATABASE_URL for the API, or add prisma:// / connection string params per Prisma + Neon docs.",
        details: { hint: prismaUnknownMsg.slice(0, 500) }
      },
      message: "Database query error."
    });
    return;
  }

  logSerializedError("unhandled_error", err, req.path);
  res.status(500).json({
    error: {
      code: "UNEXPECTED_SERVER_ERROR",
      message: "Unexpected server error"
    },
    message: "Unexpected server error"
  });
}
