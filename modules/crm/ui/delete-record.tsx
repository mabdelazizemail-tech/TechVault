"use client";

import { Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions } from "@/components/ui/dialog";
import {
  ACTIVITY_TYPE_LABELS,
  type ActivityDto,
  type DeletionImpact,
  type RecordKind,
} from "../contracts/types";
import {
  type ActionResult,
  deleteAccountAction,
  deleteActivityAction,
  deleteContactAction,
  deleteLeadAction,
  deleteOpportunityAction,
  getDeletionImpactAction,
} from "./actions";
import { describeAlsoDeleted } from "./format";

/**
 * Administrator deletion (ADR-024, §17.4): the confirmation names the record and
 * says what goes with it, using counts from the server. Shown only to holders of
 * the delete permission; the server checks again.
 */

const DELETE_ACTION: Record<RecordKind, (id: string) => Promise<ActionResult>> = {
  lead: deleteLeadAction,
  account: deleteAccountAction,
  contact: deleteContactAction,
  opportunity: deleteOpportunityAction,
};

const NOUN: Record<RecordKind, string> = {
  lead: "lead",
  account: "company",
  contact: "contact",
  opportunity: "opportunity",
};

const PERMANENCE =
  "It disappears from the CRM for everyone and cannot be restored from the app. The deletion is recorded in the audit trail.";

export function DeleteRecordButton({
  kind,
  id,
  name,
}: {
  kind: RecordKind;
  id: string;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const [impact, setImpact] = useState<DeletionImpact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, startLoading] = useTransition();
  const [isDeleting, startDeleting] = useTransition();

  function openDialog() {
    setImpact(null);
    setError(null);
    setOpen(true);
    startLoading(async () => {
      const result = await getDeletionImpactAction({ kind, id });
      if (result.ok) setImpact(result.data);
      else setError(result.message);
    });
  }

  function confirm() {
    setError(null);
    startDeleting(async () => {
      const result = await DELETE_ACTION[kind](id);
      // On success the server redirects to the list; only a refusal comes back.
      if (result !== undefined && !result.ok) setError(result.message);
    });
  }

  return (
    <>
      <Button
        variant="danger"
        icon={<Trash2 aria-hidden="true" size={15} />}
        onClick={openDialog}
      >
        Delete
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!isDeleting) setOpen(next);
        }}
        title={`Delete ${name}?`}
        description={`This ${NOUN[kind]}`}
      >
        <p className="text-foreground text-sm" aria-live="polite">
          {isLoading
            ? "Checking what goes with it…"
            : impact !== null
              ? describeAlsoDeleted(impact)
              : null}
        </p>
        <p className="text-foreground-muted mt-2 text-sm">{PERMANENCE}</p>
        {error !== null && (
          <p role="alert" className="text-danger mt-3 text-sm font-bold">
            {error}
          </p>
        )}
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={isDeleting}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={confirm}
            isPending={isDeleting}
            disabled={impact === null}
          >
            {isDeleting ? "Deleting…" : `Delete ${NOUN[kind]}`}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export function DeleteActivityButton({ activity }: { activity: ActivityDto }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, startDeleting] = useTransition();
  const label = ACTIVITY_TYPE_LABELS[activity.type].toLowerCase();

  function confirm() {
    setError(null);
    startDeleting(async () => {
      const result = await deleteActivityAction(activity.id);
      if (result.ok) setOpen(false);
      else setError(result.message);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        aria-label={`Delete ${label}: ${activity.subject}`}
        title={`Delete ${label}`}
        className="text-foreground-subtle hover:bg-surface-hover hover:text-danger grid size-7 cursor-pointer place-items-center"
      >
        <Trash2 aria-hidden="true" size={13} />
      </button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!isDeleting) setOpen(next);
        }}
        title={`Delete this ${label}?`}
        description={activity.subject}
      >
        <p className="text-foreground-muted text-sm">
          It disappears from every timeline and feed and cannot be restored from the app.
          The deletion is recorded in the audit trail.
        </p>
        {error !== null && (
          <p role="alert" className="text-danger mt-3 text-sm font-bold">
            {error}
          </p>
        )}
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={isDeleting}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirm} isPending={isDeleting}>
            {isDeleting ? "Deleting…" : `Delete ${label}`}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
