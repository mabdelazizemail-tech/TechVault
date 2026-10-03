"use client";

import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/form-controls";
import type { PersonRef } from "../contracts/types";
import { createCommitteeAction, updateCommitteeAction } from "./actions";
import { FormError } from "./badges";
import { PersonPicker, type PickedPerson } from "./person-picker";

/** Creating and editing a committee and choosing its members (administrators). */

type CommitteeValues = {
  id?: string;
  name: string;
  description: string | null;
  isActive: boolean;
  members: PersonRef[];
};

export function NewCommitteeButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="primary"
        icon={<Plus aria-hidden="true" size={15} />}
        onClick={() => setOpen(true)}
      >
        New committee
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title="New committee">
        {open && (
          <CommitteeForm
            initial={{ name: "", description: null, isActive: true, members: [] }}
            onDone={() => setOpen(false)}
          />
        )}
      </Dialog>
    </>
  );
}

export function EditCommitteeButton({
  committee,
}: {
  committee: Required<CommitteeValues>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        icon={<Pencil aria-hidden="true" size={14} />}
        onClick={() => setOpen(true)}
      >
        Edit committee
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title="Edit committee">
        {open && <CommitteeForm initial={committee} onDone={() => setOpen(false)} />}
      </Dialog>
    </>
  );
}

function CommitteeForm({
  initial,
  onDone,
}: {
  initial: CommitteeValues;
  onDone: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? "");
  const [isActive, setIsActive] = useState(initial.isActive);
  const [members, setMembers] = useState<PickedPerson[]>(
    initial.members.map((member) => ({
      kind: "user" as const,
      userId: member.id,
      name: member.name,
    })),
  );
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
          const memberIds = members.flatMap((person) =>
            person.kind === "user" ? [person.userId] : [],
          );
          const result =
            initial.id !== undefined
              ? await updateCommitteeAction(initial.id, {
                  name,
                  description,
                  isActive,
                  memberIds,
                })
              : await createCommitteeAction({ name, description, memberIds });
          if (!result.ok) {
            setErrors(result.fieldErrors ?? {});
            setFormError(result.message);
            return;
          }
          onDone();
          if (initial.id === undefined && result.data !== null) {
            router.push(`/committees/groups/${result.data.id}`);
          } else {
            router.refresh();
          }
        });
      }}
    >
      <Field label="Name" htmlFor="committee-name" required error={errors.name?.[0]}>
        <Input
          id="committee-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={120}
          dir="auto"
          autoFocus
          invalid={errors.name !== undefined}
        />
      </Field>
      <Field
        label="Purpose"
        htmlFor="committee-description"
        error={errors.description?.[0]}
      >
        <Textarea
          id="committee-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
          maxLength={2000}
          dir="auto"
        />
      </Field>
      <PersonPicker
        id="committee-members"
        label="Members"
        value={members}
        onChange={setMembers}
        allowManual={false}
        max={200}
        error={errors.memberIds?.[0]}
        hint="Members see the committee's meetings and to-do lists. They need the Committees role."
      />
      {initial.id !== undefined && (
        <Checkbox
          label="Active — clear to archive: its meetings and tasks stay, no new meetings"
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
              ? "Create committee"
              : "Save changes"}
        </Button>
      </DialogActions>
    </form>
  );
}
