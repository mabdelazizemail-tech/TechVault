"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form-controls";
import { Panel, PanelHeader } from "@/components/ui/primitives";
import type {
  AccountOption,
  CustomerRef,
  WithholdingTaxRateDto,
} from "../contracts/types";
import { formatBasisPoints } from "../domain/ar";
import { saveVendorAction } from "./ap-actions";
import { CustomerPicker } from "./customer-picker";
import { FormError, fieldError } from "./form-parts";

export type VendorFormInitial = {
  name: string;
  nameAr: string | null;
  taxRegistrationNumber: string | null;
  crmAccount: CustomerRef | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  paymentTermsDays: number | null;
  payableAccountId: string | null;
  defaultExpenseAccountId: string | null;
  defaultWithholdingTaxRateId: string | null;
  notes: string | null;
  isActive: boolean;
};

const accountLabel = (account: AccountOption) => `${account.code} — ${account.name}`;

/**
 * A supplier as ERP records it (ADR-033). A vendor may be linked to a CRM company,
 * but ERP owns the vendor record: the link copies nothing.
 */
export function VendorForm({
  vendorId,
  initial,
  payableAccounts,
  expenseAccounts,
  withholdingRates,
  canLinkCrm,
}: {
  vendorId?: string;
  initial?: VendorFormInitial;
  payableAccounts: AccountOption[];
  expenseAccounts: AccountOption[];
  withholdingRates: WithholdingTaxRateDto[];
  canLinkCrm: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [nameAr, setNameAr] = useState(initial?.nameAr ?? "");
  const [taxRegistrationNumber, setTaxRegistrationNumber] = useState(
    initial?.taxRegistrationNumber ?? "",
  );
  const [crmAccount, setCrmAccount] = useState<CustomerRef | null>(
    initial?.crmAccount ?? null,
  );
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [terms, setTerms] = useState(
    initial?.paymentTermsDays === null || initial === undefined
      ? ""
      : String(initial.paymentTermsDays),
  );
  const [payableAccountId, setPayableAccountId] = useState(
    initial?.payableAccountId ?? "",
  );
  const [expenseAccountId, setExpenseAccountId] = useState(
    initial?.defaultExpenseAccountId ?? "",
  );
  const [withholdingRateId, setWithholdingRateId] = useState(
    initial?.defaultWithholdingTaxRateId ?? "",
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
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
        startTransition(async () => {
          const result = await saveVendorAction(vendorId ?? null, {
            name,
            nameAr,
            taxRegistrationNumber,
            crmAccountId: crmAccount?.id ?? "",
            email,
            phone,
            address,
            paymentTermsDays: terms,
            payableAccountId,
            defaultExpenseAccountId: expenseAccountId,
            defaultWithholdingTaxRateId: withholdingRateId,
            notes,
            isActive,
          });
          if (result.ok) router.push(`/erp/finance/vendors/${result.data.id}`);
          else {
            setMessage(result.message);
            setErrors(result.fieldErrors);
          }
        });
      }}
    >
      {message !== null && <FormError message={message} />}
      <Panel>
        <PanelHeader title="Vendor" />
        <div className="grid gap-4 p-4 md:grid-cols-2">
          <Field label="Name" htmlFor="name" required error={fieldError(errors, "name")}>
            <Input
              id="name"
              value={name}
              maxLength={200}
              dir="auto"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field
            label="Arabic name"
            htmlFor="nameAr"
            error={fieldError(errors, "nameAr")}
          >
            <Input
              id="nameAr"
              value={nameAr}
              maxLength={200}
              dir="rtl"
              lang="ar"
              onChange={(event) => setNameAr(event.target.value)}
            />
          </Field>
          <Field
            label="Tax registration number"
            htmlFor="trn"
            error={fieldError(errors, "taxRegistrationNumber")}
          >
            <Input
              id="trn"
              value={taxRegistrationNumber}
              maxLength={50}
              dir="ltr"
              onChange={(event) => setTaxRegistrationNumber(event.target.value)}
            />
          </Field>
          {canLinkCrm ? (
            <Field
              label="CRM company (optional)"
              htmlFor="crm"
              hint="Link a supplier that is also in the CRM. Nothing is copied."
              error={fieldError(errors, "crmAccountId")}
            >
              <CustomerPicker
                id="crm"
                value={crmAccount}
                onChange={setCrmAccount}
                error={fieldError(errors, "crmAccountId")}
              />
            </Field>
          ) : (
            <div />
          )}
          <Field label="Email" htmlFor="email" error={fieldError(errors, "email")}>
            <Input
              id="email"
              type="email"
              value={email}
              maxLength={200}
              dir="ltr"
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field label="Phone" htmlFor="phone" error={fieldError(errors, "phone")}>
            <Input
              id="phone"
              type="tel"
              value={phone}
              maxLength={50}
              dir="ltr"
              onChange={(event) => setPhone(event.target.value)}
            />
          </Field>
          <Field
            label="Address"
            htmlFor="address"
            error={fieldError(errors, "address")}
            className="md:col-span-2"
          >
            <Textarea
              id="address"
              value={address}
              maxLength={500}
              rows={2}
              dir="auto"
              onChange={(event) => setAddress(event.target.value)}
            />
          </Field>
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Accounting defaults"
          description="Used when recording this vendor's bills and payments."
        />
        <div className="grid gap-4 p-4 md:grid-cols-2">
          <Field
            label="Payment terms (days)"
            htmlFor="terms"
            hint="Blank uses the AP default."
            error={fieldError(errors, "paymentTermsDays")}
          >
            <Input
              id="terms"
              value={terms}
              inputMode="numeric"
              onChange={(event) => setTerms(event.target.value)}
            />
          </Field>
          <Field
            label="Payable account"
            htmlFor="payable"
            hint="Blank uses the AP default."
            error={fieldError(errors, "payableAccountId")}
          >
            <Select
              id="payable"
              value={payableAccountId}
              placeholder="AP default"
              options={payableAccounts.map((account) => ({
                value: account.id,
                label: accountLabel(account),
              }))}
              onChange={(event) => setPayableAccountId(event.target.value)}
            />
          </Field>
          <Field
            label="Default expense account"
            htmlFor="expense"
            hint="Pre-filled on new bill lines."
            error={fieldError(errors, "defaultExpenseAccountId")}
          >
            <Select
              id="expense"
              value={expenseAccountId}
              placeholder="None"
              options={expenseAccounts.map((account) => ({
                value: account.id,
                label: accountLabel(account),
              }))}
              onChange={(event) => setExpenseAccountId(event.target.value)}
            />
          </Field>
          <Field
            label="Default withholding tax"
            htmlFor="withholding"
            hint="Suggested for each bill when paying from this vendor's page."
            error={fieldError(errors, "defaultWithholdingTaxRateId")}
          >
            <Select
              id="withholding"
              value={withholdingRateId}
              placeholder="No withholding"
              options={withholdingRates.map((rate) => ({
                value: rate.id,
                label: `${rate.code} (${formatBasisPoints(rate.rateBasisPoints)})`,
              }))}
              onChange={(event) => setWithholdingRateId(event.target.value)}
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
          <Checkbox
            label="Active — new bills and payments can use this vendor"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
          />
        </div>
      </Panel>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" isPending={isPending}>
          {isPending ? "Saving…" : "Save vendor"}
        </Button>
        <Link
          href={
            vendorId !== undefined
              ? `/erp/finance/vendors/${vendorId}`
              : "/erp/finance/vendors"
          }
          className="text-foreground-muted hover:text-foreground text-sm font-bold"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
