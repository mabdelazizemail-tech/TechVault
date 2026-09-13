import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * The button primitive (CLAUDE.md §16.3), in the Modernist style: square, heavy
 * type, the label flush left. Always a real `<button>` (§17.5).
 */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-pressed border border-transparent",
  secondary:
    "bg-transparent text-foreground border border-border-strong hover:bg-surface-hover",
  ghost:
    "bg-transparent text-primary-ink border border-transparent hover:bg-primary/10 px-1",
  danger:
    "bg-danger text-primary-foreground hover:bg-danger-hover border border-transparent",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "min-h-7 px-2.5 py-1 text-[13px] gap-1.5",
  md: "min-h-9 px-3.5 py-2 text-sm gap-1.5",
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
        "inline-flex cursor-pointer items-center justify-start leading-tight font-extrabold whitespace-nowrap",
        "transition-colors duration-150",
        "disabled:cursor-not-allowed disabled:opacity-45",
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
      className="size-3.5 animate-spin border-2 border-current border-t-transparent"
    />
  );
}
