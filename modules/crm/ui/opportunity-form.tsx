"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import {
  Field,
  PillGroup,
  RangeField,
  Select,
  TextField,
  Textarea,
} from "@/components/ui/form-controls";
import { opportunityEditSchema, opportunitySchema } from "../contracts/schemas";
import {
  CRM_CURRENCIES,
  LEAD_SOURCES,
  LEAD_SOURCE_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  SALES_CHANNELS,
  SALES_CHANNEL_LABELS,
  type CrmCurrency,
  type OpportunityDetail,
  type SalesChannel,
  type StageDto,
} from "../contracts/types";
import { createOpportunityAction, updateOpportunityAction } from "./actions";
import { firstFieldErrors, issuesToErrors } from "./form-helpers";
import { monthsFromToday, toDateInputValue, toMajorInput } from "./format";

/**
 * Create or edit an opportunity. Editing never changes the stage — stages move on
 * the board or the stage tracker, where closing details are asked for.
 */

export type OpportunityFormOptions = {
  accounts: { id: string; name: string }[];
  contacts: { id: string; name: string; accountId: string | null }[];
  stages: StageDto[];
  owners: { id: string; name: string }[];
};

type Values = {
  name: string;
  accountId: string;
  primaryContactId: string;
  stageId: string;
  amount: string;
  currency: CrmCurrency;
  closeDate: string;
  probability: number;
  priority: string;
  channel: SalesChannel;
  partnerName: string;
  source: string;
  product: string;
  description: string;
  ownerId: string;
};

function initialValues(
  opportunity: OpportunityDetail | undefined,
  options: OpportunityFormOptions,
  currentUserId: string,
  defaultAccountId: string | undefined,
): Values {
  if (opportunity !== undefined) {
    return {
      name: opportunity.name,
      accountId: opportunity.account.id,
      primaryContactId: opportunity.primaryContact?.id ?? "",
      stageId: opportunity.stage.id,
      amount: toMajorInput(opportunity.amountMinor),
      currency: opportunity.currency,
      closeDate: toDateInputValue(opportunity.closeDate),
      probability: opportunity.probability,
      priority: opportunity.priority,
      channel: opportunity.channel,
      partnerName: opportunity.partnerName ?? "",
      source: opportunity.source ?? "",
      product: opportunity.product ?? "",
      description: opportunity.description ?? "",
      ownerId: opportunity.owner?.id ?? currentUserId,
    };
  }
  const firstStage = options.stages.find((stage) => stage.kind === "OPEN");
  return {
    name: "",
    accountId: defaultAccountId ?? "",
    primaryContactId: "",
    stageId: firstStage?.id ?? "",
    amount: "",
    currency: "EGP",
    closeDate: monthsFromToday(3),
    probability: firstStage?.defaultProbability ?? 10,
    priority: "MEDIUM",
    channel: "DIRECT",
    partnerName: "",
    source: "",
    product: "",
    description: "",
    ownerId: currentUserId,
  };
}

export function OpportunityForm({
  opportunity,
  options,
  currentUserId,
  defaultAccountId,
  onSaved,
  onCancel,
  cancelHref,
}: {
  opportunity?: OpportunityDetail;
  options: OpportunityFormOptions;
  currentUserId: string;
  defaultAccountId?: string;
  onSaved?: () => void;
  onCancel?: () => void;
  cancelHref?: string;
}) {
  const router = useRouter();
  const isEdit = opportunity !== undefined;
  const [values, setValues] = useState<Values>(() =>
    initialValues(opportunity, options, currentUserId, defaultAccountId),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const set = <K extends keyof Values>(key: K, value: Values[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  // Keep the deal's own company and contact selectable even if they fall outside
  // the loaded option lists.
  const accounts =
    opportunity !== undefined &&
    !options.accounts.some((account) => account.id === opportunity.account.id)
      ? [opportunity.account, ...options.accounts]
      : options.accounts;
  const contacts = options.contacts.filter(
    (contact) => contact.accountId === values.accountId,
  );
  if (
    opportunity?.primaryContact !== null &&
    opportunity?.primaryContact !== undefined &&
    values.accountId === opportunity.account.id &&
    !contacts.some((contact) => contact.id === opportunity.primaryContact?.id)
  ) {
    contacts.unshift({
      ...opportunity.primaryContact,
      accountId: opportunity.account.id,
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const { stageId, ...editable } = values;

    const parsed =
      opportunity !== undefined
        ? opportunityEditSchema.safeParse(editable)
        : opportunitySchema.safeParse({ ...editable, stageId });
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues));
      return;
    }
    setErrors({});

    startTransition(async () => {
      if (opportunity !== undefined) {
        const result = await updateOpportunityAction(opportunity.id, editable);
        if (result.ok) {
          onSaved?.();
          return;
        }
        setErrors(firstFieldErrors(result.fieldErrors));
        setFormError(result.message);
      } else {
        const result = await createOpportunityAction({ ...editable, stageId });
        if (result.ok) {
          router.push(`/crm/opportunities/${result.data.id}`);
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
        id="opp-name"
        label="Opportunity name"
        required
        value={values.name}
        onValueChange={(value) => set("name", value)}
        error={errors.name}
        dir="auto"
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Company" htmlFor="opp-account" required error={errors.accountId}>
          <Select
            id="opp-account"
            value={values.accountId}
            placeholder="Choose a company"
            invalid={errors.accountId !== undefined}
            options={accounts.map((account) => ({
              value: account.id,
              label: account.name,
            }))}
            onChange={(event) => {
              const accountId = event.target.value;
              setValues((current) => ({
                ...current,
                accountId,
                primaryContactId: options.contacts.some(
                  (contact) =>
                    contact.id === current.primaryContactId &&
                    contact.accountId === accountId,
                )
                  ? current.primaryContactId
                  : "",
              }));
            }}
          />
        </Field>

        <Field
          label="Primary contact"
          htmlFor="opp-contact"
          hint={
            values.accountId !== "" && contacts.length === 0
              ? "This company has no contacts yet."
              : undefined
          }
        >
          <Select
            id="opp-contact"
            value={values.primaryContactId}
            placeholder={
              values.accountId === "" ? "Choose a company first" : "No primary contact"
            }
            disabled={values.accountId === ""}
            options={contacts.map((contact) => ({
              value: contact.id,
              label: contact.name,
            }))}
            onChange={(event) => set("primaryContactId", event.target.value)}
          />
        </Field>

        {!isEdit && (
          <Field label="Stage" htmlFor="opp-stage" required error={errors.stageId}>
            <Select
              id="opp-stage"
              value={values.stageId}
              options={options.stages
                .filter((stage) => stage.kind === "OPEN")
                .map((stage) => ({ value: stage.id, label: stage.name }))}
              onChange={(event) => {
                const stage = options.stages.find(
                  (candidate) => candidate.id === event.target.value,
                );
                setValues((current) => ({
                  ...current,
                  stageId: event.target.value,
                  probability: stage?.defaultProbability ?? current.probability,
                }));
              }}
            />
          </Field>
        )}

        <RangeField
          id="opp-probability"
          label="Probability"
          value={values.probability}
          onValueChange={(value) => set("probability", value)}
          step={5}
          suffix="%"
        />

        <div className="flex gap-2">
          <TextField
            id="opp-amount"
            label="Deal value"
            required
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={values.amount}
            onValueChange={(value) => set("amount", value)}
            error={errors.amount}
            className="flex-1"
          />
          <Field label="Currency" htmlFor="opp-currency" className="w-24">
            <Select
              id="opp-currency"
              value={values.currency}
              onChange={(event) => set("currency", event.target.value as CrmCurrency)}
              options={CRM_CURRENCIES.map((code) => ({ value: code, label: code }))}
            />
          </Field>
        </div>

        <TextField
          id="opp-close"
          label="Expected close date"
          required
          type="date"
          value={values.closeDate}
          onValueChange={(value) => set("closeDate", value)}
          error={errors.closeDate}
        />

        <Field label="Owner" htmlFor="opp-owner">
          <Select
            id="opp-owner"
            value={values.ownerId}
            onChange={(event) => set("ownerId", event.target.value)}
            options={options.owners.map((owner) => ({
              value: owner.id,
              label: owner.name,
            }))}
          />
        </Field>

        <Field label="Priority" htmlFor="opp-priority">
          <Select
            id="opp-priority"
            value={values.priority}
            onChange={(event) => set("priority", event.target.value)}
            options={PRIORITIES.map((value) => ({
              value,
              label: PRIORITY_LABELS[value],
            }))}
          />
        </Field>

        <Field label="Lead source" htmlFor="opp-source">
          <Select
            id="opp-source"
            value={values.source}
            placeholder="Not recorded"
            onChange={(event) => set("source", event.target.value)}
            options={LEAD_SOURCES.map((value) => ({
              value,
              label: LEAD_SOURCE_LABELS[value],
            }))}
          />
        </Field>

        <TextField
          id="opp-product"
          label="Product / service"
          value={values.product}
          onValueChange={(value) => set("product", value)}
          error={errors.product}
          dir="auto"
        />
      </div>

      <PillGroup
        name="opp-channel"
        legend="Sales channel"
        options={SALES_CHANNELS.map((value) => ({
          value,
          label: SALES_CHANNEL_LABELS[value],
        }))}
        value={values.channel}
        onValueChange={(value) => set("channel", value as SalesChannel)}
      />
      {values.channel === "INDIRECT" && (
        <TextField
          id="opp-partner"
          label="Channel partner"
          required
          value={values.partnerName}
          onValueChange={(value) => set("partnerName", value)}
          error={errors.partnerName}
          className="sm:max-w-sm"
          dir="auto"
        />
      )}

      <Field label="Description" htmlFor="opp-description" error={errors.description}>
        <Textarea
          id="opp-description"
          value={values.description}
          onChange={(event) => set("description", event.target.value)}
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

      <div className="border-border mt-2 flex flex-wrap items-center justify-end gap-2 border-t pt-4">
        {onCancel !== undefined ? (
          <Button onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
        ) : cancelHref !== undefined ? (
          <ButtonLink href={cancelHref}>Cancel</ButtonLink>
        ) : null}
        <Button type="submit" variant="primary" isPending={isPending}>
          {isEdit ? "Save changes" : "Create opportunity"}
        </Button>
      </div>
    </form>
  );
}
