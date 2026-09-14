import type { HTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Small shared primitives (CLAUDE.md §16.3), in the Modernist style: flat panels,
 * square corners, flush-left type, rules doing the organising.
 *
 * No business logic and no data access — enforced by the lint boundary on
 * components/ui.
 */

/* -------------------------------------------------------------------------- */
/* Panel                                                                      */
/* -------------------------------------------------------------------------- */

export function Panel({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("border-border bg-surface border", className)} {...props}>
      {children}
    </div>
  );
}

export function PanelHeader({
  title,
  kicker,
  description,
  actions,
}: {
  title: ReactNode;
  /** Small uppercase label above the title. */
  kicker?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="border-border flex items-start justify-between gap-4 border-b px-4 pt-3 pb-2.5">
      <div className="min-w-0">
        {kicker !== undefined && <p className="kicker text-primary-ink">{kicker}</p>}
        <h2 className="text-foreground mt-0.5 truncate text-base">{title}</h2>
        {description !== undefined && (
          <p className="text-foreground-muted mt-0.5 text-xs">{description}</p>
        )}
      </div>
      {actions !== undefined && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Badge (the design system's "tag")                                          */
/* -------------------------------------------------------------------------- */

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-sunken text-foreground-muted",
  success: "bg-success-subtle text-success",
  warning: "bg-warning-subtle text-warning",
  danger: "bg-danger-subtle text-danger",
  info: "bg-info-subtle text-info",
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
        "inline-flex items-center gap-1 px-2.5 py-0.5 text-[11px] tracking-[0.02em] whitespace-nowrap",
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
    <div className="flex flex-col gap-1">
      {/* A label always exists and is always tied to its input (§17.5). */}
      <label htmlFor={inputId} className="text-foreground-muted text-xs">
        {label}
        {required === true && (
          <span aria-hidden="true" className="text-primary ms-0.5">
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
          "bg-surface-sunken text-foreground caret-primary min-h-9 w-full border px-2.5 py-1.5 text-sm",
          "placeholder:text-foreground-subtle hover:border-foreground/45 focus-visible:border-primary focus-visible:outline-offset-0",
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
 * the action that creates one (CLAUDE.md §17.4). Flush left, per the design.
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
    <div className="flex flex-col items-start gap-1 px-4 py-9">
      <p className="text-foreground text-[15px] font-extrabold">{title}</p>
      <p className="text-foreground-muted max-w-[46ch] text-[13px]">{description}</p>
      {action !== undefined && <div className="mt-3">{action}</div>}
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
    <div className="flex flex-col items-start gap-1 px-4 py-9">
      <p className="text-danger text-[15px] font-extrabold">{title}</p>
      <p className="text-foreground-muted max-w-[56ch] text-[13px]">{message}</p>
      {traceId !== undefined && (
        <p className="text-foreground-subtle text-xs">
          Reference: <code className="font-mono">{traceId}</code>
        </p>
      )}
      {action !== undefined && <div className="mt-3">{action}</div>}
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
    <div className="flex flex-wrap items-end justify-between gap-4 pb-3.5">
      <div className="min-w-0">
        <h1 className="text-foreground text-[34px]" dir="auto">
          {title}
        </h1>
        {description !== undefined && (
          <p className="text-foreground-muted mt-1 max-w-3xl text-[12.5px]">
            {description}
          </p>
        )}
      </div>
      {actions !== undefined && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
