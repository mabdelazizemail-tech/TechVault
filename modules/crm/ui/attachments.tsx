"use client";

import { FileText, Paperclip, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import {
  ACCEPTED_EXTENSIONS,
  MAX_FILE_BYTES,
  formatBytes,
  ruleFor,
} from "@/platform/storage/file-types";
import { MAX_ATTACHMENTS_PER_UPLOAD } from "../contracts/types";
import {
  attachFilesAction,
  prepareAttachmentAction,
  removeAttachmentAction,
} from "./actions";

/**
 * Attaching files to a deal (ADR-039): choose them, and on save each goes straight to
 * private storage through a one-time link the server issued after checking you may
 * edit the deal; then the server checks every file's content and attaches them all.
 */

/** Uploads and attaches the chosen files. Nothing is attached unless every file passes. */
export async function uploadAttachments(
  opportunityId: string,
  files: readonly File[],
  onProgress?: (done: number) => void,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const ids: string[] = [];
  for (const [index, file] of files.entries()) {
    const prepared = await prepareAttachmentAction(opportunityId, {
      fileName: file.name,
      sizeBytes: file.size,
    });
    if (!prepared.ok) {
      return {
        ok: false,
        message: `${file.name}: ${prepared.fieldErrors?.file?.[0] ?? prepared.message}`,
      };
    }
    try {
      const response = await fetch(prepared.data.uploadUrl, {
        method: "PUT",
        headers: { "content-type": prepared.data.contentType, "x-upsert": "false" },
        body: file,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch {
      return {
        ok: false,
        message: `${file.name} could not be uploaded. Check your connection and try again.`,
      };
    }
    ids.push(prepared.data.attachmentId);
    onProgress?.(index + 1);
  }
  const attached = await attachFilesAction(opportunityId, { attachmentIds: ids });
  return attached.ok
    ? { ok: true }
    : { ok: false, message: attached.fieldErrors?.file?.[0] ?? attached.message };
}

/** Why a chosen file cannot be attached, checked before anything is uploaded. */
function problemWith(file: File): string | null {
  if (ruleFor(file.name) === null) {
    return `${file.name}: use a PDF, Word, Excel, PowerPoint, text or CSV file, or an image.`;
  }
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > MAX_FILE_BYTES) return `${file.name} is larger than 25 MB.`;
  return null;
}

/** Choose files to attach; they upload when the surrounding form is saved. */
export function AttachmentPicker({
  files,
  onChange,
  disabled = false,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const add = (chosen: File[]) => {
    const rejected = chosen.map(problemWith).find((message) => message !== null) ?? null;
    const accepted = chosen.filter((file) => problemWith(file) === null);
    const next = [...files, ...accepted].slice(0, MAX_ATTACHMENTS_PER_UPLOAD);
    setProblem(
      rejected ??
        (files.length + accepted.length > MAX_ATTACHMENTS_PER_UPLOAD
          ? `Attach at most ${MAX_ATTACHMENTS_PER_UPLOAD} files at a time.`
          : null),
    );
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-foreground-muted text-xs">
        Attachments <span className="text-foreground-subtle">(optional)</span>
      </span>
      {files.length > 0 && (
        <ul className="border-border divide-border divide-y border">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="flex items-center gap-2.5 px-3 py-2"
            >
              <FileText
                aria-hidden="true"
                size={16}
                className="text-foreground-muted shrink-0"
              />
              <span className="min-w-0 flex-1">
                <span className="text-foreground block truncate text-sm" dir="auto">
                  {file.name}
                </span>
                <span className="text-foreground-subtle text-xs">
                  {formatBytes(file.size)}
                </span>
              </span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(files.filter((_, at) => at !== index))}
                aria-label={`Remove ${file.name}`}
                className="text-foreground-muted hover:bg-surface-hover hover:text-foreground grid size-7 cursor-pointer place-items-center disabled:cursor-not-allowed pointer-coarse:size-10"
              >
                <X aria-hidden="true" size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <Button
          size="sm"
          variant="secondary"
          icon={<Paperclip aria-hidden="true" size={14} />}
          disabled={disabled || files.length >= MAX_ATTACHMENTS_PER_UPLOAD}
          onClick={() => input.current?.click()}
        >
          {files.length === 0 ? "Attach files" : "Add more"}
        </Button>
        <input
          ref={input}
          id={inputId}
          type="file"
          multiple
          accept={ACCEPTED_EXTENSIONS}
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose files to attach"
          onChange={(event) => {
            add(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
      </div>
      <p className="text-foreground-subtle text-xs">
        Signed contract, purchase order… PDF, Office, text or image files, up to 25 MB
        each.
      </p>
      {problem !== null && (
        <p role="alert" className="text-danger text-xs">
          {problem}
        </p>
      )}
    </div>
  );
}

/** "Add files" on the deal page. */
export function AddAttachmentsButton({ opportunityId }: { opportunityId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const busy = isPending || progress !== null;

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        icon={<Paperclip aria-hidden="true" size={14} />}
        onClick={() => {
          setFiles([]);
          setError(null);
          setOpen(true);
        }}
      >
        Add files
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!busy) setOpen(next);
        }}
        title="Attach files to this deal"
        description="Everyone who can see the deal can open them."
      >
        <AttachmentPicker files={files} onChange={setFiles} disabled={busy} />
        {error !== null && (
          <p role="alert" className="text-danger mt-2 text-sm">
            {error}
          </p>
        )}
        <DialogActions>
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            isPending={busy}
            disabled={files.length === 0}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                setProgress(0);
                const result = await uploadAttachments(opportunityId, files, setProgress);
                setProgress(null);
                if (!result.ok) {
                  setError(result.message);
                  return;
                }
                toast(
                  files.length === 1
                    ? "File attached."
                    : `${files.length} files attached.`,
                );
                setOpen(false);
                router.refresh();
              })
            }
          >
            {progress !== null
              ? `Uploading ${Math.min(progress + 1, files.length)} of ${files.length}…`
              : "Attach"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

/** Removes a file from the deal, after a confirmation that names it. */
export function RemoveAttachmentButton({
  opportunityId,
  attachmentId,
  fileName,
}: {
  opportunityId: string;
  attachmentId: string;
  fileName: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Remove ${fileName}`}
        className="text-foreground-muted hover:bg-surface-hover hover:text-danger grid size-8 shrink-0 cursor-pointer place-items-center pointer-coarse:size-10"
      >
        <Trash2 aria-hidden="true" size={15} />
      </button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Remove this file?"
        description={`“${fileName}” leaves the deal for everyone. It stays on record in the audit trail.`}
      >
        {error !== null && (
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
        )}
        <DialogActions>
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            isPending={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await removeAttachmentAction(opportunityId, attachmentId);
                if (!result.ok) {
                  setError(result.message);
                  return;
                }
                toast("File removed.");
                setOpen(false);
                router.refresh();
              })
            }
          >
            Remove file
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
