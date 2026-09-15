"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Select } from "@/components/ui/form-controls";
import { useToast } from "@/components/ui/toast";
import type { AccountOption, FinanceSettingsDto } from "../contracts/types";
import { updateFinanceSettingsAction } from "./actions";
import { FormError, fieldError } from "./form-parts";

/** Who may post journal entries, and the equity accounts finance uses (ADR-027). */
export function FinanceSettingsForm({
  settings,
  equityAccounts,
}: {
  settings: FinanceSettingsDto;
  equityAccounts: AccountOption[];
}) {
  const router = useRouter();
  const notify = useToast();
  const [allowSelfPosting, setAllowSelfPosting] = useState(settings.allowSelfPosting);
  const [retainedEarnings, setRetainedEarnings] = useState(
    settings.retainedEarningsAccount?.id ?? "",
  );
  const [openingBalance, setOpeningBalance] = useState(
    settings.openingBalanceAccount?.id ?? "",
  );
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const [isPending, startTransition] = useTransition();
  const options = equityAccounts.map((account) => ({
    value: account.id,
    label: `${account.code} — ${account.name}`,
  }));

  return (
    <form
      noValidate
      className="grid gap-4 p-4 md:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        setMessage(null);
        setErrors(undefined);
        startTransition(async () => {
          const result = await updateFinanceSettingsAction({
            allowSelfPosting,
            retainedEarningsAccountId: retainedEarnings,
            openingBalanceAccountId: openingBalance,
          });
          if (result.ok) {
            notify("Finance settings saved.");
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
      <div className="flex flex-col gap-1 md:col-span-2">
        <Checkbox
          label="Allow people to post journal entries they created or last edited"
          checked={allowSelfPosting}
          onChange={(event) => setAllowSelfPosting(event.target.checked)}
        />
        <p className="text-foreground-muted text-xs">
          Off by default, so a second person posts every manual journal entry. Switch it
          on only if one person runs finance alone; the change is audited.
        </p>
      </div>
      <Field
        label="Retained earnings account"
        htmlFor="retainedEarnings"
        hint="Year-end close moves each year's profit or loss into this account."
        error={fieldError(errors, "retainedEarningsAccountId")}
      >
        <Select
          id="retainedEarnings"
          value={retainedEarnings}
          placeholder="Not set"
          options={options}
          onChange={(event) => setRetainedEarnings(event.target.value)}
        />
      </Field>
      <Field
        label="Opening balance account"
        htmlFor="openingBalance"
        hint="Balances an opening balance journal brought over from a previous system."
        error={fieldError(errors, "openingBalanceAccountId")}
      >
        <Select
          id="openingBalance"
          value={openingBalance}
          placeholder="Not set"
          options={options}
          onChange={(event) => setOpeningBalance(event.target.value)}
        />
      </Field>
      <div className="md:col-span-2">
        <Button type="submit" variant="primary" isPending={isPending}>
          {isPending ? "Saving…" : "Save finance settings"}
        </Button>
      </div>
    </form>
  );
}
