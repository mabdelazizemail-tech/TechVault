"use client";

import { useOptimistic, useTransition } from "react";
import { setTaskCompletedAction } from "./actions";

/** Marks a task done or reopens it, updating instantly and persisting behind. */
export function TaskToggle({
  activityId,
  completed,
  subject,
}: {
  activityId: string;
  completed: boolean;
  subject: string;
}) {
  const [optimistic, setOptimistic] = useOptimistic(completed);
  const [isPending, startTransition] = useTransition();

  return (
    <label className="text-foreground inline-flex cursor-pointer items-center gap-1.5">
      <input
        type="checkbox"
        checked={optimistic}
        disabled={isPending}
        aria-label={`${optimistic ? "Reopen" : "Complete"} task: ${subject}`}
        onChange={(event) => {
          const next = event.target.checked;
          startTransition(async () => {
            setOptimistic(next);
            await setTaskCompletedAction(activityId, next);
          });
        }}
        className="accent-primary size-4 cursor-pointer"
      />
      {optimistic ? "Done" : "Mark done"}
    </label>
  );
}
