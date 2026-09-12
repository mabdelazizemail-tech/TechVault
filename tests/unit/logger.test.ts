import { describe, expect, it } from "vitest";
import { serialiseError } from "@/platform/observability/logger";
import { ForbiddenError, ValidationError, toClientError } from "@/lib/errors";

describe("serialiseError", () => {
  it("captures an error's name, message and stack", () => {
    const serialised = serialiseError(new Error("boom"));
    expect(serialised.errorName).toBe("Error");
    expect(serialised.errorMessage).toBe("boom");
    expect(serialised.stack).toBeDefined();
  });

  it("redacts sensitive keys from an AppError's context", () => {
    const serialised = serialiseError(
      new ForbiddenError("nope", { permission: "hris.salary.read", token: "abc123" }),
    );
    const asText = JSON.stringify(serialised);
    expect(asText).toContain("hris.salary.read");
    expect(asText).not.toContain("abc123");
  });

  it("handles a non-Error value", () => {
    expect(serialiseError("just a string")).toEqual({ errorMessage: "just a string" });
  });
});

describe("toClientError", () => {
  it("passes through a domain error's safe message and code", () => {
    const result = toClientError(new ForbiddenError(), "trace-1");
    expect(result.code).toBe("FORBIDDEN");
    expect(result.message).toMatch(/permission/i);
    expect(result.traceId).toBe("trace-1");
  });

  it("includes field errors for a validation failure", () => {
    const result = toClientError(
      new ValidationError("Invalid", { email: ["Enter a valid address."] }),
      "trace-2",
    );
    expect(result.fieldErrors).toEqual({ email: ["Enter a valid address."] });
  });

  it("never leaks an unexpected error's message to the client", () => {
    // An unexpected exception may contain a connection string, a SQL fragment or a
    // row of data (CLAUDE.md §19.3).
    const result = toClientError(
      new Error("connection to postgres://user:hunter2@db failed"),
      "trace-3",
    );
    expect(result.code).toBe("INTERNAL");
    expect(result.message).not.toContain("postgres");
    expect(result.message).not.toContain("hunter2");
    expect(result.traceId).toBe("trace-3");
  });
});
