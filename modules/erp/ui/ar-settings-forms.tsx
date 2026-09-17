"use client";

import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form-controls";
import { useToast } from "@/components/ui/toast";
import type {
  AccountOption,
  AccountRef,
  ArSettingsDto,
  NumberSeriesDto,
  PaymentMethodDto,
  TaxRateDto,
} from "../contracts/types";
import { formatBasisPoints } from "../domain/ar";
import { formatMinorAmount } from "../domain/journal";
import {
  savePaymentMethodAction,
  saveTaxRateAction,
  updateArSettingsAction,
  updateCustomerProfileAction,
  updateNumberSeriesAction,
} from "./ar-actions";
import { FormError, fieldError } from "./form-parts";

const accountLabel = (account: AccountRef) => `${account.code} — ${account.name}`;

/** Approval rules, defaults and aging buckets. */
export function ArSettingsForm({
  settings,
  assetAccounts,
}: {
  settings: ArSettingsDto;
  assetAccounts: AccountOption[];
}) {
  const router = useRouter();
  const notify = useToast();
  const [receivable, setReceivable] = useState(
    settings.defaultReceivableAccount?.id ?? "",
  );
  const [approvalRequired, setApprovalRequired] = useState(
    settings.invoiceApprovalRequired,
  );
  const [threshold, setThreshold] = useState(
    settings.approvalThresholdMinor === null
      ? ""
      : formatMinorAmount(settings.approvalThresholdMinor),
  );
  const [selfApproval, setSelfApproval] = useState(settings.allowSelfApproval);
  const [terms, setTerms] = useState(String(settings.defaultPaymentTermsDays));
  const [buckets, setBuckets] = useState(settings.agingBucketDays.join(", "));
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const [isPending, startTransition] = useTransition();

  return (
    <form
      noValidate
      className="grid gap-4 p-4 md:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        setMessage(null);
        setErrors(undefined);
        startTransition(async () => {
          const result = await updateArSettingsAction({
            defaultReceivableAccountId: receivable,
            invoiceApprovalRequired: approvalRequired,
            approvalThreshold: threshold,
            allowSelfApproval: selfApproval,
            defaultPaymentTermsDays: terms,
            agingBucketDays: buckets,
          });
          if (result.ok) {
            notify("AR settings saved.");
            router.refresh();
          } else {
            setMessage(result.message);
            setErrors(result.fieldErrors);
          }
        });
      }}
    >
      {message !== null && (
        <div className="md:col-span-2">
          <FormError message={message} />
        </div>
      )}
      <Field
        label="Default receivable account"
        htmlFor="receivable"
        hint="Used unless a customer's profile names another."
        error={fieldError(errors, "defaultReceivableAccountId")}
      >
        <Select
          id="receivable"
          value={receivable}
          placeholder="Not set — invoicing is blocked until chosen"
          options={assetAccounts.map((account) => ({
            value: account.id,
            label: accountLabel(account),
          }))}
          onChange={(event) => setReceivable(event.target.value)}
        />
      </Field>
      <Field
        label="Default payment terms (days)"
        htmlFor="terms"
        error={fieldError(errors, "defaultPaymentTermsDays")}
      >
        <Input
          id="terms"
          inputMode="numeric"
          value={terms}
          onChange={(event) => setTerms(event.target.value)}
        />
      </Field>
      <div className="flex flex-col gap-2">
        <Checkbox
          label="Invoices need approval before posting"
          checked={approvalRequired}
          onChange={(event) => setApprovalRequired(event.target.checked)}
        />
        <Checkbox
          label="Allow people to approve invoices they created or submitted"
          checked={selfApproval}
          onChange={(event) => setSelfApproval(event.target.checked)}
        />
      </div>
      <Field
        label="Approval threshold (EGP)"
        htmlFor="threshold"
        hint="Blank: every invoice needs approval. Otherwise only invoices at or above this total."
        error={fieldError(errors, "approvalThreshold")}
      >
        <Input
          id="threshold"
          inputMode="decimal"
          dir="ltr"
          value={threshold}
          disabled={!approvalRequired}
          onChange={(event) => setThreshold(event.target.value)}
        />
      </Field>
      <Field
        label="Aging bucket boundaries (days past due)"
        htmlFor="buckets"
        hint="e.g. 30, 60, 90, 120 gives Current, 1–30, 31–60, 61–90, 91–120, 120+."
        error={fieldError(errors, "agingBucketDays")}
      >
        <Input
          id="buckets"
          value={buckets}
          dir="ltr"
          onChange={(event) => setBuckets(event.target.value)}
        />
      </Field>
      <div className="flex items-end md:col-span-2">
        <Button type="submit" variant="primary" isPending={isPending}>
          {isPending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}

export function TaxRateFormButton({
  rate,
  liabilityAccounts,
  inputTaxAccounts,
}: {
  rate?: TaxRateDto;
  liabilityAccounts: AccountOption[];
  /** Asset or expense accounts that can hold recoverable tax on purchases (ADR-033). */
  inputTaxAccounts: AccountOption[];
}) {
  const router = useRouter();
  const notify = useToast();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState(rate?.code ?? "");
  const [name, setName] = useState(rate?.name ?? "");
  const [nameAr, setNameAr] = useState(rate?.nameAr ?? "");
  const [value, setValue] = useState(
    rate === undefined ? "" : formatBasisPoints(rate.rateBasisPoints).replace("%", ""),
  );
  const [taxAccountId, setTaxAccountId] = useState(rate?.taxAccount.id ?? "");
  const [inputTaxAccountId, setInputTaxAccountId] = useState(
    rate?.inputTaxAccount?.id ?? "",
  );
  const [isActive, setIsActive] = useState(rate?.isActive ?? true);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <Button
        size={rate === undefined ? "md" : "sm"}
        variant={rate === undefined ? "primary" : "secondary"}
        icon={
          rate === undefined ? (
            <Plus aria-hidden="true" className="size-4" />
          ) : (
            <Pencil aria-hidden="true" className="size-3.5" />
          )
        }
        onClick={() => {
          setMessage(null);
          setErrors(undefined);
          setOpen(true);
        }}
      >
        {rate === undefined ? "New tax rate" : "Edit"}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={rate === undefined ? "New tax rate" : `Edit tax rate ${rate.code}`}
        description="Existing invoice and bill lines keep the rate they were calculated with."
      >
        {message !== null && <FormError message={message} />}
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            startTransition(async () => {
              const result = await saveTaxRateAction(rate?.id ?? null, {
                code,
                name,
                nameAr,
                rate: value,
                taxAccountId,
                inputTaxAccountId,
                isActive,
              });
              if (result.ok) {
                setOpen(false);
                notify("Tax rate saved.");
                router.refresh();
              } else {
                setMessage(result.message);
                setErrors(result.fieldErrors);
              }
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Code"
              htmlFor="tax-code"
              required
              error={fieldError(errors, "code")}
            >
              <Input
                id="tax-code"
                value={code}
                dir="ltr"
                maxLength={20}
                placeholder="VAT14"
                onChange={(event) => setCode(event.target.value)}
              />
            </Field>
            <Field
              label="Rate (%)"
              htmlFor="tax-rate"
              required
              error={fieldError(errors, "rate")}
            >
              <Input
                id="tax-rate"
                value={value}
                dir="ltr"
                inputMode="decimal"
                placeholder="14"
                onChange={(event) => setValue(event.target.value)}
              />
            </Field>
          </div>
          <Field
            label="Name"
            htmlFor="tax-name"
            required
            error={fieldError(errors, "name")}
          >
            <Input
              id="tax-name"
              value={name}
              dir="auto"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field
            label="Arabic name"
            htmlFor="tax-name-ar"
            error={fieldError(errors, "nameAr")}
          >
            <Input
              id="tax-name-ar"
              value={nameAr}
              dir="rtl"
              lang="ar"
              onChange={(event) => setNameAr(event.target.value)}
            />
          </Field>
          <Field
            label="Tax account (liability)"
            htmlFor="tax-account"
            required
            error={fieldError(errors, "taxAccountId")}
          >
            <Select
              id="tax-account"
              value={taxAccountId}
              placeholder="Choose an account"
              options={liabilityAccounts.map((account) => ({
                value: account.id,
                label: accountLabel(account),
              }))}
              onChange={(event) => setTaxAccountId(event.target.value)}
            />
          </Field>
          <Field
            label="Input tax account (recoverable VAT on bills)"
            htmlFor="tax-input-account"
            hint="Blank: the rate cannot be used on vendor bills."
            error={fieldError(errors, "inputTaxAccountId")}
          >
            <Select
              id="tax-input-account"
              value={inputTaxAccountId}
              placeholder="Not used on bills"
              options={inputTaxAccounts.map((account) => ({
                value: account.id,
                label: accountLabel(account),
              }))}
              onChange={(event) => setInputTaxAccountId(event.target.value)}
            />
          </Field>
          <Checkbox
            label="Active — offered on new invoice lines"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
          />
          <DialogActions>
            <Button onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isPending={isPending}>
              {isPending ? "Saving…" : "Save tax rate"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </>
  );
}

export function PaymentMethodFormButton({
  method,
  depositAccounts,
}: {
  method?: PaymentMethodDto;
  depositAccounts: AccountOption[];
}) {
  const router = useRouter();
  const notify = useToast();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState(method?.code ?? "");
  const [name, setName] = useState(method?.name ?? "");
  const [nameAr, setNameAr] = useState(method?.nameAr ?? "");
  const [depositId, setDepositId] = useState(method?.defaultDepositAccount?.id ?? "");
  const [sortOrder, setSortOrder] = useState(String(method?.sortOrder ?? 0));
  const [isActive, setIsActive] = useState(method?.isActive ?? true);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <Button
        size={method === undefined ? "md" : "sm"}
        variant={method === undefined ? "primary" : "secondary"}
        icon={
          method === undefined ? (
            <Plus aria-hidden="true" className="size-4" />
          ) : (
            <Pencil aria-hidden="true" className="size-3.5" />
          )
        }
        onClick={() => {
          setMessage(null);
          setErrors(undefined);
          setOpen(true);
        }}
      >
        {method === undefined ? "New payment method" : "Edit"}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={method === undefined ? "New payment method" : `Edit ${method.name}`}
      >
        {message !== null && <FormError message={message} />}
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            startTransition(async () => {
              const result = await savePaymentMethodAction(method?.id ?? null, {
                code,
                name,
                nameAr,
                defaultDepositAccountId: depositId,
                sortOrder,
                isActive,
              });
              if (result.ok) {
                setOpen(false);
                notify("Payment method saved.");
                router.refresh();
              } else {
                setMessage(result.message);
                setErrors(result.fieldErrors);
              }
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Code"
              htmlFor="method-code"
              required
              error={fieldError(errors, "code")}
            >
              <Input
                id="method-code"
                value={code}
                dir="ltr"
                maxLength={20}
                onChange={(event) => setCode(event.target.value)}
              />
            </Field>
            <Field
              label="Sort order"
              htmlFor="method-sort"
              error={fieldError(errors, "sortOrder")}
            >
              <Input
                id="method-sort"
                value={sortOrder}
                inputMode="numeric"
                onChange={(event) => setSortOrder(event.target.value)}
              />
            </Field>
          </div>
          <Field
            label="Name"
            htmlFor="method-name"
            required
            error={fieldError(errors, "name")}
          >
            <Input
              id="method-name"
              value={name}
              dir="auto"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field
            label="Arabic name"
            htmlFor="method-name-ar"
            error={fieldError(errors, "nameAr")}
          >
            <Input
              id="method-name-ar"
              value={nameAr}
              dir="rtl"
              lang="ar"
              onChange={(event) => setNameAr(event.target.value)}
            />
          </Field>
          <Field
            label="Suggested deposit account"
            htmlFor="method-deposit"
            error={fieldError(errors, "defaultDepositAccountId")}
          >
            <Select
              id="method-deposit"
              value={depositId}
              placeholder="None"
              options={depositAccounts.map((account) => ({
                value: account.id,
                label: accountLabel(account),
              }))}
              onChange={(event) => setDepositId(event.target.value)}
            />
          </Field>
          <Checkbox
            label="Active — offered on new receipts"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
          />
          <DialogActions>
            <Button onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isPending={isPending}>
              {isPending ? "Saving…" : "Save payment method"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </>
  );
}

export function NumberSeriesForm({
  series,
  label,
}: {
  series: NumberSeriesDto;
  label: string;
}) {
  const router = useRouter();
  const notify = useToast();
  const [prefix, setPrefix] = useState(series.prefix);
  const [padding, setPadding] = useState(String(series.padding));
  const [resetsYearly, setResetsYearly] = useState(series.resetsYearly);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const [isPending, startTransition] = useTransition();

  const year = new Date().getUTCFullYear();
  const example = `${prefix.toUpperCase()}-${resetsYearly ? `${year}-` : ""}${"1".padStart(Number(padding) || 1, "0")}`;

  return (
    <form
      noValidate
      className="grid items-end gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_8rem_6rem_auto_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await updateNumberSeriesAction(series.id, {
            prefix,
            padding,
            resetsYearly,
          });
          if (result.ok) {
            setMessage(null);
            setErrors(undefined);
            notify(`${label} numbering saved.`);
            router.refresh();
          } else {
            setMessage(result.message);
            setErrors(result.fieldErrors);
          }
        });
      }}
    >
      <div>
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-foreground-muted text-xs">
          Next looks like <span dir="ltr">{example}</span>
        </p>
        {message !== null && <p className="text-danger text-xs">{message}</p>}
      </div>
      <Field
        label="Prefix"
        htmlFor={`prefix-${series.id}`}
        error={fieldError(errors, "prefix")}
      >
        <Input
          id={`prefix-${series.id}`}
          value={prefix}
          dir="ltr"
          onChange={(event) => setPrefix(event.target.value)}
        />
      </Field>
      <Field
        label="Digits"
        htmlFor={`padding-${series.id}`}
        error={fieldError(errors, "padding")}
      >
        <Input
          id={`padding-${series.id}`}
          value={padding}
          inputMode="numeric"
          onChange={(event) => setPadding(event.target.value)}
        />
      </Field>
      <Checkbox
        label="Restart each year"
        checked={resetsYearly}
        onChange={(event) => setResetsYearly(event.target.checked)}
      />
      <Button type="submit" size="sm" isPending={isPending}>
        Save
      </Button>
    </form>
  );
}

export function CustomerProfileFormButton({
  crmAccountId,
  profile,
  assetAccounts,
  defaultPaymentTermsDays,
}: {
  crmAccountId: string;
  profile: {
    paymentTermsDays: number | null;
    creditLimitMinor: number | null;
    receivableAccount: AccountRef | null;
    notes: string | null;
  } | null;
  assetAccounts: AccountOption[];
  defaultPaymentTermsDays: number;
}) {
  const router = useRouter();
  const notify = useToast();
  const [open, setOpen] = useState(false);
  const [terms, setTerms] = useState(
    profile?.paymentTermsDays === null || profile === null
      ? ""
      : String(profile.paymentTermsDays),
  );
  const [creditLimit, setCreditLimit] = useState(
    profile?.creditLimitMinor === null || profile === null
      ? ""
      : formatMinorAmount(profile.creditLimitMinor),
  );
  const [receivable, setReceivable] = useState(profile?.receivableAccount?.id ?? "");
  const [notes, setNotes] = useState(profile?.notes ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <Button
        size="sm"
        icon={<Pencil aria-hidden="true" className="size-3.5" />}
        onClick={() => setOpen(true)}
      >
        Edit billing profile
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Billing profile"
        description="Accounting terms for this CRM customer. The customer's details stay in CRM."
      >
        {message !== null && <FormError message={message} />}
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            startTransition(async () => {
              const result = await updateCustomerProfileAction(crmAccountId, {
                paymentTermsDays: terms,
                creditLimit,
                receivableAccountId: receivable,
                notes,
              });
              if (result.ok) {
                setOpen(false);
                notify("Billing profile saved.");
                router.refresh();
              } else {
                setMessage(result.message);
                setErrors(result.fieldErrors);
              }
            });
          }}
        >
          <Field
            label="Payment terms (days)"
            htmlFor="profile-terms"
            hint={`Blank uses the default of ${defaultPaymentTermsDays} days.`}
            error={fieldError(errors, "paymentTermsDays")}
          >
            <Input
              id="profile-terms"
              value={terms}
              inputMode="numeric"
              onChange={(event) => setTerms(event.target.value)}
            />
          </Field>
          <Field
            label="Credit limit (EGP)"
            htmlFor="profile-limit"
            hint="Shown against the balance; not enforced yet."
            error={fieldError(errors, "creditLimit")}
          >
            <Input
              id="profile-limit"
              value={creditLimit}
              inputMode="decimal"
              dir="ltr"
              onChange={(event) => setCreditLimit(event.target.value)}
            />
          </Field>
          <Field
            label="Receivable account"
            htmlFor="profile-receivable"
            hint="Blank uses the AR default."
            error={fieldError(errors, "receivableAccountId")}
          >
            <Select
              id="profile-receivable"
              value={receivable}
              placeholder="AR default"
              options={assetAccounts.map((account) => ({
                value: account.id,
                label: accountLabel(account),
              }))}
              onChange={(event) => setReceivable(event.target.value)}
            />
          </Field>
          <Field
            label="Notes"
            htmlFor="profile-notes"
            error={fieldError(errors, "notes")}
          >
            <Textarea
              id="profile-notes"
              value={notes}
              rows={2}
              dir="auto"
              maxLength={1000}
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>
          <DialogActions>
            <Button onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isPending={isPending}>
              {isPending ? "Saving…" : "Save profile"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </>
  );
}
