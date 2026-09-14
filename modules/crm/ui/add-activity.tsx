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
  type LoggableActivityType,
} from "../contracts/types";
import { logActivityAction } from "./actions";
import { OptionsGate, useLazyOptions } from "./lazy-options";
import { loadOwnerOptionsAction } from "./option-actions";

/**
 * "+ Add Activity": logs a call, email, meeting, task or note against the records
 * passed in `links`, in a slide-over so the timeline stays visible. The assignee
 * list loads the first time the slide-over opens, not with the page.
 */

export type ActivityLinks = {
  leadId?: string;
  accountId?: string;
  contactId?: string;
  opportunityId?: string;
};

function nowLocalInput(): string {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

/** `datetime-local` values carry no zone; convert in the browser, where the zone is known. */
function localInputToIso(value: string): string | null {
  if (value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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
              links={links}
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

function ActivityForm({
  links,
  owners,
  currentUserId,
  defaultType,
  onDone,
}: {
  links: ActivityLinks;
  owners: { id: string; name: string }[];
  currentUserId: string;
  defaultType: LoggableActivityType;
  onDone: () => void;
}) {
  const [type, setType] = useState<LoggableActivityType>(defaultType);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [occurredAt, setOccurredAt] = useState(nowLocalInput);
  const [duration, setDuration] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [assigneeId, setAssigneeId] = useState(currentUserId);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isTask = type === "TASK";
  const hasDuration = type === "CALL" || type === "MEETING";
  const error = (key: string) => errors[key]?.[0];

  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        setFormError(null);
        startTransition(async () => {
          const result = await logActivityAction({
            type,
            subject,
            body,
            occurredAt: isTask ? null : localInputToIso(occurredAt),
            durationMinutes: hasDuration ? duration : "",
            dueAt: isTask ? localInputToIso(dueAt) : null,
            priority: isTask ? priority : "",
            assigneeId: isTask ? assigneeId : "",
            ...links,
          });
          if (result.ok) {
            onDone();
          } else {
            setErrors(result.fieldErrors ?? {});
            setFormError(result.message);
          }
        });
      }}
    >
      <PillGroup
        name="activity-type"
        legend="Type"
        options={LOGGABLE_ACTIVITY_TYPES.map((value) => ({
          value,
          label: ACTIVITY_TYPE_LABELS[value],
        }))}
        value={type}
        onValueChange={(value) => setType(value as LoggableActivityType)}
      />

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
              options={owners.map((owner) => ({ value: owner.id, label: owner.name }))}
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
          {isPending ? "Saving…" : `Save ${ACTIVITY_TYPE_LABELS[type].toLowerCase()}`}
        </Button>
      </DialogActions>
    </form>
  );
}
