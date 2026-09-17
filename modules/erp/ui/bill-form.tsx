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
  TaxRateDto,
  VendorRef,
} from "../contracts/types";
import {
  MAX_INVOICE_LINES,
  calculateLine,
  formatBasisPoints,
  invoiceTotals,
  parseQuantityText,
  type LineAmounts,
} from "../domain/ar";
import { formatMinorAmount, parseAmountText } from "../domain/journal";
import { saveBillAction } from "./ap-actions";
import { FormError, fieldError } from "./form-parts";
import { VendorPicker } from "./vendor-picker";

/**
 * The vendor bill form: vendor, the supplier's invoice number, dates and priced lines
 * charged to expense or asset accounts. The totals shown are a preview; the server
 * prices every line again when the bill is saved and stores only its own figures, and
 * VAT on a line is booked to its rate's input tax account (ADR-033).
 */

type LineState = {
  key: number;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  taxRateId: string;
  expenseAccountId: string;
  costCentreId: string;
};

export type BillFormInitial = {
  vendor: VendorRef;
  vendorInvoiceNumber: string;
  billDate: string;
  dueDate: string;
  reference: string | null;
  notes: string | null;
  lines: {
    description: string;
    quantity: string;
    unitPriceMinor: number;
    discountMinor: number;
    taxRateId: string | null;
    expenseAccountId: string;
    costCentreId: string | null;
  }[];
};

let nextKey = 1;
const blankLine = (expenseAccountId = ""): LineState => ({
  key: nextKey++,
  description: "",
  quantity: "1",
  unitPrice: "",
  discount: "",
  taxRateId: "",
  expenseAccountId,
  costCentreId: "",
});

const LINE_GRID =
  "xl:grid-cols-[minmax(0,2fr)_5.5rem_8rem_7rem_8rem_minmax(0,1.4fr)_minmax(0,1fr)_8rem_2.5rem]";

export function BillForm({
  mode,
  billId,
  expenseAccounts,
  taxRates,
  costCentres,
  initial,
  defaultDate,
}: {
  mode: "create" | "edit";
  billId?: string;
  expenseAccounts: AccountOption[];
  taxRates: TaxRateDto[];
  costCentres: CostCentreRef[];
  initial?: BillFormInitial;
  defaultDate: string;
}) {
  const router = useRouter();
  const defaultExpense =
    expenseAccounts.length === 1 ? (expenseAccounts[0]?.id ?? "") : "";
  const [vendor, setVendor] = useState<VendorRef | null>(initial?.vendor ?? null);
  const [vendorInvoiceNumber, setVendorInvoiceNumber] = useState(
    initial?.vendorInvoiceNumber ?? "",
  );
  const [billDate, setBillDate] = useState(initial?.billDate ?? defaultDate);
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  const [reference, setReference] = useState(initial?.reference ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [lines, setLines] = useState<LineState[]>(() =>
    initial === undefined
      ? [blankLine(defaultExpense)]
      : initial.lines.map((line) => ({
          key: nextKey++,
          description: line.description,
          quantity: line.quantity,
          unitPrice: formatMinorAmount(line.unitPriceMinor),
          discount: line.discountMinor === 0 ? "" : formatMinorAmount(line.discountMinor),
          taxRateId: line.taxRateId ?? "",
          expenseAccountId: line.expenseAccountId,
          costCentreId: line.costCentreId ?? "",
        })),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const [isPending, startTransition] = useTransition();

  const rateById = new Map(taxRates.map((rate) => [rate.id, rate]));
  const preview: (LineAmounts | null)[] = lines.map((line) => {
    const quantity = parseQuantityText(line.quantity);
    const price = parseAmountText(line.unitPrice);
    const discount = parseAmountText(line.discount);
    if (!quantity.ok || !price.ok || !discount.ok) return null;
    return calculateLine({
      quantityScaled: quantity.scaled,
      unitPriceMinor: price.minor,
      discountMinor: discount.minor,
      taxBasisPoints: rateById.get(line.taxRateId)?.rateBasisPoints ?? null,
    });
  });
  const totals = invoiceTotals(
    preview.filter((amounts): amounts is LineAmounts => amounts !== null),
  );

  const updateLine = (key: number, patch: Partial<LineState>) =>
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );

  const submit = () => {
    setMessage(null);
    setErrors(undefined);
    const payload = {
      vendorId: vendor?.id ?? "",
      vendorInvoiceNumber,
      billDate,
      dueDate,
      reference,
      notes,
      lines: lines.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discount: line.discount,
        taxRateId: line.taxRateId,
        expenseAccountId: line.expenseAccountId,
        costCentreId: line.costCentreId,
      })),
    };
    startTransition(async () => {
      const result = await saveBillAction(
        mode === "edit" && billId !== undefined ? billId : null,
        payload,
      );
      if (result.ok) {
        router.push(`/erp/finance/bills/${result.data.id}`);
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
        <PanelHeader title="Bill" />
        <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-4">
          <Block
            label="Vendor"
            htmlFor="vendor"
            required
            error={fieldError(errors, "vendorId")}
            className="md:col-span-2"
          >
            <VendorPicker
              id="vendor"
              value={vendor}
              onChange={setVendor}
              error={fieldError(errors, "vendorId")}
            />
          </Block>
          <Block
            label="Supplier's invoice number"
            htmlFor="vendorInvoiceNumber"
            required
            error={fieldError(errors, "vendorInvoiceNumber")}
          >
            <input
              id="vendorInvoiceNumber"
              value={vendorInvoiceNumber}
              maxLength={100}
              dir="auto"
              onChange={(event) => setVendorInvoiceNumber(event.target.value)}
              className={cn(controlClasses, "border-border-strong min-h-10")}
            />
          </Block>
          <Block
            label="Bill date"
            htmlFor="billDate"
            required
            error={fieldError(errors, "billDate")}
          >
            <input
              id="billDate"
              type="date"
              value={billDate}
              onChange={(event) => setBillDate(event.target.value)}
              className={cn(controlClasses, "border-border-strong min-h-10")}
            />
          </Block>
          <Block
            label="Due date"
            htmlFor="dueDate"
            hint="Leave blank to use the vendor's payment terms."
            error={fieldError(errors, "dueDate")}
          >
            <input
              id="dueDate"
              type="date"
              value={dueDate}
              min={billDate}
              onChange={(event) => setDueDate(event.target.value)}
              className={cn(controlClasses, "border-border-strong min-h-10")}
            />
          </Block>
          <Block
            label="Reference"
            htmlFor="reference"
            error={fieldError(errors, "reference")}
          >
            <input
              id="reference"
              value={reference}
              maxLength={100}
              dir="auto"
              placeholder="PO or contract number"
              onChange={(event) => setReference(event.target.value)}
              className={cn(controlClasses, "border-border-strong min-h-10")}
            />
          </Block>
          <Block
            label="Notes"
            htmlFor="notes"
            error={fieldError(errors, "notes")}
            className="md:col-span-2 xl:col-span-2"
          >
            <input
              id="notes"
              value={notes}
              maxLength={1000}
              dir="auto"
              onChange={(event) => setNotes(event.target.value)}
              className={cn(controlClasses, "border-border-strong min-h-10")}
            />
          </Block>
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Lines"
          description="Amounts in EGP. Recoverable input VAT is calculated per line from the rate chosen."
        />
        {(fieldError(errors, "lines") ?? fieldError(errors, "_")) !== undefined && (
          <p role="alert" className="text-danger px-4 pt-3 text-sm">
            {fieldError(errors, "lines") ?? fieldError(errors, "_")}
          </p>
        )}
        <div
          aria-hidden="true"
          className={cn(
            "label-caps border-border hidden gap-2 border-b-2 px-4 py-2.5 xl:grid",
            LINE_GRID,
          )}
        >
          <span>Description</span>
          <span className="text-end">Qty</span>
          <span className="text-end">Unit price</span>
          <span className="text-end">Discount</span>
          <span>Tax</span>
          <span>Expense or asset account</span>
          <span>Cost centre</span>
          <span className="text-end">Line total</span>
          <span />
        </div>
        <ol className="divide-border divide-y">
          {lines.map((line, index) => {
            const number = index + 1;
            const prefix = `lines.${index}`;
            const amounts = preview[index];
            return (
              <li
                key={line.key}
                className={cn(
                  "grid gap-2 px-4 py-3 md:grid-cols-2 xl:items-start",
                  LINE_GRID,
                )}
              >
                <Cell
                  label={`Line ${number} description`}
                  error={fieldError(errors, `${prefix}.description`)}
                  className="md:col-span-2 xl:col-span-1"
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
                      "border-border-strong min-h-10 text-end tabular-nums",
                    )}
                  />
                </Cell>
                <Cell
                  label={`Line ${number} unit price`}
                  error={fieldError(errors, `${prefix}.unitPrice`)}
                >
                  <input
                    aria-label={`Line ${number} unit price`}
                    inputMode="decimal"
                    dir="ltr"
                    placeholder="0.00"
                    value={line.unitPrice}
                    onChange={(event) =>
                      updateLine(line.key, { unitPrice: event.target.value })
                    }
                    className={cn(
                      controlClasses,
                      "border-border-strong min-h-10 text-end tabular-nums",
                    )}
                  />
                </Cell>
                <Cell
                  label={`Line ${number} discount`}
                  error={fieldError(errors, `${prefix}.discount`)}
                >
                  <input
                    aria-label={`Line ${number} discount`}
                    inputMode="decimal"
                    dir="ltr"
                    placeholder="0.00"
                    value={line.discount}
                    onChange={(event) =>
                      updateLine(line.key, { discount: event.target.value })
                    }
                    className={cn(
                      controlClasses,
                      "border-border-strong min-h-10 text-end tabular-nums",
                    )}
                  />
                </Cell>
                <Cell
                  label={`Line ${number} tax`}
                  error={fieldError(errors, `${prefix}.taxRateId`)}
                >
                  <select
                    aria-label={`Line ${number} tax`}
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
                        {rate.code} ({formatBasisPoints(rate.rateBasisPoints)})
                      </option>
                    ))}
                  </select>
                </Cell>
                <Cell
                  label={`Line ${number} account`}
                  error={fieldError(errors, `${prefix}.expenseAccountId`)}
                >
                  <select
                    aria-label={`Line ${number} account`}
                    value={line.expenseAccountId}
                    onChange={(event) =>
                      updateLine(line.key, { expenseAccountId: event.target.value })
                    }
                    className={cn(
                      controlClasses,
                      "border-border-strong min-h-10 cursor-pointer",
                    )}
                  >
                    <option value="">Choose an account</option>
                    {expenseAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.code} — {account.name}
                      </option>
                    ))}
                  </select>
                </Cell>
                <Cell
                  label={`Line ${number} cost centre`}
                  error={fieldError(errors, `${prefix}.costCentreId`)}
                >
                  <select
                    aria-label={`Line ${number} cost centre`}
                    value={line.costCentreId}
                    onChange={(event) =>
                      updateLine(line.key, { costCentreId: event.target.value })
                    }
                    className={cn(
                      controlClasses,
                      "border-border-strong min-h-10 cursor-pointer",
                    )}
                  >
                    <option value="">None</option>
                    {costCentres.map((centre) => (
                      <option key={centre.id} value={centre.id}>
                        {centre.code} — {centre.name}
                      </option>
                    ))}
                  </select>
                </Cell>
                <p className="flex min-h-10 items-center justify-between gap-2 text-sm font-bold tabular-nums xl:justify-end">
                  <span className="text-foreground-muted xl:sr-only">Line total</span>
                  <span dir="ltr">
                    {amounts === null || amounts === undefined
                      ? "—"
                      : formatMinorAmount(amounts.totalMinor)}
                  </span>
                </p>
                <button
                  type="button"
                  onClick={() =>
                    setLines((current) =>
                      current.filter((candidate) => candidate.key !== line.key),
                    )
                  }
                  disabled={lines.length <= 1}
                  aria-label={`Remove line ${number}`}
                  className="text-foreground-muted hover:bg-surface-hover hover:text-danger grid min-h-10 cursor-pointer place-items-center disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                </button>
              </li>
            );
          })}
        </ol>
        <div className="rule-t flex flex-wrap items-start justify-between gap-4 px-4 py-3">
          <Button
            size="sm"
            icon={<Plus aria-hidden="true" className="size-4" />}
            disabled={lines.length >= MAX_INVOICE_LINES}
            onClick={() => setLines((current) => [...current, blankLine(defaultExpense)])}
          >
            Add line
          </Button>
          <dl
            className="grid min-w-64 grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm tabular-nums"
            aria-live="polite"
          >
            <dt className="text-foreground-muted">Subtotal</dt>
            <dd dir="ltr" className="text-end">
              {formatMinorAmount(totals.subtotalMinor)}
            </dd>
            <dt className="text-foreground-muted">Discount</dt>
            <dd dir="ltr" className="text-end">
              {formatMinorAmount(totals.discountMinor)}
            </dd>
            <dt className="text-foreground-muted">Input VAT</dt>
            <dd dir="ltr" className="text-end">
              {formatMinorAmount(totals.taxMinor)}
            </dd>
            <dt className="font-bold">Total (EGP)</dt>
            <dd dir="ltr" className="text-end font-bold">
              {formatMinorAmount(totals.totalMinor)}
            </dd>
          </dl>
        </div>
      </Panel>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" isPending={isPending}>
          {isPending ? "Saving…" : "Save draft"}
        </Button>
        <Link
          href={
            mode === "edit" && billId !== undefined
              ? `/erp/finance/bills/${billId}`
              : "/erp/finance/bills"
          }
          className="text-foreground-muted hover:text-foreground text-sm font-bold"
        >
          Cancel
        </Link>
        <p className="text-foreground-muted text-xs">
          The server recalculates every amount. Submit the draft for approval from its
          page.
        </p>
      </div>
    </form>
  );
}

function Block({
  label,
  htmlFor,
  required,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  hint?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <label htmlFor={htmlFor} className="text-foreground text-xs font-semibold">
        {label}
        {required === true && (
          <span aria-hidden="true" className="text-danger ms-0.5">
            *
          </span>
        )}
      </label>
      {children}
      {hint !== undefined && <p className="text-foreground-muted text-xs">{hint}</p>}
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
  className,
  children,
}: {
  label: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span aria-hidden="true" className="text-foreground-muted text-xs xl:hidden">
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
