export type ErrorCode =
  | "VALIDATION"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INSUFFICIENT_STOCK"
  | "RATE_LIMITED"
  | "INTERNAL";

/** Expected business-rule failure. Its message is safe to show to users. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;
  readonly fieldErrors?: Record<string, string>;

  constructor(
    code: ErrorCode,
    message: string,
    options: { details?: Record<string, unknown>; fieldErrors?: Record<string, string> } = {},
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = options.details;
    this.fieldErrors = options.fieldErrors;
  }
}

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: string;
      code: ErrorCode;
      fieldErrors?: Record<string, string>;
      details?: Record<string, unknown>;
    };

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export const notFound = (what: string) => new AppError("NOT_FOUND", `${what} was not found`);
