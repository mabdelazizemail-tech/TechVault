"use client";

import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form-controls";
import { EXPENSE_CURRENCIES } from "../domain/expenses";
import { createMissionAction, updateMissionAction } from "./actions";
import { FormError } from "./badges";

/** Adding and editing a mission, and deactivating it (committee administrators). */

type MissionValues = {
  id?: string;
  name: string;
  description: string | null;
  defaultCurrency: string;
  isActive: boolean;
};

export function NewMissionButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="primary"
        icon={<Plus aria-hidden="true" size={15} />}
        onClick={() => setOpen(true)}
      >
        New mission
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title="New mission">
        {open && (
          <MissionForm
            initial={{
              name: "",
              description: null,
              defaultCurrency: "EGP",
              isActive: true,
            }}
            onDone={() => setOpen(false)}
          />
        )}
      </Dialog>
    </>
  );
}

export function EditMissionButton({ mission }: { mission: Required<MissionValues> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        icon={<Pencil aria-hidden="true" size={14} />}
        onClick={() => setOpen(true)}
      >
        Edit
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title="Edit mission">
        {open && <MissionForm initial={mission} onDone={() => setOpen(false)} />}
      </Dialog>
    </>
  );
}

function MissionForm({
  initial,
  onDone,
}: {
  initial: MissionValues;
  onDone: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? "");
  const [defaultCurrency, setDefaultCurrency] = useState(initial.defaultCurrency);
  const [isActive, setIsActive] = useState(initial.isActive);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        setFormError(null);
        startTransition(async () => {
          const input = { name, description, defaultCurrency, isActive };
          const result =
            initial.id !== undefined
              ? await updateMissionAction(initial.id, input)
              : await createMissionAction(input);
          if (!result.ok) {
            setErrors(result.fieldErrors ?? {});
            setFormError(result.message);
            return;
          }
          onDone();
          router.refresh();
        });
      }}
    >
      <Field
        label="Mission name"
        htmlFor="mission-name"
        required
        error={errors.name?.[0]}
      >
        <Input
          id="mission-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={120}
          dir="auto"
          autoFocus
          placeholder="Turkey Trip"
          invalid={errors.name !== undefined}
        />
      </Field>
      <Field
        label="Default currency"
        htmlFor="mission-currency"
        hint="Offered first on the expense form; a claim can use another currency."
      >
        <Select
          id="mission-currency"
          value={defaultCurrency}
          onChange={(event) => setDefaultCurrency(event.target.value)}
          options={EXPENSE_CURRENCIES.map((code) => ({ value: code, label: code }))}
          className="sm:max-w-40"
        />
      </Field>
      <Field
        label="Purpose"
        htmlFor="mission-description"
        error={errors.description?.[0]}
      >
        <Textarea
          id="mission-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={2}
          maxLength={2000}
          dir="auto"
        />
      </Field>
      {initial.id !== undefined && (
        <Checkbox
          label="Active — clear to deactivate: its expenses stay, no new ones can be claimed"
          checked={isActive}
          onChange={(event) => setIsActive(event.target.checked)}
        />
      )}
      {formError !== null && <FormError message={formError} />}
      <DialogActions>
        <Button variant="secondary" onClick={onDone} disabled={isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" isPending={isPending}>
          {isPending
            ? "Saving…"
            : initial.id === undefined
              ? "Add mission"
              : "Save changes"}
        </Button>
      </DialogActions>
    </form>
  );
}
