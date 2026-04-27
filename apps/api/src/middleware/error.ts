import type { Request, Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { AppError } from "../errors/AppError.js";
import { logError } from "../lib/logger.js";

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

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = err.meta as Record<string, unknown> | undefined;
    if (err.code === "P2021" || err.code === "P2022") {
      logError("prisma_schema_mismatch", { code: err.code, meta, path: req.path });
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
    logError("prisma_client_error", { code: err.code, meta, path: req.path });
    res.status(500).json({
      error: {
        code: "DATABASE_ERROR",
        message: "A database error occurred.",
        details: { prismaCode: err.code, meta }
      },
      message: "A database error occurred."
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    logError("prisma_validation", { message: err.message, path: req.path });
    res.status(400).json({
      error: {
        code: "DATABASE_VALIDATION_ERROR",
        message: "Invalid query or data shape for the database layer."
      },
      message: "Invalid query or data shape for the database layer."
    });
    return;
  }

  logError("unhandled_error", { err, path: req.path });
  res.status(500).json({
    error: {
      code: "UNEXPECTED_SERVER_ERROR",
      message: "Unexpected server error"
    },
    message: "Unexpected server error"
  });
}
