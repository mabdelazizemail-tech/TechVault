"use client";

import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { controlClasses } from "@/components/ui/form-controls";
import { Panel, PanelHeader } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import type {
  AccountOption,
  CostCentreRef,
  CreditableInvoice,
  TaxRateDto,
} from "../contracts/types";
import {
  MAX_INVOICE_LINES,
  calculateLine,
  formatBasisPoints,
  invoiceTotals,
  parseQuantityText,
} from "../domain/ar";
import { formatMinorAmount, parseAmountText } from "../domain/journal";
import { createCreditNoteAction, updateCreditNoteAction } from "./ar-actions";
import { FormError, fieldError } from "./form-parts";

/**
 * The credit note form (ADR-029): a date, a reason and the lines to credit, which
 * start as a copy of the invoice's own lines.
 *
 * Every figure here is a convenience. The server prices each line again, checks the
 * accounts, and refuses a credit note worth more than the invoice still owes.
 */

type LineState = {
  key: number;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  taxRateId: string;
  revenueAccountId: string;
  costCentreId: string;
};

export type CreditNoteFormInitial = {
  creditNoteDate: string;
  reason: string;
  notes: string | null;
  lines: {
    description: string;
    quantity: string;
    unitPriceMinor: number;
    discountMinor: number;
    taxRateId: string | null;
    revenueAccountId: string;
    costCentreId: string | null;
  }[];
};

let nextKey = 1;
const amountText = (minor: number) => (minor === 0 ? "" : formatMinorAmount(minor));

export function CreditNoteForm({
  mode,
  creditNoteId,
  invoice,
  taxRates,
  revenueAccounts,
  costCentres,
  initial,
  defaultDate,
}: {
  mode: "create" | "edit";
  creditNoteId?: string;
  invoice: CreditableInvoice;
  taxRates: TaxRateDto[];
  revenueAccounts: AccountOption[];
  costCentres: CostCentreRef[];
  /** For a new credit note the page fills this from the invoice's own lines. */
  initial: CreditNoteFormInitial;
  defaultDate: string;
}) {
  const router = useRouter();
  const [creditNoteDate, setCreditNoteDate] = useState(
    initial.creditNoteDate === "" ? defaultDate : initial.creditNoteDate,
  );
  const [reason, setReason] = useState(initial.reason);
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [lines, setLines] = useState<LineState[]>(() =>
    initial.lines.map((line) => ({
      key: nextKey++,
      description: line.description,
      quantity: line.quantity,
      unitPrice: amountText(line.unitPriceMinor),
      discount: amountText(line.discountMinor),
      taxRateId: line.taxRateId ?? "",
      revenueAccountId: line.revenueAccountId,
      costCentreId: line.costCentreId ?? "",
    })),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const [isPending, startTransition] = useTransition();

  const priced = lines.map((line) => {
    const quantity = parseQuantityText(line.quantity);
    const unitPrice = parseAmountText(line.unitPrice === "" ? "0" : line.unitPrice);
    const discount = parseAmountText(line.discount === "" ? "0" : line.discount);
    const rate = taxRates.find((candidate) => candidate.id === line.taxRateId) ?? null;
    if (!quantity.ok || !unitPrice.ok || !discount.ok) return null;
    return calculateLine({
      quantityScaled: quantity.scaled,
      unitPriceMinor: unitPrice.minor,
      discountMinor: discount.minor,
      taxBasisPoints: rate?.rateBasisPoints ?? null,
    });
  });
  const totals = invoiceTotals(priced.flatMap((line) => (line === null ? [] : [line])));
  const overLimit = Number(totals.totalMinor) > invoice.outstandingMinor;

  const updateLine = (key: number, patch: Partial<LineState>) =>
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );

  const submit = () => {
    setMessage(null);
    setErrors(undefined);
    const payload = {
      invoiceId: invoice.id,
      creditNoteDate,
      reason,
      notes,
      lines: lines.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discount: line.discount,
        taxRateId: line.taxRateId,
        revenueAccountId: line.revenueAccountId,
        costCentreId: line.costCentreId,
      })),
    };
    startTransition(async () => {
      const result =
        mode === "edit" && creditNoteId !== undefined
          ? await updateCreditNoteAction(creditNoteId, payload)
          : await createCreditNoteAction(payload);
      if (result.ok) {
        router.push(`/erp/finance/credit-notes/${result.data.id}`);
      } else {
        setMessage(result.message);
        setErrors(result.fieldErrors);
      }
    });
  };

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {message !== null && <FormError message={message} />}

      <Panel>
        <PanelHeader
          title="Credit note"
          description={`Against invoice ${invoice.invoiceNumber} for ${invoice.customer.name}. At most ${formatMinorAmount(invoice.outstandingMinor)} EGP — what the invoice still owes.`}
        />
        <div className="grid gap-4 p-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <Field
            id="creditNoteDate"
            label="Date"
            error={fieldError(errors, "creditNoteDate")}
          >
            <input
              id="creditNoteDate"
              type="date"
              required
              value={creditNoteDate}
              onChange={(event) => setCreditNoteDate(event.target.value)}
              className={cn(controlClasses, "border-border-strong min-h-10")}
            />
          </Field>
          <Field id="reason" label="Reason" error={fieldError(errors, "reason")}>
            <input
              id="reason"
              value={reason}
              maxLength={500}
              dir="auto"
              placeholder="Goods returned, billed in error, agreed discount…"
              onChange={(event) => setReason(event.target.value)}
              className={cn(controlClasses, "border-border-strong min-h-10")}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field id="notes" label="Notes" error={fieldError(errors, "notes")}>
              <input
                id="notes"
                value={notes}
                maxLength={1000}
                dir="auto"
                onChange={(event) => setNotes(event.target.value)}
                className={cn(controlClasses, "border-border-strong min-h-10")}
              />
            </Field>
          </div>
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Lines"
          description="Copied from the invoice. Change the amounts to credit part of it."
        />
        {(fieldError(errors, "lines") ?? fieldError(errors, "_")) !== undefined && (
          <p role="alert" className="text-danger px-4 pt-3 text-sm">
            {fieldError(errors, "lines") ?? fieldError(errors, "_")}
          </p>
        )}
        <ol className="divide-border divide-y">
          {lines.map((line, index) => {
            const number = index + 1;
            const prefix = `lines.${index}`;
            return (
              <li key={line.key} className="grid gap-2 px-4 py-3 lg:grid-cols-12">
                <div className="lg:col-span-4">
                  <Cell
                    label={`Line ${number} description`}
                    error={fieldError(errors, `${prefix}.description`)}
                  >
                    <input
                      aria-label={`Line ${number} description`}
                      value={line.description}
                      maxLength={300}
                      dir="auto"
                      onChange={(event) =>
                        updateLine(line.key, { description: event.target.value })
                      }
                      className={cn(controlClasses, "border-border-strong min-h-10")}
                    />
                  </Cell>
                </div>
                <div className="lg:col-span-1">
                  <Cell
                    label={`Line ${number} quantity`}
                    error={fieldError(errors, `${prefix}.quantity`)}
                  >
                    <input
                      aria-label={`Line ${number} quantity`}
                      inputMode="decimal"
                      dir="ltr"
                      value={line.quantity}
                      onChange={(event) =>
                        updateLine(line.key, { quantity: event.target.value })
                      }
                      className={cn(
                        controlClasses,
                        "border-border-strong min-h-10 text-end",
                      )}
                    />
                  </Cell>
                </div>
                <div className="lg:col-span-2">
                  <Cell
                    label={`Line ${number} unit price`}
                    error={fieldError(errors, `${prefix}.unitPrice`)}
                  >
                    <input
                      aria-label={`Line ${number} unit price`}
                      inputMode="decimal"
                      dir="ltr"
                      value={line.unitPrice}
                      onChange={(event) =>
                        updateLine(line.key, { unitPrice: event.target.value })
                      }
                      className={cn(
                        controlClasses,
                        "border-border-strong min-h-10 text-end",
                      )}
                    />
                  </Cell>
                </div>
                <div className="lg:col-span-1">
                  <Cell
                    label={`Line ${number} discount`}
                    error={fieldError(errors, `${prefix}.discount`)}
                  >
                    <input
                      aria-label={`Line ${number} discount`}
                      inputMode="decimal"
                      dir="ltr"
                      value={line.discount}
                      onChange={(event) =>
                        updateLine(line.key, { discount: event.target.value })
                      }
                      className={cn(
                        controlClasses,
                        "border-border-strong min-h-10 text-end",
                      )}
                    />
                  </Cell>
                </div>
                <div className="lg:col-span-2">
                  <Cell
                    label={`Line ${number} tax rate`}
                    error={fieldError(errors, `${prefix}.taxRateId`)}
                  >
                    <select
                      aria-label={`Line ${number} tax rate`}
                      value={line.taxRateId}
                      onChange={(event) =>
                        updateLine(line.key, { taxRateId: event.target.value })
                      }
                      className={cn(
                        controlClasses,
                        "border-border-strong min-h-10 cursor-pointer",
                      )}
                    >
                      <option value="">No tax</option>
                      {taxRates.map((rate) => (
                        <option key={rate.id} value={rate.id}>
                          {rate.code} {formatBasisPoints(rate.rateBasisPoints)}
                        </option>
                      ))}
                    </select>
                  </Cell>
                </div>
                <div className="lg:col-span-2">
                  <Cell
                    label={`Line ${number} revenue account`}
                    error={fieldError(errors, `${prefix}.revenueAccountId`)}
                  >
                    <select
                      aria-label={`Line ${number} revenue account`}
                      value={line.revenueAccountId}
                      onChange={(event) =>
                        updateLine(line.key, { revenueAccountId: event.target.value })
                      }
                      className={cn(
                        controlClasses,
                        "border-border-strong min-h-10 cursor-pointer",
                      )}
                    >
                      <option value="">Choose an account</option>
                      {revenueAccounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.code} — {account.name}
                        </option>
                      ))}
                    </select>
                  </Cell>
                </div>
                <div className="flex items-start justify-between gap-2 lg:col-span-12 lg:justify-end">
                  <select
                    aria-label={`Line ${number} cost centre`}
                    value={line.costCentreId}
                    onChange={(event) =>
                      updateLine(line.key, { costCentreId: event.target.value })
                    }
                    className={cn(
                      controlClasses,
                      "border-border-strong min-h-9 max-w-56 cursor-pointer text-xs",
                    )}
                  >
                    <option value="">No cost centre</option>
                    {costCentres.map((centre) => (
                      <option key={centre.id} value={centre.id}>
                        {centre.code} — {centre.name}
                      </option>
                    ))}
                  </select>
                  <span className="text-sm font-bold tabular-nums" dir="ltr">
                    {formatMinorAmount(priced[index]?.totalMinor ?? 0n)}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setLines((current) =>
                        current.filter((candidate) => candidate.key !== line.key),
                      )
                    }
                    disabled={lines.length <= 1}
                    aria-label={`Remove line ${number}`}
                    className="text-foreground-muted hover:text-danger grid min-h-9 cursor-pointer place-items-center disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="rule-t flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Button
            size="sm"
            icon={<Plus aria-hidden="true" className="size-4" />}
            disabled={lines.length >= MAX_INVOICE_LINES}
            onClick={() =>
              setLines((current) => [
                ...current,
                {
                  key: nextKey++,
                  description: "",
                  quantity: "1",
                  unitPrice: "",
                  discount: "",
                  taxRateId: "",
                  revenueAccountId: revenueAccounts[0]?.id ?? "",
                  costCentreId: "",
                },
              ])
            }
          >
            Add line
          </Button>
          <dl className="grid grid-cols-[auto_auto] gap-x-6 text-sm tabular-nums">
            <dt className="text-foreground-muted">Tax</dt>
            <dd dir="ltr" className="text-end">
              {formatMinorAmount(totals.taxMinor)}
            </dd>
            <dt className="font-bold">Credit total</dt>
            <dd dir="ltr" className="text-end font-bold" data-testid="credit-note-total">
              {formatMinorAmount(totals.totalMinor)}
            </dd>
          </dl>
        </div>
        {overLimit && (
          <p role="alert" className="text-danger rule-t px-4 py-3 text-sm font-semibold">
            This is more than the {formatMinorAmount(invoice.outstandingMinor)} EGP the
            invoice still owes, so the server will refuse it.
          </p>
        )}
      </Panel>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" isPending={isPending}>
          {isPending ? "Saving…" : mode === "edit" ? "Save draft" : "Save as draft"}
        </Button>
        <Link
          href={
            mode === "edit" && creditNoteId !== undefined
              ? `/erp/finance/credit-notes/${creditNoteId}`
              : `/erp/finance/invoices/${invoice.id}`
          }
          className="text-foreground-muted hover:text-foreground text-sm font-bold"
        >
          Cancel
        </Link>
        <p className="text-foreground-muted text-xs">
          Saved as a draft. Submit it for approval from its page.
        </p>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-foreground text-xs font-semibold">
        {label}
        <span aria-hidden="true" className="text-danger ms-0.5">
          *
        </span>
      </label>
      {children}
      {error !== undefined && (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

function Cell({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span aria-hidden="true" className="text-foreground-muted text-xs lg:hidden">
        {label}
      </span>
      {children}
      {error !== undefined && (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
