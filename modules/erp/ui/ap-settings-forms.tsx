"use client";

import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select } from "@/components/ui/form-controls";
import { useToast } from "@/components/ui/toast";
import type {
  AccountOption,
  ApSettingsDto,
  WithholdingTaxRateDto,
} from "../contracts/types";
import { formatBasisPoints } from "../domain/ar";
import { formatMinorAmount } from "../domain/journal";
import { saveWithholdingTaxRateAction, updateApSettingsAction } from "./ap-actions";
import { FormError, fieldError } from "./form-parts";

const accountLabel = (account: AccountOption) => `${account.code} — ${account.name}`;
const amountText = (minor: number | null) =>
  minor === null ? "" : formatMinorAmount(minor);

/**
 * Accounts payable rules (ADR-033). Bills and payments are approved separately, each
 * with its own threshold; self-approval applies to both.
 */
export function ApSettingsForm({
  settings,
  liabilityAccounts,
}: {
  settings: ApSettingsDto;
  liabilityAccounts: AccountOption[];
}) {
  const router = useRouter();
  const notify = useToast();
  const [payable, setPayable] = useState(settings.defaultPayableAccount?.id ?? "");
  const [billApproval, setBillApproval] = useState(settings.billApprovalRequired);
  const [billThreshold, setBillThreshold] = useState(
    amountText(settings.billApprovalThresholdMinor),
  );
  const [paymentApproval, setPaymentApproval] = useState(
    settings.paymentApprovalRequired,
  );
  const [paymentThreshold, setPaymentThreshold] = useState(
    amountText(settings.paymentApprovalThresholdMinor),
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
          const result = await updateApSettingsAction({
            defaultPayableAccountId: payable,
            billApprovalRequired: billApproval,
            billApprovalThreshold: billThreshold,
            paymentApprovalRequired: paymentApproval,
            paymentApprovalThreshold: paymentThreshold,
            allowSelfApproval: selfApproval,
            defaultPaymentTermsDays: terms,
            agingBucketDays: buckets,
          });
          if (result.ok) {
            notify("AP settings saved.");
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
        label="Default payable account"
        htmlFor="payable"
        hint="Used unless a vendor names another."
        error={fieldError(errors, "defaultPayableAccountId")}
      >
        <Select
          id="payable"
          value={payable}
          placeholder="Not set — bills are blocked until chosen"
          options={liabilityAccounts.map((account) => ({
            value: account.id,
            label: accountLabel(account),
          }))}
          onChange={(event) => setPayable(event.target.value)}
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
          label="Bills need approval before posting"
          checked={billApproval}
          onChange={(event) => setBillApproval(event.target.checked)}
        />
        <Field
          label="Bill approval threshold (EGP)"
          htmlFor="billThreshold"
          hint="Blank: every bill needs approval. Otherwise only bills at or above this total."
          error={fieldError(errors, "billApprovalThreshold")}
        >
          <Input
            id="billThreshold"
            inputMode="decimal"
            dir="ltr"
            value={billThreshold}
            disabled={!billApproval}
            onChange={(event) => setBillThreshold(event.target.value)}
          />
        </Field>
      </div>
      <div className="flex flex-col gap-2">
        <Checkbox
          label="Payments need approval before posting"
          checked={paymentApproval}
          onChange={(event) => setPaymentApproval(event.target.checked)}
        />
        <Field
          label="Payment approval threshold (EGP)"
          htmlFor="paymentThreshold"
          hint="Blank: every payment needs approval. Otherwise only payments settling at least this much."
          error={fieldError(errors, "paymentApprovalThreshold")}
        >
          <Input
            id="paymentThreshold"
            inputMode="decimal"
            dir="ltr"
            value={paymentThreshold}
            disabled={!paymentApproval}
            onChange={(event) => setPaymentThreshold(event.target.value)}
          />
        </Field>
      </div>
      <Checkbox
        label="Allow people to approve bills and payments they created or submitted"
        checked={selfApproval}
        onChange={(event) => setSelfApproval(event.target.checked)}
      />
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

export function WithholdingRateFormButton({
  rate,
  liabilityAccounts,
}: {
  rate?: WithholdingTaxRateDto;
  liabilityAccounts: AccountOption[];
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
  const [payableAccountId, setPayableAccountId] = useState(rate?.payableAccount.id ?? "");
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
        {rate === undefined ? "New withholding rate" : "Edit"}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={
          rate === undefined
            ? "New withholding rate"
            : `Edit withholding rate ${rate.code}`
        }
        description="Tax deducted from supplier payments and owed to the tax authority. Existing payment lines keep the rate they were calculated with."
      >
        {message !== null && <FormError message={message} />}
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            startTransition(async () => {
              const result = await saveWithholdingTaxRateAction(rate?.id ?? null, {
                code,
                name,
                nameAr,
                rate: value,
                payableAccountId,
                isActive,
              });
              if (result.ok) {
                setOpen(false);
                notify("Withholding rate saved.");
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
              htmlFor="wht-code"
              required
              error={fieldError(errors, "code")}
            >
              <Input
                id="wht-code"
                value={code}
                dir="ltr"
                maxLength={20}
                placeholder="WHT1"
                onChange={(event) => setCode(event.target.value)}
              />
            </Field>
            <Field
              label="Rate (%)"
              htmlFor="wht-rate"
              required
              error={fieldError(errors, "rate")}
            >
              <Input
                id="wht-rate"
                value={value}
                dir="ltr"
                inputMode="decimal"
                placeholder="1"
                onChange={(event) => setValue(event.target.value)}
              />
            </Field>
          </div>
          <Field
            label="Name"
            htmlFor="wht-name"
            required
            error={fieldError(errors, "name")}
          >
            <Input
              id="wht-name"
              value={name}
              dir="auto"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field
            label="Arabic name"
            htmlFor="wht-name-ar"
            error={fieldError(errors, "nameAr")}
          >
            <Input
              id="wht-name-ar"
              value={nameAr}
              dir="rtl"
              lang="ar"
              onChange={(event) => setNameAr(event.target.value)}
            />
          </Field>
          <Field
            label="Withholding tax payable account (liability)"
            htmlFor="wht-account"
            required
            error={fieldError(errors, "payableAccountId")}
          >
            <Select
              id="wht-account"
              value={payableAccountId}
              placeholder="Choose an account"
              options={liabilityAccounts.map((account) => ({
                value: account.id,
                label: accountLabel(account),
              }))}
              onChange={(event) => setPayableAccountId(event.target.value)}
            />
          </Field>
          <Checkbox
            label="Active — offered on new payments"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
          />
          <DialogActions>
            <Button onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isPending={isPending}>
              {isPending ? "Saving…" : "Save rate"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </>
  );
}
