"use client";

import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form-controls";
import type { CategoryDto, FileDto } from "../contracts/types";
import { createKnowledgeAction, updateKnowledgeAction } from "./actions";
import { FileUploadField, type UploadedFile } from "./file-upload";
import { FormError } from "./idea-form";

/**
 * Adding knowledge: a title, a category, and a file or a few lines. Tags are
 * optional and typed as a comma-separated list — no metadata form to fill in.
 */

type KnowledgeValues = {
  id?: string;
  title: string;
  description: string | null;
  categoryId: string;
  tags: string[];
  file: FileDto | null;
  projectId: string | null;
};

export function AddKnowledgeButton({
  categories,
  filesEnabled,
  projectId = null,
  defaultCategoryId,
  label = "Add knowledge",
  variant = "primary",
}: {
  categories: CategoryDto[];
  filesEnabled: boolean;
  projectId?: string | null;
  defaultCategoryId?: string;
  label?: string;
  variant?: "primary" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);

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
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={label}
        description="Upload a file or write it down. Title and category are all that's required."
      >
        <KnowledgeForm
          key={formKey}
          initial={{
            title: "",
            description: null,
            categoryId: defaultCategoryId ?? categories[0]?.id ?? "",
            tags: [],
            file: null,
            projectId,
          }}
          categories={categories}
          filesEnabled={filesEnabled}
          onDone={() => setOpen(false)}
        />
      </Dialog>
    </>
  );
}

export function EditKnowledgeButton({
  item,
  categories,
  filesEnabled,
}: {
  item: KnowledgeValues & { id: string };
  categories: CategoryDto[];
  filesEnabled: boolean;
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
        Edit
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title="Edit knowledge" variant="sheet">
        <KnowledgeForm
          key={formKey}
          initial={item}
          categories={categories}
          filesEnabled={filesEnabled}
          onDone={() => setOpen(false)}
        />
      </Dialog>
    </>
  );
}

function KnowledgeForm({
  initial,
  categories,
  filesEnabled,
  onDone,
}: {
  initial: KnowledgeValues;
  categories: CategoryDto[];
  filesEnabled: boolean;
  onDone: () => void;
}) {
  const router = useRouter();
  const editing = initial.id !== undefined;
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description ?? "");
  const [categoryId, setCategoryId] = useState(initial.categoryId);
  const [tags, setTags] = useState(initial.tags.join(", "));
  const [file, setFile] = useState<UploadedFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
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
          const input = {
            title,
            description,
            categoryId,
            tags,
            fileId: file?.fileId ?? "",
            projectId: initial.projectId ?? "",
          };
          const result =
            initial.id !== undefined
              ? await updateKnowledgeAction(initial.id, input)
              : await createKnowledgeAction(input);
          if (!result.ok) {
            setErrors(result.fieldErrors ?? {});
            setFormError(result.message);
            return;
          }
          onDone();
          if (
            initial.id === undefined &&
            result.data !== null &&
            initial.projectId === null
          ) {
            router.push(`/innovation/knowledge/${result.data.id}`);
          }
        });
      }}
    >
      <Field label="Title" htmlFor="knowledge-title" required error={error("title")}>
        <Input
          id="knowledge-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="e.g. OCR Deployment Guide"
          maxLength={200}
          invalid={error("title") !== undefined}
          dir="auto"
          autoFocus
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Category"
          htmlFor="knowledge-category"
          required
          error={error("categoryId")}
        >
          <Select
            id="knowledge-category"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            options={categories.map((category) => ({
              value: category.id,
              label: category.isActive ? category.name : `${category.name} (archived)`,
            }))}
          />
        </Field>
        <Field
          label="Tags"
          htmlFor="knowledge-tags"
          hint="Separate with commas"
          error={error("tags")}
        >
          <Input
            id="knowledge-tags"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="ocr, banking"
            dir="auto"
          />
        </Field>
      </div>

      {editing && initial.file !== null && file === null && (
        <p className="text-foreground-muted text-xs">
          Current file: <span dir="auto">{initial.file.fileName}</span>. Upload another to
          replace it.
        </p>
      )}
      <FileUploadField
        label={editing ? "Replace file (optional)" : "File"}
        value={file}
        onChange={setFile}
        onBusyChange={setUploading}
        enabled={filesEnabled}
        error={error("file")}
      />
      <Field
        label="Description"
        htmlFor="knowledge-description"
        hint="Optional when you attach a file"
        error={error("description")}
      >
        <Textarea
          id="knowledge-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
          maxLength={4000}
          placeholder="What is it, and when is it useful?"
          dir="auto"
        />
      </Field>

      {formError !== null && <FormError message={formError} />}

      <DialogActions>
        <Button variant="secondary" onClick={onDone} disabled={isPending}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          isPending={isPending}
          disabled={uploading}
        >
          {isPending ? "Saving…" : editing ? "Save changes" : "Add"}
        </Button>
      </DialogActions>
    </form>
  );
}
