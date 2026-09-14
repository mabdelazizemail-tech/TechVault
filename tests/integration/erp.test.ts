import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  ValidationError,
} from "@/lib/errors";
import {
  ERP_ACCOUNTANT_PERMISSIONS,
  ERP_FINANCE_ADMIN_PERMISSIONS,
  ERP_PERMISSIONS,
} from "@/modules/erp/contracts/permissions";
import {
  closePeriod,
  createAccount,
  createCostCentre,
  createJournal,
  createPeriod,
  deleteJournal,
  getAccount,
  getFinanceOverview,
  getJournal,
  listAccountActivity,
  listAccounts,
  listJournals,
  postJournal,
  reopenPeriod,
  reverseJournal,
  setAccountActive,
  updateAccount,
  updateCostCentre,
  updateJournal,
} from "@/modules/erp/contracts/service";
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
 * ERP finance against a real database (CLAUDE.md §20): the double-entry rules,
 * immutability of the ledger — through the services AND straight at the tables —
 * periods, reversal, atomicity, concurrency, and allowed/refused for every control.
 */

/** Awaits an operation that must fail and returns what it threw. */
async function failure(operation: Promise<unknown>): Promise<Error> {
  try {
    await operation;
  } catch (error) {
    return error as Error;
  }
  throw new Error("Expected the operation to fail, but it succeeded.");
}

const utc = (isoDate: string) => new Date(`${isoDate}T00:00:00.000Z`);

describe.skipIf(!hasTestDatabase)("ERP finance (integration)", () => {
  let prisma: PrismaClient;
  let admin: { id: string };
  let accountant: { id: string };
  let viewer: { id: string };
  let poster: { id: string };
  let closer: { id: string };
  let outsider: { id: string };

  let assets: string;
  let cash: string;
  let bank: string;
  let equipment: string;
  let capital: string;
  let centre: string;
  let september: string;

  const as = (user: { id: string }) => ({ id: user.id });

  afterAll(async () => {
    await teardownDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedPermissions();
    prisma = testPrisma();

    const adminRole = await createRole("finance-admin", ERP_FINANCE_ADMIN_PERMISSIONS);
    const accountantRole = await createRole("accountant", ERP_ACCOUNTANT_PERMISSIONS);
    const viewerRole = await createRole("finance-viewer", [
      ERP_PERMISSIONS.ACCESS,
      ERP_PERMISSIONS.ACCOUNT_READ,
      ERP_PERMISSIONS.COST_CENTRE_READ,
      ERP_PERMISSIONS.PERIOD_READ,
      ERP_PERMISSIONS.JOURNAL_READ,
    ]);
    const posterRole = await createRole("poster", [
      ERP_PERMISSIONS.ACCESS,
      ERP_PERMISSIONS.ACCOUNT_READ,
      ERP_PERMISSIONS.JOURNAL_READ,
      ERP_PERMISSIONS.JOURNAL_CREATE,
      ERP_PERMISSIONS.JOURNAL_POST,
    ]);
    const closerRole = await createRole("closer", [
      ERP_PERMISSIONS.ACCESS,
      ERP_PERMISSIONS.PERIOD_READ,
      ERP_PERMISSIONS.PERIOD_CLOSE,
    ]);

    admin = await createUser({ email: "finance.admin@example.com" });
    accountant = await createUser({ email: "accountant@example.com" });
    viewer = await createUser({ email: "viewer@example.com" });
    poster = await createUser({ email: "poster@example.com" });
    closer = await createUser({ email: "closer@example.com" });
    outsider = await createUser({ email: "outsider@example.com" });
    await grantRole(admin.id, adminRole.id);
    await grantRole(accountant.id, accountantRole.id);
    await grantRole(viewer.id, viewerRole.id);
    await grantRole(poster.id, posterRole.id);
    await grantRole(closer.id, closerRole.id);

    assets = (
      await createAccount(as(admin), {
        code: "1000",
        name: "Assets",
        type: "ASSET",
        isPostable: false,
      })
    ).id;
    cash = (
      await createAccount(as(admin), {
        code: "1110",
        name: "Cash",
        nameAr: "النقدية",
        type: "ASSET",
        parentId: assets,
      })
    ).id;
    bank = (
      await createAccount(as(admin), {
        code: "1120",
        name: "Bank",
        type: "ASSET",
        parentId: assets,
      })
    ).id;
    equipment = (
      await createAccount(as(admin), {
        code: "1500",
        name: "Office Equipment",
        type: "ASSET",
        parentId: assets,
      })
    ).id;
    const equity = (
      await createAccount(as(admin), {
        code: "3000",
        name: "Equity",
        type: "EQUITY",
        isPostable: false,
      })
    ).id;
    capital = (
      await createAccount(as(admin), {
        code: "3100",
        name: "Share Capital",
        type: "EQUITY",
        parentId: equity,
      })
    ).id;
    centre = (
      await createCostCentre(as(admin), { code: "CC-ADMIN", name: "Administration" })
    ).id;
    september = (
      await createPeriod(as(admin), {
        name: "September 2026",
        startDate: "2026-09-01",
        endDate: "2026-09-30",
      })
    ).id;
  });

  const purchase = (overrides: Record<string, unknown> = {}) => ({
    entryDate: "2026-09-14",
    description: "Office equipment purchase",
    lines: [
      { accountId: equipment, costCentreId: centre, debit: "50,000" },
      { accountId: cash, credit: "50,000.00" },
    ],
    ...overrides,
  });

  const postedEntry = async (user = admin, input = purchase()) => {
    const { id } = await createJournal(as(user), input);
    const { journalNumber } = await postJournal(as(user), id);
    return { id, journalNumber };
  };

  const outbox = (name: string) =>
    prisma.eventOutbox.findMany({ where: { name }, orderBy: { occurredAt: "asc" } });
  const audits = (action: string) => prisma.auditLog.findMany({ where: { action } });

  /* ======================================================================== */
  /* Chart of accounts                                                        */
  /* ======================================================================== */

  describe("chart of accounts", () => {
    it("lists the tree in code order with depth, audited and published", async () => {
      const page = await listAccounts(as(viewer));
      expect(page.rows.map((row) => [row.code, row.depth])).toEqual([
        ["1000", 0],
        ["1110", 1],
        ["1120", 1],
        ["1500", 1],
        ["3000", 0],
        ["3100", 1],
      ]);
      expect(page.rows.find((row) => row.code === "1000")?.childCount).toBe(3);
      expect(await audits("erp.account.created")).toHaveLength(6);
      expect(await outbox("erp.AccountCreated")).toHaveLength(6);

      const search = await listAccounts(as(viewer), { q: "نقد" });
      expect(search.rows.map((row) => row.code)).toEqual(["1110"]);
    });

    it("refuses a parent of another type, a postable parent and a duplicate code", async () => {
      expect(
        await failure(
          createAccount(as(admin), {
            code: "3200",
            name: "Reserves",
            type: "EQUITY",
            parentId: assets,
          }),
        ),
      ).toBeInstanceOf(ValidationError);
      expect(
        await failure(
          createAccount(as(admin), {
            code: "1111",
            name: "Petty cash",
            type: "ASSET",
            parentId: cash,
          }),
        ),
      ).toBeInstanceOf(ValidationError);
      expect(
        await failure(
          createAccount(as(admin), { code: "1110", name: "Another", type: "ASSET" }),
        ),
      ).toBeInstanceOf(ConflictError);
    });

    it("enforces the tree in the database as well", async () => {
      await expect(
        prisma.erpAccount.create({
          data: {
            code: "5999",
            name: "Wrong type",
            type: "EXPENSE",
            normalBalance: "DEBIT",
            parentId: assets,
          },
        }),
      ).rejects.toThrow();
    });

    it("keeps the type of an account once it is used in journal entries", async () => {
      await postedEntry();
      const error = await failure(
        updateAccount(as(admin), cash, {
          name: "Cash",
          type: "EXPENSE",
          parentId: null,
          isPostable: true,
        }),
      );
      expect(error).toBeInstanceOf(BusinessRuleError);
      expect(error.message).toMatch(/type of an account used in journal entries/);
    });

    it("lets accountants create accounts but only administrators deactivate them", async () => {
      await createAccount(as(accountant), {
        code: "1130",
        name: "Petty cash",
        type: "ASSET",
        parentId: assets,
      });
      expect(
        await failure(
          createAccount(as(viewer), { code: "1140", name: "X", type: "ASSET" }),
        ),
      ).toBeInstanceOf(ForbiddenError);
      expect(await failure(listAccounts(as(outsider)))).toBeInstanceOf(ForbiddenError);

      expect(
        await failure(setAccountActive(as(accountant), bank, { isActive: false })),
      ).toBeInstanceOf(ForbiddenError);
      await setAccountActive(as(admin), bank, { isActive: false });
      expect((await getAccount(as(viewer), bank)).isActive).toBe(false);
      expect(await audits("erp.account.deactivated")).toHaveLength(1);
    });
  });

  /* ======================================================================== */
  /* Cost centres                                                             */
  /* ======================================================================== */

  describe("cost centres", () => {
    it("creates and updates, refusing a cycle and an unauthorised user", async () => {
      const child = (
        await createCostCentre(as(accountant), {
          code: "CC-IT",
          name: "IT",
          parentId: centre,
        })
      ).id;
      const error = await failure(
        updateCostCentre(as(admin), centre, {
          name: "Administration",
          parentId: child,
          isActive: true,
        }),
      );
      expect(error).toBeInstanceOf(BusinessRuleError);
      expect(
        await failure(
          updateCostCentre(as(viewer), child, {
            name: "IT",
            parentId: null,
            isActive: false,
          }),
        ),
      ).toBeInstanceOf(ForbiddenError);
      expect(await outbox("erp.CostCentreCreated")).toHaveLength(2);
    });
  });

  /* ======================================================================== */
  /* Periods                                                                  */
  /* ======================================================================== */

  describe("accounting periods", () => {
    it("refuses overlapping periods, in the service and in the database", async () => {
      expect(
        await failure(
          createPeriod(as(admin), {
            name: "Q3 tail",
            startDate: "2026-09-15",
            endDate: "2026-10-15",
          }),
        ),
      ).toBeInstanceOf(ConflictError);
      await expect(
        prisma.erpFiscalPeriod.create({
          data: {
            name: "Overlap",
            startDate: utc("2026-09-30"),
            endDate: utc("2026-10-31"),
          },
        }),
      ).rejects.toThrow();
      expect(
        await failure(
          createPeriod(as(accountant), {
            name: "October 2026",
            startDate: "2026-10-01",
            endDate: "2026-10-31",
          }),
        ),
      ).toBeInstanceOf(ForbiddenError);
    });

    it("erp.period.close: allowed for a holder, refused and audited for anyone else", async () => {
      const denied = await failure(closePeriod(as(accountant), september));
      expect(denied).toBeInstanceOf(ForbiddenError);
      const denials = await prisma.auditLog.findMany({
        where: { action: "iam.permission.denied", actorId: accountant.id },
      });
      expect(
        denials.some((row) => row.summary.includes(ERP_PERMISSIONS.PERIOD_CLOSE)),
      ).toBe(true);

      await closePeriod(as(closer), september);
      const period = await prisma.erpFiscalPeriod.findUniqueOrThrow({
        where: { id: september },
      });
      expect(period.status).toBe("CLOSED");
      expect(period.closedBy).toBe(closer.id);
      expect(await audits("erp.period.closed")).toHaveLength(1);
      const events = await outbox("erp.PeriodClosed");
      expect(events).toHaveLength(1);
      expect(events[0]?.payload).toMatchObject({
        fiscalPeriodId: september,
        name: "September 2026",
      });
    });

    it("erp.period.reopen: refused without the permission, needs a reason, audited as critical", async () => {
      await closePeriod(as(admin), september);
      expect(
        await failure(reopenPeriod(as(closer), september, { reason: "Late invoice" })),
      ).toBeInstanceOf(ForbiddenError);
      expect(
        await failure(reopenPeriod(as(admin), september, { reason: "" })),
      ).toBeInstanceOf(ValidationError);

      await reopenPeriod(as(admin), september, { reason: "Late supplier invoice" });
      const period = await prisma.erpFiscalPeriod.findUniqueOrThrow({
        where: { id: september },
      });
      expect(period.status).toBe("OPEN");
      expect(period.reopenedBy).toBe(admin.id);
      const [audit] = await audits("erp.period.reopened");
      expect(audit?.severity).toBe("CRITICAL");
      expect(audit?.changes).toMatchObject({ reason: "Late supplier invoice" });
      expect(await outbox("erp.PeriodReopened")).toHaveLength(1);
    });

    it("refuses to close a period while drafts are dated inside it", async () => {
      const { id } = await createJournal(as(accountant), purchase());
      const error = await failure(closePeriod(as(admin), september));
      expect(error).toBeInstanceOf(BusinessRuleError);
      expect(error.message).toMatch(/1 draft journal entry/);

      await deleteJournal(as(accountant), id);
      await closePeriod(as(admin), september);
    });
  });

  /* ======================================================================== */
  /* Journals                                                                 */
  /* ======================================================================== */

  describe("journal entries", () => {
    it("saves a draft, then posts it with a gap-free number, an audit record and an event", async () => {
      const { id } = await createJournal(as(accountant), purchase());
      const draft = await getJournal(as(viewer), id);
      expect(draft.status).toBe("DRAFT");
      expect(draft.journalNumber).toBeNull();
      expect(draft.totalMinor).toBe(5_000_000);
      expect(
        draft.lines.map((line) => [line.account.code, line.debitMinor, line.creditMinor]),
      ).toEqual([
        ["1500", 5_000_000, 0],
        ["1110", 0, 5_000_000],
      ]);

      expect((await postJournal(as(accountant), id)).journalNumber).toBe(
        "JE-2026-000001",
      );
      const posted = await getJournal(as(viewer), id);
      expect(posted.status).toBe("POSTED");
      expect(posted.period?.id).toBe(september);
      expect(posted.postedBy?.id).toBe(accountant.id);
      expect(await audits("erp.journal.posted")).toHaveLength(1);
      const events = await outbox("erp.JournalEntryPosted");
      expect(events[0]?.payload).toMatchObject({
        journalEntryId: id,
        journalNumber: "JE-2026-000001",
        fiscalPeriodId: september,
      });

      expect((await postedEntry(accountant)).journalNumber).toBe("JE-2026-000002");
    });

    it("rejects an unbalanced entry at posting and leaves nothing behind", async () => {
      const { id } = await createJournal(
        as(accountant),
        purchase({
          lines: [
            { accountId: equipment, debit: "50000" },
            { accountId: cash, credit: "40000" },
          ],
        }),
      );
      const error = await failure(postJournal(as(accountant), id));
      expect(error).toBeInstanceOf(BusinessRuleError);
      expect(error.message).toMatch(/does not balance.*10,000\.00/);

      const entry = await prisma.erpJournalEntry.findUniqueOrThrow({ where: { id } });
      expect(entry.status).toBe("DRAFT");
      expect(entry.journalNumber).toBeNull();
      expect(await prisma.erpJournalSequence.count()).toBe(0);
      expect(await audits("erp.journal.posted")).toHaveLength(0);
      expect(await outbox("erp.JournalEntryPosted")).toHaveLength(0);
    });

    it("validates every draft on the server", async () => {
      const invalid = async (lines: unknown[], field?: string) => {
        const error = await failure(createJournal(as(accountant), purchase({ lines })));
        expect(error).toBeInstanceOf(ValidationError);
        if (field !== undefined) {
          expect((error as ValidationError).fieldErrors[field]).toBeDefined();
        }
      };
      await invalid(
        [
          { accountId: equipment, debit: "-5" },
          { accountId: cash, credit: "5" },
        ],
        "lines.0.debit",
      );
      await invalid([
        { accountId: equipment, debit: "5", credit: "5" },
        { accountId: cash, credit: "5" },
      ]);
      await invalid([{ accountId: equipment }, { accountId: cash }]);
      await invalid([{ accountId: equipment, debit: "5" }], "lines");
      await invalid(
        [
          { accountId: assets, debit: "5" },
          { accountId: cash, credit: "5" },
        ],
        "lines.0.accountId",
      );

      await setAccountActive(as(admin), bank, { isActive: false });
      await invalid(
        [
          { accountId: bank, debit: "5" },
          { accountId: cash, credit: "5" },
        ],
        "lines.0.accountId",
      );
      expect(await prisma.erpJournalEntry.count()).toBe(0);
    });

    it("refuses posting into a closed period, a date with no period, and a deactivated account", async () => {
      await closePeriod(as(admin), september);
      const lateDraft = await createJournal(
        as(accountant),
        purchase({ entryDate: "2026-09-20" }),
      );
      expect((await failure(postJournal(as(accountant), lateDraft.id))).message).toMatch(
        /September 2026 is closed/,
      );

      const futureDraft = await createJournal(
        as(accountant),
        purchase({ entryDate: "2027-01-15" }),
      );
      expect(
        (await failure(postJournal(as(accountant), futureDraft.id))).message,
      ).toMatch(/no accounting period for 2027-01-15/);

      await reopenPeriod(as(admin), september, { reason: "Test" });
      await deleteJournal(as(accountant), lateDraft.id);
      const bankDraft = await createJournal(
        as(accountant),
        purchase({
          lines: [
            { accountId: bank, debit: "100" },
            { accountId: cash, credit: "100" },
          ],
        }),
      );
      await setAccountActive(as(admin), bank, { isActive: false });
      expect((await failure(postJournal(as(accountant), bankDraft.id))).message).toMatch(
        /account 1120 is inactive/,
      );
    });

    it("never edits or deletes a posted entry through the services", async () => {
      const { id } = await postedEntry();
      expect(await failure(updateJournal(as(admin), id, purchase()))).toBeInstanceOf(
        BusinessRuleError,
      );
      expect(await failure(deleteJournal(as(admin), id))).toBeInstanceOf(
        BusinessRuleError,
      );
      expect(await failure(postJournal(as(admin), id))).toBeInstanceOf(BusinessRuleError);
    });

    it("never edits or deletes a posted entry in the database either", async () => {
      const { id } = await postedEntry();
      await expect(
        prisma.erpJournalEntry.update({
          where: { id },
          data: { description: "Rewritten" },
        }),
      ).rejects.toThrow();
      await expect(prisma.erpJournalEntry.delete({ where: { id } })).rejects.toThrow();
      await expect(
        prisma.erpJournalLine.updateMany({
          where: { journalEntryId: id },
          data: { debitMinor: 1n },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.erpJournalLine.create({
          data: { journalEntryId: id, lineNo: 3, accountId: cash, debitMinor: 1n },
        }),
      ).rejects.toThrow();

      const entry = await getJournal(as(viewer), id);
      expect(entry.description).toBe("Office equipment purchase");
      expect(entry.debitTotalMinor).toBe(5_000_000);
    });

    it("refuses an unbalanced posting or a two-sided line written straight to the database", async () => {
      const draft = await prisma.erpJournalEntry.create({
        data: {
          entryDate: utc("2026-09-10"),
          description: "Written directly",
          totalMinor: 100n,
          createdBy: admin.id,
          lines: {
            create: [
              { lineNo: 1, accountId: cash, debitMinor: 100n },
              { lineNo: 2, accountId: bank, creditMinor: 50n },
            ],
          },
        },
      });
      await expect(
        prisma.erpJournalEntry.update({
          where: { id: draft.id },
          data: {
            status: "POSTED",
            journalNumber: "JE-DIRECT-1",
            fiscalPeriodId: september,
            postedAt: new Date(),
            postedBy: admin.id,
          },
        }),
      ).rejects.toThrow();
      expect(
        (await prisma.erpJournalEntry.findUniqueOrThrow({ where: { id: draft.id } }))
          .status,
      ).toBe("DRAFT");

      await expect(
        prisma.erpJournalLine.create({
          data: {
            journalEntryId: draft.id,
            lineNo: 3,
            accountId: cash,
            debitMinor: 10n,
            creditMinor: 10n,
          },
        }),
      ).rejects.toThrow();
    });

    it("reverses a posted entry with an equal and opposite posted entry", async () => {
      const original = await postedEntry(accountant);
      const result = await reverseJournal(as(accountant), original.id, {
        reversalDate: "2026-09-20",
      });
      expect(result.journalNumber).toBe("JE-2026-000002");

      const reversed = await getJournal(as(viewer), original.id);
      expect(reversed.status).toBe("REVERSED");
      expect(reversed.reversal?.id).toBe(result.reversalId);
      expect(reversed.reversedBy?.id).toBe(accountant.id);
      expect(reversed.lines.map((line) => line.debitMinor)).toEqual([5_000_000, 0]);

      const reversal = await getJournal(as(viewer), result.reversalId);
      expect(reversal.status).toBe("POSTED");
      expect(reversal.reverses?.id).toBe(original.id);
      expect(reversal.reference).toBe(original.journalNumber);
      expect(reversal.entryDate).toBe("2026-09-20");
      expect(
        reversal.lines.map((line) => [
          line.account.code,
          line.costCentre?.code ?? null,
          line.debitMinor,
          line.creditMinor,
        ]),
      ).toEqual([
        ["1500", "CC-ADMIN", 0, 5_000_000],
        ["1110", null, 5_000_000, 0],
      ]);

      const cashAccount = await getAccount(as(viewer), cash);
      expect(cashAccount.totals).toEqual({
        debitMinor: 5_000_000,
        creditMinor: 5_000_000,
        balanceMinor: 0,
      });
      expect(await audits("erp.journal.reversed")).toHaveLength(1);
      expect(await outbox("erp.JournalEntryPosted")).toHaveLength(2);
      const [event] = await outbox("erp.JournalEntryReversed");
      expect(event?.payload).toMatchObject({
        journalEntryId: original.id,
        reversalEntryId: result.reversalId,
      });

      expect(
        await failure(
          reverseJournal(as(accountant), original.id, { reversalDate: "2026-09-21" }),
        ),
      ).toBeInstanceOf(BusinessRuleError);
      expect(
        (
          await failure(
            reverseJournal(as(accountant), result.reversalId, {
              reversalDate: "2026-09-21",
            }),
          )
        ).message,
      ).toMatch(/itself a reversal/);
      const draft = await createJournal(as(accountant), purchase());
      expect(
        (
          await failure(
            reverseJournal(as(accountant), draft.id, { reversalDate: "2026-09-21" }),
          )
        ).message,
      ).toMatch(/Only a posted journal entry/);
    });

    it("refuses a reversal into a closed period or before the original, changing nothing", async () => {
      const original = await postedEntry();
      expect(
        (
          await failure(
            reverseJournal(as(admin), original.id, { reversalDate: "2026-09-01" }),
          )
        ).message,
      ).toMatch(/before the entry it reverses/);

      await closePeriod(as(admin), september);
      await createPeriod(as(admin), {
        name: "October 2026",
        startDate: "2026-10-01",
        endDate: "2026-10-31",
      });
      expect(
        (
          await failure(
            reverseJournal(as(admin), original.id, { reversalDate: "2026-09-25" }),
          )
        ).message,
      ).toMatch(/September 2026 is closed/);
      expect((await getJournal(as(admin), original.id)).status).toBe("POSTED");
      expect(await prisma.erpJournalEntry.count()).toBe(1);

      const inOctober = await reverseJournal(as(admin), original.id, {
        reversalDate: "2026-10-02",
      });
      expect((await getJournal(as(admin), inOctober.reversalId)).period?.name).toBe(
        "October 2026",
      );
    });

    it("erp.journal.post and erp.journal.reverse are separate grants", async () => {
      const draft = await createJournal(as(accountant), purchase());
      expect(await failure(postJournal(as(viewer), draft.id))).toBeInstanceOf(
        ForbiddenError,
      );
      expect(await failure(createJournal(as(viewer), purchase()))).toBeInstanceOf(
        ForbiddenError,
      );
      expect(await failure(getJournal(as(outsider), draft.id))).toBeInstanceOf(
        ForbiddenError,
      );

      const posted = await postedEntry(poster);
      expect(
        await failure(
          reverseJournal(as(poster), posted.id, { reversalDate: "2026-09-20" }),
        ),
      ).toBeInstanceOf(ForbiddenError);
      await reverseJournal(as(accountant), posted.id, { reversalDate: "2026-09-20" });
      expect(await failure(deleteJournal(as(poster), draft.id))).toBeInstanceOf(
        ForbiddenError,
      );
    });

    it("numbers simultaneous postings without gaps or duplicates", async () => {
      const drafts = await Promise.all(
        Array.from({ length: 5 }, () => createJournal(as(accountant), purchase())),
      );
      const numbers = await Promise.all(
        drafts.map(
          async (draft) => (await postJournal(as(accountant), draft.id)).journalNumber,
        ),
      );
      expect([...numbers].sort()).toEqual([
        "JE-2026-000001",
        "JE-2026-000002",
        "JE-2026-000003",
        "JE-2026-000004",
        "JE-2026-000005",
      ]);
    });

    it("lets only one of two simultaneous postings of the same draft succeed", async () => {
      const { id } = await createJournal(as(accountant), purchase());
      const results = await Promise.allSettled([
        postJournal(as(accountant), id),
        postJournal(as(admin), id),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((result) => result.status === "rejected");
      expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(
        BusinessRuleError,
      );
      expect(
        await prisma.erpJournalSequence.findUnique({ where: { year: 2026 } }),
      ).toMatchObject({
        lastNumber: 1,
      });
    });

    it("lists, filters and pages journals, and shows account activity with totals", async () => {
      await postedEntry();
      await createJournal(
        as(accountant),
        purchase({
          description: "Bank charges",
          lines: [
            { accountId: capital, debit: "10" },
            { accountId: bank, credit: "10" },
          ],
        }),
      );

      expect((await listJournals(as(viewer), { status: "DRAFT" })).total).toBe(1);
      const search = await listJournals(as(viewer), { q: "equipment" });
      expect(search.rows.map((row) => row.journalNumber)).toEqual(["JE-2026-000001"]);

      const activity = await listAccountActivity(as(viewer), cash);
      expect(activity.total).toBe(1);
      expect(activity.rows[0]).toMatchObject({
        journalNumber: "JE-2026-000001",
        creditMinor: 5_000_000,
      });
      expect(activity.totals).toEqual({ debitMinor: 0, creditMinor: 5_000_000 });

      const overview = await getFinanceOverview(as(viewer));
      expect(overview.draftCount).toBe(1);
      expect(overview.openPeriods?.map((period) => period.name)).toEqual([
        "September 2026",
      ]);
      expect(overview.recentJournals?.map((entry) => entry.journalNumber)).toEqual([
        "JE-2026-000001",
      ]);
      expect(await failure(getFinanceOverview(as(outsider)))).toBeInstanceOf(
        ForbiddenError,
      );
    });
  });
});
