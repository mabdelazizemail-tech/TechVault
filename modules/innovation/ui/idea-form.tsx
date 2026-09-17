"use client";

import { Lightbulb, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions } from "@/components/ui/dialog";
import {
  Field,
  Input,
  Select,
  Textarea,
  describedBy,
} from "@/components/ui/form-controls";
import {
  IDEA_STATUSES,
  IDEA_STATUS_LABELS,
  type CategoryDto,
  type IdeaStatus,
} from "../contracts/types";
import { createIdeaAction, updateIdeaAction } from "./actions";
import { FileUploadField, type UploadedFile } from "./file-upload";
import { usePeople } from "./use-people";

/**
 * Submitting an idea takes three fields and a click: title, a few sentences, a
 * category. The attachment is optional. Administrators use the same dialog to edit,
 * review and assign.
 */

type Errors = Record<string, string[]>;

export function SubmitIdeaButton({
  categories,
  filesEnabled,
  label = "Submit an idea",
  variant = "primary",
}: {
  categories: CategoryDto[];
  filesEnabled: boolean;
  label?: string;
  variant?: "primary" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);

  return (
    <>
      <Button
        variant={variant}
        icon={<Lightbulb aria-hidden="true" size={15} />}
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
        title="Submit an idea"
        description="A clear title and a few sentences are enough. Others can vote and comment."
      >
        <IdeaCreateForm
          key={formKey}
          categories={categories}
          filesEnabled={filesEnabled}
          onCancel={() => setOpen(false)}
        />
      </Dialog>
    </>
  );
}

function IdeaCreateForm({
  categories,
  filesEnabled,
  onCancel,
}: {
  categories: CategoryDto[];
  filesEnabled: boolean;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [file, setFile] = useState<UploadedFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
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
          // A thrown action (lost connection, server timeout) must not leave the
          // dialog spinning with no explanation.
          const result = await createIdeaAction({
            title,
            description,
            categoryId,
            attachmentFileId: file?.fileId ?? "",
          }).catch(() => ({
            ok: false as const,
            message:
              "We could not reach the server, so nothing was saved. Check your connection and try again.",
          }));
          if (result.ok) {
            onCancel();
            router.push(`/innovation/ideas/${result.data.id}`);
          } else {
            setErrors("fieldErrors" in result ? (result.fieldErrors ?? {}) : {});
            setFormError(result.message);
          }
        });
      }}
    >
      <Field label="Title" htmlFor="idea-title" required error={error("title")}>
        <Input
          id="idea-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="e.g. Automate invoice data entry with OCR"
          maxLength={160}
          invalid={error("title") !== undefined}
          aria-describedby={describedBy("idea-title", error("title"))}
          dir="auto"
          autoFocus
        />
      </Field>
      <Field
        label="Description"
        htmlFor="idea-description"
        required
        error={error("description")}
      >
        <Textarea
          id="idea-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={5}
          maxLength={5000}
          placeholder="What's the problem, and what would you do about it?"
          invalid={error("description") !== undefined}
          dir="auto"
        />
      </Field>
      <Field
        label="Category"
        htmlFor="idea-category"
        required
        error={error("categoryId")}
      >
        <Select
          id="idea-category"
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
          options={categories.map((category) => ({
            value: category.id,
            label: category.name,
          }))}
        />
      </Field>
      <FileUploadField
        label="Attachment (optional)"
        value={file}
        onChange={setFile}
        onBusyChange={setUploading}
        enabled={filesEnabled}
        error={error("file")}
      />

      {formError !== null && <FormError message={formError} />}

      <DialogActions>
        <Button variant="secondary" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          isPending={isPending}
          disabled={uploading}
        >
          {isPending ? "Submitting…" : "Submit idea"}
        </Button>
      </DialogActions>
    </form>
  );
}

export function EditIdeaButton({
  idea,
  categories,
}: {
  idea: {
    id: string;
    title: string;
    description: string;
    categoryId: string;
    status: IdeaStatus;
    ownerId: string | null;
  };
  categories: CategoryDto[];
}) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);

  return (
    <>
      <Button
        icon={<Pencil aria-hidden="true" size={14} />}
        onClick={() => {
          setFormKey((key) => key + 1);
          setOpen(true);
        }}
      >
        Edit &amp; review
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title="Edit idea" variant="sheet">
        <IdeaEditForm
          key={formKey}
          idea={idea}
          categories={categories}
          open={open}
          onDone={() => setOpen(false)}
        />
      </Dialog>
    </>
  );
}

function IdeaEditForm({
  idea,
  categories,
  open,
  onDone,
}: {
  idea: Parameters<typeof EditIdeaButton>[0]["idea"];
  categories: CategoryDto[];
  open: boolean;
  onDone: () => void;
}) {
  const { people, error: peopleError } = usePeople(open);
  const [title, setTitle] = useState(idea.title);
  const [description, setDescription] = useState(idea.description);
  const [categoryId, setCategoryId] = useState(idea.categoryId);
  const [status, setStatus] = useState<IdeaStatus>(idea.status);
  const [ownerId, setOwnerId] = useState(idea.ownerId ?? "");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const error = (key: string) => errors[key]?.[0];

  const categoryOptions = categories.map((category) => ({
    value: category.id,
    label: category.isActive ? category.name : `${category.name} (archived)`,
  }));

  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        setFormError(null);
        startTransition(async () => {
          const result = await updateIdeaAction(idea.id, {
            title,
            description,
            categoryId,
            status,
            ownerId,
          });
          if (result.ok) onDone();
          else {
            setErrors(result.fieldErrors ?? {});
            setFormError(result.message);
          }
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Status" htmlFor="idea-edit-status">
          <Select
            id="idea-edit-status"
            value={status}
            onChange={(event) => setStatus(event.target.value as IdeaStatus)}
            options={IDEA_STATUSES.map((value) => ({
              value,
              label: IDEA_STATUS_LABELS[value],
            }))}
          />
        </Field>
        <Field
          label="Owner"
          htmlFor="idea-edit-owner"
          error={error("ownerId") ?? peopleError ?? undefined}
        >
          <Select
            id="idea-edit-owner"
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
      <Field label="Title" htmlFor="idea-edit-title" required error={error("title")}>
        <Input
          id="idea-edit-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={160}
          invalid={error("title") !== undefined}
          dir="auto"
        />
      </Field>
      <Field
        label="Description"
        htmlFor="idea-edit-description"
        required
        error={error("description")}
      >
        <Textarea
          id="idea-edit-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={7}
          maxLength={5000}
          dir="auto"
        />
      </Field>
      <Field label="Category" htmlFor="idea-edit-category" error={error("categoryId")}>
        <Select
          id="idea-edit-category"
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
          options={categoryOptions}
        />
      </Field>

      {formError !== null && <FormError message={formError} />}

      <DialogActions>
        <Button variant="secondary" onClick={onDone} disabled={isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" isPending={isPending}>
          {isPending ? "Saving…" : "Save changes"}
        </Button>
      </DialogActions>
    </form>
  );
}

export function FormError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="border-danger/25 bg-danger-subtle text-danger border px-3 py-2 text-xs"
    >
      {message}
    </p>
  );
}
