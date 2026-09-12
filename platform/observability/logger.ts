/**
 * Structured logging (CLAUDE.md §19.4, §22).
 *
 * One JSON object per line, so logs are queryable rather than grepable. Every
 * entry carries a correlation ID where one is available, which is what makes an
 * asynchronous pipeline debuggable.
 *
 * NEVER log: passwords, tokens, keys, connection strings, salary figures,
 * national IDs, bank details, document contents, or whole request bodies that
 * could contain any of them. Log the entity ID, not the entity.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export type LogContext = {
  correlationId?: string;
  actorId?: string;
  module?: string;
  operation?: string;
  durationMs?: number;
  [key: string]: unknown;
};

/**
 * Keys whose values are redacted if they ever reach the logger. This is a
 * backstop for mistakes, not a licence to pass sensitive data: the rule remains
 * "do not log it".
 */
const REDACTED_KEYS = new Set([
  "password",
  "passwordconfirmation",
  "token",
  "accesstoken",
  "refreshtoken",
  "apikey",
  "secret",
  "authorization",
  "cookie",
  "servicerolekey",
  "databaseurl",
  "connectionstring",
  "salary",
  "basesalary",
  "compensation",
  "nationalid",
  "bankaccount",
  "iban",
  "ssn",
]);

const REDACTED = "[redacted]";

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    result[key] = REDACTED_KEYS.has(key.toLowerCase().replace(/[_-]/g, ""))
      ? REDACTED
      : redact(nested, depth + 1);
  }
  return result;
}

function configuredLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL;
  return raw === "debug" || raw === "info" || raw === "warn" || raw === "error"
    ? raw
    : "info";
}

function write(level: LogLevel, message: string, context: LogContext = {}): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[configuredLevel()]) return;

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(redact(context) as LogContext),
  };

  const line = JSON.stringify(entry);
  // The logger is the one place console output is permitted (see eslint.config.mjs).
  if (level === "error") process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

/**
 * Serialises an error for logging: message, name and stack, but never the
 * `context` of nested causes verbatim — those go through redaction.
 */
export function serialiseError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      stack: error.stack,
      ...(("context" in error && error.context
        ? { errorContext: redact(error.context) }
        : {}) as Record<string, unknown>),
    };
  }
  return { errorMessage: String(error) };
}

export const logger = {
  debug: (message: string, context?: LogContext) => write("debug", message, context),
  info: (message: string, context?: LogContext) => write("info", message, context),
  warn: (message: string, context?: LogContext) => write("warn", message, context),
  error: (message: string, context?: LogContext) => write("error", message, context),
};

/** Generates a correlation ID for a request, job or event chain (§22). */
export function newCorrelationId(): string {
  return crypto.randomUUID();
}
