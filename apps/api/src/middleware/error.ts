import type { Request, Response, NextFunction } from "express";
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

  logError("unhandled_error", { err, path: req.path });
  res.status(500).json({
    error: {
      code: "UNEXPECTED_SERVER_ERROR",
      message: "Unexpected server error"
    },
    message: "Unexpected server error"
  });
}
