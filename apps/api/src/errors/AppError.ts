export class AppError extends Error {
  public readonly statusCode: number;
  public readonly details?: unknown;
  public readonly code: string;

  constructor(message: string, statusCode = 500, details?: unknown, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.code = code || `HTTP_${statusCode}`;
  }
}
