export class AppError extends Error {
  statusCode: number;
  details: unknown;
  code: string;

  constructor(message: string, statusCode = 500, code?: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code ?? `HTTP_${statusCode}`;
    this.details = details;
  }
}
