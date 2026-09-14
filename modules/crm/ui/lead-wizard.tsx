"use client";

import { Check, ChevronLeft, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Field,
  Input,
  PillGroup,
  RangeField,
  Select,
  Textarea,
  describedBy,
} from "@/components/ui/form-controls";
import { cn } from "@/lib/cn";
import {
  leadInfoSchema,
  leadQualificationSchema,
  opportunityDraftSchema,
  QUALIFICATION_STATUSES,
} from "../contracts/schemas";
import {
  COMPANY_SIZES,
  CRM_CURRENCIES,
  DECISION_MAKER_LABELS,
  DECISION_MAKER_OPTIONS,
  INDUSTRIES,
  LEAD_SOURCES,
  LEAD_SOURCE_LABELS,
  LEAD_STATUS_LABELS,
  PURCHASE_TIMELINES,
  PURCHASE_TIMELINE_LABELS,
  SALES_CHANNELS,
  SALES_CHANNEL_LABELS,
  type CrmCurrency,
  type StageDto,
} from "../contracts/types";
import { createLeadAction } from "./actions";
import { scoreLabel } from "./badges";
import { formatDate, formatMoney, monthsFromToday } from "./format";

/**
 * The New Lead wizard: Lead Info → Qualification → Opportunity → Review.
 *
 * One screen of questions at a time instead of one enormous form. Each step is
 * validated with the same Zod schema the server uses before moving on, and the
 * whole lead is submitted once, from the review step.
 */

const STEPS = ["Lead info", "Qualification", "Opportunity", "Review"] as const;

type Info = Record<
  | "firstName"
  | "lastName"
  | "company"
  | "jobTitle"
  | "email"
  | "phone"
  | "website"
  | "source"
  | "industry"
  | "companySize"
  | "country"
  | "city",
  string
>;

type Qualification = {
  interest: string;
  budget: string;
  budgetCurrency: CrmCurrency;
  timeline: string;
  decisionMaker: string;
  currentSolution: string;
  painPoint: string;
  score: number;
  status: (typeof QUALIFICATION_STATUSES)[number];
};

type Opportunity = {
  name: string;
  amount: string;
  currency: CrmCurrency;
  closeDate: string;
  product: string;
  probability: number;
  channel: "DIRECT" | "INDIRECT";
  partnerName: string;
  ownerId: string;
  stageId: string;
};

type Errors = Record<string, string>;

const TIMELINE_MONTHS: Record<string, number> = {
  IMMEDIATE: 1,
  WITHIN_3_MONTHS: 3,
  WITHIN_6_MONTHS: 6,
  WITHIN_12_MONTHS: 12,
  OVER_12_MONTHS: 18,
};

function issuesToErrors(
  issues: readonly { path: PropertyKey[]; message: string }[],
): Errors {
  const errors: Errors = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join(".");
    errors[key] ??= issue.message;
  }
  return errors;
}

export function LeadWizard({
  owners,
  stages,
  currentUserId,
}: {
  owners: { id: string; name: string }[];
  stages: StageDto[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [furthest, setFurthest] = useState(0);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [ownerId, setOwnerId] = useState(currentUserId);
  const [info, setInfo] = useState<Info>({
    firstName: "",
    lastName: "",
    company: "",
    jobTitle: "",
    email: "",
    phone: "",
    website: "",
    source: "",
    industry: "",
    companySize: "",
    country: "",
    city: "",
  });
  const [qualification, setQualification] = useState<Qualification>({
    interest: "",
    budget: "",
    budgetCurrency: "EGP",
    timeline: "",
    decisionMaker: "",
    currentSolution: "",
    painPoint: "",
    score: 50,
    status: "NEW",
  });
  const [createOpportunity, setCreateOpportunity] = useState<boolean | null>(null);
  const qualifiedStage = stages.find((stage) => stage.key === "qualified") ?? stages[0];
  const [opportunity, setOpportunity] = useState<Opportunity>({
    name: "",
    amount: "",
    currency: "EGP",
    closeDate: monthsFromToday(3),
    product: "",
    probability: qualifiedStage?.defaultProbability ?? 20,
    channel: "DIRECT",
    partnerName: "",
    ownerId: currentUserId,
    stageId: qualifiedStage?.id ?? "",
  });

  const setInfoField = (key: keyof Info, value: string) =>
    setInfo((current) => ({ ...current, [key]: value }));
  const setQualificationField = <K extends keyof Qualification>(
    key: K,
    value: Qualification[K],
  ) => setQualification((current) => ({ ...current, [key]: value }));
  const setOpportunityField = <K extends keyof Opportunity>(
    key: K,
    value: Opportunity[K],
  ) => setOpportunity((current) => ({ ...current, [key]: value }));

  const error = (key: string) => errors[key];

  /* Validation ------------------------------------------------------------- */

  function validateStep(index: number): boolean {
    let result: Errors = {};
    if (index === 0) {
      const parsed = leadInfoSchema.safeParse(info);
      if (!parsed.success) result = issuesToErrors(parsed.error.issues);
    } else if (index === 1) {
      const parsed = leadQualificationSchema.safeParse(qualification);
      if (!parsed.success) result = issuesToErrors(parsed.error.issues);
    } else if (index === 2) {
      if (createOpportunity === null) {
        result = { choice: "Choose whether to create an opportunity now." };
      } else if (createOpportunity) {
        const parsed = opportunityDraftSchema.safeParse(opportunity);
        if (!parsed.success) result = issuesToErrors(parsed.error.issues);
      }
    }
    setErrors(result);
    return Object.keys(result).length === 0;
  }

  function goTo(index: number) {
    setFormError(null);
    setErrors({});
    setStep(index);
    setFurthest((current) => Math.max(current, index));
    window.scrollTo({ top: 0 });
  }

  function next() {
    if (validateStep(step)) goTo(step + 1);
  }

  /** Sensible opportunity defaults from what the lead already told us. */
  function chooseCreateOpportunity(value: boolean) {
    setCreateOpportunity(value);
    setErrors({});
    if (value && opportunity.name === "") {
      setOpportunity((current) => ({
        ...current,
        name: `${info.company}${qualification.interest !== "" ? ` – ${qualification.interest}` : " deal"}`,
        amount: qualification.budget,
        currency: qualification.budgetCurrency,
        closeDate:
          qualification.timeline !== "" &&
          TIMELINE_MONTHS[qualification.timeline] !== undefined
            ? monthsFromToday(TIMELINE_MONTHS[qualification.timeline] ?? 3)
            : current.closeDate,
        product: qualification.interest,
        ownerId,
      }));
    }
  }

  /* Submit ---------------------------------------------------------------- */

  function save(withOpportunity: boolean) {
    if (!validateStep(0)) return goTo(0);
    if (!validateStep(1)) return goTo(1);
    if (withOpportunity) {
      if (createOpportunity !== true) {
        chooseCreateOpportunity(true);
        return goTo(2);
      }
      const parsed = opportunityDraftSchema.safeParse(opportunity);
      if (!parsed.success) {
        goTo(2);
        setErrors(issuesToErrors(parsed.error.issues));
        return;
      }
    }

    setFormError(null);
    startTransition(async () => {
      const result = await createLeadAction({
        info,
        qualification,
        ownerId,
        opportunity: withOpportunity ? opportunity : null,
      });
      if (result.ok) {
        router.push(
          result.data.opportunityId !== null
            ? `/crm/opportunities/${result.data.opportunityId}`
            : `/crm/leads/${result.data.leadId}`,
        );
        return;
      }
      const fieldErrors = result.fieldErrors ?? {};
      const keys = Object.keys(fieldErrors);
      const flattened: Errors = {};
      for (const key of keys) {
        const [section, ...rest] = key.split(".");
        const message = fieldErrors[key]?.[0];
        if (message !== undefined)
          flattened[rest.length > 0 ? rest.join(".") : (section ?? key)] = message;
      }
      const firstSection = keys[0]?.split(".")[0];
      if (firstSection === "info") goTo(0);
      else if (firstSection === "qualification") goTo(1);
      else if (firstSection === "opportunity") goTo(2);
      setErrors(flattened);
      setFormError(result.message);
    });
  }

  /* Render ---------------------------------------------------------------- */

  const ownerName = owners.find((owner) => owner.id === ownerId)?.name ?? "—";

  return (
    <div className="max-w-4xl">
      <Progress
        step={step}
        furthest={furthest}
        onSelect={(index) => index <= furthest && goTo(index)}
      />

      <div className="bg-surface border-border mt-4 border">
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (step < 3) next();
          }}
        >
          <div className="px-4 py-5 sm:px-6">
            {step === 0 && (
              <StepFrame
                title="Who is this lead?"
                description="The essentials first. You can add more later."
              >
                <Section title="Person">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Text
                      id="firstName"
                      label="First name"
                      required
                      value={info.firstName}
                      onChange={(v) => setInfoField("firstName", v)}
                      error={error("firstName")}
                      autoComplete="given-name"
                      autoFocus
                    />
                    <Text
                      id="lastName"
                      label="Last name"
                      required
                      value={info.lastName}
                      onChange={(v) => setInfoField("lastName", v)}
                      error={error("lastName")}
                      autoComplete="family-name"
                    />
                    <Text
                      id="jobTitle"
                      label="Job title"
                      value={info.jobTitle}
                      onChange={(v) => setInfoField("jobTitle", v)}
                      error={error("jobTitle")}
                    />
                    <Text
                      id="email"
                      label="Email"
                      type="email"
                      value={info.email}
                      onChange={(v) => setInfoField("email", v)}
                      error={error("email")}
                      autoComplete="email"
                    />
                    <Text
                      id="phone"
                      label="Phone"
                      type="tel"
                      value={info.phone}
                      onChange={(v) => setInfoField("phone", v)}
                      error={error("phone")}
                      autoComplete="tel"
                    />
                  </div>
                </Section>
                <Section title="Company">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Text
                      id="company"
                      label="Company"
                      required
                      value={info.company}
                      onChange={(v) => setInfoField("company", v)}
                      error={error("company")}
                      autoComplete="organization"
                    />
                    <Text
                      id="website"
                      label="Website"
                      value={info.website}
                      onChange={(v) => setInfoField("website", v)}
                      error={error("website")}
                      placeholder="example.com"
                    />
                    <Field label="Industry" htmlFor="industry">
                      <Select
                        id="industry"
                        value={info.industry}
                        onChange={(e) => setInfoField("industry", e.target.value)}
                        placeholder="Choose an industry"
                        options={INDUSTRIES.map((value) => ({ value, label: value }))}
                      />
                    </Field>
                    <Field label="Number of employees" htmlFor="companySize">
                      <Select
                        id="companySize"
                        value={info.companySize}
                        onChange={(e) => setInfoField("companySize", e.target.value)}
                        placeholder="Choose a size"
                        options={COMPANY_SIZES.map((value) => ({ value, label: value }))}
                      />
                    </Field>
                    <Text
                      id="country"
                      label="Country"
                      value={info.country}
                      onChange={(v) => setInfoField("country", v)}
                      error={error("country")}
                      autoComplete="country-name"
                    />
                    <Text
                      id="city"
                      label="City"
                      value={info.city}
                      onChange={(v) => setInfoField("city", v)}
                      error={error("city")}
                    />
                  </div>
                </Section>
                <PillGroup
                  name="source"
                  legend="Lead source"
                  required
                  options={LEAD_SOURCES.map((value) => ({
                    value,
                    label: LEAD_SOURCE_LABELS[value],
                  }))}
                  value={info.source}
                  onValueChange={(value) => setInfoField("source", value)}
                  error={error("source")}
                />
              </StepFrame>
            )}

            {step === 1 && (
              <StepFrame
                title="Is this a real opportunity?"
                description="A few questions to qualify the lead. Skip anything you don't know yet."
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <Text
                    id="interest"
                    label="What are they interested in?"
                    value={qualification.interest}
                    onChange={(v) => setQualificationField("interest", v)}
                    error={error("interest")}
                    placeholder="e.g. Branch archive digitization"
                    className="sm:col-span-2"
                  />
                  <div className="flex gap-2">
                    <Text
                      id="budget"
                      label="Estimated budget"
                      type="number"
                      inputMode="decimal"
                      value={qualification.budget}
                      onChange={(v) => setQualificationField("budget", v)}
                      error={error("budget")}
                      className="flex-1"
                    />
                    <Field label="Currency" htmlFor="budgetCurrency" className="w-24">
                      <Select
                        id="budgetCurrency"
                        value={qualification.budgetCurrency}
                        onChange={(e) =>
                          setQualificationField(
                            "budgetCurrency",
                            e.target.value as CrmCurrency,
                          )
                        }
                        options={CRM_CURRENCIES.map((value) => ({ value, label: value }))}
                      />
                    </Field>
                  </div>
                  <Field label="Owner" htmlFor="owner">
                    <Select
                      id="owner"
                      value={ownerId}
                      onChange={(e) => setOwnerId(e.target.value)}
                      options={owners.map((owner) => ({
                        value: owner.id,
                        label: owner.name,
                      }))}
                    />
                  </Field>
                </div>

                <PillGroup
                  name="timeline"
                  legend="Expected purchase timeline"
                  options={PURCHASE_TIMELINES.map((value) => ({
                    value,
                    label: PURCHASE_TIMELINE_LABELS[value],
                  }))}
                  value={qualification.timeline}
                  onValueChange={(value) => setQualificationField("timeline", value)}
                />
                <PillGroup
                  name="decisionMaker"
                  legend="Are they the decision maker?"
                  options={DECISION_MAKER_OPTIONS.map((value) => ({
                    value,
                    label: DECISION_MAKER_LABELS[value],
                  }))}
                  value={qualification.decisionMaker}
                  onValueChange={(value) => setQualificationField("decisionMaker", value)}
                />

                <div className="grid gap-3 sm:grid-cols-2">
                  <Text
                    id="currentSolution"
                    label="Current solution"
                    value={qualification.currentSolution}
                    onChange={(v) => setQualificationField("currentSolution", v)}
                    error={error("currentSolution")}
                    placeholder="Paper files, a legacy system…"
                  />
                  <RangeField
                    id="score"
                    label="Lead score"
                    value={qualification.score}
                    onValueChange={(value) => setQualificationField("score", value)}
                    describe={scoreLabel}
                  />
                </div>

                <Field
                  label="Main pain point"
                  htmlFor="painPoint"
                  error={error("painPoint")}
                >
                  <Textarea
                    id="painPoint"
                    value={qualification.painPoint}
                    onChange={(e) => setQualificationField("painPoint", e.target.value)}
                    rows={3}
                    dir="auto"
                  />
                </Field>

                <PillGroup
                  name="status"
                  legend="Qualification status"
                  options={QUALIFICATION_STATUSES.map((value) => ({
                    value,
                    label: LEAD_STATUS_LABELS[value],
                  }))}
                  value={qualification.status}
                  onValueChange={(value) =>
                    setQualificationField("status", value as Qualification["status"])
                  }
                />
              </StepFrame>
            )}

            {step === 2 && (
              <StepFrame
                title="Create an opportunity?"
                description="If there's a deal to pursue, create it now and it goes straight onto the pipeline."
              >
                <div
                  className="grid gap-2 sm:grid-cols-2"
                  role="radiogroup"
                  aria-label="Opportunity choice"
                >
                  <ChoiceCard
                    selected={createOpportunity === true}
                    onSelect={() => chooseCreateOpportunity(true)}
                    title="Create opportunity"
                    description="Converts the lead: creates the company, the contact and the deal."
                    icon={<Sparkles size={18} />}
                  />
                  <ChoiceCard
                    selected={createOpportunity === false}
                    onSelect={() => chooseCreateOpportunity(false)}
                    title="Save lead only"
                    description="Keep qualifying first. You can convert it later."
                  />
                </div>
                {error("choice") !== undefined && (
                  <p role="alert" className="text-danger text-xs">
                    {error("choice")}
                  </p>
                )}

                {createOpportunity === true && (
                  <div className="animate-tv-fade grid gap-3 sm:grid-cols-2">
                    <Text
                      id="opportunityName"
                      label="Opportunity name"
                      required
                      value={opportunity.name}
                      onChange={(v) => setOpportunityField("name", v)}
                      error={error("name")}
                      className="sm:col-span-2"
                    />
                    <div className="flex gap-2">
                      <Text
                        id="amount"
                        label="Estimated deal value"
                        required
                        type="number"
                        inputMode="decimal"
                        value={opportunity.amount}
                        onChange={(v) => setOpportunityField("amount", v)}
                        error={error("amount")}
                        className="flex-1"
                      />
                      <Field label="Currency" htmlFor="currency" className="w-24">
                        <Select
                          id="currency"
                          value={opportunity.currency}
                          onChange={(e) =>
                            setOpportunityField("currency", e.target.value as CrmCurrency)
                          }
                          options={CRM_CURRENCIES.map((value) => ({
                            value,
                            label: value,
                          }))}
                        />
                      </Field>
                    </div>
                    <Text
                      id="closeDate"
                      label="Expected close date"
                      required
                      type="date"
                      value={opportunity.closeDate}
                      onChange={(v) => setOpportunityField("closeDate", v)}
                      error={error("closeDate")}
                    />
                    <Text
                      id="product"
                      label="Product / service"
                      value={opportunity.product}
                      onChange={(v) => setOpportunityField("product", v)}
                      error={error("product")}
                    />
                    <Field label="Stage" htmlFor="stage">
                      <Select
                        id="stage"
                        value={opportunity.stageId}
                        onChange={(e) => {
                          const stage = stages.find(
                            (candidate) => candidate.id === e.target.value,
                          );
                          setOpportunity((current) => ({
                            ...current,
                            stageId: e.target.value,
                            probability: stage?.defaultProbability ?? current.probability,
                          }));
                        }}
                        options={stages.map((stage) => ({
                          value: stage.id,
                          label: stage.name,
                        }))}
                      />
                    </Field>
                    <RangeField
                      id="probability"
                      label="Probability"
                      value={opportunity.probability}
                      onValueChange={(value) => setOpportunityField("probability", value)}
                      step={5}
                      suffix="%"
                    />
                    <Field label="Owner" htmlFor="opportunityOwner">
                      <Select
                        id="opportunityOwner"
                        value={opportunity.ownerId}
                        onChange={(e) => setOpportunityField("ownerId", e.target.value)}
                        options={owners.map((owner) => ({
                          value: owner.id,
                          label: owner.name,
                        }))}
                      />
                    </Field>
                    <PillGroup
                      name="channel"
                      legend="Sales channel"
                      options={SALES_CHANNELS.map((value) => ({
                        value,
                        label: SALES_CHANNEL_LABELS[value],
                      }))}
                      value={opportunity.channel}
                      onValueChange={(value) =>
                        setOpportunityField("channel", value as Opportunity["channel"])
                      }
                      className="sm:col-span-2"
                    />
                    {opportunity.channel === "INDIRECT" && (
                      <Text
                        id="partnerName"
                        label="Channel partner"
                        required
                        value={opportunity.partnerName}
                        onChange={(v) => setOpportunityField("partnerName", v)}
                        error={error("partnerName")}
                      />
                    )}
                  </div>
                )}
              </StepFrame>
            )}

            {step === 3 && (
              <StepFrame title="Review" description="Check the details, then save.">
                <div className="bg-border border-border grid gap-px border md:grid-cols-3">
                  <Summary title="Lead" onEdit={() => goTo(0)}>
                    <SummaryLine
                      strong
                    >{`${info.firstName} ${info.lastName}`}</SummaryLine>
                    <SummaryLine>{info.company}</SummaryLine>
                    <SummaryLine muted>{info.jobTitle}</SummaryLine>
                    <SummaryLine muted>{info.email}</SummaryLine>
                    <SummaryLine muted>
                      {info.source !== ""
                        ? LEAD_SOURCE_LABELS[
                            info.source as keyof typeof LEAD_SOURCE_LABELS
                          ]
                        : ""}
                    </SummaryLine>
                  </Summary>
                  <Summary title="Qualification" onEdit={() => goTo(1)}>
                    <SummaryLine
                      strong
                    >{`Score: ${qualification.score} · ${scoreLabel(qualification.score)}`}</SummaryLine>
                    <SummaryLine>
                      {qualification.budget !== "" &&
                      Number.isFinite(Number(qualification.budget))
                        ? `Budget: ${formatMoney(Math.round(Number(qualification.budget) * 100), qualification.budgetCurrency)}`
                        : "Budget: not known"}
                    </SummaryLine>
                    <SummaryLine>
                      {`Timeline: ${qualification.timeline !== "" ? PURCHASE_TIMELINE_LABELS[qualification.timeline as keyof typeof PURCHASE_TIMELINE_LABELS] : "not known"}`}
                    </SummaryLine>
                    <SummaryLine
                      muted
                    >{`Status: ${LEAD_STATUS_LABELS[qualification.status]}`}</SummaryLine>
                    <SummaryLine muted>{`Owner: ${ownerName}`}</SummaryLine>
                  </Summary>
                  <Summary title="Opportunity" onEdit={() => goTo(2)}>
                    {createOpportunity === true ? (
                      <>
                        <SummaryLine strong>{opportunity.name}</SummaryLine>
                        <SummaryLine>
                          {opportunity.amount !== "" &&
                          Number.isFinite(Number(opportunity.amount))
                            ? formatMoney(
                                Math.round(Number(opportunity.amount) * 100),
                                opportunity.currency,
                              )
                            : "—"}
                        </SummaryLine>
                        <SummaryLine>
                          {opportunity.closeDate !== ""
                            ? `Expected close: ${formatDate(new Date(`${opportunity.closeDate}T00:00:00Z`))}`
                            : ""}
                        </SummaryLine>
                        <SummaryLine
                          muted
                        >{`${opportunity.probability}% · ${SALES_CHANNEL_LABELS[opportunity.channel]}${opportunity.channel === "INDIRECT" && opportunity.partnerName !== "" ? ` · ${opportunity.partnerName}` : ""}`}</SummaryLine>
                      </>
                    ) : (
                      <SummaryLine muted>
                        No opportunity — the lead will be saved on its own.
                      </SummaryLine>
                    )}
                  </Summary>
                </div>
              </StepFrame>
            )}

            {formError !== null && (
              <p
                role="alert"
                className="border-danger/25 bg-danger-subtle text-danger mt-4 border px-3 py-2 text-xs"
              >
                {formError}
              </p>
            )}
          </div>

          <div className="border-border-strong flex flex-wrap items-center justify-between gap-2 border-t-2 px-4 py-3 sm:px-6">
            <div>
              {step > 0 && (
                <Button
                  variant="ghost"
                  icon={<ChevronLeft aria-hidden="true" size={16} />}
                  onClick={() => goTo(step - 1)}
                  disabled={isPending}
                >
                  Back
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {step < 3 ? (
                <Button type="submit" variant="primary">
                  Continue
                </Button>
              ) : (
                <>
                  <Button
                    variant={createOpportunity === true ? "secondary" : "primary"}
                    onClick={() => save(false)}
                    isPending={isPending}
                  >
                    Save lead
                  </Button>
                  <Button
                    variant={createOpportunity === true ? "primary" : "secondary"}
                    onClick={() => save(true)}
                    isPending={isPending}
                  >
                    Save &amp; create opportunity
                  </Button>
                </>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pieces                                                                     */
/* -------------------------------------------------------------------------- */

function Progress({
  step,
  furthest,
  onSelect,
}: {
  step: number;
  furthest: number;
  onSelect: (index: number) => void;
}) {
  return (
    <nav aria-label="Wizard progress">
      <ol className="bg-border border-border grid grid-cols-4 gap-px border">
        {STEPS.map((label, index) => {
          const done = index < step;
          const current = index === step;
          const reachable = index <= furthest;
          return (
            <li key={label} className="bg-surface min-w-0">
              <button
                type="button"
                onClick={() => onSelect(index)}
                disabled={!reachable}
                aria-current={current ? "step" : undefined}
                className={cn(
                  "flex w-full items-center gap-2 border-t-3 px-2 py-2.5 text-start sm:px-3",
                  current
                    ? "border-primary"
                    : done
                      ? "border-foreground"
                      : "border-transparent",
                  reachable ? "cursor-pointer" : "cursor-default",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid size-6 shrink-0 place-items-center text-[11px] font-extrabold",
                    current
                      ? "bg-primary text-primary-foreground"
                      : done
                        ? "bg-foreground text-canvas"
                        : "bg-surface-sunken text-foreground-muted",
                  )}
                >
                  {done ? <Check size={13} strokeWidth={3} /> : index + 1}
                </span>
                <span
                  className={cn(
                    "hidden truncate text-[13px] sm:inline",
                    current ? "text-foreground font-extrabold" : "text-foreground-muted",
                  )}
                >
                  {label}
                </span>
                <span className="sr-only sm:hidden">{label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function StepFrame({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-foreground text-2xl">{title}</h2>
        <p className="text-foreground-muted mt-1 text-[13px]">{description}</p>
      </div>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="kicker text-primary-ink">{title}</h3>
      {children}
    </section>
  );
}

function Text({
  id,
  label,
  value,
  onChange,
  error,
  required,
  className,
  ...props
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
  className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "id">) {
  return (
    <Field
      label={label}
      htmlFor={id}
      required={required}
      error={error}
      className={className}
    >
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        invalid={error !== undefined}
        aria-describedby={describedBy(id, error)}
        aria-required={required}
        dir={props.type === undefined || props.type === "text" ? "auto" : undefined}
        {...props}
      />
    </Field>
  );
}

function ChoiceCard({
  selected,
  onSelect,
  title,
  description,
  icon,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description: string;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex cursor-pointer flex-col items-start gap-1 border-2 p-4 text-start transition-colors",
        selected
          ? "border-primary bg-primary-subtle"
          : "border-border-strong hover:bg-surface-hover",
      )}
    >
      <span className="text-foreground flex items-center gap-2 text-[15px] font-extrabold">
        {icon}
        {title}
      </span>
      <span className="text-foreground-muted text-[13px]">{description}</span>
    </button>
  );
}

function Summary({
  title,
  onEdit,
  children,
}: {
  title: string;
  onEdit: () => void;
  children: ReactNode;
}) {
  return (
    <section className="bg-surface flex min-w-0 flex-col gap-1 p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="kicker text-primary-ink">{title}</h3>
        <button
          type="button"
          onClick={onEdit}
          className="text-primary-ink cursor-pointer text-xs font-extrabold hover:underline"
        >
          Edit
        </button>
      </div>
      {children}
    </section>
  );
}

function SummaryLine({
  children,
  strong,
  muted,
}: {
  children: ReactNode;
  strong?: boolean;
  muted?: boolean;
}) {
  if (children === "" || children === null || children === undefined) return null;
  return (
    <p
      className={cn(
        "truncate text-[13px]",
        strong && "text-foreground text-[15px] font-extrabold",
        muted ? "text-foreground-muted" : "text-foreground",
      )}
      dir="auto"
    >
      {children}
    </p>
  );
}
