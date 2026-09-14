import type { HTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Small shared primitives (CLAUDE.md §16.3): bordered panels, square corners,
 * 2px rules, small uppercase labels.
 *
 * No business logic and no data access — enforced by the lint boundary on
 * components/ui.
 */

/* -------------------------------------------------------------------------- */
/* Panel                                                                      */
/* -------------------------------------------------------------------------- */

export function Panel({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("panel", className)} {...props}>
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
    <div className="rule-b flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        {kicker !== undefined && <p className="label-caps">{kicker}</p>}
        <h2 className="text-foreground truncate text-sm font-bold tracking-tight uppercase">
          {title}
        </h2>
        {description !== undefined && (
          <p className="text-foreground-muted mt-0.5 text-xs">{description}</p>
        )}
      </div>
      {actions !== undefined && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Badge (the design system's "tag")                                          */
/* -------------------------------------------------------------------------- */

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

/** The outline stays neutral; the tone colours the label, which always says it. */
const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "text-foreground",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
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
        "border-border inline-flex items-center gap-1 border-2 px-2 py-0.5 text-[11px] font-bold tracking-wide whitespace-nowrap uppercase",
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
      <label htmlFor={inputId} className="text-foreground text-xs font-semibold">
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
          "bg-surface text-foreground min-h-10 w-full border-2 px-3 py-2 text-sm",
          "placeholder:text-foreground-subtle hover:border-foreground-subtle focus-visible:border-foreground focus-visible:outline-offset-0",
          error !== undefined ? "border-danger" : "border-border-strong",
          className,
        )}
        {...props}
      />
      {hint !== undefined && (
        <p id={hintId} className="text-foreground-muted text-xs">
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
    <div className="flex flex-col items-start gap-1 px-4 py-8">
      <p className="text-foreground text-base font-bold">{title}</p>
      <p className="text-foreground-muted max-w-[52ch] text-sm">{description}</p>
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
    <div className="flex flex-col items-start gap-1 px-4 py-8">
      <p className="text-danger text-base font-bold">{title}</p>
      <p className="text-foreground-muted max-w-[60ch] text-sm">{message}</p>
      {traceId !== undefined && (
        <p className="text-foreground-muted text-xs">
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

/**
 * The band at the top of a screen: title, one line of context, primary actions. It
 * runs edge to edge across the content column, cancelling the layout's padding.
 */
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
    <div className="bg-surface rule-b -mx-4 -mt-6 mb-6 flex flex-wrap items-end justify-between gap-4 px-4 py-5 sm:-mx-6 sm:px-6">
      <div className="min-w-0">
        <h1 className="text-foreground text-2xl font-bold tracking-tight" dir="auto">
          {title}
        </h1>
        {description !== undefined && (
          <p className="text-foreground-muted mt-1 max-w-2xl text-sm">{description}</p>
        )}
      </div>
      {actions !== undefined && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Key figure                                                                 */
/* -------------------------------------------------------------------------- */

/** One number on a dashboard: a caption, the figure, and a line of context. */
export function StatCard({
  label,
  value,
  note,
  className,
  children,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  className?: string;
  /** Extra lines under the figure, such as totals per currency. */
  children?: ReactNode;
}) {
  return (
    <div className={cn("panel min-w-0 p-4", className)}>
      <p className="label-caps">{label}</p>
      <p className="text-foreground mt-2 truncate text-3xl font-bold tracking-tight tabular-nums">
        {value}
      </p>
      {children}
      {note !== undefined && <p className="text-foreground-muted mt-1 text-xs">{note}</p>}
    </div>
  );
}
