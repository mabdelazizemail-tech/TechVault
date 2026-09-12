/**
 * Typed domain errors (CLAUDE.md §19.3).
 *
 * Services throw these; the API and UI layers map them to status codes and
 * user-facing messages in exactly one place. The `message` on every error must
 * be safe to show a user — diagnostic detail belongs in `context`, which is
 * logged but never returned to a client.
 */

export type ErrorCode =
  | "VALIDATION_FAILED"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "BUSINESS_RULE_VIOLATION"
  | "RATE_LIMITED"
  | "INTERNAL";

export abstract class AppError extends Error {
  abstract readonly code: ErrorCode;
  abstract readonly httpStatus: number;

  /** Extra detail for logs. Never serialised to a client response. */
  readonly context: Record<string, unknown>;

  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
    this.context = context;
  }
}

export class ValidationError extends AppError {
  readonly code = "VALIDATION_FAILED" as const;
  readonly httpStatus = 400;

  /** Field-level messages, safe to display next to the offending inputs. */
  readonly fieldErrors: Record<string, string[]>;

  constructor(
    message = "The submitted data is not valid.",
    fieldErrors: Record<string, string[]> = {},
  ) {
    super(message);
    this.fieldErrors = fieldErrors;
  }
}

export class UnauthenticatedError extends AppError {
  readonly code = "UNAUTHENTICATED" as const;
  readonly httpStatus = 401;

  constructor(message = "You must sign in to continue.") {
    super(message);
  }
}

/**
 * The principal is known but not permitted.
 *
 * Use this when the user may legitimately know the resource exists. When
 * revealing existence is itself a disclosure, throw `NotFoundError` instead
 * (CLAUDE.md §11.6).
 */
export class ForbiddenError extends AppError {
  readonly code = "FORBIDDEN" as const;
  readonly httpStatus = 403;

  constructor(
    message = "You do not have permission to perform this action.",
    context: Record<string, unknown> = {},
  ) {
    super(message, context);
  }
}

export class NotFoundError extends AppError {
  readonly code = "NOT_FOUND" as const;
  readonly httpStatus = 404;

  constructor(entity = "record", context: Record<string, unknown> = {}) {
    super(`The requested ${entity} was not found.`, context);
  }
}

export class ConflictError extends AppError {
  readonly code = "CONFLICT" as const;
  readonly httpStatus = 409;
}

/** A request that is well-formed and permitted but breaks a business rule. */
export class BusinessRuleError extends AppError {
  readonly code = "BUSINESS_RULE_VIOLATION" as const;
  readonly httpStatus = 422;
}

export class RateLimitedError extends AppError {
  readonly code = "RATE_LIMITED" as const;
  readonly httpStatus = 429;

  constructor(message = "Too many requests. Please try again shortly.") {
    super(message);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * A client-safe view of an error.
 *
 * Anything that is not an `AppError` is reported as a generic internal error:
 * an unexpected exception's message may contain a connection string, a SQL
 * fragment or a row of data, and must never reach a client (CLAUDE.md §19.3).
 */
export function toClientError(
  error: unknown,
  traceId: string,
): {
  code: ErrorCode;
  message: string;
  fieldErrors?: Record<string, string[]>;
  traceId: string;
} {
  if (isAppError(error)) {
    return {
      code: error.code,
      message: error.message,
      ...(error instanceof ValidationError && Object.keys(error.fieldErrors).length > 0
        ? { fieldErrors: error.fieldErrors }
        : {}),
      traceId,
    };
  }

  return {
    code: "INTERNAL",
    message: "Something went wrong. Please try again or contact support.",
    traceId,
  };
}

export function httpStatusFor(error: unknown): number {
  return isAppError(error) ? error.httpStatus : 500;
}
