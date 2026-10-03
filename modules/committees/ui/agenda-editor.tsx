"use client";

import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/form-controls";
import { EmptyState } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import type { AgendaItemDto } from "../contracts/types";
import {
  addAgendaItemAction,
  moveAgendaItemAction,
  removeAgendaItemAction,
  updateAgendaItemAction,
} from "./actions";
import { FormError } from "./badges";

/**
 * A meeting's agenda, in order. Everyone who can see the meeting reads it; its
 * organiser (or a committee administrator) adds, edits, reorders and removes items.
 */
export function AgendaEditor({
  meetingId,
  items,
  canEdit,
}: {
  meetingId: string;
  items: readonly AgendaItemDto[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState<AgendaItemDto | "new" | null>(null);
  const [removing, setRemoving] = useState<AgendaItemDto | null>(null);

  const act = (work: () => Promise<{ ok: boolean; message?: string }>) =>
    startTransition(async () => {
      const result = await work();
      if (!result.ok) toast(result.message ?? "That didn't work.", "error");
      router.refresh();
    });

  return (
    <div>
      {items.length === 0 ? (
        <EmptyState
          title="No agenda yet"
          description={
            canEdit
              ? "List what the meeting will cover, in order, so members can prepare."
              : "The organiser hasn't added agenda items yet."
          }
        />
      ) : (
        <ol className="divide-border divide-y">
          {items.map((item, index) => (
            <li key={item.id} className="flex items-start gap-3 px-4 py-3">
              <span className="text-foreground-muted w-6 shrink-0 pt-0.5 text-sm font-bold tabular-nums">
                {index + 1}.
              </span>
              <div className="min-w-0 flex-1">
                <p dir="auto" className="text-foreground text-sm font-semibold">
                  {item.title}
                </p>
                {item.notes !== null && (
                  <p
                    dir="auto"
                    className="text-foreground-muted mt-0.5 text-[13px] whitespace-pre-line"
                  >
                    {item.notes}
                  </p>
                )}
              </div>
              {canEdit && (
                <div className="flex shrink-0 items-center gap-0.5">
                  <IconButton
                    label={`Move “${item.title}” up`}
                    disabled={isPending || index === 0}
                    onClick={() => act(() => moveAgendaItemAction(item.id, "up"))}
                  >
                    <ArrowUp aria-hidden="true" className="size-4" />
                  </IconButton>
                  <IconButton
                    label={`Move “${item.title}” down`}
                    disabled={isPending || index === items.length - 1}
                    onClick={() => act(() => moveAgendaItemAction(item.id, "down"))}
                  >
                    <ArrowDown aria-hidden="true" className="size-4" />
                  </IconButton>
                  <IconButton
                    label={`Edit “${item.title}”`}
                    disabled={isPending}
                    onClick={() => setEditing(item)}
                  >
                    <Pencil aria-hidden="true" className="size-4" />
                  </IconButton>
                  <IconButton
                    label={`Remove “${item.title}” from the agenda`}
                    disabled={isPending}
                    onClick={() => setRemoving(item)}
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </IconButton>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      {canEdit && (
        <div className="rule-t px-4 py-3">
          <Button
            size="sm"
            icon={<Plus aria-hidden="true" size={14} />}
            onClick={() => setEditing("new")}
          >
            Add agenda item
          </Button>
        </div>
      )}

      <Dialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title="Remove this agenda item?"
        description={
          removing === null
            ? undefined
            : `“${removing.title}” is taken off the agenda for everyone. The audit trail keeps what it said.`
        }
      >
        <DialogActions>
          <Button
            variant="secondary"
            onClick={() => setRemoving(null)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            isPending={isPending}
            onClick={() => {
              const item = removing;
              setRemoving(null);
              if (item !== null) act(() => removeAgendaItemAction(item.id));
            }}
          >
            Remove item
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        title={editing === "new" ? "Add agenda item" : "Edit agenda item"}
      >
        {editing !== null && (
          <AgendaItemForm
            meetingId={meetingId}
            item={editing === "new" ? null : editing}
            onDone={() => {
              setEditing(null);
              router.refresh();
            }}
            onCancel={() => setEditing(null)}
          />
        )}
      </Dialog>
    </div>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="text-foreground hover:bg-surface-hover grid size-8 cursor-pointer place-items-center disabled:cursor-not-allowed disabled:opacity-35 pointer-coarse:size-10"
    >
      {children}
    </button>
  );
}

function AgendaItemForm({
  meetingId,
  item,
  onDone,
  onCancel,
}: {
  meetingId: string;
  item: AgendaItemDto | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(item?.title ?? "");
  const [notes, setNotes] = useState(item?.notes ?? "");
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
          const input = { title, notes };
          const result =
            item === null
              ? await addAgendaItemAction(meetingId, input)
              : await updateAgendaItemAction(item.id, input);
          if (!result.ok) {
            setErrors(result.fieldErrors ?? {});
            setFormError(result.message);
            return;
          }
          onDone();
        });
      }}
    >
      <Field label="Title" htmlFor="agenda-title" required error={errors.title?.[0]}>
        <Input
          id="agenda-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={200}
          dir="auto"
          autoFocus
          invalid={errors.title !== undefined}
        />
      </Field>
      <Field label="Notes" htmlFor="agenda-notes" error={errors.notes?.[0]}>
        <Textarea
          id="agenda-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={3}
          maxLength={5000}
          dir="auto"
        />
      </Field>
      {formError !== null && <FormError message={formError} />}
      <DialogActions>
        <Button variant="secondary" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" isPending={isPending}>
          {isPending ? "Saving…" : item === null ? "Add item" : "Save changes"}
        </Button>
      </DialogActions>
    </form>
  );
}
