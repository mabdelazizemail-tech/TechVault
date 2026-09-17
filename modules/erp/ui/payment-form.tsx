"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Field,
  Input,
  Select,
  Textarea,
  controlClasses,
} from "@/components/ui/form-controls";
import { EmptyState, Panel, PanelHeader } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import type {
  AccountOption,
  OpenBillOption,
  PaymentMethodDto,
  VendorRef,
  WithholdingTaxRateDto,
} from "../contracts/types";
import {
  calculatePaymentLine,
  paymentTotals,
  type PaymentLineAmounts,
} from "../domain/ap";
import { formatBasisPoints } from "../domain/ar";
import { formatMinorAmount, parseAmountText } from "../domain/journal";
import { listOpenBillsAction, savePaymentAction } from "./ap-actions";
import { FormError, fieldError } from "./form-parts";
import { VendorPicker } from "./vendor-picker";

/**
 * A supplier payment: which of the vendor's posted bills it settles, how much of
 * each, and the withholding tax rate for each. Withholding and cash shown here are a
 * preview; the server calculates both again from the amount and the rate (ADR-033).
 */

export type PaymentFormInitial = {
  vendor: VendorRef;
  paymentDate: string;
  paymentMethodId: string;
  bankAccountId: string;
  reference: string | null;
  notes: string | null;
  lines: {
    bill: OpenBillOption;
    amountMinor: number;
    withholdingTaxRateId: string | null;
  }[];
};

type LineState = { selected: boolean; amount: string; rateId: string };

export function PaymentForm({
  mode,
  paymentId,
  paymentMethods,
  bankAccounts,
  withholdingRates,
  initial,
  initialVendor,
  initialOpenBills,
  defaultWithholdingRateId,
  defaultDate,
}: {
  mode: "create" | "edit";
  paymentId?: string;
  paymentMethods: PaymentMethodDto[];
  bankAccounts: AccountOption[];
  withholdingRates: WithholdingTaxRateDto[];
  initial?: PaymentFormInitial;
  /** A vendor chosen before the form opened, e.g. from the vendor's page. */
  initialVendor?: VendorRef;
  /** The open bills of the initial vendor, loaded by the page. */
  initialOpenBills?: OpenBillOption[];
  /** The vendor's usual withholding rate, suggested for each bill chosen. */
  defaultWithholdingRateId?: string | null;
  defaultDate: string;
}) {
  const router = useRouter();
  const [vendor, setVendor] = useState<VendorRef | null>(
    initial?.vendor ?? initialVendor ?? null,
  );
  const [paymentDate, setPaymentDate] = useState(initial?.paymentDate ?? defaultDate);
  const [paymentMethodId, setPaymentMethodId] = useState(initial?.paymentMethodId ?? "");
  const [bankAccountId, setBankAccountId] = useState(initial?.bankAccountId ?? "");
  const [reference, setReference] = useState(initial?.reference ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [bills, setBills] = useState<OpenBillOption[]>(() => {
    const open = initialOpenBills ?? [];
    // Keep the bills a saved draft already names, even if no longer open.
    const named = (initial?.lines ?? [])
      .map((line) => line.bill)
      .filter((bill) => !open.some((candidate) => candidate.id === bill.id));
    return [...open, ...named];
  });
  const [lines, setLines] = useState<Record<string, LineState>>(() =>
    Object.fromEntries(
      (initial?.lines ?? []).map((line) => [
        line.bill.id,
        {
          selected: true,
          amount: formatMinorAmount(line.amountMinor),
          rateId: line.withholdingTaxRateId ?? "",
        },
      ]),
    ),
  );
  const [billsMessage, setBillsMessage] = useState<string | null>(null);
  const [isLoadingBills, startLoadingBills] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const [isPending, startTransition] = useTransition();

  const loadBills = (vendorId: string) => {
    startLoadingBills(async () => {
      const result = await listOpenBillsAction(vendorId);
      if (result.ok) {
        setBillsMessage(null);
        setBills(result.data);
      } else {
        setBillsMessage(result.message);
      }
    });
  };

  const rateById = new Map(withholdingRates.map((rate) => [rate.id, rate]));
  // The suggestion belongs to the vendor the page loaded, not one chosen afterwards.
  const suggestedRate =
    vendor?.id === (initial?.vendor.id ?? initialVendor?.id) &&
    defaultWithholdingRateId !== null &&
    defaultWithholdingRateId !== undefined &&
    rateById.has(defaultWithholdingRateId)
      ? defaultWithholdingRateId
      : "";

  const preview = new Map<string, PaymentLineAmounts | null>();
  for (const bill of bills) {
    const line = lines[bill.id];
    if (line?.selected !== true) continue;
    const amount = parseAmountText(line.amount);
    preview.set(
      bill.id,
      amount.ok && amount.minor > 0n
        ? calculatePaymentLine({
            amountMinor: amount.minor,
            billNetMinor: BigInt(bill.netMinor),
            billTotalMinor: BigInt(bill.totalMinor),
            withholdingBasisPoints: rateById.get(line.rateId)?.rateBasisPoints ?? null,
          })
        : null,
    );
  }
  const totals = paymentTotals(
    [...preview.values()].filter(
      (amounts): amounts is PaymentLineAmounts => amounts !== null,
    ),
  );
  const chosen = bills.filter((bill) => lines[bill.id]?.selected === true);

  const updateLine = (billId: string, patch: Partial<LineState>) =>
    setLines((current) => ({
      ...current,
      [billId]: {
        selected: false,
        amount: "",
        rateId: "",
        ...current[billId],
        ...patch,
      },
    }));

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setMessage(null);
        setErrors(undefined);
        const payload = {
          vendorId: vendor?.id ?? "",
          paymentDate,
          paymentMethodId,
          bankAccountId,
          reference,
          notes,
          lines: chosen.map((bill) => ({
            billId: bill.id,
            amount: lines[bill.id]?.amount ?? "",
            withholdingTaxRateId: lines[bill.id]?.rateId ?? "",
          })),
        };
        startTransition(async () => {
          const result = await savePaymentAction(
            mode === "edit" && paymentId !== undefined ? paymentId : null,
            payload,
          );
          if (result.ok) router.push(`/erp/finance/payments/${result.data.id}`);
          else {
            setMessage(result.message);
            setErrors(result.fieldErrors);
          }
        });
      }}
    >
      {message !== null && <FormError message={message} />}
      <Panel>
        <PanelHeader title="Payment" description="Money paid to a vendor, in EGP." />
        <div className="grid gap-4 p-4 md:grid-cols-2">
          <Field
            label="Vendor"
            htmlFor="vendor"
            required
            error={fieldError(errors, "vendorId")}
            className="md:col-span-2"
          >
            <VendorPicker
              id="vendor"
              value={vendor}
              onChange={(next) => {
                setVendor(next);
                setBills([]);
                setLines({});
                setBillsMessage(null);
                if (next !== null) loadBills(next.id);
              }}
              error={fieldError(errors, "vendorId")}
            />
          </Field>
          <Field
            label="Payment date"
            htmlFor="paymentDate"
            required
            error={fieldError(errors, "paymentDate")}
          >
            <Input
              id="paymentDate"
              type="date"
              value={paymentDate}
              onChange={(event) => setPaymentDate(event.target.value)}
            />
          </Field>
          <Field
            label="Payment method"
            htmlFor="paymentMethod"
            required
            error={fieldError(errors, "paymentMethodId")}
          >
            <Select
              id="paymentMethod"
              value={paymentMethodId}
              placeholder="Choose a method"
              options={paymentMethods.map((method) => ({
                value: method.id,
                label: method.name,
              }))}
              onChange={(event) => {
                const next = event.target.value;
                setPaymentMethodId(next);
                const suggested = paymentMethods.find(
                  (method) => method.id === next,
                )?.defaultDepositAccount;
                if (suggested !== null && suggested !== undefined)
                  setBankAccountId(suggested.id);
              }}
            />
          </Field>
          <Field
            label="Paid from (bank or cash account)"
            htmlFor="bankAccount"
            required
            error={fieldError(errors, "bankAccountId")}
          >
            <Select
              id="bankAccount"
              value={bankAccountId}
              placeholder="Choose an account"
              options={bankAccounts.map((account) => ({
                value: account.id,
                label: `${account.code} — ${account.name}`,
              }))}
              onChange={(event) => setBankAccountId(event.target.value)}
            />
          </Field>
          <Field
            label="Reference"
            htmlFor="reference"
            error={fieldError(errors, "reference")}
          >
            <Input
              id="reference"
              value={reference}
              maxLength={100}
              dir="auto"
              placeholder="Transfer or cheque number"
              onChange={(event) => setReference(event.target.value)}
            />
          </Field>
          <Field
            label="Notes"
            htmlFor="notes"
            error={fieldError(errors, "notes")}
            className="md:col-span-2"
          >
            <Textarea
              id="notes"
              value={notes}
              maxLength={1000}
              rows={2}
              dir="auto"
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>
        </div>
      </Panel>

      <Panel className="overflow-hidden">
        <PanelHeader
          title="Bills to pay"
          description="Tax is withheld on the part of each amount before VAT."
        />
        {fieldError(errors, "lines") !== undefined && (
          <p role="alert" className="text-danger px-4 pt-3 text-sm">
            {fieldError(errors, "lines")}
          </p>
        )}
        {billsMessage !== null && (
          <p role="alert" className="text-danger px-4 pt-3 text-sm">
            {billsMessage}
          </p>
        )}
        {vendor === null ? (
          <EmptyState
            title="Choose a vendor"
            description="The vendor's posted bills that still owe money are listed here."
          />
        ) : bills.length === 0 ? (
          <EmptyState
            title={isLoadingBills ? "Loading bills…" : "Nothing to pay"}
            description={
              isLoadingBills
                ? "Looking up this vendor's open bills."
                : "This vendor has no posted bill with an amount outstanding."
            }
          />
        ) : (
          <ul className="divide-border divide-y">
            {bills.map((bill) => {
              const index = chosen.findIndex((candidate) => candidate.id === bill.id);
              const prefix = `lines.${index}`;
              const line = lines[bill.id];
              const selected = line?.selected === true;
              const amounts = preview.get(bill.id);
              return (
                <li
                  key={bill.id}
                  className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1.4fr)_9rem_minmax(0,1fr)_10rem] md:items-start"
                >
                  <label className="flex cursor-pointer items-start gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(event) =>
                        updateLine(
                          bill.id,
                          event.target.checked
                            ? {
                                selected: true,
                                amount:
                                  line?.amount !== undefined && line.amount !== ""
                                    ? line.amount
                                    : formatMinorAmount(bill.outstandingMinor),
                                rateId: line?.rateId ?? suggestedRate,
                              }
                            : { selected: false },
                        )
                      }
                      className="accent-foreground mt-0.5 size-4 cursor-pointer pointer-coarse:size-5"
                    />
                    <span className="min-w-0">
                      <span className="block font-semibold" dir="ltr">
                        {bill.billNumber}
                      </span>
                      <span className="text-foreground-muted block text-xs">
                        Supplier invoice{" "}
                        <span dir="auto">{bill.vendorInvoiceNumber}</span> · due{" "}
                        {bill.dueDate}
                      </span>
                      <span className="text-foreground-muted block text-xs tabular-nums">
                        Outstanding{" "}
                        <span dir="ltr">{formatMinorAmount(bill.outstandingMinor)}</span>{" "}
                        of <span dir="ltr">{formatMinorAmount(bill.totalMinor)}</span>
                      </span>
                    </span>
                  </label>
                  {selected ? (
                    <>
                      <div className="flex flex-col gap-1">
                        <span className="text-foreground-muted text-xs md:sr-only">
                          Amount settled
                        </span>
                        <input
                          aria-label={`Amount settled on ${bill.billNumber}`}
                          inputMode="decimal"
                          dir="ltr"
                          value={line?.amount ?? ""}
                          onChange={(event) =>
                            updateLine(bill.id, { amount: event.target.value })
                          }
                          className={cn(
                            controlClasses,
                            "min-h-10 text-end tabular-nums",
                            fieldError(errors, `${prefix}.amount`) !== undefined
                              ? "border-danger"
                              : "border-border-strong",
                          )}
                        />
                        {fieldError(errors, `${prefix}.amount`) !== undefined && (
                          <p role="alert" className="text-danger text-xs">
                            {fieldError(errors, `${prefix}.amount`)}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-foreground-muted text-xs md:sr-only">
                          Withholding tax
                        </span>
                        <select
                          aria-label={`Withholding tax on ${bill.billNumber}`}
                          value={line?.rateId ?? ""}
                          onChange={(event) =>
                            updateLine(bill.id, { rateId: event.target.value })
                          }
                          className={cn(
                            controlClasses,
                            "border-border-strong min-h-10 cursor-pointer",
                          )}
                        >
                          <option value="">No withholding</option>
                          {withholdingRates.map((rate) => (
                            <option key={rate.id} value={rate.id}>
                              {rate.code} ({formatBasisPoints(rate.rateBasisPoints)})
                            </option>
                          ))}
                        </select>
                        {fieldError(errors, `${prefix}.withholdingTaxRateId`) !==
                          undefined && (
                          <p role="alert" className="text-danger text-xs">
                            {fieldError(errors, `${prefix}.withholdingTaxRateId`)}
                          </p>
                        )}
                        {fieldError(errors, `${prefix}.billId`) !== undefined && (
                          <p role="alert" className="text-danger text-xs">
                            {fieldError(errors, `${prefix}.billId`)}
                          </p>
                        )}
                      </div>
                      <dl className="grid grid-cols-[1fr_auto] gap-x-4 text-xs tabular-nums">
                        <dt className="text-foreground-muted">Withheld</dt>
                        <dd dir="ltr" className="text-end">
                          {amounts === null || amounts === undefined
                            ? "—"
                            : formatMinorAmount(amounts.withheldMinor)}
                        </dd>
                        <dt className="font-bold">Paid out</dt>
                        <dd dir="ltr" className="text-end font-bold">
                          {amounts === null || amounts === undefined
                            ? "—"
                            : formatMinorAmount(amounts.cashMinor)}
                        </dd>
                      </dl>
                    </>
                  ) : (
                    <p className="text-foreground-muted text-xs md:col-span-3 md:self-center">
                      Not paid by this payment.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <dl
          className="rule-t ms-auto grid max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1 px-4 py-3 text-sm tabular-nums"
          aria-live="polite"
        >
          <dt className="text-foreground-muted">Bills settled</dt>
          <dd dir="ltr" className="text-end">
            {formatMinorAmount(totals.amountMinor)}
          </dd>
          <dt className="text-foreground-muted">Tax withheld</dt>
          <dd dir="ltr" className="text-end">
            {formatMinorAmount(totals.withheldMinor)}
          </dd>
          <dt className="font-bold">Paid out (EGP)</dt>
          <dd dir="ltr" className="text-end font-bold">
            {formatMinorAmount(totals.cashMinor)}
          </dd>
        </dl>
      </Panel>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" isPending={isPending}>
          {isPending ? "Saving…" : "Save draft"}
        </Button>
        <Link
          href={
            mode === "edit" && paymentId !== undefined
              ? `/erp/finance/payments/${paymentId}`
              : "/erp/finance/payments"
          }
          className="text-foreground-muted hover:text-foreground text-sm font-bold"
        >
          Cancel
        </Link>
        <p className="text-foreground-muted text-xs">
          The server recalculates withholding and cash. Submit the draft for approval from
          its page.
        </p>
      </div>
    </form>
  );
}
