"use client";

import {
  Field,
  Input,
  PillGroup,
  RangeField,
  Select,
  describedBy,
} from "@/components/ui/form-controls";
import {
  CRM_CURRENCIES,
  SALES_CHANNELS,
  SALES_CHANNEL_LABELS,
  type CrmCurrency,
  type SalesChannel,
  type StageDto,
} from "../contracts/types";

/** The opportunity a lead turns into, as edited on the conversion screen. */
export type OpportunityDraft = {
  name: string;
  amount: string;
  currency: CrmCurrency;
  closeDate: string;
  product: string;
  probability: number;
  channel: SalesChannel;
  partnerName: string;
  ownerId: string;
  stageId: string;
};

export function OpportunityDraftFields({
  idPrefix,
  value,
  onChange,
  errors,
  stages,
  owners,
}: {
  idPrefix: string;
  value: OpportunityDraft;
  onChange: (next: OpportunityDraft) => void;
  errors: Record<string, string>;
  stages: StageDto[];
  owners: { id: string; name: string }[];
}) {
  const id = (name: string) => `${idPrefix}-${name}`;
  const set = <K extends keyof OpportunityDraft>(key: K, next: OpportunityDraft[K]) =>
    onChange({ ...value, [key]: next });

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field
        label="Opportunity name"
        htmlFor={id("name")}
        required
        error={errors.name}
        className="sm:col-span-2"
      >
        <Input
          id={id("name")}
          value={value.name}
          onChange={(event) => set("name", event.target.value)}
          invalid={errors.name !== undefined}
          aria-describedby={describedBy(id("name"), errors.name)}
          dir="auto"
        />
      </Field>

      <div className="flex gap-2">
        <Field
          label="Deal value"
          htmlFor={id("amount")}
          required
          error={errors.amount}
          className="flex-1"
        >
          <Input
            id={id("amount")}
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={value.amount}
            onChange={(event) => set("amount", event.target.value)}
            invalid={errors.amount !== undefined}
            aria-describedby={describedBy(id("amount"), errors.amount)}
          />
        </Field>
        <Field label="Currency" htmlFor={id("currency")} className="w-24">
          <Select
            id={id("currency")}
            value={value.currency}
            onChange={(event) => set("currency", event.target.value as CrmCurrency)}
            options={CRM_CURRENCIES.map((code) => ({ value: code, label: code }))}
          />
        </Field>
      </div>

      <Field
        label="Expected close date"
        htmlFor={id("closeDate")}
        required
        error={errors.closeDate}
      >
        <Input
          id={id("closeDate")}
          type="date"
          value={value.closeDate}
          onChange={(event) => set("closeDate", event.target.value)}
          invalid={errors.closeDate !== undefined}
          aria-describedby={describedBy(id("closeDate"), errors.closeDate)}
        />
      </Field>

      <Field label="Stage" htmlFor={id("stage")}>
        <Select
          id={id("stage")}
          value={value.stageId}
          onChange={(event) => {
            const stage = stages.find((candidate) => candidate.id === event.target.value);
            onChange({
              ...value,
              stageId: event.target.value,
              probability: stage?.defaultProbability ?? value.probability,
            });
          }}
          options={stages.map((stage) => ({ value: stage.id, label: stage.name }))}
        />
      </Field>

      <RangeField
        id={id("probability")}
        label="Probability"
        value={value.probability}
        onValueChange={(probability) => set("probability", probability)}
        step={5}
        suffix="%"
      />

      <Field label="Product / service" htmlFor={id("product")} error={errors.product}>
        <Input
          id={id("product")}
          value={value.product}
          onChange={(event) => set("product", event.target.value)}
          dir="auto"
        />
      </Field>

      <Field label="Owner" htmlFor={id("owner")}>
        <Select
          id={id("owner")}
          value={value.ownerId}
          onChange={(event) => set("ownerId", event.target.value)}
          options={owners.map((owner) => ({ value: owner.id, label: owner.name }))}
        />
      </Field>

      <PillGroup
        name={id("channel")}
        legend="Sales channel"
        options={SALES_CHANNELS.map((channel) => ({
          value: channel,
          label: SALES_CHANNEL_LABELS[channel],
        }))}
        value={value.channel}
        onValueChange={(channel) => set("channel", channel as SalesChannel)}
        className="sm:col-span-2"
      />

      {value.channel === "INDIRECT" && (
        <Field
          label="Channel partner"
          htmlFor={id("partner")}
          required
          error={errors.partnerName}
        >
          <Input
            id={id("partner")}
            value={value.partnerName}
            onChange={(event) => set("partnerName", event.target.value)}
            invalid={errors.partnerName !== undefined}
            aria-describedby={describedBy(id("partner"), errors.partnerName)}
            dir="auto"
          />
        </Field>
      )}
    </div>
  );
}
