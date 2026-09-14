"use client";

import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form-controls";
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  type ProjectStatus,
} from "../contracts/types";
import { createProjectAction, updateProjectAction } from "./actions";
import { FormError } from "./idea-form";
import { usePeople } from "./use-people";

/** Creating and editing a project: name, owner, team, status, lessons learned. */

type ProjectValues = {
  id?: string;
  name: string;
  description: string | null;
  ownerId: string | null;
  status: ProjectStatus;
  memberIds: string[];
  lessonsLearned: string | null;
};

export function NewProjectButton() {
  return (
    <ProjectDialogButton
      label="New project"
      icon={<Plus aria-hidden="true" size={15} />}
      variant="primary"
      initial={{
        name: "",
        description: null,
        ownerId: null,
        status: "PLANNING",
        memberIds: [],
        lessonsLearned: null,
      }}
    />
  );
}

export function EditProjectButton({
  project,
}: {
  project: ProjectValues & { id: string };
}) {
  return (
    <ProjectDialogButton
      label="Edit"
      icon={<Pencil aria-hidden="true" size={14} />}
      variant="secondary"
      initial={project}
    />
  );
}

function ProjectDialogButton({
  label,
  icon,
  variant,
  initial,
}: {
  label: string;
  icon: React.ReactNode;
  variant: "primary" | "secondary";
  initial: ProjectValues;
}) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  return (
    <>
      <Button
        variant={variant}
        icon={icon}
        onClick={() => {
          setFormKey((key) => key + 1);
          setOpen(true);
        }}
      >
        {label}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={initial.id === undefined ? "New project" : "Edit project"}
        variant="sheet"
      >
        <ProjectForm
          key={formKey}
          initial={initial}
          open={open}
          onDone={() => setOpen(false)}
        />
      </Dialog>
    </>
  );
}

function ProjectForm({
  initial,
  open,
  onDone,
}: {
  initial: ProjectValues;
  open: boolean;
  onDone: () => void;
}) {
  const router = useRouter();
  const { people, error: peopleError } = usePeople(open);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? "");
  const [ownerId, setOwnerId] = useState(initial.ownerId ?? "");
  const [status, setStatus] = useState<ProjectStatus>(initial.status);
  const [memberIds, setMemberIds] = useState<string[]>(initial.memberIds);
  const [lessonsLearned, setLessonsLearned] = useState(initial.lessonsLearned ?? "");
  const [teamFilter, setTeamFilter] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const error = (key: string) => errors[key]?.[0];

  const needle = teamFilter.trim().toLowerCase();
  const shownPeople = (people ?? []).filter(
    (person) =>
      needle === "" ||
      person.name.toLowerCase().includes(needle) ||
      memberIds.includes(person.id),
  );

  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        setFormError(null);
        startTransition(async () => {
          const input = { name, description, ownerId, status, memberIds, lessonsLearned };
          const result =
            initial.id !== undefined
              ? await updateProjectAction(initial.id, input)
              : await createProjectAction(input);
          if (!result.ok) {
            setErrors(result.fieldErrors ?? {});
            setFormError(result.message);
            return;
          }
          onDone();
          if (initial.id === undefined && result.data !== null) {
            router.push(`/innovation/projects/${result.data.id}`);
          }
        });
      }}
    >
      <Field label="Project name" htmlFor="project-name" required error={error("name")}>
        <Input
          id="project-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={160}
          invalid={error("name") !== undefined}
          dir="auto"
          autoFocus
        />
      </Field>
      <Field
        label="Description"
        htmlFor="project-description"
        error={error("description")}
      >
        <Textarea
          id="project-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
          maxLength={5000}
          dir="auto"
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Status" htmlFor="project-status">
          <Select
            id="project-status"
            value={status}
            onChange={(event) => setStatus(event.target.value as ProjectStatus)}
            options={PROJECT_STATUSES.map((value) => ({
              value,
              label: PROJECT_STATUS_LABELS[value],
            }))}
          />
        </Field>
        <Field label="Owner" htmlFor="project-owner" error={error("ownerId")}>
          <Select
            id="project-owner"
            value={ownerId}
            onChange={(event) => setOwnerId(event.target.value)}
            disabled={people === null}
            options={[
              { value: "", label: people === null ? "Loading…" : "No owner yet" },
              ...(people ?? []).map((person) => ({
                value: person.id,
                label: person.name,
              })),
            ]}
          />
        </Field>
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-foreground-muted mb-1 text-xs">
          Team {memberIds.length > 0 && `· ${memberIds.length} selected`}
        </legend>
        <Input
          value={teamFilter}
          onChange={(event) => setTeamFilter(event.target.value)}
          placeholder="Filter people"
          aria-label="Filter people"
        />
        <div className="border-border max-h-44 overflow-y-auto border px-2.5 py-1.5">
          {people === null ? (
            <p className="text-foreground-muted py-1 text-xs">
              {peopleError ?? "Loading people…"}
            </p>
          ) : shownPeople.length === 0 ? (
            <p className="text-foreground-muted py-1 text-xs">No one matches.</p>
          ) : (
            shownPeople.map((person) => (
              <Checkbox
                key={person.id}
                label={<span dir="auto">{person.name}</span>}
                checked={memberIds.includes(person.id)}
                onChange={(event) =>
                  setMemberIds((current) =>
                    event.target.checked
                      ? [...current, person.id]
                      : current.filter((id) => id !== person.id),
                  )
                }
                className="flex py-1"
              />
            ))
          )}
        </div>
        {error("memberIds") !== undefined && (
          <p role="alert" className="text-danger text-xs">
            {error("memberIds")}
          </p>
        )}
      </fieldset>

      <Field
        label="Lessons learned"
        htmlFor="project-lessons"
        hint="What would you tell the next team?"
        error={error("lessonsLearned")}
      >
        <Textarea
          id="project-lessons"
          value={lessonsLearned}
          onChange={(event) => setLessonsLearned(event.target.value)}
          rows={4}
          maxLength={8000}
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
              ? "Create project"
              : "Save changes"}
        </Button>
      </DialogActions>
    </form>
  );
}
