import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import {
  INNOVATION_ADMIN_PERMISSIONS,
  INNOVATION_MEMBER_PERMISSIONS,
} from "@/modules/innovation/contracts/permissions";
import {
  addComment,
  askThinkTank,
  convertIdeaToProject,
  createCategory,
  createIdea,
  createKnowledgeItem,
  createProject,
  deleteComment,
  deleteKnowledgeItem,
  getFileLink,
  getIdea,
  getOverview,
  getProject,
  listIdeas,
  listKnowledge,
  listProjects,
  listTopVotedIdeas,
  prepareUpload,
  toggleVote,
  updateIdea,
  updateProject,
} from "@/modules/innovation/contracts/service";
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
 * THE THINK TANK against a real database. Object storage is faked: the tests have
 * no storage key, and what matters here is what the services decide, not the
 * vendor's HTTP API.
 */
const storage = vi.hoisted(() => ({
  isStorageConfigured: vi.fn(() => true),
  createUploadUrl: vi.fn(async (key: string) => ({
    url: `https://storage.test/upload/${key}`,
  })),
  readObjectStart: vi.fn(),
  createDownloadUrl: vi.fn(async (key: string) => `https://storage.test/object/${key}`),
  removeObject: vi.fn(),
}));

vi.mock("@/platform/storage/storage", () => storage);

const PDF_HEAD = new TextEncoder().encode("%PDF-1.7\n%âãÏÓ");

describe.skipIf(!hasTestDatabase)("THE THINK TANK (integration)", () => {
  let alice: { id: string };
  let bob: { id: string };
  let admin: { id: string };
  let outsider: { id: string };
  let technology: string;
  let sops: string;
  let lessons: string;

  const as = (user: { id: string }) => ({ id: user.id });

  afterAll(async () => {
    await teardownDatabase();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    storage.isStorageConfigured.mockReturnValue(true);
    await resetDatabase();
    await seedPermissions();

    const member = await createRole("member", INNOVATION_MEMBER_PERMISSIONS);
    const adminRole = await createRole("think-tank-admin", INNOVATION_ADMIN_PERMISSIONS);
    alice = await createUser({ email: "alice@example.com" });
    bob = await createUser({ email: "bob@example.com" });
    admin = await createUser({ email: "admin@example.com" });
    outsider = await createUser({ email: "outsider@example.com" });
    await grantRole(alice.id, member.id);
    await grantRole(bob.id, member.id);
    await grantRole(admin.id, adminRole.id);

    const prisma = testPrisma();
    technology = (
      await prisma.innovationCategory.create({
        data: { kind: "IDEA", name: "Technology" },
      })
    ).id;
    sops = (
      await prisma.innovationCategory.create({
        data: { kind: "KNOWLEDGE", name: "SOPs" },
      })
    ).id;
    lessons = (
      await prisma.innovationCategory.create({
        data: { kind: "KNOWLEDGE", name: "Lessons Learned" },
      })
    ).id;
  });

  const idea = (overrides: Record<string, unknown> = {}) => ({
    title: "Automate invoice OCR",
    description: "Scan supplier invoices and extract the totals automatically.",
    categoryId: technology,
    ...overrides,
  });

  /** Walks a file through prepare → (faked) upload, returning its id. */
  async function uploadPdf(user: { id: string }, head: Uint8Array = PDF_HEAD) {
    const prepared = await prepareUpload(as(user), {
      fileName: "OCR Deployment Guide.pdf",
      sizeBytes: 2048,
    });
    storage.readObjectStart.mockResolvedValueOnce({ size: 2048, head });
    return prepared.fileId;
  }

  /* ------------------------------------------------------------------------ */
  /* Ideas                                                                    */
  /* ------------------------------------------------------------------------ */

  describe("ideas", () => {
    it("lets a member submit an idea that everyone can find by part of a word", async () => {
      const { id } = await createIdea(as(alice), idea());

      const found = await listIdeas(as(bob), { q: "automat invo" });
      expect(found.rows.map((row) => row.id)).toEqual([id]);
      expect(found.rows[0]?.status).toBe("NEW");
      expect(found.rows[0]?.submitter.id).toBe(alice.id);
      expect((await listIdeas(as(bob), { q: "blockchain" })).total).toBe(0);

      const prisma = testPrisma();
      expect(
        await prisma.auditLog.count({ where: { action: "innovation.idea.submitted" } }),
      ).toBe(1);
      expect(
        await prisma.eventOutbox.count({ where: { name: "innovation.IdeaSubmitted" } }),
      ).toBe(1);
    });

    it("filters by status and category and sorts by newest, votes and comments", async () => {
      const first = await createIdea(as(alice), idea({ title: "Paperless onboarding" }));
      const second = await createIdea(as(bob), idea({ title: "Shared glossary" }));
      const third = await createIdea(as(bob), idea({ title: "Quiet Fridays" }));
      await toggleVote(as(alice), second.id);
      await addComment(as(alice), first.id, { body: "Yes please" });
      await addComment(as(bob), first.id, { body: "Agreed" });

      const newest = await listIdeas(as(admin), {});
      expect(newest.rows.map((row) => row.id)).toEqual([third.id, second.id, first.id]);
      const voted = await listIdeas(as(admin), { sort: "top" });
      expect(voted.rows[0]?.id).toBe(second.id);
      const commented = await listIdeas(as(admin), { sort: "comments" });
      expect(commented.rows[0]?.id).toBe(first.id);
      expect(commented.rows[0]?.commentCount).toBe(2);

      expect((await listIdeas(as(admin), { status: "APPROVED" })).total).toBe(0);
      expect((await listIdeas(as(admin), { category: technology })).total).toBe(3);
    });

    it("keeps the vote count in the database and refuses a second vote by the same person", async () => {
      const { id } = await createIdea(as(alice), idea());
      const prisma = testPrisma();

      // Written straight to the table, bypassing the service: the trigger still counts it.
      await prisma.innovationIdeaVote.create({ data: { ideaId: id, userId: bob.id } });
      expect(
        (await prisma.innovationIdea.findUniqueOrThrow({ where: { id } })).voteCount,
      ).toBe(1);

      await expect(
        prisma.innovationIdeaVote.create({ data: { ideaId: id, userId: bob.id } }),
      ).rejects.toThrow();

      await prisma.innovationIdeaVote.delete({
        where: { ideaId_userId: { ideaId: id, userId: bob.id } },
      });
      expect(
        (await prisma.innovationIdea.findUniqueOrThrow({ where: { id } })).voteCount,
      ).toBe(0);
    });

    it("shows administrators the top voted ideas, and nobody else", async () => {
      const liked = await createIdea(as(alice), idea({ title: "Liked" }));
      await createIdea(as(alice), idea({ title: "Unvoted" }));
      await toggleVote(as(bob), liked.id);
      await toggleVote(as(admin), liked.id);

      const top = await listTopVotedIdeas(as(admin));
      expect(top.map((row) => [row.title, row.voteCount])).toEqual([["Liked", 2]]);
      await expect(listTopVotedIdeas(as(bob))).rejects.toThrow(ForbiddenError);
    });

    it("row-level security lets a client role add and remove only its own votes", async () => {
      const { id } = await createIdea(as(alice), idea());
      await toggleVote(as(admin), id);

      const outcome = await asClientRole(bob.id, async (tx) => {
        const results: string[] = [];
        const attempt = async (label: string, sql: string, ...values: unknown[]) => {
          await tx.$executeRawUnsafe("SAVEPOINT attempt");
          try {
            const affected = await tx.$executeRawUnsafe(sql, ...values);
            results.push(`${label}: ${affected} row(s)`);
          } catch {
            await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT attempt");
            results.push(`${label}: rejected`);
          }
        };

        const visible = await tx.$queryRawUnsafe<{ n: number }[]>(
          "SELECT count(*)::int AS n FROM innovation.idea_votes",
        );
        results.push(`visible votes: ${visible[0]?.n}`);
        await attempt(
          "add own",
          "INSERT INTO innovation.idea_votes (idea_id, user_id) VALUES ($1::uuid, $2::uuid)",
          id,
          bob.id,
        );
        await attempt(
          "add as someone else",
          "INSERT INTO innovation.idea_votes (idea_id, user_id) VALUES ($1::uuid, $2::uuid)",
          id,
          alice.id,
        );
        await attempt(
          "remove someone else's",
          "DELETE FROM innovation.idea_votes WHERE idea_id = $1::uuid AND user_id = $2::uuid",
          id,
          admin.id,
        );
        await attempt(
          "remove own",
          "DELETE FROM innovation.idea_votes WHERE idea_id = $1::uuid AND user_id = $2::uuid",
          id,
          bob.id,
        );
        return results;
      });

      expect(outcome).toEqual([
        "visible votes: 1",
        "add own: 1 row(s)",
        "add as someone else: rejected",
        "remove someone else's: 0 row(s)",
        "remove own: 1 row(s)",
      ]);
      // Nothing the client role did survived its rolled-back transaction.
      expect((await getIdea(as(alice), id)).voteCount).toBe(1);
    });

    it("counts one vote per person, never your own, without marking the idea as edited", async () => {
      const { id } = await createIdea(as(alice), idea());
      const before = await testPrisma().innovationIdea.findUniqueOrThrow({
        where: { id },
      });

      expect(await toggleVote(as(bob), id)).toEqual({ voted: true, voteCount: 1 });
      expect((await getIdea(as(bob), id)).hasVoted).toBe(true);
      expect(await toggleVote(as(bob), id)).toEqual({ voted: false, voteCount: 0 });

      await expect(toggleVote(as(alice), id)).rejects.toThrow(BusinessRuleError);
      await expect(
        testPrisma().innovationIdeaVote.create({
          data: { ideaId: id, userId: alice.id },
        }),
      ).rejects.toThrow(/cannot vote for their own ideas/);

      const after = await testPrisma().innovationIdea.findUniqueOrThrow({
        where: { id },
      });
      expect(after.updatedAt).toEqual(before.updatedAt);
    });

    it("keeps the comment count in step, and lets people remove only their own comments", async () => {
      const { id } = await createIdea(as(alice), idea());
      const mine = await addComment(as(bob), id, { body: "We tried this in 2024." });
      const theirs = await addComment(as(alice), id, { body: "What went wrong?" });
      expect((await getIdea(as(alice), id)).commentCount).toBe(2);

      await expect(deleteComment(as(bob), theirs.id)).rejects.toThrow(ForbiddenError);
      await deleteComment(as(bob), mine.id);
      await deleteComment(as(admin), theirs.id);

      const detail = await getIdea(as(alice), id);
      expect(detail.commentCount).toBe(0);
      expect(detail.comments).toEqual([]);
    });

    it("reserves reviewing, editing and conversion for administrators", async () => {
      const { id } = await createIdea(as(alice), idea());
      const update = { ...idea(), status: "APPROVED", ownerId: bob.id };

      await expect(updateIdea(as(alice), id, update)).rejects.toThrow(ForbiddenError);
      await expect(convertIdeaToProject(as(alice), id)).rejects.toThrow(ForbiddenError);
      await expect(createIdea(as(outsider), idea())).rejects.toThrow(ForbiddenError);

      await updateIdea(as(admin), id, update);
      const reviewed = await getIdea(as(alice), id);
      expect(reviewed.status).toBe("APPROVED");
      expect(reviewed.owner?.id).toBe(bob.id);

      const audit = await testPrisma().auditLog.findFirstOrThrow({
        where: { action: "innovation.idea.updated", entityId: id },
      });
      expect(audit.changes).toMatchObject({
        status: { from: "NEW", to: "APPROVED" },
        ownerId: { from: null, to: bob.id },
      });
      expect(
        await testPrisma().eventOutbox.count({
          where: { name: "innovation.IdeaStageChanged" },
        }),
      ).toBe(1);
    });

    it("turns only an approved idea into exactly one project", async () => {
      const { id } = await createIdea(as(alice), idea());
      await expect(convertIdeaToProject(as(admin), id)).rejects.toThrow(
        BusinessRuleError,
      );

      await updateIdea(as(admin), id, { ...idea(), status: "APPROVED", ownerId: bob.id });
      const { projectId } = await convertIdeaToProject(as(admin), id);

      const project = await getProject(as(alice), projectId);
      expect(project.idea?.id).toBe(id);
      expect(project.owner?.id).toBe(bob.id);
      expect(project.members.map((member) => member.id)).toEqual([bob.id]);
      expect(project.status).toBe("PLANNING");

      const converted = await getIdea(as(alice), id);
      expect(converted.status).toBe("IN_PROGRESS");
      expect(converted.project?.id).toBe(projectId);
      await expect(convertIdeaToProject(as(admin), id)).rejects.toThrow(
        BusinessRuleError,
      );
    });

    it("refuses an archived category for a new idea", async () => {
      await testPrisma().innovationCategory.update({
        where: { id: technology },
        data: { isActive: false },
      });
      await expect(createIdea(as(alice), idea())).rejects.toThrow(ValidationError);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Files and knowledge                                                      */
  /* ------------------------------------------------------------------------ */

  describe("knowledge and files", () => {
    it("adds a document whose content was checked, and audits every download", async () => {
      const fileId = await uploadPdf(alice);
      const { id } = await createKnowledgeItem(as(alice), {
        title: "OCR Deployment Guide",
        categoryId: sops,
        tags: "OCR, deployment, ocr",
        fileId,
      });

      const [item] = (await listKnowledge(as(bob), { q: "deploy" })).rows;
      expect(item?.id).toBe(id);
      expect(item?.tags).toEqual(["ocr", "deployment"]);
      expect(item?.file?.fileName).toBe("OCR Deployment Guide.pdf");
      expect(item?.file?.preview).toBe("pdf");

      const link = await getFileLink(as(bob), fileId, "download");
      expect(link).toMatch(/^https:\/\/storage\.test\/object\/innovation\//);
      expect(storage.createDownloadUrl).toHaveBeenCalledWith(expect.any(String), {
        downloadAs: "OCR Deployment Guide.pdf",
        expiresInSeconds: 60,
      });
      expect(
        await testPrisma().auditLog.count({
          where: {
            action: "innovation.file.downloaded",
            entityId: fileId,
            actorId: bob.id,
          },
        }),
      ).toBe(1);

      await expect(getFileLink(as(outsider), fileId, "download")).rejects.toThrow(
        ForbiddenError,
      );
      await deleteKnowledgeItem(as(admin), id);
      await expect(getFileLink(as(bob), fileId, "download")).rejects.toThrow(
        NotFoundError,
      );
    });

    it("refuses a file whose bytes do not match its extension, and keeps it unused", async () => {
      const fileId = await uploadPdf(alice, new Uint8Array([0x4d, 0x5a, 0x90, 0x00]));
      await expect(
        createKnowledgeItem(as(alice), { title: "Guide", categoryId: sops, fileId }),
      ).rejects.toThrow(ValidationError);

      const file = await testPrisma().innovationFile.findUniqueOrThrow({
        where: { id: fileId },
      });
      expect(file.status).toBe("PENDING");
      expect(await testPrisma().innovationKnowledgeItem.count()).toBe(0);
    });

    it("refuses someone else's upload, a file that never arrived, and unaccepted types", async () => {
      const fileId = await uploadPdf(alice);
      await expect(
        createKnowledgeItem(as(bob), { title: "Borrowed", categoryId: sops, fileId }),
      ).rejects.toThrow(ValidationError);

      const missing = await prepareUpload(as(alice), {
        fileName: "a.pdf",
        sizeBytes: 10,
      });
      storage.readObjectStart.mockResolvedValueOnce(null);
      await expect(
        createKnowledgeItem(as(alice), {
          title: "Ghost",
          categoryId: sops,
          fileId: missing.fileId,
        }),
      ).rejects.toThrow(ValidationError);

      await expect(
        prepareUpload(as(alice), { fileName: "setup.exe", sizeBytes: 10 }),
      ).rejects.toThrow(ValidationError);
      await expect(
        prepareUpload(as(alice), { fileName: "huge.pdf", sizeBytes: 26 * 1024 * 1024 }),
      ).rejects.toThrow(ValidationError);
      await expect(
        prepareUpload(as(outsider), { fileName: "a.pdf", sizeBytes: 10 }),
      ).rejects.toThrow(ForbiddenError);

      storage.isStorageConfigured.mockReturnValue(false);
      await expect(
        prepareUpload(as(alice), { fileName: "a.pdf", sizeBytes: 10 }),
      ).rejects.toThrow(BusinessRuleError);
    });

    it("needs a file or a description, and finds items by tag", async () => {
      await expect(
        createKnowledgeItem(as(alice), { title: "Empty", categoryId: sops }),
      ).rejects.toThrow(ValidationError);

      await createKnowledgeItem(as(alice), {
        title: "Month-end checklist",
        description: "Steps to close the books.",
        categoryId: sops,
        tags: "finance",
      });
      expect((await listKnowledge(as(bob), { q: "financ" })).total).toBe(1);
      expect((await listKnowledge(as(bob), { category: lessons })).total).toBe(0);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Projects                                                                 */
  /* ------------------------------------------------------------------------ */

  describe("projects", () => {
    it("lets administrators run projects that everyone can read", async () => {
      await expect(
        createProject(as(alice), { name: "Banking OCR", status: "PLANNING" }),
      ).rejects.toThrow(ForbiddenError);

      const { id } = await createProject(as(admin), {
        name: "Banking OCR",
        description: "OCR for the banking client.",
        ownerId: alice.id,
        status: "IN_PROGRESS",
        memberIds: [bob.id],
      });
      await createKnowledgeItem(as(bob), {
        title: "Banking project lessons learned",
        description: "Low-resolution scans broke OCR; we added a pre-processing step.",
        categoryId: lessons,
        projectId: id,
      });

      const project = await getProject(as(bob), id);
      expect(project.members.map((member) => member.id).sort()).toEqual(
        [alice.id, bob.id].sort(),
      );
      expect(project.documents.map((doc) => doc.title)).toEqual([
        "Banking project lessons learned",
      ]);

      await updateProject(as(admin), id, {
        name: "Banking OCR",
        ownerId: alice.id,
        status: "COMPLETED",
        memberIds: [],
        lessonsLearned: "Pre-process scans before OCR.",
      });
      const done = await getProject(as(bob), id);
      expect(done.status).toBe("COMPLETED");
      expect(done.members.map((member) => member.id)).toEqual([alice.id]);
      expect((await listProjects(as(bob), { status: "COMPLETED" })).total).toBe(1);
      expect((await listProjects(as(bob), { q: "scans" })).total).toBe(1);
    });

    it("refuses an unknown or inactive person on the team", async () => {
      const gone = await createUser({ email: "gone@example.com", isActive: false });
      await expect(
        createProject(as(admin), { name: "X", status: "PLANNING", memberIds: [gone.id] }),
      ).rejects.toThrow(ValidationError);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Overview, assistant, categories                                          */
  /* ------------------------------------------------------------------------ */

  describe("overview, Ask Think Tank and categories", () => {
    it("shows counts, recent activity and the ideas gathering votes", async () => {
      const popular = await createIdea(as(alice), idea({ title: "Popular idea" }));
      await createIdea(as(alice), idea({ title: "Quiet idea" }));
      await toggleVote(as(bob), popular.id);
      await createKnowledgeItem(as(bob), {
        title: "What the migration taught us",
        description: "Test restores before cut-over.",
        categoryId: lessons,
      });

      const overview = await getOverview(as(bob));
      expect(overview.counts).toEqual({ ideas: 2, knowledge: 1, projects: 0 });
      expect(overview.trending.map((entry) => entry.title)).toEqual(["Popular idea"]);
      expect(overview.recent.map((entry) => entry.kind)).toContain("LESSON_NEW");
      await expect(getOverview(as(outsider))).rejects.toThrow(ForbiddenError);
    });

    it("points a question at the knowledge that answers it, never at deleted items", async () => {
      const guide = await createKnowledgeItem(as(alice), {
        title: "OCR Deployment Guide",
        description:
          "We solved the OCR accuracy problem by pre-processing low-resolution scans.",
        categoryId: sops,
      });
      const stale = await createKnowledgeItem(as(alice), {
        title: "Old OCR notes",
        description: "Outdated OCR problem notes.",
        categoryId: sops,
      });
      await deleteKnowledgeItem(as(admin), stale.id);

      const result = await askThinkTank(as(bob), {
        question: "How did we solve the OCR problem in our previous project?",
      });
      expect(result.engine).toBe("keyword");
      expect(result.answer).toBeNull();
      expect(result.sources.map((source) => source.id)).toEqual([guide.id]);
      expect(result.sources[0]?.href).toBe(`/innovation/knowledge/${guide.id}`);
      expect(result.sources[0]?.excerpt).toMatch(/OCR/);

      await expect(askThinkTank(as(outsider), { question: "OCR" })).rejects.toThrow(
        ForbiddenError,
      );
    });

    it("lets administrators add categories, refusing duplicates in any case", async () => {
      await expect(
        createCategory(as(alice), { kind: "IDEA", name: "Sustainability" }),
      ).rejects.toThrow(ForbiddenError);
      await createCategory(as(admin), { kind: "IDEA", name: "Sustainability" });
      await expect(
        createCategory(as(admin), { kind: "IDEA", name: "SUSTAINABILITY" }),
      ).rejects.toThrow(ConflictError);
      // The same name is fine for the other kind.
      await createCategory(as(admin), { kind: "KNOWLEDGE", name: "Sustainability" });
    });

    it("enables row-level security on every Think Tank table", async () => {
      const rows = await testPrisma().$queryRaw<{ tablename: string; rls: boolean }[]>`
        SELECT c.relname AS tablename, c.relrowsecurity AS rls
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'innovation' AND c.relkind = 'r'
      `;
      expect(rows.length).toBe(8);
      expect(rows.every((row) => row.rls)).toBe(true);
    });
  });
});

type Transaction = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

const ROLLBACK = Symbol("rollback");

/**
 * Runs `work` as a non-owning database role carrying a Supabase-style JWT for
 * `userId`, so row-level security applies as it would to a client. The role and
 * everything it does exist only inside a rolled-back transaction.
 */
async function asClientRole<T>(
  userId: string,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  let result: T | undefined;
  try {
    await testPrisma().$transaction(async (tx) => {
      await tx.$executeRawUnsafe("CREATE ROLE innovation_rls_probe NOLOGIN");
      await tx.$executeRawUnsafe(
        "GRANT USAGE ON SCHEMA innovation TO innovation_rls_probe",
      );
      await tx.$executeRawUnsafe(
        "GRANT SELECT, INSERT, DELETE ON innovation.idea_votes TO innovation_rls_probe",
      );
      await tx.$executeRawUnsafe(
        "GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA innovation TO innovation_rls_probe",
      );
      await tx.$executeRawUnsafe(
        "SELECT set_config('request.jwt.claims', $1, true)",
        JSON.stringify({ sub: userId, role: "authenticated" }),
      );
      await tx.$executeRawUnsafe("SET LOCAL ROLE innovation_rls_probe");
      result = await work(tx);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
  return result as T;
}
