"use client";

import { CalendarPlus, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form-controls";
import { createMeetingAction, deleteMeetingAction, updateMeetingAction } from "./actions";
import { FormError } from "./badges";

/**
 * Scheduling a meeting (its creator becomes the organiser), editing one, and — for
 * committee administrators — deleting one.
 */

/** `datetime-local` wants wall-clock time without a zone. */
function toLocalInput(date: Date | null): string {
  if (date === null) return "";
  const copy = new Date(date);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 16);
}

/** `datetime-local` values carry no zone; convert here, where the zone is known. */
function localInputToIso(value: string): string {
  if (value === "") return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

type MeetingValues = {
  id?: string;
  committeeId: string;
  title: string;
  scheduledAt: Date | null;
  location: string | null;
  description: string | null;
};

export function NewMeetingButton({
  committees,
  defaultCommitteeId,
}: {
  committees: readonly { id: string; name: string }[];
  defaultCommitteeId?: string;
}) {
  const [open, setOpen] = useState(false);
  if (committees.length === 0) return null;
  return (
    <>
      <Button
        variant="primary"
        icon={<CalendarPlus aria-hidden="true" size={15} />}
        onClick={() => setOpen(true)}
      >
        Schedule meeting
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Schedule a meeting"
        description="You will be its organiser."
      >
        {open && (
          <MeetingForm
            committees={committees}
            initial={{
              committeeId:
                defaultCommitteeId ??
                (committees.length === 1 ? (committees[0]?.id ?? "") : ""),
              title: "",
              scheduledAt: null,
              location: null,
              description: null,
            }}
            onDone={() => setOpen(false)}
          />
        )}
      </Dialog>
    </>
  );
}

export function EditMeetingButton({
  meeting,
}: {
  meeting: Required<Omit<MeetingValues, "scheduledAt">> & { scheduledAt: Date };
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        icon={<Pencil aria-hidden="true" size={14} />}
        onClick={() => setOpen(true)}
      >
        Edit meeting
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title="Edit meeting">
        {open && <MeetingForm initial={meeting} onDone={() => setOpen(false)} />}
      </Dialog>
    </>
  );
}

function MeetingForm({
  committees,
  initial,
  onDone,
}: {
  committees?: readonly { id: string; name: string }[];
  initial: MeetingValues;
  onDone: () => void;
}) {
  const router = useRouter();
  const [committeeId, setCommitteeId] = useState(initial.committeeId);
  const [title, setTitle] = useState(initial.title);
  const [when, setWhen] = useState(toLocalInput(initial.scheduledAt));
  const [location, setLocation] = useState(initial.location ?? "");
  const [description, setDescription] = useState(initial.description ?? "");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const error = (key: string) => errors[key]?.[0];

  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        setFormError(null);
        startTransition(async () => {
          const fields = {
            title,
            scheduledAt: localInputToIso(when),
            location,
            description,
          };
          const result =
            initial.id !== undefined
              ? await updateMeetingAction(initial.id, fields)
              : await createMeetingAction({ ...fields, committeeId });
          if (!result.ok) {
            setErrors(result.fieldErrors ?? {});
            setFormError(result.message);
            return;
          }
          onDone();
          if (initial.id === undefined && result.data !== null) {
            router.push(`/committees/meetings/${result.data.id}`);
          } else {
            router.refresh();
          }
        });
      }}
    >
      {committees !== undefined && (
        <Field
          label="Committee"
          htmlFor="meeting-committee"
          required
          error={error("committeeId")}
        >
          <Select
            id="meeting-committee"
            value={committeeId}
            onChange={(event) => setCommitteeId(event.target.value)}
            placeholder="Choose a committee"
            options={committees.map((committee) => ({
              value: committee.id,
              label: committee.name,
            }))}
            invalid={error("committeeId") !== undefined}
          />
        </Field>
      )}
      <Field label="Title" htmlFor="meeting-title" required error={error("title")}>
        <Input
          id="meeting-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={200}
          dir="auto"
          invalid={error("title") !== undefined}
          autoFocus
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Date and time"
          htmlFor="meeting-when"
          required
          error={error("scheduledAt")}
        >
          <Input
            id="meeting-when"
            type="datetime-local"
            value={when}
            onChange={(event) => setWhen(event.target.value)}
            invalid={error("scheduledAt") !== undefined}
          />
        </Field>
        <Field label="Location" htmlFor="meeting-location" error={error("location")}>
          <Input
            id="meeting-location"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            maxLength={200}
            dir="auto"
            placeholder="Room, building or video link"
          />
        </Field>
      </div>
      <Field
        label="Purpose"
        htmlFor="meeting-description"
        hint="Optional. Agenda items are added on the meeting's page."
        error={error("description")}
      >
        <Textarea
          id="meeting-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
          maxLength={5000}
          dir="auto"
        />
      </Field>

      {formError !== null && <FormError message={formError} />}

      <DialogActions>
        <Button variant="secondary" onClick={onDone} disabled={isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" isPending={isPending}>
          {isPending
            ? "Saving…"
            : initial.id === undefined
              ? "Schedule meeting"
              : "Save changes"}
        </Button>
      </DialogActions>
    </form>
  );
}

export function DeleteMeetingButton({
  meetingId,
  title,
  taskCount,
}: {
  meetingId: string;
  title: string;
  taskCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  return (
    <>
      <Button
        variant="secondary"
        icon={<Trash2 aria-hidden="true" size={14} />}
        onClick={() => setOpen(true)}
      >
        Delete
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`Delete “${title}”?`}
        description={
          taskCount === 0
            ? "The meeting and its agenda disappear for everyone. The audit trail keeps the record."
            : `The meeting, its agenda and its ${taskCount} ${taskCount === 1 ? "task" : "tasks"} disappear for everyone, and their notification links stop working. The audit trail keeps the record.`
        }
      >
        {formError !== null && <FormError message={formError} />}
        <DialogActions>
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            isPending={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await deleteMeetingAction(meetingId);
                if (!result.ok) {
                  setFormError(result.message);
                  return;
                }
                setOpen(false);
                router.push("/committees/meetings");
              })
            }
          >
            {isPending ? "Deleting…" : "Delete meeting"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
