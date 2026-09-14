"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form-controls";
import { Panel, PanelHeader } from "@/components/ui/primitives";
import type { AccountOption, CustomerRef, PaymentMethodDto } from "../contracts/types";
import { formatMinorAmount } from "../domain/journal";
import { createReceiptAction, updateReceiptAction } from "./ar-actions";
import { CustomerPicker } from "./customer-picker";
import { FormError, fieldError } from "./form-parts";

export type ReceiptFormInitial = {
  customer: CustomerRef;
  receiptDate: string;
  amountMinor: number;
  paymentMethodId: string;
  depositAccountId: string;
  reference: string | null;
  notes: string | null;
};

/** Records money received from a customer as a draft receipt. */
export function ReceiptForm({
  mode,
  receiptId,
  paymentMethods,
  depositAccounts,
  initial,
  defaultDate,
}: {
  mode: "create" | "edit";
  receiptId?: string;
  paymentMethods: PaymentMethodDto[];
  depositAccounts: AccountOption[];
  initial?: ReceiptFormInitial;
  defaultDate: string;
}) {
  const router = useRouter();
  const [customer, setCustomer] = useState<CustomerRef | null>(initial?.customer ?? null);
  const [receiptDate, setReceiptDate] = useState(initial?.receiptDate ?? defaultDate);
  const [amount, setAmount] = useState(
    initial === undefined ? "" : formatMinorAmount(initial.amountMinor),
  );
  const [paymentMethodId, setPaymentMethodId] = useState(initial?.paymentMethodId ?? "");
  const [depositAccountId, setDepositAccountId] = useState(
    initial?.depositAccountId ?? "",
  );
  const [reference, setReference] = useState(initial?.reference ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const [isPending, startTransition] = useTransition();

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setMessage(null);
        setErrors(undefined);
        const payload = {
          crmAccountId: customer?.id ?? "",
          receiptDate,
          amount,
          paymentMethodId,
          depositAccountId,
          reference,
          notes,
        };
        startTransition(async () => {
          const result =
            mode === "edit" && receiptId !== undefined
              ? await updateReceiptAction(receiptId, payload)
              : await createReceiptAction(payload);
          if (result.ok) router.push(`/erp/finance/receipts/${result.data.id}`);
          else {
            setMessage(result.message);
            setErrors(result.fieldErrors);
          }
        });
      }}
    >
      {message !== null && <FormError message={message} />}
      <Panel>
        <PanelHeader
          title="Receipt"
          description="Money received from a customer, in EGP."
        />
        <div className="grid gap-4 p-4 md:grid-cols-2">
          <Field
            label="Customer (CRM company)"
            htmlFor="customer"
            required
            error={fieldError(errors, "crmAccountId")}
            className="md:col-span-2"
          >
            <CustomerPicker
              id="customer"
              value={customer}
              onChange={setCustomer}
              error={fieldError(errors, "crmAccountId")}
            />
          </Field>
          <Field
            label="Receipt date"
            htmlFor="receiptDate"
            required
            error={fieldError(errors, "receiptDate")}
          >
            <Input
              id="receiptDate"
              type="date"
              value={receiptDate}
              onChange={(event) => setReceiptDate(event.target.value)}
            />
          </Field>
          <Field
            label="Amount (EGP)"
            htmlFor="amount"
            required
            error={fieldError(errors, "amount")}
          >
            <Input
              id="amount"
              inputMode="decimal"
              dir="ltr"
              placeholder="0.00"
              value={amount}
              invalid={fieldError(errors, "amount") !== undefined}
              onChange={(event) => setAmount(event.target.value)}
              className="text-end tabular-nums"
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
                  setDepositAccountId(suggested.id);
              }}
            />
          </Field>
          <Field
            label="Deposited to (bank or cash account)"
            htmlFor="depositAccount"
            required
            error={fieldError(errors, "depositAccountId")}
          >
            <Select
              id="depositAccount"
              value={depositAccountId}
              placeholder="Choose an account"
              options={depositAccounts.map((account) => ({
                value: account.id,
                label: `${account.code} — ${account.name}`,
              }))}
              onChange={(event) => setDepositAccountId(event.target.value)}
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
          <Field label="Notes" htmlFor="notes" error={fieldError(errors, "notes")}>
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
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" isPending={isPending}>
          {isPending ? "Saving…" : "Save draft"}
        </Button>
        <Link
          href={
            mode === "edit" && receiptId !== undefined
              ? `/erp/finance/receipts/${receiptId}`
              : "/erp/finance/receipts"
          }
          className="text-foreground-muted hover:text-foreground text-sm font-bold"
        >
          Cancel
        </Link>
        <p className="text-foreground-muted text-xs">
          Post the receipt from its page, then allocate it to invoices.
        </p>
      </div>
    </form>
  );
}
