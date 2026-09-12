import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * The button primitive (CLAUDE.md §16.3).
 *
 * Always renders a real `<button>`, so keyboard activation, focus and assistive
 * technology work without extra effort (§17.5). A clickable `<div>` is never
 * acceptable.
 */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-primary-foreground hover:bg-primary-hover border border-transparent",
  secondary:
    "bg-surface text-foreground border border-border-strong hover:bg-surface-hover",
  ghost:
    "bg-transparent text-foreground-muted border border-transparent hover:bg-surface-hover hover:text-foreground",
  danger:
    "bg-danger text-foreground-inverse hover:bg-danger-hover border border-transparent",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a pending state and blocks further submissions. */
  isPending?: boolean;
  icon?: ReactNode;
};

export function Button({
  variant = "secondary",
  size = "md",
  isPending = false,
  icon,
  className,
  children,
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      // A pending button must not be clickable twice — double submission of a
      // payment or an approval is a real defect, not a cosmetic one.
      disabled={disabled === true || isPending}
      aria-busy={isPending || undefined}
      className={cn(
        "inline-flex items-center justify-center rounded-(--radius-control) font-medium",
        "transition-colors duration-150",
        "disabled:pointer-events-none disabled:opacity-55",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    >
      {isPending ? <Spinner /> : icon}
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}
