import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * The button primitive (CLAUDE.md §16.3): square, bold, ink for the primary action
 * and a 2px outline for the rest. Always a real `<button>` (§17.5).
 */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-pressed border-2 border-transparent",
  secondary: "bg-surface text-foreground border-2 border-border hover:bg-surface-hover",
  ghost:
    "bg-transparent text-primary-ink border-2 border-transparent hover:bg-surface-hover px-1.5",
  danger:
    "bg-danger text-primary-foreground hover:bg-danger-hover border-2 border-transparent",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  // Touch screens get targets of at least 40–44px (§17.5); a mouse keeps the
  // denser desktop sizes.
  sm: "min-h-8 px-2.5 py-1 text-[13px] gap-1.5 pointer-coarse:min-h-10",
  md: "min-h-10 px-4 py-2 text-sm gap-2 pointer-coarse:min-h-11",
};

const BASE_CLASSES =
  "inline-flex items-center justify-center leading-tight font-bold whitespace-nowrap transition-colors duration-150";

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
        BASE_CLASSES,
        "cursor-pointer disabled:cursor-not-allowed disabled:opacity-45",
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

/**
 * A link styled as a button — for navigation only. An action that changes data is
 * always a real `<button>` (CLAUDE.md §17.5).
 */
export function ButtonLink({
  href,
  variant = "secondary",
  size = "md",
  icon,
  className,
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        BASE_CLASSES,
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
    >
      {icon}
      {children}
    </Link>
  );
}
