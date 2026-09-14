"use client";

import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form-controls";
import { useToast } from "@/components/ui/toast";
import {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABELS,
  DEFAULT_NORMAL_BALANCE,
  NORMAL_BALANCES,
  NORMAL_BALANCE_LABELS,
  type AccountOption,
  type AccountType,
  type NormalBalance,
} from "../contracts/types";
import {
  createAccountAction,
  setAccountActiveAction,
  updateAccountAction,
} from "./actions";
import { FormError, fieldError } from "./form-parts";

export type EditableAccount = {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  type: AccountType;
  normalBalance: NormalBalance;
  parentId: string | null;
  isPostable: boolean;
  description: string | null;
  hasPostings: boolean;
};

/** Add an account, or edit one. The code is fixed once the account exists. */
export function AccountFormButton({
  headings,
  account,
}: {
  /** Heading accounts that may be chosen as a parent. */
  headings: AccountOption[];
  account?: EditableAccount;
}) {
  const router = useRouter();
  const notify = useToast();
  const isEdit = account !== undefined;
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState(account?.code ?? "");
  const [name, setName] = useState(account?.name ?? "");
  const [nameAr, setNameAr] = useState(account?.nameAr ?? "");
  const [type, setType] = useState<AccountType>(account?.type ?? "ASSET");
  const [normalBalance, setNormalBalance] = useState<NormalBalance>(
    account?.normalBalance ?? DEFAULT_NORMAL_BALANCE.ASSET,
  );
  const [parentId, setParentId] = useState(account?.parentId ?? "");
  const [isPostable, setIsPostable] = useState(account?.isPostable ?? true);
  const [description, setDescription] = useState(account?.description ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const [isPending, startTransition] = useTransition();

  const parents = headings.filter(
    (heading) => heading.type === type && heading.id !== account?.id,
  );
  const locked = account?.hasPostings === true;

  return (
    <>
      <Button
        variant={isEdit ? "secondary" : "primary"}
        icon={
          isEdit ? (
            <Pencil aria-hidden="true" className="size-4" />
          ) : (
            <Plus aria-hidden="true" className="size-4" />
          )
        }
        onClick={() => {
          setMessage(null);
          setErrors(undefined);
          setOpen(true);
        }}
      >
        {isEdit ? "Edit account" : "New account"}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        variant="sheet"
        title={isEdit ? `Edit account ${account.code}` : "New account"}
        description="Headings group accounts; only postable accounts take journal lines."
      >
        {message !== null && <FormError message={message} />}
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setMessage(null);
            setErrors(undefined);
            const fields = {
              name,
              nameAr,
              type,
              normalBalance,
              parentId,
              isPostable,
              description,
            };
            startTransition(async () => {
              const result = isEdit
                ? await updateAccountAction(account.id, fields)
                : await createAccountAction({ code, ...fields });
              if (result.ok) {
                setOpen(false);
                notify(isEdit ? "Account updated." : "Account created.");
                if (isEdit) router.refresh();
                else router.push(`/erp/finance/accounts/${result.data.id}`);
              } else {
                setMessage(result.message);
                setErrors(result.fieldErrors);
              }
            });
          }}
        >
          {!isEdit && (
            <Field
              label="Code"
              htmlFor="account-code"
              required
              error={fieldError(errors, "code")}
            >
              <Input
                id="account-code"
                value={code}
                maxLength={20}
                dir="ltr"
                placeholder="1130"
                onChange={(event) => setCode(event.target.value)}
                invalid={fieldError(errors, "code") !== undefined}
              />
            </Field>
          )}
          <Field
            label="Name"
            htmlFor="account-name"
            required
            error={fieldError(errors, "name")}
          >
            <Input
              id="account-name"
              value={name}
              maxLength={150}
              dir="auto"
              onChange={(event) => setName(event.target.value)}
              invalid={fieldError(errors, "name") !== undefined}
            />
          </Field>
          <Field
            label="Arabic name"
            htmlFor="account-name-ar"
            error={fieldError(errors, "nameAr")}
          >
            <Input
              id="account-name-ar"
              value={nameAr}
              maxLength={150}
              dir="rtl"
              lang="ar"
              onChange={(event) => setNameAr(event.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Type"
              htmlFor="account-type"
              required
              hint={locked ? "Fixed: the account is used in journal entries." : undefined}
              error={fieldError(errors, "type")}
            >
              <Select
                id="account-type"
                value={type}
                disabled={locked}
                options={ACCOUNT_TYPES.map((value) => ({
                  value,
                  label: ACCOUNT_TYPE_LABELS[value],
                }))}
                onChange={(event) => {
                  const next = event.target.value as AccountType;
                  setType(next);
                  setNormalBalance(DEFAULT_NORMAL_BALANCE[next]);
                  setParentId("");
                }}
              />
            </Field>
            <Field
              label="Normal balance"
              htmlFor="account-normal-balance"
              required
              hint="Change only for contra accounts."
              error={fieldError(errors, "normalBalance")}
            >
              <Select
                id="account-normal-balance"
                value={normalBalance}
                options={NORMAL_BALANCES.map((value) => ({
                  value,
                  label: NORMAL_BALANCE_LABELS[value],
                }))}
                onChange={(event) =>
                  setNormalBalance(event.target.value as NormalBalance)
                }
              />
            </Field>
          </div>
          <Field
            label="Parent"
            htmlFor="account-parent"
            error={fieldError(errors, "parentId")}
          >
            <Select
              id="account-parent"
              value={parentId}
              placeholder="None — a top-level account"
              options={parents.map((heading) => ({
                value: heading.id,
                label: `${heading.code} — ${heading.name}`,
              }))}
              onChange={(event) => setParentId(event.target.value)}
            />
          </Field>
          <Checkbox
            label="Takes postings (untick for a heading that groups other accounts)"
            checked={isPostable}
            disabled={locked && isPostable}
            onChange={(event) => setIsPostable(event.target.checked)}
          />
          <Field
            label="Description"
            htmlFor="account-description"
            error={fieldError(errors, "description")}
          >
            <Textarea
              id="account-description"
              value={description}
              maxLength={500}
              rows={3}
              dir="auto"
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
          <DialogActions>
            <Button onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isPending={isPending}>
              {isPending ? "Saving…" : isEdit ? "Save changes" : "Create account"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </>
  );
}

export function AccountActiveButton({
  accountId,
  code,
  isActive,
}: {
  accountId: string;
  code: string;
  isActive: boolean;
}) {
  const router = useRouter();
  const notify = useToast();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <Button
        onClick={() => {
          setMessage(null);
          setOpen(true);
        }}
      >
        {isActive ? "Deactivate" : "Activate"}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`${isActive ? "Deactivate" : "Activate"} account ${code}?`}
        description={
          isActive
            ? "An inactive account keeps its history and balance but cannot be used on new journal entries, and drafts that use it cannot be posted."
            : "The account can be used on journal entries again."
        }
      >
        {message !== null && <FormError message={message} />}
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant={isActive ? "danger" : "primary"}
            isPending={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await setAccountActiveAction(accountId, !isActive);
                if (result.ok) {
                  setOpen(false);
                  notify(isActive ? "Account deactivated." : "Account activated.");
                  router.refresh();
                } else {
                  setMessage(result.message);
                }
              })
            }
          >
            {isActive ? "Deactivate account" : "Activate account"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
