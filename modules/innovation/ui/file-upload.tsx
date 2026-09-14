"use client";

import { FileText, Loader2, X } from "lucide-react";
import { useId, useState } from "react";
import { ACCEPTED_EXTENSIONS, MAX_FILE_BYTES, formatBytes } from "../domain/files";
import { prepareUploadAction } from "./actions";

/**
 * Pick a file and it uploads at once, straight to storage through a one-time link
 * the server issued after checking permissions. The form then saves only the file's
 * id; the server checks the stored bytes before accepting it.
 */

export type UploadedFile = { fileId: string; fileName: string; sizeBytes: number };

export function FileUploadField({
  label,
  value,
  onChange,
  onBusyChange,
  enabled,
  error,
}: {
  label: string;
  value: UploadedFile | null;
  onChange: (file: UploadedFile | null) => void;
  onBusyChange?: (busy: boolean) => void;
  /** False when the server has no storage configured. */
  enabled: boolean;
  error?: string;
}) {
  const inputId = useId();
  const [uploading, setUploading] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  if (!enabled) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-foreground-muted text-xs">{label}</span>
        <p className="border-border text-foreground-muted border border-dashed px-3 py-2 text-xs">
          File uploads aren&apos;t switched on for this server yet.
        </p>
      </div>
    );
  }

  const busy = (next: string | null) => {
    setUploading(next);
    onBusyChange?.(next !== null);
  };

  const upload = async (file: File) => {
    setFailure(null);
    if (file.size === 0) {
      setFailure("That file is empty.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setFailure("Files are limited to 25 MB.");
      return;
    }

    busy(file.name);
    try {
      const prepared = await prepareUploadAction({
        fileName: file.name,
        sizeBytes: file.size,
      });
      if (!prepared.ok) {
        setFailure(prepared.fieldErrors?.file?.[0] ?? prepared.message);
        return;
      }
      const response = await fetch(prepared.data.uploadUrl, {
        method: "PUT",
        headers: { "content-type": prepared.data.contentType, "x-upsert": "false" },
        body: file,
      });
      if (!response.ok) {
        setFailure("The upload did not complete. Please try again.");
        return;
      }
      onChange({
        fileId: prepared.data.fileId,
        fileName: file.name,
        sizeBytes: file.size,
      });
    } catch {
      setFailure("The upload did not complete. Check your connection and try again.");
    } finally {
      busy(null);
    }
  };

  const message = failure ?? error;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-foreground-muted text-xs">
        {label}
      </label>
      {value !== null ? (
        <div className="border-border-strong flex items-center gap-2.5 border px-3 py-2">
          <FileText
            aria-hidden="true"
            size={16}
            className="text-foreground-muted shrink-0"
          />
          <span className="min-w-0 flex-1">
            <span className="text-foreground block truncate text-sm" dir="auto">
              {value.fileName}
            </span>
            <span className="text-foreground-subtle text-xs">
              {formatBytes(value.sizeBytes)}
            </span>
          </span>
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={`Remove ${value.fileName}`}
            className="text-foreground-muted hover:bg-surface-hover hover:text-foreground grid size-7 cursor-pointer place-items-center"
          >
            <X aria-hidden="true" size={15} />
          </button>
        </div>
      ) : uploading !== null ? (
        <p
          role="status"
          className="border-border-strong text-foreground-muted flex items-center gap-2 border px-3 py-2 text-sm"
        >
          <Loader2 aria-hidden="true" size={15} className="animate-spin" />
          Uploading <span dir="auto">{uploading}</span>…
        </p>
      ) : (
        <input
          id={inputId}
          type="file"
          accept={ACCEPTED_EXTENSIONS}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file !== undefined) void upload(file);
          }}
          className="text-foreground-muted file:border-border-strong file:text-foreground hover:file:bg-surface-hover text-sm file:me-3 file:cursor-pointer file:border file:bg-transparent file:px-3 file:py-1.5 file:text-sm file:font-extrabold"
        />
      )}
      <p className="text-foreground-subtle text-xs">
        PDF, Word, Excel, PowerPoint, text, CSV or images · up to 25 MB
      </p>
      {message !== undefined && message !== null && (
        <p role="alert" className="text-danger text-xs">
          {message}
        </p>
      )}
    </div>
  );
}
