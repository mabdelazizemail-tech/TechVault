import { describe, expect, it } from "vitest";
import { readRangeHead } from "@/platform/storage/storage";

/**
 * Checking an upload reads the first bytes of the stored object. Inside Next.js the
 * patched fetch hands callers one branch of a tee'd body; awaiting cancel() on that
 * branch never settles while the other branch stays open, which hung idea submission
 * with an attachment indefinitely (2026-09-17).
 */

const bytes = (length: number) => new Uint8Array(length).map((_, index) => index % 251);

function teedResponse(body: Uint8Array, headers: Record<string, string>, status = 206) {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      // Deliver in chunks and never close: a long object still streaming.
      for (let offset = 0; offset < body.length; offset += 1000) {
        controller.enqueue(body.subarray(offset, offset + 1000));
      }
    },
  });
  const [mine] = source.tee(); // the other branch is never read or cancelled
  return new Response(mine, { status, headers });
}

const within = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("hung")), ms)),
  ]);

describe("readRangeHead", () => {
  it("returns the first bytes and the total size without hanging on a tee'd body", async () => {
    const body = bytes(8000);
    const fetchImpl = async () =>
      teedResponse(body, { "content-range": "bytes 0-4095/219476" });

    const result = await within(
      readRangeHead("https://storage.test/x", 4096, fetchImpl),
      2000,
    );

    expect(result).not.toBeNull();
    expect(result?.size).toBe(219476);
    expect(result?.head).toEqual(body.subarray(0, 4096));
  });

  it("uses Content-Length when the server ignores the range", async () => {
    const body = bytes(3000);
    const fetchImpl = async () =>
      new Response(body, { status: 200, headers: { "content-length": "3000" } });

    const result = await within(
      readRangeHead("https://storage.test/x", 4096, fetchImpl),
      2000,
    );

    expect(result?.size).toBe(3000);
    expect(result?.head.length).toBe(3000);
  });

  it("reports a missing object as null", async () => {
    const fetchImpl = async () => new Response("not found", { status: 404 });
    expect(await readRangeHead("https://storage.test/x", 4096, fetchImpl)).toBeNull();
  });

  it("gives up instead of waiting forever on a server that never answers", async () => {
    const fetchImpl = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
      );

    await expect(
      within(
        readRangeHead("https://storage.test/x", 4096, fetchImpl, { timeoutMs: 50 }),
        2000,
      ),
    ).rejects.toThrow(/unavailable/i);
  });
});
