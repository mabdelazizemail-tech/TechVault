import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BusinessRuleError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import {
  CRM_PERMISSIONS,
  CRM_SALES_PERMISSIONS,
} from "@/modules/crm/contracts/permissions";
import {
  attachOpportunityFiles,
  convertLead,
  createLead,
  deleteOpportunity,
  getOpportunityAttachmentLink,
  listOpportunityAttachments,
  prepareOpportunityAttachment,
  removeOpportunityAttachment,
} from "@/modules/crm/contracts/service";
import {
  createRole,
  createUser,
  grantRole,
  hasTestDatabase,
  resetDatabase,
  seedPermissions,
  seedStages,
  teardownDatabase,
  testPrisma,
} from "./helpers/db";

/**
 * Files attached to deals against a real database (ADR-039). Object storage is faked
 * by key, like real storage: what matters here is what the CRM decides.
 */
const objects = vi.hoisted(() => new Map<string, { size: number; head: Uint8Array }>());
const storage = vi.hoisted(() => ({
  isStorageConfigured: vi.fn(() => true),
  createUploadUrl: vi.fn(async (key: string) => ({
    url: `https://storage.test/up/${key}`,
  })),
  readObjectStart: vi.fn(async (key: string) => objects.get(key) ?? null),
  createDownloadUrl: vi.fn(async (key: string) => `https://storage.test/object/${key}`),
  removeObject: vi.fn(),
}));

vi.mock("@/platform/storage/storage", () => storage);

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

describe.skipIf(!hasTestDatabase)("CRM deal attachments (integration)", () => {
  type U = { id: string };
  let admin: U; // every CRM permission, deletes included
  let rep: U; // Sales: may edit deals, may not delete
  let rep2: U; // another salesperson
  let viewer: U; // may see deals only
  let ownRep: U; // Sales, but only for deals they own
  let outsider: U; // nothing in the CRM
  let deal: string;
  const as = (user: U) => ({ id: user.id });
  const db = () => testPrisma();

  afterAll(async () => {
    await teardownDatabase();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    objects.clear();
    storage.isStorageConfigured.mockReturnValue(true);
    await resetDatabase();
    await seedPermissions();
    await seedStages();
    const adminRole = await createRole("crm-admin", Object.values(CRM_PERMISSIONS));
    const salesRole = await createRole("sales", CRM_SALES_PERMISSIONS);
    const viewerRole = await createRole("viewer", [
      CRM_PERMISSIONS.ACCESS,
      CRM_PERMISSIONS.OPPORTUNITY_READ,
    ]);
    admin = await createUser({ email: "admin@example.com" });
    rep = await createUser({ email: "rep@example.com" });
    rep2 = await createUser({ email: "rep2@example.com" });
    viewer = await createUser({ email: "viewer@example.com" });
    ownRep = await createUser({ email: "own@example.com" });
    outsider = await createUser({ email: "outsider@example.com" });
    await grantRole(admin.id, adminRole.id);
    await grantRole(rep.id, salesRole.id);
    await grantRole(rep2.id, salesRole.id);
    await grantRole(viewer.id, viewerRole.id);
    await grantRole(ownRep.id, salesRole.id, { scopeType: "OWN" });

    const { leadId } = await createLead(as(admin), {
      info: {
        firstName: "John",
        lastName: "Smith",
        company: "Acme Corporation",
        jobTitle: "CEO",
        email: "john@acme.com",
        source: "REFERRAL",
        country: "Egypt",
      },
      qualification: {
        interest: "COA AI Document Extractor",
        budget: "6068290",
        timeline: "WITHIN_3_MONTHS",
        decisionMaker: "YES",
        score: "82",
        status: "QUALIFIED",
      },
      opportunity: null,
    });
    const converted = await convertLead(as(admin), {
      leadId,
      accountMode: "new",
      contactMode: "new",
      createOpportunity: true,
      opportunity: {
        name: "COA AI Document Extractor",
        amount: "6068290",
        closeDate: "2026-11-10",
        probability: "60",
      },
    });
    deal = converted.opportunityId ?? "";
  });

  function lastUploadKey(): string {
    const key = storage.createUploadUrl.mock.lastCall?.[0];
    if (key === undefined) throw new Error("No upload was prepared.");
    return key;
  }

  /** Prepares an upload and puts the given bytes in (faked) storage under its key. */
  async function upload(
    user: U,
    fileName: string,
    options: { head?: Uint8Array; size?: number; opportunityId?: string } = {},
  ): Promise<string> {
    const size = options.size ?? 2048;
    const prepared = await prepareOpportunityAttachment(
      as(user),
      options.opportunityId ?? deal,
      { fileName, sizeBytes: size },
    );
    objects.set(lastUploadKey(), { size, head: options.head ?? PDF });
    return prepared.attachmentId;
  }

  async function attach(user: U, ...files: string[]): Promise<string[]> {
    const ids: string[] = [];
    for (const name of files) ids.push(await upload(user, name));
    await attachOpportunityFiles(as(user), deal, { attachmentIds: ids });
    return ids;
  }

  describe("attaching", () => {
    it("attaches a checked file to the deal, listed with who attached it, audited", async () => {
      const [id] = await attach(rep, "Signed contract.pdf");
      const list = await listOpportunityAttachments(as(viewer), deal);
      expect(list.canAdd).toBe(false);
      expect(list.items).toEqual([
        expect.objectContaining({
          id,
          fileName: "Signed contract.pdf",
          contentType: "application/pdf",
          sizeBytes: 2048,
          uploadedBy: { id: rep.id, name: "rep" },
          preview: true,
          canRemove: false,
        }),
      ]);
      expect((await listOpportunityAttachments(as(rep), deal)).items[0]?.canRemove).toBe(
        true,
      );
      const row = await db().crmOpportunityAttachment.findUniqueOrThrow({
        where: { id },
        select: { status: true, attachedAt: true, storageKey: true },
      });
      expect(row.status).toBe("READY");
      expect(row.attachedAt).not.toBeNull();
      expect(row.storageKey).toMatch(
        /^crm\/opportunities\/\d{4}\/\d{2}\/[0-9a-f]{32}\.pdf$/,
      );
      expect(
        await db().auditLog.count({
          where: { action: "crm.opportunity.attachments_added" },
        }),
      ).toBe(1);
      expect(
        await db().eventOutbox.count({
          where: { name: "crm.OpportunityAttachmentsAdded" },
        }),
      ).toBe(1);
    });

    it("attaches several files at once, or none if any fails its check", async () => {
      const good = await upload(rep, "PO.pdf");
      const bad = await upload(rep, "Pricing.xlsx", { head: JPEG });
      await expect(
        attachOpportunityFiles(as(rep), deal, { attachmentIds: [good, bad] }),
      ).rejects.toThrow(/Pricing\.xlsx/);
      expect((await listOpportunityAttachments(as(rep), deal)).items).toEqual([]);

      const fixed = await upload(rep, "Pricing.xlsx", { head: ZIP });
      await attachOpportunityFiles(as(rep), deal, { attachmentIds: [good, fixed] });
      expect(
        (await listOpportunityAttachments(as(rep), deal)).items.map(
          (file) => file.fileName,
        ),
      ).toEqual(expect.arrayContaining(["PO.pdf", "Pricing.xlsx"]));
    });

    it("refuses other file types, oversize files, size mismatches and missing uploads", async () => {
      await expect(
        prepareOpportunityAttachment(as(rep), deal, {
          fileName: "tool.exe",
          sizeBytes: 10,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        prepareOpportunityAttachment(as(rep), deal, {
          fileName: "huge.pdf",
          sizeBytes: 26 * 1024 * 1024,
        }),
      ).rejects.toBeInstanceOf(ValidationError);

      const prepared = await prepareOpportunityAttachment(as(rep), deal, {
        fileName: "contract.pdf",
        sizeBytes: 5000,
      });
      objects.set(lastUploadKey(), { size: 9999, head: PDF });
      await expect(
        attachOpportunityFiles(as(rep), deal, { attachmentIds: [prepared.attachmentId] }),
      ).rejects.toThrow(/does not match/);

      const lost = await prepareOpportunityAttachment(as(rep), deal, {
        fileName: "lost.pdf",
        sizeBytes: 100,
      });
      await expect(
        attachOpportunityFiles(as(rep), deal, { attachmentIds: [lost.attachmentId] }),
      ).rejects.toThrow(/did not finish uploading/);
    });

    it("never attaches someone else's upload, or an upload twice", async () => {
      const mine = await upload(rep, "contract.pdf");
      await expect(
        attachOpportunityFiles(as(rep2), deal, { attachmentIds: [mine] }),
      ).rejects.toBeInstanceOf(ValidationError);
      await attachOpportunityFiles(as(rep), deal, { attachmentIds: [mine] });
      await expect(
        attachOpportunityFiles(as(rep), deal, { attachmentIds: [mine] }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("needs the right to edit the deal; a deal you cannot see is not found", async () => {
      await expect(
        prepareOpportunityAttachment(as(viewer), deal, {
          fileName: "a.pdf",
          sizeBytes: 10,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        prepareOpportunityAttachment(as(outsider), deal, {
          fileName: "a.pdf",
          sizeBytes: 10,
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
      // The deal is the administrator's, so a salesperson limited to their own deals cannot see it.
      await expect(
        prepareOpportunityAttachment(as(ownRep), deal, {
          fileName: "a.pdf",
          sizeBytes: 10,
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(listOpportunityAttachments(as(ownRep), deal)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it("is refused, clearly, when the server has no storage", async () => {
      storage.isStorageConfigured.mockReturnValue(false);
      await expect(
        prepareOpportunityAttachment(as(rep), deal, { fileName: "a.pdf", sizeBytes: 10 }),
      ).rejects.toBeInstanceOf(BusinessRuleError);
      expect((await listOpportunityAttachments(as(rep), deal)).storageAvailable).toBe(
        false,
      );
    });
  });

  describe("opening", () => {
    it("needs only the right to see the deal, expires within minutes, and is audited", async () => {
      const [pdf, sheet] = await attach(rep, "contract.pdf", "notes.txt");
      expect(await getOpportunityAttachmentLink(as(viewer), deal, pdf ?? "")).toMatch(
        /^https:\/\/storage\.test\/object\/crm\/opportunities\//,
      );
      expect(storage.createDownloadUrl).toHaveBeenLastCalledWith(expect.any(String), {
        downloadAs: null,
        expiresInSeconds: 300,
      });
      await getOpportunityAttachmentLink(as(viewer), deal, sheet ?? "");
      expect(storage.createDownloadUrl).toHaveBeenLastCalledWith(expect.any(String), {
        downloadAs: "notes.txt",
        expiresInSeconds: 60,
      });
      expect(
        await db().auditLog.count({
          where: { action: "crm.opportunity.attachment_opened" },
        }),
      ).toBe(2);
      await expect(
        getOpportunityAttachmentLink(as(outsider), deal, pdf ?? ""),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("stops when the deal is deleted", async () => {
      const [pdf] = await attach(rep, "contract.pdf");
      await deleteOpportunity(as(admin), deal);
      await expect(listOpportunityAttachments(as(admin), deal)).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await expect(
        getOpportunityAttachmentLink(as(admin), deal, pdf ?? ""),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("removing", () => {
    it("lets the uploader or an administrator remove a file, and nobody else", async () => {
      const [first, second] = await attach(rep, "draft.pdf", "old-quote.pdf");
      await expect(
        removeOpportunityAttachment(as(rep2), deal, first ?? ""),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        removeOpportunityAttachment(as(viewer), deal, first ?? ""),
      ).rejects.toBeInstanceOf(ForbiddenError);

      await removeOpportunityAttachment(as(rep), deal, first ?? "");
      await removeOpportunityAttachment(as(admin), deal, second ?? "");
      expect((await listOpportunityAttachments(as(rep), deal)).items).toEqual([]);
      await expect(
        getOpportunityAttachmentLink(as(rep), deal, first ?? ""),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        removeOpportunityAttachment(as(rep), deal, first ?? ""),
      ).rejects.toBeInstanceOf(NotFoundError);

      const removed = await db().crmOpportunityAttachment.findUniqueOrThrow({
        where: { id: first ?? "" },
        select: { deletedBy: true, deletedAt: true },
      });
      expect(removed.deletedBy).toBe(rep.id);
      const audits = await db().auditLog.findMany({
        where: { action: "crm.opportunity.attachment_removed" },
        select: { severity: true },
      });
      expect(audits.map((audit) => audit.severity)).toEqual(["WARNING", "WARNING"]);
      expect(
        await db().eventOutbox.count({
          where: { name: "crm.OpportunityAttachmentRemoved" },
        }),
      ).toBe(2);
    });
  });

  describe("database invariants", () => {
    it("keeps a file's identity, attaches once, and never deletes an attached file", async () => {
      const [id] = await attach(rep, "contract.pdf");
      await expect(
        db().$executeRaw`
          UPDATE crm.opportunity_attachments SET file_name = 'other.pdf' WHERE id = ${id}::uuid`,
      ).rejects.toThrow(/cannot be changed/);
      await expect(
        db().$executeRaw`
          UPDATE crm.opportunity_attachments
             SET status = 'PENDING', attached_at = NULL WHERE id = ${id}::uuid`,
      ).rejects.toThrow(/stays attached/);
      await expect(
        db().$executeRaw`DELETE FROM crm.opportunity_attachments WHERE id = ${id}::uuid`,
      ).rejects.toThrow(/never deleted/);

      await removeOpportunityAttachment(as(rep), deal, id ?? "");
      await expect(
        db().$executeRaw`
          UPDATE crm.opportunity_attachments
             SET deleted_at = NULL, deleted_by = NULL WHERE id = ${id}::uuid`,
      ).rejects.toThrow(/cannot change/);
    });

    it("records attaching and removal consistently, and lets an abandoned upload go", async () => {
      const pending = await upload(rep, "abandoned.pdf");
      await expect(
        db().$executeRaw`
          UPDATE crm.opportunity_attachments SET status = 'READY' WHERE id = ${pending}::uuid`,
      ).rejects.toThrow(/opportunity_attachments_attached_recorded/);
      await expect(
        db().$executeRaw`
          UPDATE crm.opportunity_attachments
             SET deleted_at = now(), deleted_by = ${rep.id}::uuid WHERE id = ${pending}::uuid`,
      ).rejects.toThrow(/opportunity_attachments_removed_when_attached/);
      await db()
        .$executeRaw`DELETE FROM crm.opportunity_attachments WHERE id = ${pending}::uuid`;
      expect(await db().crmOpportunityAttachment.count()).toBe(0);
    });

    it("has row-level security on", async () => {
      const [table] = await db().$queryRaw<{ relrowsecurity: boolean }[]>`
        SELECT c.relrowsecurity FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'crm' AND c.relname = 'opportunity_attachments'`;
      expect(table?.relrowsecurity).toBe(true);
    });
  });
});
