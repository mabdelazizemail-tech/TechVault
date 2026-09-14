"use client";

import { Building2, Check, Sparkles, Target, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Checkbox, Field, Select } from "@/components/ui/form-controls";
import { cn } from "@/lib/cn";
import { opportunityDraftSchema } from "../contracts/schemas";
import type { ConversionPreview, LeadDetail, StageDto } from "../contracts/types";
import { convertLeadAction } from "./actions";
import { firstFieldErrors, issuesToErrors, TIMELINE_MONTHS } from "./form-helpers";
import { formatMoney, monthsFromToday, toMajorInput } from "./format";
import {
  OpportunityDraftFields,
  type OpportunityDraft,
} from "./opportunity-draft-fields";

/**
 * The conversion confirmation screen.
 *
 * It shows exactly what will be created or reused before anything happens. When a
 * company with the lead's name, or a contact with the lead's email, already
 * exists, conversion attaches to it — the screen says so, and never offers to
 * create a duplicate.
 */

function draftFor(
  lead: LeadDetail,
  stages: StageDto[],
  currentUserId: string,
): OpportunityDraft {
  const qualified = stages.find((stage) => stage.key === "qualified") ?? stages[0];
  const months = lead.timeline === null ? undefined : TIMELINE_MONTHS[lead.timeline];
  return {
    name: `${lead.company} – ${lead.interest ?? "deal"}`,
    amount: toMajorInput(lead.budgetMinor),
    currency: lead.currency,
    closeDate: monthsFromToday(months ?? 3),
    product: lead.interest ?? "",
    probability: qualified?.defaultProbability ?? 20,
    channel: "DIRECT",
    partnerName: "",
    ownerId: lead.owner?.id ?? currentUserId,
    stageId: qualified?.id ?? "",
  };
}

export function ConvertLeadForm({
  lead,
  matchingAccount,
  matchingContact,
  stages,
  accounts,
  owners,
  currentUserId,
  canCreateOpportunity,
}: {
  lead: LeadDetail;
  matchingAccount: ConversionPreview["matchingAccount"];
  matchingContact: ConversionPreview["matchingContact"];
  stages: StageDto[];
  accounts: { id: string; name: string }[];
  owners: { id: string; name: string }[];
  currentUserId: string;
  canCreateOpportunity: boolean;
}) {
  const router = useRouter();
  const [accountMode, setAccountMode] = useState<"existing" | "new">(
    matchingAccount !== null ? "existing" : "new",
  );
  const [accountId, setAccountId] = useState(matchingAccount?.id ?? "");
  const [createOpportunity, setCreateOpportunity] = useState(canCreateOpportunity);
  const [draft, setDraft] = useState<OpportunityDraft>(() =>
    draftFor(lead, stages, currentUserId),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const accountOptions = (
    matchingAccount !== null &&
    !accounts.some((account) => account.id === matchingAccount.id)
      ? [matchingAccount, ...accounts]
      : accounts
  ).map((account) => ({ value: account.id, label: account.name }));
  const chosenAccountName = accountOptions.find(
    (option) => option.value === accountId,
  )?.label;
  const stageName =
    stages.find((stage) => stage.id === draft.stageId)?.name ?? "the first stage";
  const amount =
    draft.amount !== "" && Number.isFinite(Number(draft.amount))
      ? formatMoney(Math.round(Number(draft.amount) * 100), draft.currency)
      : null;

  function submit() {
    setFormError(null);
    const nextErrors: Record<string, string> = {};
    if (accountMode === "existing" && accountId === "") {
      nextErrors.accountId = "Choose the company to attach this lead to.";
    }
    if (createOpportunity) {
      const parsed = opportunityDraftSchema.safeParse(draft);
      if (!parsed.success) Object.assign(nextErrors, issuesToErrors(parsed.error.issues));
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    startTransition(async () => {
      const result = await convertLeadAction({
        leadId: lead.id,
        accountMode,
        accountId: accountMode === "existing" ? accountId : null,
        contactMode: matchingContact !== null ? "existing" : "new",
        contactId: matchingContact?.id ?? null,
        createOpportunity,
        opportunity: createOpportunity ? draft : null,
      });
      if (result.ok) {
        router.push(
          result.data.opportunityId !== null
            ? `/crm/opportunities/${result.data.opportunityId}`
            : `/crm/accounts/${result.data.accountId}`,
        );
        return;
      }
      setErrors(firstFieldErrors(result.fieldErrors, "opportunity"));
      setFormError(result.message);
    });
  }

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <Step icon={<Building2 aria-hidden="true" size={16} />} step={1} title="Company">
        {matchingAccount !== null ? (
          <div className="flex flex-col gap-3">
            <Notice>
              A company named <strong dir="auto">{matchingAccount.name}</strong> already
              exists, so the lead is attached to it. No duplicate company is created.
            </Notice>
            <Field
              label="Attach to"
              htmlFor="convert-account"
              error={errors.accountId}
              className="max-w-md"
            >
              <Select
                id="convert-account"
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
                options={accountOptions}
              />
            </Field>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div
              role="radiogroup"
              aria-label="Company"
              className="grid gap-2 sm:grid-cols-2"
            >
              <Choice
                selected={accountMode === "new"}
                onSelect={() => setAccountMode("new")}
                title={`Create “${lead.company}”`}
                description="A new company record, filled in from the lead."
              />
              <Choice
                selected={accountMode === "existing"}
                onSelect={() => setAccountMode("existing")}
                title="Use an existing company"
                description="Attach the lead to a company already in the CRM."
                disabled={accountOptions.length === 0}
              />
            </div>
            {accountMode === "existing" && (
              <Field
                label="Company"
                htmlFor="convert-account"
                required
                error={errors.accountId}
                className="max-w-md"
              >
                <Select
                  id="convert-account"
                  value={accountId}
                  placeholder="Choose a company"
                  onChange={(event) => setAccountId(event.target.value)}
                  options={accountOptions}
                  invalid={errors.accountId !== undefined}
                />
              </Field>
            )}
          </div>
        )}
      </Step>

      <Step icon={<UserRound aria-hidden="true" size={16} />} step={2} title="Contact">
        {matchingContact !== null ? (
          <Notice>
            A contact with this email already exists:{" "}
            <strong dir="auto">{matchingContact.name}</strong>
            {matchingContact.accountName !== null && (
              <>
                {" "}
                at <span dir="auto">{matchingContact.accountName}</span>
              </>
            )}
            . The lead is linked to that contact instead of creating a duplicate.
          </Notice>
        ) : (
          <p className="text-foreground text-[13px]">
            A new contact is created: <strong dir="auto">{lead.name}</strong>
            {lead.jobTitle !== null && <>, {lead.jobTitle}</>}
            {lead.email !== null && <> · {lead.email}</>}.
          </p>
        )}
      </Step>

      <Step icon={<Target aria-hidden="true" size={16} />} step={3} title="Opportunity">
        {canCreateOpportunity ? (
          <div className="flex flex-col gap-3">
            <Checkbox
              label="Create an opportunity for this lead"
              checked={createOpportunity}
              onChange={(event) => setCreateOpportunity(event.target.checked)}
            />
            {createOpportunity && (
              <OpportunityDraftFields
                idPrefix="convert"
                value={draft}
                onChange={setDraft}
                errors={errors}
                stages={stages}
                owners={owners}
              />
            )}
          </div>
        ) : (
          <p className="text-foreground-muted text-[13px]">
            You don’t have permission to create opportunities, so the lead converts into a
            company and a contact only.
          </p>
        )}
      </Step>

      <section
        aria-labelledby="convert-summary"
        className="border-border-strong bg-surface border-2 px-4 py-3"
      >
        <h2 id="convert-summary" className="kicker text-primary-ink">
          When you convert
        </h2>
        <ul className="mt-2 flex flex-col gap-1.5 text-[13px]">
          <SummaryItem>
            {accountMode === "new" ? (
              <>
                Create the company <strong dir="auto">{lead.company}</strong>
              </>
            ) : chosenAccountName !== undefined ? (
              <>
                Attach to the existing company{" "}
                <strong dir="auto">{chosenAccountName}</strong>
              </>
            ) : (
              "Attach to the company you choose above"
            )}
          </SummaryItem>
          <SummaryItem>
            {matchingContact !== null ? (
              <>
                Link to the existing contact{" "}
                <strong dir="auto">{matchingContact.name}</strong>
              </>
            ) : (
              <>
                Create the contact <strong dir="auto">{lead.name}</strong>
              </>
            )}
          </SummaryItem>
          <SummaryItem muted={!createOpportunity}>
            {createOpportunity ? (
              <>
                Create{" "}
                <strong dir="auto">
                  {draft.name === "" ? "the opportunity" : draft.name}
                </strong>
                {amount !== null && <> for {amount}</>} in {stageName}
              </>
            ) : (
              "No opportunity — you can create one from the company later"
            )}
          </SummaryItem>
          <SummaryItem>
            Mark the lead Converted and carry its activity history over
          </SummaryItem>
        </ul>
      </section>

      {formError !== null && (
        <p
          role="alert"
          className="border-danger/25 bg-danger-subtle text-danger border px-3 py-2 text-xs"
        >
          {formError}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <ButtonLink href={`/crm/leads/${lead.id}`}>Cancel</ButtonLink>
        <Button
          variant="primary"
          icon={<Sparkles aria-hidden="true" size={15} />}
          onClick={submit}
          isPending={isPending}
        >
          Convert lead
        </Button>
      </div>
    </div>
  );
}

function Step({
  icon,
  step,
  title,
  children,
}: {
  icon: ReactNode;
  step: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="bg-surface border-border border">
      <header className="border-border flex items-center gap-2.5 border-b px-4 py-2.5">
        <span className="bg-foreground text-canvas grid size-7 place-items-center">
          {icon}
        </span>
        <div>
          <p className="kicker text-primary-ink">Step {step}</p>
          <h2 className="text-foreground text-base">{title}</h2>
        </div>
      </header>
      <div className="px-4 py-4">{children}</div>
    </section>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="border-info bg-info-subtle text-foreground border-s-3 px-3 py-2 text-[13px]">
      {children}
    </p>
  );
}

function Choice({
  selected,
  onSelect,
  title,
  description,
  disabled = false,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        "flex cursor-pointer flex-col items-start gap-1 border-2 p-3.5 text-start transition-colors disabled:cursor-not-allowed disabled:opacity-45",
        selected
          ? "border-primary bg-primary-subtle"
          : "border-border-strong hover:bg-surface-hover",
      )}
    >
      <span className="text-foreground text-[14px] font-extrabold" dir="auto">
        {title}
      </span>
      <span className="text-foreground-muted text-[13px]">{description}</span>
    </button>
  );
}

function SummaryItem({
  children,
  muted = false,
}: {
  children: ReactNode;
  muted?: boolean;
}) {
  return (
    <li
      className={cn(
        "flex items-start gap-2",
        muted ? "text-foreground-muted" : "text-foreground",
      )}
    >
      <Check
        aria-hidden="true"
        size={15}
        strokeWidth={3}
        className="text-primary mt-0.5 shrink-0"
      />
      <span>{children}</span>
    </li>
  );
}
