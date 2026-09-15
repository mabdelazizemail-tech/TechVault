"use client";

import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { controlClasses } from "@/components/ui/form-controls";
import { Panel, PanelHeader } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABELS,
  JOURNAL_KIND_LABELS,
  type AccountOption,
  type AccountRef,
  type CostCentreRef,
} from "../contracts/types";
import {
  MAX_JOURNAL_LINES,
  formatMinorAmount,
  parseAmountText,
  summarizeLines,
} from "../domain/journal";
import { createJournalAction, updateJournalAction } from "./actions";
import { BalanceBadge } from "./badges";
import { FormError, fieldError } from "./form-parts";

/**
 * The journal entry form: a date, a description and a grid of lines, with running
 * debit and credit totals and whether they balance.
 *
 * What it shows is a convenience. The server parses every amount again, checks
 * every account, and decides at posting whether the entry balances — nothing here is
 * trusted (CLAUDE.md §16.5).
 */

type LineState = {
  key: number;
  accountId: string;
  costCentreId: string;
  description: string;
  debit: string;
  credit: string;
};

export type JournalFormInitial = {
  kind: "STANDARD" | "OPENING_BALANCE";
  entryDate: string;
  description: string;
  reference: string | null;
  lines: {
    accountId: string;
    costCentreId: string | null;
    description: string | null;
    debitMinor: number;
    creditMinor: number;
  }[];
};

let nextKey = 1;
const blankLine = (): LineState => ({
  key: nextKey++,
  accountId: "",
  costCentreId: "",
  description: "",
  debit: "",
  credit: "",
});

const amountText = (minor: number) => (minor === 0 ? "" : formatMinorAmount(minor));

export function JournalForm({
  mode,
  entryId,
  accounts,
  costCentres,
  initial,
  defaultDate,
  openingBalanceAccount,
}: {
  mode: "create" | "edit";
  entryId?: string;
  accounts: AccountOption[];
  costCentres: CostCentreRef[];
  initial?: JournalFormInitial;
  defaultDate: string;
  /** Finance settings' opening balance account, used to balance opening balances. */
  openingBalanceAccount: AccountRef | null;
}) {
  const router = useRouter();
  const [entryDate, setEntryDate] = useState(initial?.entryDate ?? defaultDate);
  const [description, setDescription] = useState(initial?.description ?? "");
  const [reference, setReference] = useState(initial?.reference ?? "");
  const [kind, setKind] = useState<"STANDARD" | "OPENING_BALANCE">(
    initial?.kind ?? "STANDARD",
  );
  const [lines, setLines] = useState<LineState[]>(() =>
    initial === undefined
      ? [blankLine(), blankLine()]
      : initial.lines.map((line) => ({
          key: nextKey++,
          accountId: line.accountId,
          costCentreId: line.costCentreId ?? "",
          description: line.description ?? "",
          debit: amountText(line.debitMinor),
          credit: amountText(line.creditMinor),
        })),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const [isPending, startTransition] = useTransition();

  const parsed = lines.map((line) => ({
    debit: parseAmountText(line.debit),
    credit: parseAmountText(line.credit),
  }));
  const hasInvalidAmount = parsed.some((line) => !line.debit.ok || !line.credit.ok);
  const summary = summarizeLines(
    parsed.map((line) => ({
      debitMinor: line.debit.ok ? line.debit.minor : 0n,
      creditMinor: line.credit.ok ? line.credit.minor : 0n,
    })),
  );
  const difference =
    summary.differenceMinor < 0n ? -summary.differenceMinor : summary.differenceMinor;

  const updateLine = (key: number, patch: Partial<LineState>) =>
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );

  const groups = ACCOUNT_TYPES.map((type) => ({
    type,
    options: accounts.filter((account) => account.type === type),
  })).filter((group) => group.options.length > 0);

  /** Opening balances: put the difference on the opening balance account, on the side that balances. */
  const balanceToOpeningAccount = () => {
    if (openingBalanceAccount === null || summary.differenceMinor === 0n) return;
    const amount = formatMinorAmount(difference);
    setLines((current) => [
      ...current,
      {
        ...blankLine(),
        accountId: openingBalanceAccount.id,
        ...(summary.differenceMinor > 0n ? { credit: amount } : { debit: amount }),
      },
    ]);
  };

  const submit = () => {
    setMessage(null);
    setErrors(undefined);
    const payload = {
      kind,
      entryDate,
      description,
      reference,
      lines: lines.map((line) => ({
        accountId: line.accountId,
        costCentreId: line.costCentreId,
        description: line.description,
        debit: line.debit,
        credit: line.credit,
      })),
    };
    startTransition(async () => {
      const result =
        mode === "edit" && entryId !== undefined
          ? await updateJournalAction(entryId, payload)
          : await createJournalAction(payload);
      if (result.ok) {
        router.push(`/erp/finance/journals/${result.data.id}`);
      } else {
        setMessage(result.message);
        setErrors(result.fieldErrors);
      }
    });
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex flex-col gap-4"
      noValidate
    >
      {message !== null && <FormError message={message} />}

      <Panel>
        <PanelHeader title="Entry" />
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-[11rem_12rem_minmax(0,1fr)_14rem]">
          <FieldBlock
            id="entryDate"
            label="Date"
            required
            error={fieldError(errors, "entryDate")}
          >
            <input
              id="entryDate"
              type="date"
              required
              value={entryDate}
              onChange={(event) => setEntryDate(event.target.value)}
              aria-invalid={fieldError(errors, "entryDate") !== undefined || undefined}
              className={cn(controlClasses, "border-border-strong min-h-10")}
            />
          </FieldBlock>
          <FieldBlock id="kind" label="Entry type" error={fieldError(errors, "kind")}>
            <select
              id="kind"
              value={kind}
              onChange={(event) =>
                setKind(
                  event.target.value === "OPENING_BALANCE"
                    ? "OPENING_BALANCE"
                    : "STANDARD",
                )
              }
              className={cn(
                controlClasses,
                "border-border-strong min-h-10 cursor-pointer",
              )}
            >
              <option value="STANDARD">{JOURNAL_KIND_LABELS.STANDARD}</option>
              <option value="OPENING_BALANCE">
                {JOURNAL_KIND_LABELS.OPENING_BALANCE}
              </option>
            </select>
          </FieldBlock>
          <FieldBlock
            id="description"
            label="Description"
            required
            error={fieldError(errors, "description")}
          >
            <input
              id="description"
              value={description}
              maxLength={500}
              dir="auto"
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Office equipment purchase"
              aria-invalid={fieldError(errors, "description") !== undefined || undefined}
              className={cn(controlClasses, "border-border-strong min-h-10")}
            />
          </FieldBlock>
          <FieldBlock
            id="reference"
            label="Reference"
            error={fieldError(errors, "reference")}
          >
            <input
              id="reference"
              value={reference}
              maxLength={100}
              dir="auto"
              onChange={(event) => setReference(event.target.value)}
              placeholder="Invoice or receipt number"
              className={cn(controlClasses, "border-border-strong min-h-10")}
            />
          </FieldBlock>
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Lines"
          description="Each line is a debit or a credit. Debits must equal credits before the entry can be posted."
          actions={
            <BalanceBadge
              debitMinor={summary.debitMinor}
              creditMinor={summary.creditMinor}
              difference={formatMinorAmount(difference)}
            />
          }
        />

        {kind === "OPENING_BALANCE" && (
          <div className="border-border flex flex-wrap items-center gap-3 border-b px-4 py-3 text-sm">
            <span className="text-foreground-muted min-w-0 flex-1">
              {openingBalanceAccount === null
                ? "Enter each account's balance. Choose an opening balance account in finance settings to balance the entry in one step."
                : `Enter each account's balance, then put the difference on ${openingBalanceAccount.code} — ${openingBalanceAccount.name}.`}
            </span>
            {openingBalanceAccount !== null && (
              <Button
                size="sm"
                disabled={
                  hasInvalidAmount ||
                  summary.differenceMinor === 0n ||
                  lines.length >= MAX_JOURNAL_LINES
                }
                onClick={balanceToOpeningAccount}
              >
                Add balancing line
              </Button>
            )}
          </div>
        )}

        {(fieldError(errors, "lines") ?? fieldError(errors, "_")) !== undefined && (
          <p role="alert" className="text-danger px-4 pt-3 text-sm">
            {fieldError(errors, "lines") ?? fieldError(errors, "_")}
          </p>
        )}

        <div
          aria-hidden="true"
          className="label-caps border-border hidden grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.5fr)_9rem_9rem_2.5rem] gap-2 border-b-2 px-4 py-2.5 lg:grid"
        >
          <span>Account</span>
          <span>Cost centre</span>
          <span>Line description</span>
          <span className="text-end">Debit (EGP)</span>
          <span className="text-end">Credit (EGP)</span>
          <span />
        </div>

        <ol className="divide-border divide-y">
          {lines.map((line, index) => {
            const number = index + 1;
            const prefix = `lines.${index}`;
            const amountError = (side: "debit" | "credit") => {
              const local = parsed[index]?.[side];
              if (local !== undefined && !local.ok) return local.message;
              return fieldError(errors, `${prefix}.${side}`);
            };
            return (
              <li
                key={line.key}
                className="grid gap-2 px-4 py-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.5fr)_9rem_9rem_2.5rem] lg:items-start"
              >
                <CellField
                  label={`Line ${number} account`}
                  error={fieldError(errors, `${prefix}.accountId`)}
                >
                  <select
                    aria-label={`Line ${number} account`}
                    value={line.accountId}
                    onChange={(event) =>
                      updateLine(line.key, { accountId: event.target.value })
                    }
                    className={cn(
                      controlClasses,
                      "border-border-strong min-h-10 cursor-pointer",
                    )}
                  >
                    <option value="">Choose an account</option>
                    {groups.map((group) => (
                      <optgroup key={group.type} label={ACCOUNT_TYPE_LABELS[group.type]}>
                        {group.options.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.code} — {account.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </CellField>

                <CellField
                  label={`Line ${number} cost centre`}
                  error={fieldError(errors, `${prefix}.costCentreId`)}
                >
                  <select
                    aria-label={`Line ${number} cost centre`}
                    value={line.costCentreId}
                    onChange={(event) =>
                      updateLine(line.key, { costCentreId: event.target.value })
                    }
                    className={cn(
                      controlClasses,
                      "border-border-strong min-h-10 cursor-pointer",
                    )}
                  >
                    <option value="">No cost centre</option>
                    {costCentres.map((centre) => (
                      <option key={centre.id} value={centre.id}>
                        {centre.code} — {centre.name}
                      </option>
                    ))}
                  </select>
                </CellField>

                <CellField
                  label={`Line ${number} description`}
                  error={fieldError(errors, `${prefix}.description`)}
                >
                  <input
                    aria-label={`Line ${number} description`}
                    value={line.description}
                    maxLength={300}
                    dir="auto"
                    onChange={(event) =>
                      updateLine(line.key, { description: event.target.value })
                    }
                    className={cn(controlClasses, "border-border-strong min-h-10")}
                  />
                </CellField>

                <CellField label={`Line ${number} debit`} error={amountError("debit")}>
                  <input
                    aria-label={`Line ${number} debit`}
                    inputMode="decimal"
                    dir="ltr"
                    value={line.debit}
                    placeholder="0.00"
                    onChange={(event) =>
                      // A line is one side only: typing a debit clears the credit.
                      updateLine(line.key, {
                        debit: event.target.value,
                        ...(event.target.value.trim() !== "" ? { credit: "" } : {}),
                      })
                    }
                    className={cn(
                      controlClasses,
                      "border-border-strong min-h-10 text-end tabular-nums",
                    )}
                  />
                </CellField>

                <CellField label={`Line ${number} credit`} error={amountError("credit")}>
                  <input
                    aria-label={`Line ${number} credit`}
                    inputMode="decimal"
                    dir="ltr"
                    value={line.credit}
                    placeholder="0.00"
                    onChange={(event) =>
                      updateLine(line.key, {
                        credit: event.target.value,
                        ...(event.target.value.trim() !== "" ? { debit: "" } : {}),
                      })
                    }
                    className={cn(
                      controlClasses,
                      "border-border-strong min-h-10 text-end tabular-nums",
                    )}
                  />
                </CellField>

                <button
                  type="button"
                  onClick={() =>
                    setLines((current) =>
                      current.filter((candidate) => candidate.key !== line.key),
                    )
                  }
                  disabled={lines.length <= 2}
                  aria-label={`Remove line ${number}`}
                  title={
                    lines.length <= 2
                      ? "An entry needs at least two lines"
                      : "Remove line"
                  }
                  className="text-foreground-muted hover:bg-surface-hover hover:text-danger grid min-h-10 cursor-pointer place-items-center disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                </button>
              </li>
            );
          })}
        </ol>

        <div className="rule-t grid gap-2 px-4 py-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.5fr)_9rem_9rem_2.5rem] lg:items-center">
          <div className="lg:col-span-3">
            <Button
              size="sm"
              icon={<Plus aria-hidden="true" className="size-4" />}
              disabled={lines.length >= MAX_JOURNAL_LINES}
              onClick={() => setLines((current) => [...current, blankLine()])}
            >
              Add line
            </Button>
          </div>
          <p className="flex justify-between gap-2 text-sm font-bold tabular-nums lg:block lg:text-end">
            <span className="text-foreground-muted lg:sr-only">Total debit</span>
            <span dir="ltr">{formatMinorAmount(summary.debitMinor)}</span>
          </p>
          <p className="flex justify-between gap-2 text-sm font-bold tabular-nums lg:block lg:text-end">
            <span className="text-foreground-muted lg:sr-only">Total credit</span>
            <span dir="ltr">{formatMinorAmount(summary.creditMinor)}</span>
          </p>
        </div>
        <p aria-live="polite" className="sr-only">
          {hasInvalidAmount
            ? "Some amounts are not valid."
            : summary.isBalanced
              ? "The entry is balanced."
              : `The entry is out of balance by ${formatMinorAmount(difference)}.`}
        </p>
      </Panel>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" isPending={isPending}>
          {isPending ? "Saving…" : mode === "edit" ? "Save draft" : "Save as draft"}
        </Button>
        <Link
          href={
            mode === "edit" && entryId !== undefined
              ? `/erp/finance/journals/${entryId}`
              : "/erp/finance/journals"
          }
          className="text-foreground-muted hover:text-foreground text-sm font-bold"
        >
          Cancel
        </Link>
        <p className="text-foreground-muted text-xs">
          Drafts can be changed. Review and post the entry from its page.
        </p>
      </div>
    </form>
  );
}

function FieldBlock({
  id,
  label,
  required,
  error,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-foreground text-xs font-semibold">
        {label}
        {required === true && (
          <span aria-hidden="true" className="text-danger ms-0.5">
            *
          </span>
        )}
      </label>
      {children}
      {error !== undefined && (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

/** A grid cell: the label shows above the control on narrow screens only. */
function CellField({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span aria-hidden="true" className="text-foreground-muted text-xs lg:hidden">
        {label}
      </span>
      {children}
      {error !== undefined && (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
