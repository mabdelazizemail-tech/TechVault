import { describe, expect, it } from "vitest";
import type { MessageDto, ReceiptDto } from "@/modules/messaging/contracts/types";
import {
  buildTimeline,
  compareMessages,
  directKeyFor,
  mergeMessages,
  messageStatus,
  previewOf,
} from "@/modules/messaging/domain/conversation-rules";

const ME = "00000000-0000-4000-8000-000000000001";
const YOU = "00000000-0000-4000-8000-000000000002";

function message(
  id: string,
  createdAt: string,
  senderId: string | null = YOU,
  overrides: Partial<MessageDto> = {},
): MessageDto {
  return {
    id,
    conversationId: "c",
    senderId,
    type: "TEXT",
    content: `message ${id}`,
    createdAt,
    editedAt: null,
    ...overrides,
  };
}

const dayKeyOf = (iso: string) => iso.slice(0, 10);

describe("directKeyFor", () => {
  it("is the same whichever person starts the conversation", () => {
    expect(directKeyFor(ME, YOU)).toBe(directKeyFor(YOU, ME));
  });

  it("ignores letter case, so one pair can never have two keys", () => {
    expect(directKeyFor(ME.toUpperCase(), YOU)).toBe(directKeyFor(ME, YOU));
  });
});

describe("messageStatus", () => {
  const sent = message("m1", "2026-09-14T10:00:00.000Z", ME);
  const receipt = (overrides: Partial<ReceiptDto>): ReceiptDto[] => [
    { userId: YOU, lastDeliveredAt: null, lastReadAt: null, ...overrides },
  ];

  it("shows no status on someone else's message", () => {
    expect(messageStatus(message("m2", sent.createdAt, YOU), ME, receipt({}))).toBeNull();
  });

  it("is sent until the recipient's client receives it", () => {
    expect(messageStatus(sent, ME, receipt({}))).toBe("sent");
    expect(
      messageStatus(sent, ME, receipt({ lastDeliveredAt: "2026-09-14T09:59:59.999Z" })),
    ).toBe("sent");
  });

  it("is delivered once the delivery watermark reaches it", () => {
    expect(messageStatus(sent, ME, receipt({ lastDeliveredAt: sent.createdAt }))).toBe(
      "delivered",
    );
  });

  it("is read once the read watermark reaches it", () => {
    expect(
      messageStatus(
        sent,
        ME,
        receipt({
          lastDeliveredAt: "2026-09-14T10:05:00.000Z",
          lastReadAt: "2026-09-14T10:05:00.000Z",
        }),
      ),
    ).toBe("read");
  });

  it("counts a read watermark as delivery too", () => {
    expect(messageStatus(sent, ME, receipt({ lastReadAt: sent.createdAt }))).toBe("read");
  });

  it("is only as far along as the least advanced recipient", () => {
    const receipts: ReceiptDto[] = [
      { userId: YOU, lastDeliveredAt: sent.createdAt, lastReadAt: sent.createdAt },
      { userId: "someone-else", lastDeliveredAt: null, lastReadAt: null },
    ];
    expect(messageStatus(sent, ME, receipts)).toBe("sent");
  });
});

describe("mergeMessages", () => {
  const a = message("a", "2026-09-14T10:00:00.000Z");
  const b = message("b", "2026-09-14T10:01:00.000Z");

  it("returns the same array when there is nothing new, so React skips the render", () => {
    const current = [a, b];
    expect(mergeMessages(current, [])).toBe(current);
  });

  it("orders by time and breaks ties by id, identically on every client", () => {
    const tieLow = message("0001", "2026-09-14T10:00:30.000Z");
    const tieHigh = message("0002", "2026-09-14T10:00:30.000Z");
    const merged = mergeMessages([b, tieHigh], [tieLow, a]);
    expect(merged.map((m) => m.id)).toEqual(["a", "0001", "0002", "b"]);
    expect([...merged].sort(compareMessages)).toEqual(merged);
  });

  it("replaces an optimistic copy with the confirmed message of the same id", () => {
    const optimistic = { ...a, createdAt: "2026-09-14T09:59:00.000Z" };
    const merged = mergeMessages([optimistic, b], [a]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toBe(a);
  });
});

describe("buildTimeline", () => {
  it("puts a day separator before the first message of each day", () => {
    const items = buildTimeline(
      [
        message("1", "2026-09-13T22:00:00.000Z", ME),
        message("2", "2026-09-14T08:00:00.000Z", ME),
      ],
      { viewerId: ME, lastReadAt: null, dayKeyOf },
    );
    expect(items.map((item) => item.kind)).toEqual(["day", "message", "day", "message"]);
  });

  it("places the unread divider before the first unread message from someone else", () => {
    const items = buildTimeline(
      [
        message("1", "2026-09-14T08:00:00.000Z", YOU),
        message("2", "2026-09-14T08:01:00.000Z", ME),
        message("3", "2026-09-14T08:02:00.000Z", YOU),
        message("4", "2026-09-14T08:03:00.000Z", YOU),
      ],
      { viewerId: ME, lastReadAt: "2026-09-14T08:01:30.000Z", dayKeyOf },
    );
    const kinds = items.map((item) => (item.kind === "message" ? item.key : item.kind));
    expect(kinds).toEqual(["day", "1", "2", "unread", "3", "4"]);
  });

  it("never marks the viewer's own messages as unread", () => {
    const items = buildTimeline([message("1", "2026-09-14T08:00:00.000Z", ME)], {
      viewerId: ME,
      lastReadAt: null,
      dayKeyOf,
    });
    expect(items.some((item) => item.kind === "unread")).toBe(false);
  });

  it("groups consecutive messages from one sender within five minutes", () => {
    const items = buildTimeline(
      [
        message("1", "2026-09-14T08:00:00.000Z", ME),
        message("2", "2026-09-14T08:04:00.000Z", ME),
        message("3", "2026-09-14T08:10:00.000Z", ME),
        message("4", "2026-09-14T08:11:00.000Z", YOU),
      ],
      { viewerId: ME, lastReadAt: "2026-09-14T09:00:00.000Z", dayKeyOf },
    );
    const grouping = items.flatMap((item) =>
      item.kind === "message" ? [item.continuesGroup] : [],
    );
    expect(grouping).toEqual([false, true, false, false]);
  });
});

describe("previewOf", () => {
  it("collapses whitespace and truncates long text", () => {
    expect(previewOf({ type: "TEXT", content: "hello\n\n  world" })).toBe("hello world");
    const preview = previewOf({ type: "TEXT", content: "x".repeat(300) }, 10);
    expect(preview).toHaveLength(10);
    expect(preview.endsWith("…")).toBe(true);
  });

  it("describes a document without revealing anything about it", () => {
    expect(previewOf({ type: "DOCUMENT", content: null })).toBe("Shared a document");
  });
});
