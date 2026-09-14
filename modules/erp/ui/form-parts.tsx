import { AlertTriangle } from "lucide-react";

/** A form-level error: the safe message a Server Action returned. */
export function FormError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="border-danger text-danger mb-4 flex items-start gap-2 border-s-4 px-3 py-2 text-sm"
    >
      <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </p>
  );
}

/** The first message for a field from a Server Action's field errors. */
export function fieldError(
  errors: Record<string, string[]> | undefined,
  key: string,
): string | undefined {
  return errors?.[key]?.[0];
}
