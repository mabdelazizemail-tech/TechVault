"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/form-controls";
import { useToast } from "@/components/ui/toast";
import { TASK_STATUSES, TASK_STATUS_LABELS, type TaskStatus } from "../contracts/types";
import { changeTaskStatusAction, deleteTaskAction, replyToTaskAction } from "./actions";
import { FormError } from "./badges";

/**
 * The interactive parts of a task: posting a reply, updating the status with a
 * progress comment, and (for committee administrators) deleting it. Each refreshes
 * the server-rendered discussion when it succeeds.
 */

export function ReplyForm({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      noValidate
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        setFormError(null);
        startTransition(async () => {
          const result = await replyToTaskAction(taskId, { body });
          if (!result.ok) {
            setFormError(result.fieldErrors?.body?.[0] ?? result.message);
            return;
          }
          setBody("");
          router.refresh();
        });
      }}
    >
      <Field label="Reply" htmlFor="task-reply">
        <Textarea
          id="task-reply"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            // Ctrl/Cmd+Enter posts, so a keyboard user need not leave the field.
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.currentTarget.form?.requestSubmit();
            }
          }}
          rows={3}
          maxLength={5000}
          dir="auto"
          placeholder="Share an update, ask a question…"
        />
      </Field>
      {formError !== null && <FormError message={formError} />}
      <div className="flex justify-end">
        <Button
          type="submit"
          variant="primary"
          isPending={isPending}
          disabled={body.trim() === ""}
        >
          {isPending ? "Posting…" : "Post reply"}
        </Button>
      </div>
    </form>
  );
}

export function StatusForm({ taskId, current }: { taskId: string; current: TaskStatus }) {
  const router = useRouter();
  const toast = useToast();
  const [status, setStatus] = useState<TaskStatus>(current);
  const [comment, setComment] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const unchanged = status === current && comment.trim() === "";

  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        setFormError(null);
        startTransition(async () => {
          const result = await changeTaskStatusAction(taskId, { status, comment });
          if (!result.ok) {
            setFormError(result.message);
            return;
          }
          setComment("");
          toast(
            status === current
              ? "Comment posted."
              : `Marked ${TASK_STATUS_LABELS[status]}.`,
          );
          router.refresh();
        });
      }}
    >
      <Field label="Status" htmlFor="task-status">
        <Select
          id="task-status"
          value={status}
          onChange={(event) => setStatus(event.target.value as TaskStatus)}
          options={TASK_STATUSES.map((value) => ({
            value,
            label: TASK_STATUS_LABELS[value],
          }))}
        />
      </Field>
      <Field
        label="Progress comment"
        htmlFor="task-status-comment"
        hint="Optional. Added to the discussion with the status change."
      >
        <Textarea
          id="task-status-comment"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          rows={2}
          maxLength={5000}
          dir="auto"
        />
      </Field>
      {formError !== null && <FormError message={formError} />}
      <Button
        type="submit"
        variant="secondary"
        isPending={isPending}
        disabled={unchanged}
      >
        {isPending ? "Saving…" : "Update status"}
      </Button>
    </form>
  );
}

export function DeleteTaskButton({
  taskId,
  description,
  meetingId,
}: {
  taskId: string;
  description: string;
  meetingId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const label = description.length > 80 ? `${description.slice(0, 79)}…` : description;

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
        title="Delete this task?"
        description={`“${label}” disappears from the meeting's Team To-Do List for everyone. Its discussion stays on record and in the audit trail.`}
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
                const result = await deleteTaskAction(taskId);
                if (!result.ok) {
                  setFormError(result.message);
                  return;
                }
                setOpen(false);
                router.push(`/committees/meetings/${meetingId}?tab=todo`);
              })
            }
          >
            {isPending ? "Deleting…" : "Delete task"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
