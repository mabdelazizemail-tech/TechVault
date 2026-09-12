import type { HTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Small shared primitives (CLAUDE.md §16.3).
 *
 * These contain no business logic and no data access, which is what keeps them
 * reusable across every module. Enforced by the lint boundary on components/ui.
 */

/* -------------------------------------------------------------------------- */
/* Panel                                                                      */
/* -------------------------------------------------------------------------- */

export function Panel({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "border-border bg-surface rounded-(--radius-panel) border",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function PanelHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="border-border flex items-start justify-between gap-4 border-b px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-foreground truncate text-sm font-semibold">{title}</h2>
        {description !== undefined && (
          <p className="text-foreground-muted mt-0.5 text-xs">{description}</p>
        )}
      </div>
      {actions !== undefined && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Badge                                                                      */
/* -------------------------------------------------------------------------- */

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-sunken text-foreground-muted border-border",
  success: "bg-success-subtle text-success border-success/25",
  warning: "bg-warning-subtle text-warning border-warning/25",
  danger: "bg-danger-subtle text-danger border-danger/25",
  info: "bg-info-subtle text-info border-info/25",
};

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Text input                                                                 */
/* -------------------------------------------------------------------------- */

export type TextInputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  /** Field-level error, shown next to the input it belongs to (§16.5). */
  error?: string;
  hint?: string;
};

export function TextInput({
  label,
  error,
  hint,
  id,
  className,
  required,
  ...props
}: TextInputProps) {
  const inputId = id ?? props.name ?? label.toLowerCase().replace(/\s+/g, "-");
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;

  return (
    <div className="flex flex-col gap-1.5">
      {/* A label always exists and is always tied to its input (§17.5). */}
      <label htmlFor={inputId} className="text-foreground text-xs font-medium">
        {label}
        {required === true && (
          <span aria-hidden="true" className="text-danger ms-0.5">
            *
          </span>
        )}
      </label>
      <input
        id={inputId}
        required={required}
        aria-invalid={error !== undefined || undefined}
        aria-describedby={
          [error !== undefined ? errorId : null, hint !== undefined ? hintId : null]
            .filter(Boolean)
            .join(" ") || undefined
        }
        className={cn(
          "bg-surface text-foreground h-9 rounded-(--radius-control) border px-3 text-sm",
          "placeholder:text-foreground-subtle",
          error !== undefined ? "border-danger" : "border-border-strong",
          className,
        )}
        {...props}
      />
      {hint !== undefined && (
        <p id={hintId} className="text-foreground-subtle text-xs">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={errorId} className="text-danger text-xs" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Empty / error states                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Every list needs a real empty state explaining what the thing is and offering
 * the action that creates one (CLAUDE.md §17.4).
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <p className="text-foreground text-sm font-medium">{title}</p>
      <p className="text-foreground-muted max-w-sm text-xs">{description}</p>
      {action !== undefined && <div className="mt-2">{action}</div>}
    </div>
  );
}

/**
 * A user-safe error surface: a message, an action, and a trace ID for support.
 * Never renders a stack trace or a raw database error (CLAUDE.md §16.6).
 */
export function ErrorState({
  title = "Something went wrong",
  message,
  traceId,
  action,
}: {
  title?: string;
  message: string;
  traceId?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <p className="text-danger text-sm font-semibold">{title}</p>
      <p className="text-foreground-muted max-w-md text-xs">{message}</p>
      {traceId !== undefined && (
        <p className="text-foreground-subtle text-xs">
          Reference: <code className="font-mono">{traceId}</code>
        </p>
      )}
      {action !== undefined && <div className="mt-2">{action}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Page header                                                                */
/* -------------------------------------------------------------------------- */

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 pb-4">
      <div className="min-w-0">
        <h1 className="text-foreground text-lg font-semibold tracking-tight">{title}</h1>
        {description !== undefined && (
          <p className="text-foreground-muted mt-1 max-w-2xl text-sm">{description}</p>
        )}
      </div>
      {actions !== undefined && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}
