import { createClient } from "@supabase/supabase-js";
import { BusinessRuleError } from "@/lib/errors";
import { publicEnv, serverEnv } from "@/platform/config/env";
import { logger } from "@/platform/observability/logger";

/**
 * Object storage (CLAUDE.md §7, §12): a private Supabase Storage bucket reached
 * only from the server with the secret key.
 *
 * Nothing here authorises anything — callers are services that have already
 * checked permissions. The bucket is private and has no storage policies, so a
 * client key can neither list nor read it; every read goes through a signed link
 * that expires within minutes, created after an authorisation check (§12.3).
 *
 * Generic: it knows keys and bytes, not documents or ideas.
 */

const NOT_CONFIGURED =
  "File storage is not configured on this server. Add SUPABASE_SECRET_KEY to the server environment.";

const UNAVAILABLE =
  "The file service is unavailable right now. Please try again shortly.";

export function isStorageConfigured(): boolean {
  return serverEnv().supabaseSecretKey !== null;
}

function bucket() {
  if (typeof window !== "undefined") {
    throw new Error("Object storage must never be used from the browser.");
  }
  const env = serverEnv();
  if (env.supabaseSecretKey === null) throw new BusinessRuleError(NOT_CONFIGURED);

  return createClient(publicEnv().supabaseUrl, env.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }).storage.from(env.storageBucket);
}

type StorageFailure = { message: string; status?: number; statusCode?: string };

function isMissing(error: StorageFailure): boolean {
  return (
    error.status === 404 ||
    error.statusCode === "404" ||
    /not.?found/i.test(error.message)
  );
}

function unavailable(operation: string, error: StorageFailure): BusinessRuleError {
  logger.error("Object storage operation failed", {
    module: "storage",
    operation,
    httpStatus: error.status ?? null,
    errorMessage: error.message,
  });
  return new BusinessRuleError(UNAVAILABLE);
}

/**
 * A one-time URL the browser can PUT a file's bytes to, for this key only. It
 * cannot overwrite an existing object.
 */
export async function createUploadUrl(key: string): Promise<{ url: string }> {
  const { data, error } = await bucket().createSignedUploadUrl(key);
  if (error !== null || data === null) {
    throw unavailable("createUploadUrl", error ?? { message: "No upload URL returned" });
  }
  return { url: data.signedUrl };
}

/**
 * The stored object's size and its first `byteCount` bytes, or null when no object
 * exists at the key — enough to confirm an upload finished and check its content
 * without downloading the whole file.
 */
export async function readObjectStart(
  key: string,
  byteCount: number,
): Promise<{ size: number; head: Uint8Array } | null> {
  const { data, error } = await bucket().createSignedUrl(key, 60);
  if (error !== null || data === null) {
    if (error !== null && isMissing(error)) return null;
    throw unavailable("readObjectStart.sign", error ?? { message: "No URL returned" });
  }

  const response = await fetch(data.signedUrl, {
    headers: { Range: `bytes=0-${byteCount - 1}` },
    cache: "no-store",
  });
  if (response.status === 404 || response.status === 400) return null;
  if (!response.ok) {
    throw unavailable("readObjectStart.fetch", {
      message: `HTTP ${response.status}`,
      status: response.status,
    });
  }

  const head = await readAtMost(response, byteCount);
  // 206 carries "bytes 0-4095/123456"; a server that ignores Range sends the whole
  // object with its full Content-Length.
  const range = response.headers.get("content-range");
  const total =
    range !== null
      ? Number(range.split("/")[1])
      : Number(response.headers.get("content-length") ?? head.length);
  return { size: Number.isFinite(total) ? total : head.length, head };
}

async function readAtMost(response: Response, byteCount: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (reader === undefined) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (received < byteCount) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
  }
  await reader.cancel().catch(() => undefined);

  const head = new Uint8Array(Math.min(received, byteCount));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, head.length - offset);
    head.set(part, offset);
    offset += part.length;
    if (offset >= head.length) break;
  }
  return head;
}

/**
 * A link to read an object, valid for a few minutes. With `downloadAs`, the browser
 * saves it under that name; without, it is displayed inline (previews).
 */
export async function createDownloadUrl(
  key: string,
  options: { downloadAs: string | null; expiresInSeconds: number },
): Promise<string> {
  const { data, error } = await bucket().createSignedUrl(
    key,
    options.expiresInSeconds,
    options.downloadAs !== null ? { download: options.downloadAs } : undefined,
  );
  if (error !== null || data === null) {
    throw unavailable("createDownloadUrl", error ?? { message: "No URL returned" });
  }
  return data.signedUrl;
}

export async function removeObject(key: string): Promise<void> {
  const { error } = await bucket().remove([key]);
  if (error !== null) throw unavailable("removeObject", error);
}
