"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DialogActions } from "@/components/ui/dialog";
import {
  Field,
  RangeField,
  Select,
  TextField,
  Textarea,
} from "@/components/ui/form-controls";
import { QUALIFICATION_STATUSES, updateLeadSchema } from "../contracts/schemas";
import {
  COMPANY_SIZES,
  CRM_CURRENCIES,
  DECISION_MAKER_LABELS,
  DECISION_MAKER_OPTIONS,
  INDUSTRIES,
  LEAD_SOURCES,
  LEAD_SOURCE_LABELS,
  PURCHASE_TIMELINES,
  PURCHASE_TIMELINE_LABELS,
  type CrmCurrency,
  type LeadDetail,
} from "../contracts/types";
import { updateLeadAction } from "./actions";
import { scoreLabel } from "./badges";
import { firstFieldErrors, issuesToErrors } from "./form-helpers";
import { toMajorInput } from "./format";

/**
 * The lead edit form. Loaded on demand by `LeadEditButton`, so its schema and
 * field code are not part of the lead page's first load. Status is deliberately
 * not here: it moves through the status bar, so every change lands on the timeline.
 */

type Values = {
  firstName: string;
  lastName: string;
  jobTitle: string;
  email: string;
  phone: string;
  company: string;
  website: string;
  industry: string;
  companySize: string;
  country: string;
  city: string;
  source: string;
  interest: string;
  budget: string;
  budgetCurrency: CrmCurrency;
  timeline: string;
  decisionMaker: string;
  currentSolution: string;
  painPoint: string;
  score: number;
  ownerId: string;
};

function valuesOf(lead: LeadDetail): Values {
  return {
    firstName: lead.firstName,
    lastName: lead.lastName,
    jobTitle: lead.jobTitle ?? "",
    email: lead.email ?? "",
    phone: lead.phone ?? "",
    company: lead.company,
    website: lead.website ?? "",
    industry: lead.industry ?? "",
    companySize: lead.companySize ?? "",
    country: lead.country ?? "",
    city: lead.city ?? "",
    source: lead.source,
    interest: lead.interest ?? "",
    budget: toMajorInput(lead.budgetMinor),
    budgetCurrency: lead.currency,
    timeline: lead.timeline ?? "",
    decisionMaker: lead.decisionMaker ?? "",
    currentSolution: lead.currentSolution ?? "",
    painPoint: lead.painPoint ?? "",
    score: lead.score,
    ownerId: lead.owner?.id ?? "",
  };
}

export function LeadEditForm({
  lead,
  owners,
  onDone,
}: {
  lead: LeadDetail;
  owners: { id: string; name: string }[];
  onDone: () => void;
}) {
  const [values, setValues] = useState<Values>(() => valuesOf(lead));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const set = <K extends keyof Values>(key: K, value: Values[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  // The status is carried through unchanged; the status bar is where it moves.
  const status = (QUALIFICATION_STATUSES as readonly string[]).includes(lead.status)
    ? lead.status
    : "NEW";
  const industries: string[] = [...INDUSTRIES];
  if (values.industry !== "" && !industries.includes(values.industry))
    industries.unshift(values.industry);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const payload = { ...values, status };
    const parsed = updateLeadSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result = await updateLeadAction(lead.id, payload);
      if (result.ok) {
        onDone();
        return;
      }
      setErrors(firstFieldErrors(result.fieldErrors));
      setFormError(result.message);
    });
  }

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
      <Group title="Person">
        <TextField
          id="edit-firstName"
          label="First name"
          required
          value={values.firstName}
          onValueChange={(v) => set("firstName", v)}
          error={errors.firstName}
          dir="auto"
        />
        <TextField
          id="edit-lastName"
          label="Last name"
          required
          value={values.lastName}
          onValueChange={(v) => set("lastName", v)}
          error={errors.lastName}
          dir="auto"
        />
        <TextField
          id="edit-jobTitle"
          label="Job title"
          value={values.jobTitle}
          onValueChange={(v) => set("jobTitle", v)}
          error={errors.jobTitle}
          dir="auto"
        />
        <TextField
          id="edit-email"
          label="Email"
          type="email"
          value={values.email}
          onValueChange={(v) => set("email", v)}
          error={errors.email}
        />
        <TextField
          id="edit-phone"
          label="Phone"
          type="tel"
          value={values.phone}
          onValueChange={(v) => set("phone", v)}
          error={errors.phone}
        />
        <Field label="Owner" htmlFor="edit-owner">
          <Select
            id="edit-owner"
            value={values.ownerId}
            onChange={(e) => set("ownerId", e.target.value)}
            placeholder="Unassigned"
            options={owners.map((owner) => ({ value: owner.id, label: owner.name }))}
          />
        </Field>
      </Group>

      <Group title="Company">
        <TextField
          id="edit-company"
          label="Company"
          required
          value={values.company}
          onValueChange={(v) => set("company", v)}
          error={errors.company}
          dir="auto"
        />
        <TextField
          id="edit-website"
          label="Website"
          value={values.website}
          onValueChange={(v) => set("website", v)}
          error={errors.website}
        />
        <Field label="Industry" htmlFor="edit-industry">
          <Select
            id="edit-industry"
            value={values.industry}
            onChange={(e) => set("industry", e.target.value)}
            placeholder="Not set"
            options={industries.map((value) => ({ value, label: value }))}
          />
        </Field>
        <Field label="Employees" htmlFor="edit-size">
          <Select
            id="edit-size"
            value={values.companySize}
            onChange={(e) => set("companySize", e.target.value)}
            placeholder="Not set"
            options={COMPANY_SIZES.map((value) => ({ value, label: value }))}
          />
        </Field>
        <TextField
          id="edit-country"
          label="Country"
          value={values.country}
          onValueChange={(v) => set("country", v)}
          error={errors.country}
        />
        <TextField
          id="edit-city"
          label="City"
          value={values.city}
          onValueChange={(v) => set("city", v)}
          error={errors.city}
        />
        <Field label="Lead source" htmlFor="edit-source" required error={errors.source}>
          <Select
            id="edit-source"
            value={values.source}
            onChange={(e) => set("source", e.target.value)}
            options={LEAD_SOURCES.map((value) => ({
              value,
              label: LEAD_SOURCE_LABELS[value],
            }))}
          />
        </Field>
      </Group>

      <Group title="Qualification">
        <TextField
          id="edit-interest"
          label="Interested in"
          value={values.interest}
          onValueChange={(v) => set("interest", v)}
          error={errors.interest}
          className="sm:col-span-2"
          dir="auto"
        />
        <div className="flex gap-2">
          <TextField
            id="edit-budget"
            label="Budget"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={values.budget}
            onValueChange={(v) => set("budget", v)}
            error={errors.budget}
            className="flex-1"
          />
          <Field label="Currency" htmlFor="edit-currency" className="w-24">
            <Select
              id="edit-currency"
              value={values.budgetCurrency}
              onChange={(e) => set("budgetCurrency", e.target.value as CrmCurrency)}
              options={CRM_CURRENCIES.map((value) => ({ value, label: value }))}
            />
          </Field>
        </div>
        <RangeField
          id="edit-score"
          label="Lead score"
          value={values.score}
          onValueChange={(v) => set("score", v)}
          describe={scoreLabel}
        />
        <Field label="Timeline" htmlFor="edit-timeline">
          <Select
            id="edit-timeline"
            value={values.timeline}
            onChange={(e) => set("timeline", e.target.value)}
            placeholder="Not known"
            options={PURCHASE_TIMELINES.map((value) => ({
              value,
              label: PURCHASE_TIMELINE_LABELS[value],
            }))}
          />
        </Field>
        <Field label="Decision maker" htmlFor="edit-decision">
          <Select
            id="edit-decision"
            value={values.decisionMaker}
            onChange={(e) => set("decisionMaker", e.target.value)}
            placeholder="Not known"
            options={DECISION_MAKER_OPTIONS.map((value) => ({
              value,
              label: DECISION_MAKER_LABELS[value],
            }))}
          />
        </Field>
        <TextField
          id="edit-solution"
          label="Current solution"
          value={values.currentSolution}
          onValueChange={(v) => set("currentSolution", v)}
          error={errors.currentSolution}
          className="sm:col-span-2"
          dir="auto"
        />
        <Field
          label="Main pain point"
          htmlFor="edit-pain"
          error={errors.painPoint}
          className="sm:col-span-2"
        >
          <Textarea
            id="edit-pain"
            value={values.painPoint}
            onChange={(e) => set("painPoint", e.target.value)}
            rows={3}
            dir="auto"
          />
        </Field>
      </Group>

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
          Save changes
        </Button>
      </DialogActions>
    </form>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2.5">
      <legend className="kicker text-primary-ink mb-2">{title}</legend>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}
