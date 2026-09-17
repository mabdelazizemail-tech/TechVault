import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/cn";

/**
 * Form controls on native elements (CLAUDE.md §16.3, §17.5).
 *
 * Native `<select>`, `<input type="radio">` and friends keep keyboard behaviour,
 * mobile pickers and screen-reader semantics for free. No business logic here.
 */

export const controlClasses =
  "bg-surface text-foreground w-full border-2 px-3 py-1.5 text-sm " +
  "placeholder:text-foreground-subtle hover:border-foreground-subtle " +
  "focus-visible:border-foreground focus-visible:outline-offset-0 disabled:cursor-not-allowed disabled:opacity-45";

export type Option = { value: string; label: string };

/** Label, control, hint and error, correctly associated. */
export function Field({
  label,
  htmlFor,
  required,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  error?: string | null;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <label htmlFor={htmlFor} className="text-foreground-muted text-xs">
        {label}
        {required === true && (
          <span aria-hidden="true" className="text-primary ms-0.5">
            *
          </span>
        )}
      </label>
      {children}
      {hint !== undefined && (
        <p id={`${htmlFor}-hint`} className="text-foreground-subtle text-xs">
          {hint}
        </p>
      )}
      {error !== undefined && error !== null && (
        <p id={`${htmlFor}-error`} role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

/** `aria-describedby` for a control rendered inside `Field`. */
export function describedBy(
  id: string,
  error?: string | null,
  hint?: string,
): string | undefined {
  const ids = [
    error !== undefined && error !== null ? `${id}-error` : null,
    hint !== undefined ? `${id}-hint` : null,
  ].filter((value) => value !== null);
  return ids.length === 0 ? undefined : ids.join(" ");
}

export function Input({
  invalid,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      aria-invalid={invalid === true || undefined}
      className={cn(
        controlClasses,
        "min-h-9 pointer-coarse:min-h-11",
        invalid === true ? "border-danger" : "border-border-strong",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({
  invalid,
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      aria-invalid={invalid === true || undefined}
      className={cn(
        controlClasses,
        "min-h-20 resize-y",
        invalid === true ? "border-danger" : "border-border-strong",
        className,
      )}
      {...props}
    />
  );
}

export function Select({
  options,
  placeholder,
  invalid,
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  options: readonly Option[];
  /** Renders an empty first option — "not chosen". */
  placeholder?: string;
  invalid?: boolean;
}) {
  return (
    <select
      aria-invalid={invalid === true || undefined}
      className={cn(
        controlClasses,
        "min-h-9 cursor-pointer pointer-coarse:min-h-11",
        invalid === true ? "border-danger" : "border-border-strong",
        className,
      )}
      {...props}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Radio options rendered as a row of pills — the design system's segmented
 * control. Built on real radios inside a fieldset, so arrow keys work.
 */
export function PillGroup({
  name,
  legend,
  options,
  value,
  onValueChange,
  required,
  error,
  className,
}: {
  name: string;
  legend: string;
  options: readonly Option[];
  value: string;
  onValueChange: (value: string) => void;
  required?: boolean;
  error?: string | null;
  className?: string;
}) {
  return (
    <fieldset className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <legend className="text-foreground-muted mb-1 text-xs">
        {legend}
        {required === true && (
          <span aria-hidden="true" className="text-primary ms-0.5">
            *
          </span>
        )}
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const checked = option.value === value;
          return (
            <label
              key={option.value}
              className={cn(
                "has-focus-visible:outline-primary relative cursor-pointer border px-3 py-1.5 text-[13px] select-none has-focus-visible:outline-2 has-focus-visible:outline-offset-2",
                checked
                  ? "border-primary bg-primary text-primary-foreground font-extrabold"
                  : "border-border-strong text-foreground hover:bg-surface-hover",
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                onChange={() => onValueChange(option.value)}
                className="sr-only"
              />
              {option.label}
            </label>
          );
        })}
      </div>
      {error !== undefined && error !== null && (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
    </fieldset>
  );
}

export function Checkbox({
  label,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label
      className={cn(
        "inline-flex cursor-pointer items-center gap-2 text-sm pointer-coarse:min-h-10",
        className,
      )}
    >
      <input
        type="checkbox"
        className="accent-primary size-4 cursor-pointer pointer-coarse:size-5"
        {...props}
      />
      {label}
    </label>
  );
}

/**
 * A 0–100 slider with its value shown beside it. `tone` lets the caller colour the
 * readout (e.g. a hot lead score).
 */
export function RangeField({
  id,
  label,
  value,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  suffix,
  describe,
}: {
  id: string;
  label: string;
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  /** A short word describing the value, e.g. "Hot". */
  describe?: (value: number) => string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-foreground-muted text-xs">
          {label}
        </label>
        <span className="text-foreground text-sm font-extrabold tabular-nums">
          {value}
          {suffix}
          {describe !== undefined && (
            <span className="text-foreground-muted ms-1.5 text-xs font-normal">
              {describe(value)}
            </span>
          )}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onValueChange(Number(event.target.value))}
        className="accent-primary h-6 w-full cursor-pointer"
      />
    </div>
  );
}

/** A labelled text input with its error, the most common field in every form. */
export function TextField({
  id,
  label,
  value,
  onValueChange,
  error,
  hint,
  required,
  className,
  ...props
}: {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  error?: string | null;
  hint?: string;
  required?: boolean;
  className?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "value" | "onChange">) {
  return (
    <Field
      label={label}
      htmlFor={id}
      required={required}
      error={error}
      hint={hint}
      className={className}
    >
      <Input
        id={id}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        invalid={error !== undefined && error !== null}
        aria-describedby={describedBy(id, error, hint)}
        aria-required={required}
        {...props}
      />
    </Field>
  );
}
