import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  BusinessRuleError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { MESSAGING_MEMBER_PERMISSIONS } from "@/modules/messaging/contracts/permissions";
import {
  getConversation,
  getInboxSummary,
  listConversations,
  listMessages,
  markRead,
  openDirectConversation,
  recordLastSeen,
  searchPeople,
  sendMessage,
} from "@/modules/messaging/contracts/service";
import { messageStatus } from "@/modules/messaging/domain/conversation-rules";
import {
  createRole,
  createUser,
  grantRole,
  hasTestDatabase,
  resetDatabase,
  seedPermissions,
  teardownDatabase,
  testPrisma,
} from "./helpers/db";

/**
 * Messaging against a real database: who may talk to whom, what each person can
 * read, pagination, delivery and read receipts — and the controls that live in
 * the database itself: the participation and document-access triggers, and the
 * row-level security policies exercised as a non-owning role.
 */
describe.skipIf(!hasTestDatabase)("Messaging (integration)", () => {
  let alice: { id: string };
  let bob: { id: string };
  let carol: { id: string };
  let noAccess: { id: string };
  let inactive: { id: string };

  afterAll(async () => {
    await teardownDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedPermissions();
    const member = await createRole("member", MESSAGING_MEMBER_PERMISSIONS);

    alice = await createUser({ email: "alice.adams@example.com" });
    bob = await createUser({ email: "bob.brown@example.com" });
    carol = await createUser({ email: "carol.clark@example.com" });
    noAccess = await createUser({ email: "no.access@example.com" });
    inactive = await createUser({ email: "gone.person@example.com", isActive: false });

    for (const user of [alice, bob, carol, inactive]) {
      await grantRole(user.id, member.id);
    }
  });

  const text = (conversationId: string, content: string) => ({
    conversationId,
    clientMessageId: crypto.randomUUID(),
    content,
  });

  async function directBetween(a: { id: string }, b: { id: string }): Promise<string> {
    return (await openDirectConversation(a, { userId: b.id })).conversationId;
  }

  /* ------------------------------------------------------------------------ */
  /* Starting conversations                                                   */
  /* ------------------------------------------------------------------------ */

  it("gives two people exactly one direct conversation, whoever starts it", async () => {
    const first = await openDirectConversation(alice, { userId: bob.id });
    const second = await openDirectConversation(bob, { userId: alice.id });
    const again = await openDirectConversation(alice, { userId: bob.id });

    expect(first.created).toBe(true);
    expect(second).toEqual({ conversationId: first.conversationId, created: false });
    expect(again.conversationId).toBe(first.conversationId);

    const prisma = testPrisma();
    expect(await prisma.msgConversation.count()).toBe(1);
    expect(await prisma.msgParticipant.count()).toBe(2);
    expect(
      await prisma.auditLog.count({
        where: { action: "messaging.conversation.started" },
      }),
    ).toBe(1);
    expect(
      await prisma.eventOutbox.count({
        where: { name: "messaging.ConversationStarted" },
      }),
    ).toBe(1);
  });

  it("settles simultaneous first contact on a single conversation", async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        index % 2 === 0
          ? openDirectConversation(alice, { userId: bob.id })
          : openDirectConversation(bob, { userId: alice.id }),
      ),
    );
    expect(new Set(results.map((result) => result.conversationId)).size).toBe(1);
    expect(await testPrisma().msgConversation.count()).toBe(1);
  });

  it("refuses conversations with oneself, inactive or unknown people, or people without Messages", async () => {
    await expect(
      openDirectConversation(alice, { userId: alice.id }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(
      openDirectConversation(alice, { userId: inactive.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      openDirectConversation(alice, { userId: crypto.randomUUID() }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      openDirectConversation(alice, { userId: noAccess.id }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(
      openDirectConversation(alice, { userId: "not-a-uuid" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await testPrisma().msgConversation.count()).toBe(0);
  });

  it("refuses every operation to someone without the messaging permissions", async () => {
    const conversationId = await directBetween(alice, bob);
    await expect(
      openDirectConversation(noAccess, { userId: bob.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(searchPeople(noAccess, { query: "bob" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(listConversations(noAccess)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      sendMessage(noAccess, text(conversationId, "hi")),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  /* ------------------------------------------------------------------------ */
  /* Search                                                                   */
  /* ------------------------------------------------------------------------ */

  it("searches colleagues by name or email, never returning oneself or inactive accounts", async () => {
    const byName = await searchPeople(alice, { query: "bob" });
    expect(byName.map((person) => person.id)).toEqual([bob.id]);

    const byEmail = await searchPeople(alice, { query: "example.com" });
    const ids = byEmail.map((person) => person.id);
    expect(ids).toContain(bob.id);
    expect(ids).toContain(carol.id);
    expect(ids).not.toContain(alice.id);
    expect(ids).not.toContain(inactive.id);

    expect(await searchPeople(alice, { query: "carol nobody" })).toEqual([]);
    expect(
      (await searchPeople(alice, { query: "carol example" })).map((p) => p.id),
    ).toEqual([carol.id]);
    await expect(searchPeople(alice, { query: "   " })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  /* ------------------------------------------------------------------------ */
  /* Participation                                                            */
  /* ------------------------------------------------------------------------ */

  it("hides a conversation completely from anyone who is not in it", async () => {
    const conversationId = await directBetween(alice, bob);
    const sent = await sendMessage(alice, text(conversationId, "private"));

    expect(await listConversations(carol)).toEqual([]);
    await expect(getConversation(carol, conversationId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(listMessages(carol, { conversationId })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      sendMessage(carol, text(conversationId, "let me in")),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      markRead(carol, { conversationId, messageId: sent.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  /* ------------------------------------------------------------------------ */
  /* History                                                                  */
  /* ------------------------------------------------------------------------ */

  it("loads the newest 50 messages first and older pages on demand", async () => {
    const conversationId = await directBetween(alice, bob);
    for (let index = 1; index <= 60; index += 1) {
      await sendMessage(index % 2 === 0 ? alice : bob, text(conversationId, `#${index}`));
    }

    const latest = await listMessages(bob, { conversationId });
    expect(latest.messages).toHaveLength(50);
    expect(latest.hasOlder).toBe(true);
    expect(latest.messages[0]?.content).toBe("#11");
    expect(latest.messages[49]?.content).toBe("#60");

    const older = await listMessages(bob, {
      conversationId,
      before: latest.messages[0]?.id,
    });
    expect(older.messages.map((m) => m.content)).toEqual(
      Array.from({ length: 10 }, (_, index) => `#${index + 1}`),
    );
    expect(older.hasOlder).toBe(false);

    const newer = await listMessages(bob, {
      conversationId,
      after: latest.messages[47]?.id,
    });
    expect(newer.messages.map((m) => m.content)).toEqual(["#59", "#60"]);
  });

  it("keeps every message, in one agreed order, when both people send at once", async () => {
    const conversationId = await directBetween(alice, bob);
    const sends = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        sendMessage(
          index % 2 === 0 ? alice : bob,
          text(conversationId, `burst ${index}`),
        ),
      ),
    );

    const page = await listMessages(alice, { conversationId });
    expect(page.messages).toHaveLength(12);
    expect(new Set(page.messages.map((m) => m.id))).toEqual(
      new Set(sends.map((m) => m.id)),
    );

    const fromBob = await listMessages(bob, { conversationId });
    expect(fromBob.messages.map((m) => m.id)).toEqual(page.messages.map((m) => m.id));
  });

  it("treats a retried send as the same message", async () => {
    const conversationId = await directBetween(alice, bob);
    const input = text(conversationId, "only once");

    const first = await sendMessage(alice, input);
    const retry = await sendMessage(alice, input);

    expect(retry).toEqual(first);
    expect(await testPrisma().msgMessage.count()).toBe(1);
  });

  it("rejects empty and oversized messages", async () => {
    const conversationId = await directBetween(alice, bob);
    await expect(sendMessage(alice, text(conversationId, "   "))).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      sendMessage(alice, text(conversationId, "x".repeat(4001))),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  /* ------------------------------------------------------------------------ */
  /* Unread, delivered, read                                                  */
  /* ------------------------------------------------------------------------ */

  it("counts unread messages and moves receipts from sent to delivered to read", async () => {
    const conversationId = await directBetween(alice, bob);
    const messages = [];
    for (const content of ["one", "two", "three"]) {
      messages.push(await sendMessage(alice, text(conversationId, content)));
    }
    const last = messages[2];
    if (last === undefined) throw new Error("fixture");

    const statusFor = async () => {
      const view = await getConversation(alice, conversationId);
      return messageStatus(last, alice.id, view.receipts);
    };

    expect(await statusFor()).toBe("sent");
    expect((await listConversations(bob))[0]?.unreadCount).toBe(3);
    expect((await listConversations(alice))[0]?.unreadCount).toBe(0);

    // Bob's application loads: everything waiting is now delivered.
    expect(await getInboxSummary(bob)).toEqual({ unreadTotal: 3 });
    expect(await statusFor()).toBe("delivered");

    await markRead(bob, { conversationId, messageId: messages[0]?.id });
    expect((await getInboxSummary(bob)).unreadTotal).toBe(2);
    expect(await statusFor()).toBe("delivered");

    await markRead(bob, { conversationId, messageId: last.id });
    expect((await getInboxSummary(bob)).unreadTotal).toBe(0);
    expect(await statusFor()).toBe("read");

    // Reading an older message again never moves the watermark back.
    await markRead(bob, { conversationId, messageId: messages[0]?.id });
    expect(await statusFor()).toBe("read");
  });

  it("marks everything before a reply as read", async () => {
    const conversationId = await directBetween(alice, bob);
    await sendMessage(alice, text(conversationId, "question?"));
    await sendMessage(bob, text(conversationId, "answer"));

    expect((await getInboxSummary(bob)).unreadTotal).toBe(0);
    expect((await getInboxSummary(alice)).unreadTotal).toBe(1);
  });

  it("lists conversations newest first with a preview of the last message", async () => {
    const withBob = await directBetween(alice, bob);
    const withCarol = await directBetween(alice, carol);
    await sendMessage(bob, text(withBob, "older"));
    await sendMessage(carol, text(withCarol, "  newest\n message  "));

    const inbox = await listConversations(alice);
    expect(inbox.map((c) => c.id)).toEqual([withCarol, withBob]);
    expect(inbox[0]?.counterpart.id).toBe(carol.id);
    expect(inbox[0]?.lastMessage?.preview).toBe("newest message");
  });

  /* ------------------------------------------------------------------------ */
  /* Deactivated accounts                                                     */
  /* ------------------------------------------------------------------------ */

  it("keeps history but stops new messages when a participant is deactivated", async () => {
    const conversationId = await directBetween(alice, bob);
    await sendMessage(bob, text(conversationId, "before I left"));
    await testPrisma().user.update({ where: { id: bob.id }, data: { isActive: false } });

    const view = await getConversation(alice, conversationId);
    expect(view.canSend).toBe(false);
    expect(view.counterpart.isActive).toBe(false);
    expect((await listMessages(alice, { conversationId })).messages).toHaveLength(1);

    await expect(
      sendMessage(alice, text(conversationId, "are you there?")),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(listConversations(bob)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await testPrisma().msgMessage.count()).toBe(1);
  });

  /* ------------------------------------------------------------------------ */
  /* Last seen                                                                */
  /* ------------------------------------------------------------------------ */

  it("records last seen at most once a minute", async () => {
    await recordLastSeen(alice);
    const first = await testPrisma().msgPresence.findUniqueOrThrow({
      where: { userId: alice.id },
    });
    await recordLastSeen(alice);
    const second = await testPrisma().msgPresence.findUniqueOrThrow({
      where: { userId: alice.id },
    });
    expect(second.lastSeenAt).toEqual(first.lastSeenAt);
  });

  /* ------------------------------------------------------------------------ */
  /* Controls in the database itself                                          */
  /* ------------------------------------------------------------------------ */

  it("rejects, even from the application's own connection, a message by a non-participant", async () => {
    const conversationId = await directBetween(alice, bob);
    await expect(
      testPrisma().msgMessage.create({
        data: { conversationId, senderId: carol.id, type: "TEXT", content: "sneaky" },
      }),
    ).rejects.toThrow(/not an active participant/);
  });

  it("refuses to attach a document until ECM can vouch for the sharer's access", async () => {
    const conversationId = await directBetween(alice, bob);
    const message = await sendMessage(alice, text(conversationId, "see attached"));
    const attach = (prisma: Pick<PrismaClient, "msgAttachment">) =>
      prisma.msgAttachment.create({
        data: {
          messageId: message.id,
          conversationId,
          ecmDocumentId: crypto.randomUUID(),
          attachedBy: alice.id,
        },
      });

    // No ECM contract function exists: sharing is impossible, not unchecked.
    await expect(attach(testPrisma())).rejects.toThrow(/may not read the document/);
  });

  it("asks ECM, with the sharer's identity, before accepting an attachment", async () => {
    const conversationId = await directBetween(alice, bob);
    const message = await sendMessage(alice, text(conversationId, "see attached"));
    const readable = crypto.randomUUID();
    const unreadable = crypto.randomUUID();

    const outcome = await inRolledBackTransaction(async (tx) => {
      // A stand-in for the contract function ECM will publish: alice may read one
      // document and nothing else.
      await tx.$executeRawUnsafe(`CREATE SCHEMA ecm`);
      await tx.$executeRawUnsafe(`
        CREATE FUNCTION ecm.user_can_read_document(p_user uuid, p_document uuid)
        RETURNS boolean LANGUAGE sql STABLE
        AS $$ SELECT p_user = '${alice.id}'::uuid AND p_document = '${readable}'::uuid $$`);

      const attach = (documentId: string, attachedBy: string) =>
        tx.$executeRawUnsafe(
          `INSERT INTO messaging.message_attachments (message_id, conversation_id, ecm_document_id, attached_by)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)`,
          message.id,
          conversationId,
          documentId,
          attachedBy,
        );

      await attach(readable, alice.id);
      const results: string[] = ["readable: accepted"];
      for (const [label, documentId, sharer] of [
        ["unreadable", unreadable, alice.id],
        ["someone else's message", readable, bob.id],
      ] as const) {
        await tx.$executeRawUnsafe(`SAVEPOINT attempt`);
        try {
          await attach(documentId, sharer);
          results.push(`${label}: accepted`);
        } catch {
          results.push(`${label}: rejected`);
          await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT attempt`);
        }
      }

      await tx.$executeRawUnsafe(`SAVEPOINT attempt`);
      try {
        await tx.$executeRawUnsafe(
          `UPDATE messaging.message_attachments SET ecm_document_id = $1::uuid`,
          unreadable,
        );
        results.push("re-point: accepted");
      } catch {
        results.push("re-point: rejected");
        await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT attempt`);
      }
      return results;
    });

    expect(outcome).toEqual([
      "readable: accepted",
      "unreadable: rejected",
      "someone else's message: rejected",
      "re-point: rejected",
    ]);
  });

  it("row-level security shows a client role only its own conversations", async () => {
    const aliceBob = await directBetween(alice, bob);
    const aliceCarol = await directBetween(alice, carol);
    await sendMessage(alice, text(aliceBob, "for bob"));
    await sendMessage(alice, text(aliceCarol, "for carol"));

    const asBob = await asClientRole(bob.id, async (tx) => ({
      conversations: await tx.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM messaging.conversations`,
      ),
      messages: await tx.$queryRawUnsafe<{ content: string }[]>(
        `SELECT content FROM messaging.messages`,
      ),
      participants: await tx.$queryRawUnsafe<{ user_id: string }[]>(
        `SELECT user_id FROM messaging.conversation_participants`,
      ),
    }));
    expect(asBob.conversations.map((row) => row.id)).toEqual([aliceBob]);
    expect(asBob.messages.map((row) => row.content)).toEqual(["for bob"]);
    expect(asBob.participants.map((row) => row.user_id).sort()).toEqual(
      [alice.id, bob.id].sort(),
    );

    const anonymous = await asClientRole(null, (tx) =>
      tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM messaging.messages`),
    );
    expect(anonymous).toEqual([]);
  });

  it("row-level security lets a client role send only as itself, only where it belongs", async () => {
    const aliceBob = await directBetween(alice, bob);
    const aliceCarol = await directBetween(alice, carol);
    const insert = (conversationId: string, senderId: string) => (tx: Transaction) =>
      tx.$executeRawUnsafe(
        `INSERT INTO messaging.messages (conversation_id, sender_id, message_type, content)
         VALUES ($1::uuid, $2::uuid, 'TEXT', 'hello')`,
        conversationId,
        senderId,
      );
    const attempt = async (userId: string, work: (tx: Transaction) => Promise<unknown>) =>
      asClientRole(userId, async (tx) => {
        try {
          await work(tx);
          return "accepted";
        } catch {
          return "rejected";
        }
      });

    expect(await attempt(bob.id, insert(aliceBob, bob.id))).toBe("accepted");
    expect(await attempt(bob.id, insert(aliceBob, alice.id))).toBe("rejected");
    expect(await attempt(bob.id, insert(aliceCarol, bob.id))).toBe("rejected");
    expect(
      await attempt(bob.id, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO messaging.messages (conversation_id, sender_id, message_type, content)
           VALUES ($1::uuid, NULL, 'SYSTEM', 'forged system notice')`,
          aliceBob,
        ),
      ),
    ).toBe("rejected");
  });
});

type Transaction = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

const ROLLBACK = Symbol("rollback");

/** Runs `work` in a transaction that is always rolled back, returning its result. */
async function inRolledBackTransaction<T>(
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  let result: T | undefined;
  try {
    await testPrisma().$transaction(async (tx) => {
      result = await work(tx);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
  return result as T;
}

/**
 * Runs `work` as a non-owning database role carrying a Supabase-style JWT for
 * `userId`, so row-level security applies exactly as it would to a client. The
 * role and its grants exist only inside a rolled-back transaction.
 */
async function asClientRole<T>(
  userId: string | null,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return inRolledBackTransaction(async (tx) => {
    await tx.$executeRawUnsafe(`CREATE ROLE messaging_rls_probe NOLOGIN`);
    await tx.$executeRawUnsafe(`GRANT USAGE ON SCHEMA messaging TO messaging_rls_probe`);
    await tx.$executeRawUnsafe(
      `GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA messaging TO messaging_rls_probe`,
    );
    await tx.$executeRawUnsafe(
      `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA messaging TO messaging_rls_probe`,
    );
    if (userId !== null) {
      await tx.$executeRawUnsafe(
        `SELECT set_config('request.jwt.claims', $1, true)`,
        JSON.stringify({ sub: userId, role: "authenticated" }),
      );
    }
    await tx.$executeRawUnsafe(`SET LOCAL ROLE messaging_rls_probe`);
    return work(tx);
  });
}
