"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { ACTIVITY_TYPE_LABELS, type ActivityDto } from "../contracts/types";
import { ActivityForm, isLoggableType } from "./add-activity";
import { OptionsGate, useLazyOptions } from "./lazy-options";
import { loadOwnerOptionsAction } from "./option-actions";

/**
 * Edit a call, email, meeting, note or task in place. Shown only to people who
 * may update activities; the server checks again, including the author's scope.
 * The assignee list loads only when a task is being edited.
 */
export function EditActivityButton({ activity }: { activity: ActivityDto }) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const isTask = activity.type === "TASK";
  const options = useLazyOptions(loadOwnerOptionsAction, open && isTask);

  if (!isLoggableType(activity.type)) return null;
  const type = activity.type;
  const label = ACTIVITY_TYPE_LABELS[type].toLowerCase();

  const form = (owners: { id: string; name: string }[]) => (
    <ActivityForm
      key={formKey}
      mode={{ kind: "edit", activity }}
      owners={owners}
      currentUserId=""
      defaultType={type}
      onDone={() => setOpen(false)}
    />
  );

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setFormKey((key) => key + 1);
          setOpen(true);
        }}
        aria-label={`Edit ${label}: ${activity.subject}`}
        title={`Edit ${label}`}
        className="text-foreground-subtle hover:bg-surface-hover hover:text-foreground grid size-7 cursor-pointer place-items-center"
      >
        <Pencil aria-hidden="true" size={13} />
      </button>
      <Dialog open={open} onOpenChange={setOpen} title={`Edit ${label}`} variant="sheet">
        {isTask ? (
          <OptionsGate state={options}>{({ owners }) => form(owners)}</OptionsGate>
        ) : (
          form([])
        )}
      </Dialog>
    </>
  );
}
