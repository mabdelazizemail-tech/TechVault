"use client";

import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";

/**
 * Transient notifications for the outcome of an action (CLAUDE.md §16.6, §17.5).
 *
 * Announced through a polite live region, dismissible, and removed after a few
 * seconds — errors stay longer than successes. Wrap the part of the page whose
 * actions report outcomes in `ToastProvider` and call `useToast()`.
 */

type Tone = "success" | "error" | "info";
/** An optional action: a link, or a callback such as opening a chat window. */
export type ToastAction =
  { label: string; href: string } | { label: string; onSelect: () => void };
type Toast = { id: number; tone: Tone; message: string; action?: ToastAction };
type Notify = (message: string, tone?: Tone, action?: ToastAction) => void;

const ToastContext = createContext<Notify | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback<Notify>((message, tone = "success", action) => {
    const id = nextId.current;
    nextId.current += 1;
    setToasts((current) => [...current.slice(-3), { id, tone, message, action }]);
  }, []);

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed end-4 bottom-22 z-50 flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2"
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(
      () => onDismiss(toast.id),
      toast.tone === "error" ? 10_000 : 6_000,
    );
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  const Icon =
    toast.tone === "success"
      ? CheckCircle2
      : toast.tone === "info"
        ? Info
        : AlertTriangle;
  const accent =
    toast.tone === "success"
      ? "text-success"
      : toast.tone === "info"
        ? "text-info"
        : "text-danger";

  return (
    <div
      className={cn(
        "bg-surface-raised text-foreground animate-tv-fade pointer-events-auto flex items-start gap-2.5 border-s-4 px-3 py-2.5 text-[13px] shadow-[0_12px_32px_color-mix(in_srgb,#2d2b2b_22%,transparent)]",
        toast.tone === "success"
          ? "border-success"
          : toast.tone === "info"
            ? "border-info"
            : "border-danger",
      )}
    >
      <Icon aria-hidden="true" size={16} className={cn("mt-0.5 shrink-0", accent)} />
      <p className="min-w-0 flex-1" dir="auto">
        {toast.message}
      </p>
      {toast.action !== undefined &&
        ("href" in toast.action ? (
          <Link
            href={toast.action.href}
            onClick={() => onDismiss(toast.id)}
            className="text-primary-ink shrink-0 text-[13px] font-extrabold hover:underline"
          >
            {toast.action.label}
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (toast.action !== undefined && "onSelect" in toast.action) {
                toast.action.onSelect();
              }
              onDismiss(toast.id);
            }}
            className="text-primary-ink shrink-0 cursor-pointer text-[13px] font-extrabold hover:underline"
          >
            {toast.action.label}
          </button>
        ))}
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="text-foreground-muted hover:text-foreground -me-1 grid size-6 shrink-0 cursor-pointer place-items-center"
      >
        <X aria-hidden="true" size={14} />
      </button>
    </div>
  );
}

export function useToast(): Notify {
  const notify = useContext(ToastContext);
  if (notify === null) throw new Error("useToast must be used inside ToastProvider.");
  return notify;
}
