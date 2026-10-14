"use client";

import { Camera, ImageUp, ReceiptText, RefreshCw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form-controls";
import { Badge, EmptyState } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import type { MissionOption } from "../contracts/types";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_CURRENCIES,
  MAX_RECEIPT_BYTES,
  type ExpenseCategory,
  parseAmountText,
} from "../domain/expenses";
import { prepareReceiptUploadAction, submitExpenseAction } from "./actions";
import { FormError } from "./badges";
import { CATEGORY_ICONS } from "./expense-badges";
import { prepareReceiptImage } from "./receipt-image";

/**
 * Submitting a mission expense, built for a phone first: one column, large tiles
 * for the category, a numeric keypad for the amount, and the camera one tap away for
 * the receipt, which is optional. A picture is shrunk on the phone, previewed, and
 * only uploaded when the claim is submitted — straight to private storage, never
 * through the app server.
 * The submitter is the signed-in account; nobody types their own name.
 */

type Receipt = {
  blob: Blob;
  fileName: string;
  previewUrl: string;
  /** Set once uploaded, so a retry after a validation error does not upload again. */
  uploadedId: string | null;
};

type Phase = "idle" | "preparing" | "uploading" | "saving";

export function ExpenseForm({
  missions,
  today,
  storageAvailable,
}: {
  missions: readonly MissionOption[];
  /** Today in Cairo, YYYY-MM-DD: the default expense date. */
  today: string;
  storageAvailable: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const formId = useId();
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const [missionId, setMissionId] = useState(
    missions.length === 1 ? (missions[0]?.id ?? "") : "",
  );
  const [category, setCategory] = useState<ExpenseCategory | "">("");
  const [description, setDescription] = useState("");
  const [expenseDate, setExpenseDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(
    missions.length === 1 ? (missions[0]?.defaultCurrency ?? "EGP") : "EGP",
  );
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const busy = phase !== "idle";

  // Free the preview's memory when it is replaced or the form goes away.
  useEffect(() => {
    const url = receipt?.previewUrl;
    return () => {
      if (url !== undefined) URL.revokeObjectURL(url);
    };
  }, [receipt?.previewUrl]);

  const mission = missions.find((candidate) => candidate.id === missionId);
  const isOther = category === "OTHER";

  if (missions.length === 0) {
    return (
      <EmptyState
        title="No missions to claim against"
        description="A committee administrator adds missions, such as a trip or a customer visit. Ask them to add yours."
      />
    );
  }

  async function choosePicture(file: File | undefined) {
    if (file === undefined) return;
    if (!/^image\/(jpeg|png)$/.test(file.type) && !/\.(jpe?g|png)$/i.test(file.name)) {
      setErrors((current) => ({
        ...current,
        receipt: "Use a JPG, JPEG or PNG picture.",
      }));
      return;
    }
    setPhase("preparing");
    const prepared = await prepareReceiptImage(file);
    setPhase("idle");
    if (prepared.blob.size > MAX_RECEIPT_BYTES) {
      setErrors((current) => ({ ...current, receipt: "Pictures are limited to 10 MB." }));
      return;
    }
    setErrors(({ receipt: _removed, ...rest }) => rest);
    setReceipt({
      blob: prepared.blob,
      fileName: prepared.fileName,
      previewUrl: URL.createObjectURL(prepared.blob),
      uploadedId: null,
    });
  }

  function validate(): Record<string, string> {
    const found: Record<string, string> = {};
    if (missionId === "") found.missionId = "Choose a mission.";
    if (category === "") found.category = "Choose a category.";
    if (isOther && description.trim() === "") found.description = "Describe the expense.";
    if (expenseDate === "") found.expenseDate = "Choose the date of the expense.";
    const parsed = parseAmountText(amount);
    if (!parsed.ok) found.amount = parsed.message;
    return found;
  }

  async function uploadReceipt(current: Receipt): Promise<string | null> {
    if (current.uploadedId !== null) return current.uploadedId;
    setPhase("uploading");
    const prepared = await prepareReceiptUploadAction({
      fileName: current.fileName,
      sizeBytes: current.blob.size,
    });
    if (!prepared.ok) {
      setErrors((found) => ({
        ...found,
        receipt: prepared.fieldErrors?.receipt?.[0] ?? prepared.message,
      }));
      return null;
    }
    try {
      const response = await fetch(prepared.data.uploadUrl, {
        method: "PUT",
        headers: { "content-type": prepared.data.contentType, "x-upsert": "false" },
        body: current.blob,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch {
      setErrors((found) => ({
        ...found,
        receipt:
          "The picture could not be uploaded. Check your connection and try again.",
      }));
      return null;
    }
    setReceipt((latest) =>
      latest === current ? { ...latest, uploadedId: prepared.data.receiptId } : latest,
    );
    return prepared.data.receiptId;
  }

  async function submit() {
    setFormError(null);
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setFormError("Please complete the highlighted fields.");
      return;
    }
    // The picture is optional; when one was chosen it must upload before the claim is saved.
    const receiptId = receipt === null ? null : await uploadReceipt(receipt);
    if (receipt !== null && receiptId === null) {
      setPhase("idle");
      return;
    }
    setPhase("saving");
    const result = await submitExpenseAction({
      missionId,
      category,
      description,
      expenseDate,
      amount,
      currency,
      receiptId,
    });
    setPhase("idle");
    if (!result.ok) {
      const fields: Record<string, string> = {};
      for (const [field, messages] of Object.entries(result.fieldErrors ?? {})) {
        if (messages[0] !== undefined) fields[field] = messages[0];
      }
      setErrors(fields);
      setFormError(result.message);
      return;
    }
    toast("Expense submitted.");
    router.push(`/committees/expenses/${result.data.id}`);
  }

  return (
    <form
      id={formId}
      noValidate
      className="panel mx-auto flex w-full max-w-2xl flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) void submit();
      }}
    >
      <div className="rule-b flex items-start gap-3 px-4 py-4 sm:px-5">
        <ReceiptText
          aria-hidden="true"
          className="text-foreground mt-1 size-6 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <h2 className="text-foreground text-lg font-bold">Mission expense</h2>
          <p className="text-foreground-muted text-sm">
            New expense
            {mission !== undefined && (
              <>
                {" "}
                · <span dir="auto">{mission.name}</span>
              </>
            )}
          </p>
        </div>
        <Badge tone="info">Draft</Badge>
      </div>

      <div className="flex flex-col gap-6 px-4 py-5 sm:px-5">
        <Field
          label="Mission"
          htmlFor="expense-mission"
          required
          error={errors.missionId}
        >
          <Select
            id="expense-mission"
            value={missionId}
            onChange={(event) => {
              setMissionId(event.target.value);
              const chosen = missions.find(
                (candidate) => candidate.id === event.target.value,
              );
              if (chosen !== undefined) setCurrency(chosen.defaultCurrency);
            }}
            placeholder="Choose a mission"
            options={missions.map((option) => ({ value: option.id, label: option.name }))}
            invalid={errors.missionId !== undefined}
            className="min-h-11 text-base"
          />
        </Field>

        <fieldset className="flex flex-col gap-2">
          <legend className="label-caps mb-2">
            Expense category<span className="text-primary ms-0.5">*</span>
          </legend>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {EXPENSE_CATEGORIES.map((value) => {
              const Icon = CATEGORY_ICONS[value];
              const checked = category === value;
              return (
                <label
                  key={value}
                  className={cn(
                    "has-focus-visible:outline-primary flex min-h-20 cursor-pointer flex-col justify-between gap-2 border-2 p-3 select-none has-focus-visible:outline-2 has-focus-visible:outline-offset-2",
                    checked
                      ? "border-primary bg-surface-hover"
                      : "border-border hover:bg-surface-hover",
                  )}
                >
                  <input
                    type="radio"
                    name="category"
                    value={value}
                    checked={checked}
                    onChange={() => setCategory(value)}
                    className="sr-only"
                  />
                  <Icon
                    aria-hidden="true"
                    className={cn(
                      "size-5",
                      checked ? "text-primary" : "text-foreground-muted",
                    )}
                  />
                  <span className="text-foreground text-[15px] font-semibold">
                    {EXPENSE_CATEGORY_LABELS[value]}
                  </span>
                </label>
              );
            })}
          </div>
          {errors.category !== undefined && (
            <p role="alert" className="text-danger text-xs">
              {errors.category}
            </p>
          )}
        </fieldset>

        <Field
          label={isOther ? "Describe the expense" : "Notes (optional)"}
          htmlFor="expense-description"
          required={isOther}
          error={errors.description}
        >
          <Textarea
            id="expense-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={2}
            maxLength={1000}
            dir="auto"
            invalid={errors.description !== undefined}
            placeholder={isOther ? "What was it for?" : undefined}
          />
        </Field>

        <Field
          label="Expense date"
          htmlFor="expense-date"
          required
          error={errors.expenseDate}
        >
          <Input
            id="expense-date"
            type="date"
            value={expenseDate}
            max={today}
            onChange={(event) => setExpenseDate(event.target.value)}
            invalid={errors.expenseDate !== undefined}
            className="min-h-11 text-base sm:max-w-56"
          />
        </Field>

        <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
          <Field label="Amount" htmlFor="expense-amount" required error={errors.amount}>
            <Input
              id="expense-amount"
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
              invalid={errors.amount !== undefined}
              className="min-h-11 text-base tabular-nums"
            />
          </Field>
          <Field
            label="Currency"
            htmlFor="expense-currency"
            required
            error={errors.currency}
          >
            <Select
              id="expense-currency"
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
              options={EXPENSE_CURRENCIES.map((code) => ({ value: code, label: code }))}
              className="min-h-11 text-base"
            />
          </Field>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="label-caps mb-2">
            Invoice / receipt{" "}
            <span className="text-foreground-muted normal-case">(optional)</span>
          </legend>
          {!storageAvailable ? (
            <p className="text-foreground-muted text-sm">
              Pictures cannot be attached on this server yet. You can still submit the
              expense without one.
            </p>
          ) : receipt === null ? (
            <div
              className={cn(
                "flex flex-col items-center gap-3 border-2 border-dashed px-4 py-6 text-center",
                errors.receipt !== undefined ? "border-danger" : "border-border-strong",
              )}
            >
              <Camera aria-hidden="true" className="text-foreground-muted size-7" />
              <p className="text-foreground text-sm font-bold">
                Upload the invoice or take a picture
              </p>
              <p className="text-foreground-muted text-xs">
                JPG, JPEG or PNG · Optional, but it helps the approver
              </p>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                {/* Phones and tablets open the camera straight away; a mouse has no camera. */}
                <Button
                  variant="primary"
                  icon={<Camera aria-hidden="true" size={16} />}
                  onClick={() => cameraInput.current?.click()}
                  disabled={busy}
                  className="hidden pointer-coarse:inline-flex"
                >
                  Take a picture
                </Button>
                <Button
                  variant="secondary"
                  icon={<ImageUp aria-hidden="true" size={16} />}
                  onClick={() => fileInput.current?.click()}
                  disabled={busy}
                >
                  {phase === "preparing" ? "Preparing…" : "Upload a picture"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="border-border flex flex-col gap-3 border-2 p-3 sm:flex-row sm:items-start">
              {/* eslint-disable-next-line @next/next/no-img-element -- a local preview (blob URL), which next/image cannot load */}
              <img
                src={receipt.previewUrl}
                alt="Preview of the receipt picture"
                className="bg-surface-sunken max-h-72 w-full object-contain sm:w-48"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <p dir="auto" className="text-foreground truncate text-sm font-semibold">
                  {receipt.fileName}
                </p>
                <p className="text-foreground-muted text-xs">
                  {Math.max(1, Math.round(receipt.blob.size / 1024))} KB
                  {receipt.uploadedId !== null && " · uploaded"}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    icon={<RefreshCw aria-hidden="true" size={14} />}
                    onClick={() => fileInput.current?.click()}
                    disabled={busy}
                  >
                    Replace
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<X aria-hidden="true" size={14} />}
                    onClick={() => setReceipt(null)}
                    disabled={busy}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            </div>
          )}
          {errors.receipt !== undefined && (
            <p role="alert" className="text-danger text-xs">
              {errors.receipt}
            </p>
          )}
          <input
            ref={cameraInput}
            type="file"
            accept="image/jpeg,image/png"
            capture="environment"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              void choosePicture(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              void choosePicture(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </fieldset>

        {formError !== null && <FormError message={formError} />}
      </div>

      {/* On a phone the submit button stays within reach of the thumb. */}
      <div className="rule-t bg-surface sticky bottom-0 px-4 py-3 sm:static sm:px-5">
        <Button
          type="submit"
          variant="primary"
          isPending={busy}
          className="w-full sm:w-auto"
        >
          {phase === "uploading"
            ? "Uploading receipt…"
            : phase === "saving"
              ? "Submitting…"
              : phase === "preparing"
                ? "Preparing picture…"
                : "Submit expense"}
        </Button>
      </div>
    </form>
  );
}
