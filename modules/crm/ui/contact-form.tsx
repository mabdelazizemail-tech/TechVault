"use client";

import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions } from "@/components/ui/dialog";
import { Field, Select, TextField } from "@/components/ui/form-controls";
import { contactSchema } from "../contracts/schemas";
import type { ContactDetail } from "../contracts/types";
import { createContactAction, updateContactAction } from "./actions";
import { firstFieldErrors, issuesToErrors } from "./form-helpers";

/**
 * Create or edit a contact, in a slide-over. Started from a company page the
 * company is preset and the page stays put; from the contacts list the new
 * contact opens.
 */

type Values = Record<
  | "firstName"
  | "lastName"
  | "jobTitle"
  | "email"
  | "phone"
  | "country"
  | "city"
  | "accountId"
  | "ownerId",
  string
>;

export function ContactFormButton({
  contact,
  accounts,
  owners,
  currentUserId,
  defaultAccountId,
  variant,
}: {
  contact?: ContactDetail;
  accounts: { id: string; name: string }[];
  owners: { id: string; name: string }[];
  currentUserId: string;
  defaultAccountId?: string;
  variant?: "primary" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const isEdit = contact !== undefined;

  return (
    <>
      <Button
        variant={variant ?? (isEdit ? "secondary" : "primary")}
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
        {isEdit ? "Edit" : "New contact"}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={isEdit ? "Edit contact" : "New contact"}
        variant="sheet"
      >
        <ContactForm
          key={formKey}
          contact={contact}
          accounts={accounts}
          owners={owners}
          currentUserId={currentUserId}
          defaultAccountId={defaultAccountId}
          onDone={() => setOpen(false)}
        />
      </Dialog>
    </>
  );
}

function ContactForm({
  contact,
  accounts,
  owners,
  currentUserId,
  defaultAccountId,
  onDone,
}: {
  contact?: ContactDetail;
  accounts: { id: string; name: string }[];
  owners: { id: string; name: string }[];
  currentUserId: string;
  defaultAccountId?: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Values>(() => ({
    firstName: contact?.firstName ?? "",
    lastName: contact?.lastName ?? "",
    jobTitle: contact?.jobTitle ?? "",
    email: contact?.email ?? "",
    phone: contact?.phone ?? "",
    country: contact?.country ?? "",
    city: contact?.city ?? "",
    accountId: contact?.account?.id ?? defaultAccountId ?? "",
    ownerId: contact?.owner?.id ?? currentUserId,
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const set = (key: keyof Values, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  const accountOptions =
    contact?.account != null &&
    !accounts.some((account) => account.id === contact.account?.id)
      ? [contact.account, ...accounts]
      : accounts;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const parsed = contactSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    startTransition(async () => {
      if (contact !== undefined) {
        const result = await updateContactAction(contact.id, values);
        if (result.ok) {
          onDone();
          return;
        }
        setErrors(firstFieldErrors(result.fieldErrors));
        setFormError(result.message);
      } else {
        const result = await createContactAction(values);
        if (result.ok) {
          onDone();
          if (defaultAccountId === undefined)
            router.push(`/crm/contacts/${result.data.id}`);
          return;
        }
        setErrors(firstFieldErrors(result.fieldErrors));
        setFormError(result.message);
      }
    });
  }

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          id="contact-first"
          label="First name"
          required
          value={values.firstName}
          onValueChange={(v) => set("firstName", v)}
          error={errors.firstName}
          dir="auto"
        />
        <TextField
          id="contact-last"
          label="Last name"
          required
          value={values.lastName}
          onValueChange={(v) => set("lastName", v)}
          error={errors.lastName}
          dir="auto"
        />
        <TextField
          id="contact-title"
          label="Job title"
          value={values.jobTitle}
          onValueChange={(v) => set("jobTitle", v)}
          error={errors.jobTitle}
          dir="auto"
        />
        <Field label="Company" htmlFor="contact-account" error={errors.accountId}>
          <Select
            id="contact-account"
            value={values.accountId}
            onChange={(e) => set("accountId", e.target.value)}
            placeholder="No company"
            options={accountOptions.map((account) => ({
              value: account.id,
              label: account.name,
            }))}
          />
        </Field>
        <TextField
          id="contact-email"
          label="Email"
          type="email"
          value={values.email}
          onValueChange={(v) => set("email", v)}
          error={errors.email}
        />
        <TextField
          id="contact-phone"
          label="Phone"
          type="tel"
          value={values.phone}
          onValueChange={(v) => set("phone", v)}
          error={errors.phone}
        />
        <TextField
          id="contact-country"
          label="Country"
          value={values.country}
          onValueChange={(v) => set("country", v)}
          error={errors.country}
        />
        <TextField
          id="contact-city"
          label="City"
          value={values.city}
          onValueChange={(v) => set("city", v)}
          error={errors.city}
        />
        <Field label="Owner" htmlFor="contact-owner" className="sm:col-span-2">
          <Select
            id="contact-owner"
            value={values.ownerId}
            onChange={(e) => set("ownerId", e.target.value)}
            options={owners.map((owner) => ({ value: owner.id, label: owner.name }))}
          />
        </Field>
      </div>

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
          {contact !== undefined ? "Save changes" : "Create contact"}
        </Button>
      </DialogActions>
    </form>
  );
}
