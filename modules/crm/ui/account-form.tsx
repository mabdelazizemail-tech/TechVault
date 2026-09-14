"use client";

import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions } from "@/components/ui/dialog";
import { Field, Select, TextField, Textarea } from "@/components/ui/form-controls";
import { accountSchema } from "../contracts/schemas";
import { COMPANY_SIZES, INDUSTRIES, type AccountDetail } from "../contracts/types";
import { createAccountAction, updateAccountAction } from "./actions";
import { firstFieldErrors, issuesToErrors } from "./form-helpers";

/** Create or edit a company, in a slide-over. */

type Values = Record<
  | "name"
  | "website"
  | "industry"
  | "companySize"
  | "country"
  | "city"
  | "phone"
  | "description"
  | "ownerId",
  string
>;

export function AccountFormButton({
  account,
  owners,
  currentUserId,
}: {
  account?: AccountDetail;
  owners: { id: string; name: string }[];
  currentUserId: string;
}) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const isEdit = account !== undefined;

  return (
    <>
      <Button
        variant={isEdit ? "secondary" : "primary"}
        icon={
          isEdit ? (
            <Pencil aria-hidden="true" size={14} />
          ) : (
            <Plus aria-hidden="true" size={15} />
          )
        }
        onClick={() => {
          setFormKey((key) => key + 1);
          setOpen(true);
        }}
      >
        {isEdit ? "Edit" : "New company"}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={isEdit ? "Edit company" : "New company"}
        variant="sheet"
      >
        <AccountForm
          key={formKey}
          account={account}
          owners={owners}
          currentUserId={currentUserId}
          onDone={() => setOpen(false)}
        />
      </Dialog>
    </>
  );
}

function AccountForm({
  account,
  owners,
  currentUserId,
  onDone,
}: {
  account?: AccountDetail;
  owners: { id: string; name: string }[];
  currentUserId: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Values>(() => ({
    name: account?.name ?? "",
    website: account?.website ?? "",
    industry: account?.industry ?? "",
    companySize: account?.companySize ?? "",
    country: account?.country ?? "",
    city: account?.city ?? "",
    phone: account?.phone ?? "",
    description: account?.description ?? "",
    ownerId: account?.owner?.id ?? currentUserId,
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const set = (key: keyof Values, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  const industries: string[] = [...INDUSTRIES];
  if (values.industry !== "" && !industries.includes(values.industry))
    industries.unshift(values.industry);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const parsed = accountSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    startTransition(async () => {
      if (account !== undefined) {
        const result = await updateAccountAction(account.id, values);
        if (result.ok) {
          onDone();
          return;
        }
        setErrors(firstFieldErrors(result.fieldErrors));
        setFormError(result.message);
      } else {
        const result = await createAccountAction(values);
        if (result.ok) {
          onDone();
          router.push(`/crm/accounts/${result.data.id}`);
          return;
        }
        setErrors(firstFieldErrors(result.fieldErrors));
        setFormError(result.message);
      }
    });
  }

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-3">
      <TextField
        id="account-name"
        label="Company name"
        required
        value={values.name}
        onValueChange={(v) => set("name", v)}
        error={errors.name}
        dir="auto"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          id="account-website"
          label="Website"
          value={values.website}
          onValueChange={(v) => set("website", v)}
          error={errors.website}
          placeholder="example.com"
        />
        <TextField
          id="account-phone"
          label="Phone"
          type="tel"
          value={values.phone}
          onValueChange={(v) => set("phone", v)}
          error={errors.phone}
        />
        <Field label="Industry" htmlFor="account-industry">
          <Select
            id="account-industry"
            value={values.industry}
            onChange={(e) => set("industry", e.target.value)}
            placeholder="Not set"
            options={industries.map((value) => ({ value, label: value }))}
          />
        </Field>
        <Field label="Employees" htmlFor="account-size">
          <Select
            id="account-size"
            value={values.companySize}
            onChange={(e) => set("companySize", e.target.value)}
            placeholder="Not set"
            options={COMPANY_SIZES.map((value) => ({ value, label: value }))}
          />
        </Field>
        <TextField
          id="account-country"
          label="Country"
          value={values.country}
          onValueChange={(v) => set("country", v)}
          error={errors.country}
        />
        <TextField
          id="account-city"
          label="City"
          value={values.city}
          onValueChange={(v) => set("city", v)}
          error={errors.city}
        />
        <Field label="Owner" htmlFor="account-owner" className="sm:col-span-2">
          <Select
            id="account-owner"
            value={values.ownerId}
            onChange={(e) => set("ownerId", e.target.value)}
            options={owners.map((owner) => ({ value: owner.id, label: owner.name }))}
          />
        </Field>
      </div>
      <Field
        label="About the company"
        htmlFor="account-description"
        error={errors.description}
      >
        <Textarea
          id="account-description"
          value={values.description}
          onChange={(e) => set("description", e.target.value)}
          rows={4}
          dir="auto"
        />
      </Field>

      {formError !== null && (
        <p
          role="alert"
          className="border-danger/25 bg-danger-subtle text-danger border px-3 py-2 text-xs"
        >
          {formError}
        </p>
      )}

      <DialogActions>
        <Button onClick={onDone} disabled={isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" isPending={isPending}>
          {account !== undefined ? "Save changes" : "Create company"}
        </Button>
      </DialogActions>
    </form>
  );
}
