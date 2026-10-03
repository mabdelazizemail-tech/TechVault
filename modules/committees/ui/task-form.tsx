"use client";

import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/form-controls";
import type { Assignee } from "../contracts/types";
import { createTaskAction, updateTaskAction } from "./actions";
import { FormError } from "./badges";
import { PersonPicker, type PickedPerson } from "./person-picker";

/**
 * Adding a task to a meeting's Team To-Do List, and editing one. The meeting —
 * and with it the meeting date — is fixed by where the task is created; the
 * creator and creation time are recorded by the server.
 */

type TaskValues = {
  id?: string;
  description: string;
  expectedOutcome: string;
  dueDate: string;
  assignees: PickedPerson[];
};

export function toPicked(assignees: readonly Assignee[]): PickedPerson[] {
  return assignees.map((assignee) =>
    assignee.kind === "user"
      ? { kind: "user", userId: assignee.userId, name: assignee.name }
      : { kind: "manual", name: assignee.name },
  );
}

export function NewTaskButton({
  meetingId,
  meetingLabel,
}: {
  meetingId: string;
  /** "Board meeting · Sat, 3 Oct 2026, 14:00", shown so the link is visible. */
  meetingLabel: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="primary"
        icon={<Plus aria-hidden="true" size={15} />}
        onClick={() => setOpen(true)}
      >
        Add new task
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Add a task"
        description={`For ${meetingLabel}`}
      >
        {open && (
          <TaskForm
            meetingId={meetingId}
            initial={{ description: "", expectedOutcome: "", dueDate: "", assignees: [] }}
            onDone={() => setOpen(false)}
          />
        )}
      </Dialog>
    </>
  );
}

export function EditTaskButton({
  task,
}: {
  task: {
    id: string;
    description: string;
    expectedOutcome: string | null;
    dueDate: string;
    assignees: Assignee[];
  };
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        icon={<Pencil aria-hidden="true" size={14} />}
        onClick={() => setOpen(true)}
      >
        Edit
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title="Edit task">
        {open && (
          <TaskForm
            initial={{
              id: task.id,
              description: task.description,
              expectedOutcome: task.expectedOutcome ?? "",
              dueDate: task.dueDate,
              assignees: toPicked(task.assignees),
            }}
            onDone={() => setOpen(false)}
          />
        )}
      </Dialog>
    </>
  );
}

function TaskForm({
  meetingId,
  initial,
  onDone,
}: {
  meetingId?: string;
  initial: TaskValues;
  onDone: () => void;
}) {
  const router = useRouter();
  const [description, setDescription] = useState(initial.description);
  const [expectedOutcome, setExpectedOutcome] = useState(initial.expectedOutcome);
  const [dueDate, setDueDate] = useState(initial.dueDate);
  const [assignees, setAssignees] = useState<PickedPerson[]>(initial.assignees);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const error = (key: string) =>
    errors[key]?.[0] ??
    Object.entries(errors).find(([field]) => field.startsWith(`${key}.`))?.[1][0];

  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        setFormError(null);
        startTransition(async () => {
          const input = {
            description,
            expectedOutcome,
            dueDate,
            assignees: assignees.map((person) =>
              person.kind === "user" ? { userId: person.userId } : { name: person.name },
            ),
          };
          const result =
            initial.id !== undefined
              ? await updateTaskAction(initial.id, input)
              : await createTaskAction(meetingId ?? "", input);
          if (!result.ok) {
            setErrors(result.fieldErrors ?? {});
            setFormError(result.message);
            return;
          }
          onDone();
          if (initial.id === undefined && result.data !== null) {
            router.push(`/committees/meetings/${meetingId}/tasks/${result.data.id}`);
          } else {
            router.refresh();
          }
        });
      }}
    >
      <Field
        label="Task description"
        htmlFor="task-description"
        required
        error={error("description")}
      >
        <Textarea
          id="task-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
          maxLength={5000}
          dir="auto"
          invalid={error("description") !== undefined}
          autoFocus
          placeholder="What needs to be done?"
        />
      </Field>

      <Field
        label="Expected outcome / next action"
        htmlFor="task-outcome"
        hint="Optional. What done looks like, or the next step to take."
        error={error("expectedOutcome")}
      >
        <Textarea
          id="task-outcome"
          value={expectedOutcome}
          onChange={(event) => setExpectedOutcome(event.target.value)}
          rows={2}
          maxLength={2000}
          dir="auto"
          invalid={error("expectedOutcome") !== undefined}
        />
      </Field>

      <Field label="Due date" htmlFor="task-due" required error={error("dueDate")}>
        <Input
          id="task-due"
          type="date"
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
          invalid={error("dueDate") !== undefined}
          className="sm:max-w-56"
        />
      </Field>

      <PersonPicker
        id="task-assignees"
        label="Responsible people *"
        value={assignees}
        onChange={setAssignees}
        allowManual
        max={20}
        error={error("assignees")}
        hint="Registered colleagues are notified. A typed name is recorded for someone without a TechVault account, who is not notified."
      />

      {formError !== null && <FormError message={formError} />}

      <DialogActions>
        <Button variant="secondary" onClick={onDone} disabled={isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" isPending={isPending}>
          {isPending ? "Saving…" : initial.id === undefined ? "Add task" : "Save changes"}
        </Button>
      </DialogActions>
    </form>
  );
}
