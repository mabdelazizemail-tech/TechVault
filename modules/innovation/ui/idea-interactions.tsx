"use client";

import { ChevronUp, Rocket, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/form-controls";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import {
  addCommentAction,
  convertIdeaAction,
  deleteCommentAction,
  deleteIdeaAction,
  deleteKnowledgeAction,
  deleteProjectAction,
  toggleVoteAction,
} from "./actions";
import { FormError } from "./idea-form";

/** Small interactive pieces of the idea, knowledge and project screens. */

export function VoteButton({
  ideaId,
  voteCount,
  hasVoted,
  canVote,
  isMine,
  size = "md",
}: {
  ideaId: string;
  voteCount: number;
  hasVoted: boolean;
  canVote: boolean;
  isMine: boolean;
  size?: "md" | "lg";
}) {
  const notify = useToast();
  const [state, setState] = useState({ voted: hasVoted, count: voteCount });
  const [isPending, startTransition] = useTransition();
  const disabled = !canVote || isMine;

  return (
    <button
      type="button"
      disabled={disabled || isPending}
      aria-pressed={state.voted}
      aria-label={
        isMine
          ? `${state.count} votes — this is your idea`
          : `${state.voted ? "Remove your vote" : "Vote for this idea"} (${state.count} votes)`
      }
      title={isMine ? "You can't vote for your own idea" : undefined}
      onClick={() => {
        const previous = state;
        setState({
          voted: !previous.voted,
          count: previous.count + (previous.voted ? -1 : 1),
        });
        startTransition(async () => {
          const result = await toggleVoteAction(ideaId);
          if (result.ok)
            setState({ voted: result.data.voted, count: result.data.voteCount });
          else {
            setState(previous);
            notify(result.message, "error");
          }
        });
      }}
      className={cn(
        "flex shrink-0 flex-col items-center justify-center border font-extrabold tabular-nums transition-colors",
        size === "lg" ? "min-h-16 w-16 text-lg" : "min-h-14 w-12 text-sm",
        state.voted
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border-strong text-foreground",
        disabled ? "cursor-default opacity-70" : "hover:border-primary cursor-pointer",
      )}
    >
      <ChevronUp aria-hidden="true" size={size === "lg" ? 20 : 17} strokeWidth={2.5} />
      {state.count}
    </button>
  );
}

export function CommentForm({ ideaId }: { ideaId: string }) {
  const [body, setBody] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        setFormError(null);
        startTransition(async () => {
          const result = await addCommentAction(ideaId, { body });
          if (result.ok) setBody("");
          else setFormError(result.fieldErrors?.body?.[0] ?? result.message);
        });
      }}
    >
      <label htmlFor="idea-comment" className="sr-only">
        Add a comment
      </label>
      <Textarea
        id="idea-comment"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="Add a comment…"
        dir="auto"
      />
      {formError !== null && <FormError message={formError} />}
      <div>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          isPending={isPending}
          disabled={body.trim() === ""}
        >
          {isPending ? "Posting…" : "Comment"}
        </Button>
      </div>
    </form>
  );
}

export function DeleteCommentButton({ commentId }: { commentId: string }) {
  const notify = useToast();
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await deleteCommentAction(commentId);
          if (!result.ok) notify(result.message, "error");
        })
      }
      className="text-foreground-subtle hover:text-danger cursor-pointer text-xs disabled:opacity-50"
    >
      {isPending ? "Removing…" : "Remove"}
    </button>
  );
}

export function ConvertIdeaButton({ ideaId, title }: { ideaId: string; title: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <Button
        variant="primary"
        icon={<Rocket aria-hidden="true" size={15} />}
        onClick={() => setOpen(true)}
      >
        Turn into project
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Turn this idea into a project?"
        description={`“${title}” becomes a project in Planning, and the idea moves to In progress.`}
      >
        {formError !== null && <FormError message={formError} />}
        <DialogActions>
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            isPending={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await convertIdeaAction(ideaId);
                if (result.ok) {
                  setOpen(false);
                  router.push(`/innovation/projects/${result.data.projectId}`);
                } else setFormError(result.message);
              })
            }
          >
            {isPending ? "Creating…" : "Create project"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

const DELETE_ACTIONS = {
  idea: { action: deleteIdeaAction, noun: "idea", back: "/innovation/ideas" },
  knowledge: {
    action: deleteKnowledgeAction,
    noun: "knowledge item",
    back: "/innovation/knowledge",
  },
  project: { action: deleteProjectAction, noun: "project", back: "/innovation/projects" },
} as const;

export function DeleteButton({
  kind,
  id,
  name,
}: {
  kind: keyof typeof DELETE_ACTIONS;
  id: string;
  name: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const { action, noun, back } = DELETE_ACTIONS[kind];

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
        title={`Delete this ${noun}?`}
        description={`“${name}” disappears from THE THINK TANK for everyone. Its history stays in the audit trail.`}
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
                const result = await action(id);
                if (result.ok) {
                  setOpen(false);
                  router.push(back);
                } else setFormError(result.message);
              })
            }
          >
            {isPending ? "Deleting…" : `Delete ${noun}`}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
