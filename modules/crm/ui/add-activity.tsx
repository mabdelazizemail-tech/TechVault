"use client";

import { Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions } from "@/components/ui/dialog";
import {
  Field,
  Input,
  PillGroup,
  Select,
  Textarea,
  describedBy,
} from "@/components/ui/form-controls";
import {
  ACTIVITY_TYPE_LABELS,
  LOGGABLE_ACTIVITY_TYPES,
  PRIORITIES,
  PRIORITY_LABELS,
  type ActivityDto,
  type LoggableActivityType,
} from "../contracts/types";
import { logActivityAction, updateActivityAction } from "./actions";
import { OptionsGate, useLazyOptions } from "./lazy-options";
import { loadOwnerOptionsAction } from "./option-actions";

/**
 * "+ Add Activity": logs a call, email, meeting, task or note against the records
 * passed in `links`, in a slide-over so the timeline stays visible. The assignee
 * list loads the first time the slide-over opens, not with the page.
 *
 * The same form edits an existing activity (see edit-activity.tsx).
 */

export type ActivityLinks = {
  leadId?: string;
  accountId?: string;
  contactId?: string;
  opportunityId?: string;
};

/** `datetime-local` wants local wall-clock time without a zone. */
function toLocalInput(date: Date | null): string {
  if (date === null) return "";
  const copy = new Date(date);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 16);
}

/** `datetime-local` values carry no zone; convert in the browser, where the zone is known. */
function localInputToIso(value: string): string | null {
  if (value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function isLoggableType(type: string): type is LoggableActivityType {
  return (LOGGABLE_ACTIVITY_TYPES as readonly string[]).includes(type);
}

export function AddActivityButton({
  links,
  currentUserId,
  defaultType = "CALL",
  label = "Add activity",
  variant = "primary",
}: {
  links: ActivityLinks;
  currentUserId: string;
  defaultType?: LoggableActivityType;
  label?: string;
  variant?: "primary" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  // Remount the form on every open, so it always starts clean.
  const [formKey, setFormKey] = useState(0);
  const options = useLazyOptions(loadOwnerOptionsAction, open);

  return (
    <>
      <Button
        variant={variant}
        icon={<Plus aria-hidden="true" size={15} />}
        onClick={() => {
          setFormKey((key) => key + 1);
          setOpen(true);
        }}
      >
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title="Add activity" variant="sheet">
        <OptionsGate state={options}>
          {({ owners }) => (
            <ActivityForm
              key={formKey}
              mode={{ kind: "create", links }}
              owners={owners}
              currentUserId={currentUserId}
              defaultType={defaultType}
              onDone={() => setOpen(false)}
            />
          )}
        </OptionsGate>
      </Dialog>
    </>
  );
}

export type ActivityFormMode =
  /** Log a new activity; `types` narrows the choice (a note-only form, say). */
  | { kind: "create"; links: ActivityLinks; types?: readonly LoggableActivityType[] }
  /** Correct an existing activity; its type and links are fixed. */
  | { kind: "edit"; activity: ActivityDto };

export function ActivityForm({
  mode,
  owners,
  currentUserId,
  defaultType,
  onDone,
}: {
  mode: ActivityFormMode;
  owners: { id: string; name: string }[];
  currentUserId: string;
  defaultType: LoggableActivityType;
  onDone: () => void;
}) {
  const editing = mode.kind === "edit" ? mode.activity : null;
  const initialType =
    editing !== null && isLoggableType(editing.type) ? editing.type : defaultType;

  const [type, setType] = useState<LoggableActivityType>(initialType);
  const [subject, setSubject] = useState(editing?.subject ?? "");
  const [body, setBody] = useState(editing?.body ?? "");
  const [occurredAt, setOccurredAt] = useState(() =>
    toLocalInput(editing?.occurredAt ?? new Date()),
  );
  const [duration, setDuration] = useState(
    editing?.durationMinutes != null ? String(editing.durationMinutes) : "",
  );
  const [dueAt, setDueAt] = useState(() => toLocalInput(editing?.dueAt ?? null));
  const [priority, setPriority] = useState<string>(editing?.priority ?? "MEDIUM");
  const [assigneeId, setAssigneeId] = useState(
    editing !== null ? (editing.assignee?.id ?? "") : currentUserId,
  );
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isTask = type === "TASK";
  const hasDuration = type === "CALL" || type === "MEETING";
  const error = (key: string) => errors[key]?.[0];
  const typeChoices =
    mode.kind === "create" ? (mode.types ?? LOGGABLE_ACTIVITY_TYPES) : [];

  // A task assigned to someone no longer in the directory keeps its assignee.
  const assigneeOptions = owners.map((owner) => ({ value: owner.id, label: owner.name }));
  if (
    editing?.assignee != null &&
    !assigneeOptions.some((option) => option.value === editing.assignee?.id)
  ) {
    assigneeOptions.unshift({ value: editing.assignee.id, label: editing.assignee.name });
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        setFormError(null);
        startTransition(async () => {
          const fields = {
            subject,
            body,
            occurredAt: isTask ? null : localInputToIso(occurredAt),
            durationMinutes: hasDuration ? duration : "",
            dueAt: isTask ? localInputToIso(dueAt) : null,
            priority: isTask ? priority : "",
            assigneeId: isTask ? assigneeId : "",
          };
          const result =
            mode.kind === "create"
              ? await logActivityAction({ type, ...fields, ...mode.links })
              : await updateActivityAction(mode.activity.id, fields);
          if (result.ok) {
            onDone();
          } else {
            setErrors(result.fieldErrors ?? {});
            setFormError(result.message);
          }
        });
      }}
    >
      {typeChoices.length > 1 && (
        <PillGroup
          name="activity-type"
          legend="Type"
          options={typeChoices.map((value) => ({
            value,
            label: ACTIVITY_TYPE_LABELS[value],
          }))}
          value={type}
          onValueChange={(value) => setType(value as LoggableActivityType)}
        />
      )}

      <Field
        label={type === "NOTE" ? "Title" : "Subject"}
        htmlFor="activity-subject"
        required
        error={error("subject")}
      >
        <Input
          id="activity-subject"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          placeholder={
            type === "CALL"
              ? "Discovery call with…"
              : type === "EMAIL"
                ? "Sent proposal…"
                : type === "MEETING"
                  ? "Proposal review…"
                  : type === "TASK"
                    ? "Send revised pricing…"
                    : "What happened"
          }
          invalid={error("subject") !== undefined}
          aria-describedby={describedBy("activity-subject", error("subject"))}
          dir="auto"
          autoFocus
        />
      </Field>

      <Field label={type === "NOTE" ? "Note" : "Details"} htmlFor="activity-body">
        <Textarea
          id="activity-body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={type === "NOTE" ? 6 : 4}
          dir="auto"
        />
      </Field>

      {isTask ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Due" htmlFor="activity-due" error={error("dueAt")}>
            <Input
              id="activity-due"
              type="datetime-local"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
            />
          </Field>
          <Field label="Priority" htmlFor="activity-priority">
            <Select
              id="activity-priority"
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
              options={PRIORITIES.map((value) => ({
                value,
                label: PRIORITY_LABELS[value],
              }))}
            />
          </Field>
          <Field
            label="Assigned to"
            htmlFor="activity-assignee"
            className="sm:col-span-2"
          >
            <Select
              id="activity-assignee"
              value={assigneeId}
              onChange={(event) => setAssigneeId(event.target.value)}
              options={assigneeOptions}
            />
          </Field>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="When" htmlFor="activity-when" error={error("occurredAt")}>
            <Input
              id="activity-when"
              type="datetime-local"
              value={occurredAt}
              onChange={(event) => setOccurredAt(event.target.value)}
            />
          </Field>
          {hasDuration && (
            <Field label="Duration (minutes)" htmlFor="activity-duration">
              <Input
                id="activity-duration"
                type="number"
                min={0}
                max={1440}
                inputMode="numeric"
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
              />
            </Field>
          )}
        </div>
      )}

      {formError !== null && (
        <p
          role="alert"
          className="border-danger/25 bg-danger-subtle text-danger border px-3 py-2 text-xs"
        >
          {formError}
        </p>
      )}

      <DialogActions>
        <Button variant="secondary" onClick={onDone} disabled={isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" isPending={isPending}>
          {isPending
            ? "Saving…"
            : editing !== null
              ? "Save changes"
              : `Save ${ACTIVITY_TYPE_LABELS[type].toLowerCase()}`}
        </Button>
      </DialogActions>
    </form>
  );
}
