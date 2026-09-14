/**
 * Which files THE THINK TANK accepts, and how to recognise them — pure.
 *
 * A file is accepted by its extension AND its actual first bytes; the name the
 * browser sends and the content type it claims are never trusted on their own
 * (CLAUDE.md §12.2). The stored content type comes from here, not from the upload.
 */

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** How many leading bytes the server reads to check a file's content. */
export const SNIFF_BYTES = 4096;

type Signature = (bytes: Uint8Array) => boolean;

export type FileRule = {
  label: string;
  contentType: string;
  preview: "pdf" | "image" | null;
  signature: Signature;
};

const startsWith =
  (...expected: number[]): Signature =>
  (bytes) =>
    expected.every((value, index) => bytes[index] === value);

const zip = startsWith(0x50, 0x4b, 0x03, 0x04);
const legacyOffice = startsWith(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);

/** Plain text: valid UTF-8 without NUL bytes — rules out binaries renamed .txt. */
const plainText: Signature = (bytes) => {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: true });
    return true;
  } catch {
    return false;
  }
};

const RULES: Record<string, FileRule> = {
  pdf: {
    label: "PDF",
    contentType: "application/pdf",
    preview: "pdf",
    signature: startsWith(0x25, 0x50, 0x44, 0x46),
  },
  docx: {
    label: "Word",
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    preview: null,
    signature: zip,
  },
  xlsx: {
    label: "Excel",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    preview: null,
    signature: zip,
  },
  pptx: {
    label: "PowerPoint",
    contentType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    preview: null,
    signature: zip,
  },
  doc: {
    label: "Word",
    contentType: "application/msword",
    preview: null,
    signature: legacyOffice,
  },
  xls: {
    label: "Excel",
    contentType: "application/vnd.ms-excel",
    preview: null,
    signature: legacyOffice,
  },
  ppt: {
    label: "PowerPoint",
    contentType: "application/vnd.ms-powerpoint",
    preview: null,
    signature: legacyOffice,
  },
  png: {
    label: "Image",
    contentType: "image/png",
    preview: "image",
    signature: startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
  },
  jpg: {
    label: "Image",
    contentType: "image/jpeg",
    preview: "image",
    signature: startsWith(0xff, 0xd8, 0xff),
  },
  jpeg: {
    label: "Image",
    contentType: "image/jpeg",
    preview: "image",
    signature: startsWith(0xff, 0xd8, 0xff),
  },
  webp: {
    label: "Image",
    contentType: "image/webp",
    preview: "image",
    signature: (bytes) =>
      startsWith(0x52, 0x49, 0x46, 0x46)(bytes) &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50,
  },
  txt: { label: "Text", contentType: "text/plain", preview: null, signature: plainText },
  csv: { label: "CSV", contentType: "text/csv", preview: null, signature: plainText },
  md: {
    label: "Text",
    contentType: "text/markdown",
    preview: null,
    signature: plainText,
  },
};

/** For the file picker's `accept` attribute. */
export const ACCEPTED_EXTENSIONS = Object.keys(RULES)
  .map((extension) => `.${extension}`)
  .join(",");

export function extensionOf(fileName: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  return match?.[1]?.toLowerCase() ?? "";
}

export function ruleFor(fileName: string): FileRule | null {
  return RULES[extensionOf(fileName)] ?? null;
}

/** The file's own name, without any directory part or control characters. */
export function cleanFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\x00-\x1f\x7f]/g, "").trim();
  return cleaned.length > 200 ? cleaned.slice(cleaned.length - 200) : cleaned;
}

export function matchesContent(fileName: string, bytes: Uint8Array): boolean {
  const rule = ruleFor(fileName);
  return rule !== null && bytes.length > 0 && rule.signature(bytes);
}

export function fileLabel(fileName: string): string {
  return ruleFor(fileName)?.label ?? "File";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
