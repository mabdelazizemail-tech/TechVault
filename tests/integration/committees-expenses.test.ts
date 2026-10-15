import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import {
  COMMITTEES_ADMIN_PERMISSIONS,
  COMMITTEES_MEMBER_PERMISSIONS,
  COMMITTEES_PERMISSIONS,
} from "@/modules/committees/contracts/permissions";
import {
  createMission,
  deleteExpense,
  getExpense,
  getExpenseTotals,
  getReceiptLink,
  listExpenseSubmitters,
  listExpenses,
  listMissionOptions,
  listMissions,
  prepareReceiptUpload,
  reviewExpense,
  submitExpense,
  updateMission,
} from "@/modules/committees/contracts/service";
import { addDays, todayInCairo } from "@/modules/committees/domain/dates";
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
 * Mission expenses against a real database (ADR-037). Object storage is faked: what
 * matters here is what the services decide, not the vendor's HTTP API.
 */
const objects = vi.hoisted(() => new Map<string, { size: number; head: Uint8Array }>());
const storage = vi.hoisted(() => ({
  isStorageConfigured: vi.fn(() => true),
  createUploadUrl: vi.fn(async (key: string) => ({
    url: `https://storage.test/up/${key}`,
  })),
  // Keyed like real storage, so what a check reads never depends on call order.
  readObjectStart: vi.fn(async (key: string) => objects.get(key) ?? null),
  createDownloadUrl: vi.fn(async (key: string) => `https://storage.test/object/${key}`),
  removeObject: vi.fn(),
}));

vi.mock("@/platform/storage/storage", () => storage);

/** The exchange-rate feed is faked too: tests choose the rates, and the network is never touched. */
const exchange = vi.hoisted(() => ({
  getUsdRates: vi.fn(),
  EXCHANGE_RATE_SOURCE: "exchangerate-api",
  EXCHANGE_RATE_ATTRIBUTION: { label: "Rates", href: "https://example.test" },
}));

vi.mock("@/platform/integrations/exchange-rates", () => exchange);

/** Units per 1 USD, as the feed published them on 15 October 2026. */
const TODAY = {
  perUsd: new Map([
    ["USD", "1"],
    ["TRY", "49.45021"],
    ["EUR", "0.894425"],
    ["EGP", "53.095404"],
  ]),
  publishedAt: new Date("2026-10-15T00:02:31Z"),
  source: "exchangerate-api" as const,
};

const JPEG_HEAD = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PDF_HEAD = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

describe.skipIf(!hasTestDatabase)("Mission expenses (integration)", () => {
  type U = { id: string };
  let alice: U; // member
  let bob: U; // member
  let carol: U; // approver and mission administrator
  let erin: U; // nothing in Committees
  let turkey: string;

  const as = (user: U) => ({ id: user.id });
  const db = () => testPrisma();

  afterAll(async () => {
    await teardownDatabase();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    objects.clear();
    storage.isStorageConfigured.mockReturnValue(true);
    exchange.getUsdRates.mockResolvedValue(TODAY);
    await resetDatabase();
    await seedPermissions();
    const member = await createRole("committees-user", COMMITTEES_MEMBER_PERMISSIONS);
    const admin = await createRole("committees-admin", COMMITTEES_ADMIN_PERMISSIONS);
    alice = await createUser({ email: "alice@example.com" });
    bob = await createUser({ email: "bob@example.com" });
    carol = await createUser({ email: "carol@example.com" });
    erin = await createUser({ email: "erin@example.com" });
    await grantRole(alice.id, member.id);
    await grantRole(bob.id, member.id);
    await grantRole(carol.id, admin.id);

    turkey = (
      await createMission(as(carol), { name: "Turkey Trip", defaultCurrency: "TRY" })
    ).id;
  });

  function lastUploadKey(): string {
    const key = storage.createUploadUrl.mock.lastCall?.[0];
    if (key === undefined) throw new Error("No upload was prepared.");
    return key;
  }

  /** Prepares an upload that never reaches storage. */
  async function prepareAndForget(user: U) {
    const prepared = await prepareReceiptUpload(as(user), {
      fileName: "lost.png",
      sizeBytes: 100,
    });
    return prepared.receiptId;
  }

  /** Walks a receipt through prepare → (faked) upload, returning its id. */
  async function uploadReceipt(
    user: U,
    options: { fileName?: string; head?: Uint8Array; size?: number } = {},
  ) {
    const size = options.size ?? 180_000;
    const prepared = await prepareReceiptUpload(as(user), {
      fileName: options.fileName ?? "dinner.jpg",
      sizeBytes: size,
    });
    objects.set(lastUploadKey(), { size, head: options.head ?? JPEG_HEAD });
    return prepared.receiptId;
  }

  async function claim(user: U, overrides: Record<string, unknown> = {}) {
    return submitExpense(as(user), {
      missionId: turkey,
      category: "DINNER",
      expenseDate: todayInCairo(),
      amount: "1,250.50",
      currency: "TRY",
      ...overrides,
      receiptId:
        "receiptId" in overrides ? overrides.receiptId : await uploadReceipt(user),
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Missions                                                                 */
  /* ------------------------------------------------------------------------ */

  describe("missions", () => {
    it("are managed by mission administrators only, with unique names", async () => {
      await expect(
        createMission(as(alice), { name: "Dubai Trip", defaultCurrency: "AED" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        createMission(as(carol), { name: "  turkey trip ", defaultCurrency: "TRY" }),
      ).rejects.toBeInstanceOf(ConflictError);
      await expect(listMissions(as(bob))).rejects.toBeInstanceOf(ForbiddenError);
      expect((await listMissions(as(carol))).rows.map((mission) => mission.name)).toEqual(
        ["Turkey Trip"],
      );
    });

    it("once deactivated, are no longer offered and take no new claims", async () => {
      await updateMission(as(carol), turkey, {
        name: "Turkey Trip",
        defaultCurrency: "TRY",
        isActive: false,
      });
      expect(await listMissionOptions(as(alice))).toEqual([]);
      expect(
        (await listMissionOptions(as(alice), { includeInactive: true })).map((m) => m.id),
      ).toEqual([turkey]);
      await expect(claim(alice)).rejects.toBeInstanceOf(ValidationError);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Submitting                                                               */
  /* ------------------------------------------------------------------------ */

  describe("submitting", () => {
    it("records the claim against the mission, by the signed-in person, with its receipt", async () => {
      const { id } = await claim(alice);
      const expense = await getExpense(as(alice), id);
      expect(expense).toMatchObject({
        mission: { id: turkey, name: "Turkey Trip" },
        submitter: { id: alice.id },
        category: "DINNER",
        amountMinor: 125050,
        currency: "TRY",
        status: "SUBMITTED",
        reviewer: null,
        canReview: false,
      });
      expect(expense.receipt?.contentType).toBe("image/jpeg");
      expect(expense.hasReceipt).toBe(true);
      const row = await db().committeeMissionExpense.findUniqueOrThrow({
        where: { id },
        select: { receipt: { select: { status: true, storageKey: true } } },
      });
      expect(row.receipt?.status).toBe("READY");
      expect(row.receipt?.storageKey).toMatch(
        /^committees\/receipts\/\d{4}\/\d{2}\/[0-9a-f]{32}\.jpg$/,
      );
      expect(
        await db().auditLog.count({ where: { action: "committees.expense.submitted" } }),
      ).toBe(1);
      expect(
        await db().eventOutbox.count({
          where: { name: "committees.MissionExpenseSubmitted" },
        }),
      ).toBe(1);
    });

    it("accepts a claim without a receipt picture, even with no storage configured", async () => {
      storage.isStorageConfigured.mockReturnValue(false);
      const { id } = await claim(alice, { receiptId: null });
      const expense = await getExpense(as(alice), id);
      expect(expense).toMatchObject({
        receipt: null,
        hasReceipt: false,
        status: "SUBMITTED",
      });
      expect((await listExpenses(as(carol))).rows[0]?.hasReceipt).toBe(false);
      await expect(getReceiptLink(as(alice), id)).rejects.toBeInstanceOf(NotFoundError);
      expect(storage.readObjectStart).not.toHaveBeenCalled();
      const [audit] = await db().auditLog.findMany({
        where: { action: "committees.expense.submitted" },
      });
      expect(audit?.summary).toBe(
        "Claimed Dinner TRY 1,250.50 on Turkey Trip, without a receipt",
      );
      // It is reviewed like any other claim.
      await reviewExpense(as(carol), id, { decision: "APPROVED" });
      expect((await getExpense(as(alice), id)).status).toBe("APPROVED");
    });

    it("needs a description for Other, a positive amount and no future date", async () => {
      await expect(claim(alice, { category: "OTHER" })).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(claim(alice, { amount: "0" })).rejects.toBeInstanceOf(ValidationError);
      await expect(
        claim(alice, { expenseDate: addDays(todayInCairo(), 5) }),
      ).rejects.toBeInstanceOf(ValidationError);
      const other = await claim(alice, {
        category: "OTHER",
        description: "Local SIM card",
      });
      expect((await getExpense(as(alice), other.id)).description).toBe("Local SIM card");
    });

    it("accepts only a JPG or PNG that really is one, of the declared size, under 10 MB", async () => {
      await expect(
        prepareReceiptUpload(as(alice), { fileName: "invoice.pdf", sizeBytes: 1000 }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        prepareReceiptUpload(as(alice), {
          fileName: "big.jpg",
          sizeBytes: 11 * 1024 * 1024,
        }),
      ).rejects.toBeInstanceOf(ValidationError);

      const disguised = await uploadReceipt(alice, { head: PDF_HEAD });
      await expect(claim(alice, { receiptId: disguised })).rejects.toThrow(
        /not a JPG or PNG/,
      );

      const prepared = await prepareReceiptUpload(as(alice), {
        fileName: "taxi.jpg",
        sizeBytes: 5000,
      });
      objects.set(lastUploadKey(), { size: 9999, head: JPEG_HEAD });
      await expect(claim(alice, { receiptId: prepared.receiptId })).rejects.toThrow(
        /does not match/,
      );
      await expect(
        claim(alice, { receiptId: await prepareAndForget(alice) }),
      ).rejects.toThrow(/did not finish uploading/);
      expect(await db().committeeMissionExpense.count()).toBe(0);
    });

    it("uses a receipt once, and never someone else's", async () => {
      const receiptId = await uploadReceipt(alice);
      await expect(claim(bob, { receiptId })).rejects.toBeInstanceOf(ValidationError);
      await claim(alice, { receiptId });
      await expect(claim(alice, { receiptId })).rejects.toBeInstanceOf(ValidationError);
    });

    it("is refused without the permission, and without storage", async () => {
      await expect(
        prepareReceiptUpload(as(erin), { fileName: "a.jpg", sizeBytes: 10 }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      storage.isStorageConfigured.mockReturnValue(false);
      await expect(
        prepareReceiptUpload(as(alice), { fileName: "a.jpg", sizeBytes: 10 }),
      ).rejects.toThrow(/storage key/);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Seeing and totals                                                        */
  /* ------------------------------------------------------------------------ */

  describe("seeing claims", () => {
    it("shows people their own claims and approvers everyone's", async () => {
      const mine = await claim(alice);
      await claim(bob);
      expect((await listExpenses(as(alice))).rows.map((row) => row.id)).toEqual([
        mine.id,
      ]);
      await expect(getExpense(as(bob), mine.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(getReceiptLink(as(bob), mine.id)).rejects.toBeInstanceOf(
        NotFoundError,
      );
      expect((await listExpenses(as(carol))).total).toBe(2);
      expect((await listExpenses(as(carol), { user: alice.id })).total).toBe(1);
      // A member's "user" filter cannot widen what they see.
      expect((await listExpenses(as(alice), { user: bob.id })).total).toBe(1);
      expect((await listExpenseSubmitters(as(carol))).map((p) => p.id).sort()).toEqual(
        [alice.id, bob.id].sort(),
      );
      expect(await listExpenseSubmitters(as(alice))).toEqual([]);
      await expect(listExpenses(as(erin))).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("totals per currency, never mixing them, and leaves rejected claims out", async () => {
      const dinner = await claim(alice, { amount: "100.00" });
      const taxi = await claim(alice, { amount: "50.00", category: "TRANSPORTATION" });
      await claim(bob, { amount: "20.00", currency: "EUR", category: "COFFEE" });
      await reviewExpense(as(carol), dinner.id, { decision: "APPROVED" });
      await reviewExpense(as(carol), taxi.id, {
        decision: "REJECTED",
        note: "No receipt date",
      });
      await claim(bob, { amount: "30.00" });

      // TRY 100.00 → USD 2.02, TRY 30.00 → USD 0.61, EUR 20.00 → USD 22.36.
      expect(await getExpenseTotals(as(carol), { mission: turkey })).toEqual({
        currencies: [
          { currency: "EUR", claimedMinor: 2000, approvedMinor: 0, count: 1 },
          { currency: "TRY", claimedMinor: 13000, approvedMinor: 10000, count: 2 },
        ],
        usd: { claimedMinor: 2499, approvedMinor: 202, count: 3, pendingCount: 0 },
      });
      expect(await getExpenseTotals(as(alice))).toEqual({
        currencies: [
          { currency: "TRY", claimedMinor: 10000, approvedMinor: 10000, count: 1 },
        ],
        usd: { claimedMinor: 202, approvedMinor: 202, count: 1, pendingCount: 0 },
      });
      expect((await listExpenses(as(carol), { category: "COFFEE" })).total).toBe(1);
      expect((await listExpenses(as(carol), { status: "REJECTED" })).total).toBe(1);
    });

    it("totals each mission per currency on the missions list, for approvers only", async () => {
      await createMission(as(carol), { name: "Dubai Visit", defaultCurrency: "AED" });
      const dinner = await claim(alice, { amount: "100.00" });
      await claim(bob, { amount: "30.00" });
      await claim(bob, { amount: "20.00", currency: "EUR", category: "COFFEE" });
      const rejected = await claim(alice, { amount: "999.00" });
      const deleted = await claim(alice, { amount: "500.00" });
      await reviewExpense(as(carol), dinner.id, { decision: "APPROVED" });
      await reviewExpense(as(carol), rejected.id, { decision: "REJECTED" });
      await deleteExpense(as(carol), deleted.id);

      const rows = (await listMissions(as(carol))).rows;
      expect(rows.map((row) => [row.name, row.expenseCount, row.totals])).toEqual([
        [
          "Dubai Visit",
          0,
          {
            currencies: [],
            usd: { claimedMinor: 0, approvedMinor: 0, count: 0, pendingCount: 0 },
          },
        ],
        [
          "Turkey Trip",
          4,
          {
            currencies: [
              { currency: "EUR", claimedMinor: 2000, approvedMinor: 0, count: 1 },
              { currency: "TRY", claimedMinor: 13000, approvedMinor: 10000, count: 2 },
            ],
            usd: { claimedMinor: 2499, approvedMinor: 202, count: 3, pendingCount: 0 },
          },
        ],
      ]);

      // A mission administrator who may not see others' claims gets no totals.
      const keeper = await createRole("mission-keeper", [
        COMMITTEES_PERMISSIONS.ACCESS,
        COMMITTEES_PERMISSIONS.EXPENSE_READ,
        COMMITTEES_PERMISSIONS.MISSION_ADMINISTER,
      ]);
      const hana = await createUser({ email: "hana@example.com" });
      await grantRole(hana.id, keeper.id);
      expect((await listMissions(as(hana))).rows.map((row) => row.totals)).toEqual([
        null,
        null,
      ]);
    });

    it("filters by expense date range", async () => {
      await claim(alice, { expenseDate: addDays(todayInCairo(), -10) });
      await claim(alice);
      expect(
        (await listExpenses(as(alice), { from: addDays(todayInCairo(), -1) })).total,
      ).toBe(1);
      expect(
        (await listExpenses(as(alice), { to: addDays(todayInCairo(), -5) })).total,
      ).toBe(1);
    });

    it("serves the receipt through a short-lived link and audits the view", async () => {
      const { id } = await claim(alice);
      expect(await getReceiptLink(as(alice), id)).toMatch(
        /^https:\/\/storage\.test\/object\//,
      );
      expect(await getReceiptLink(as(carol), id)).toContain("committees/receipts/");
      expect(storage.createDownloadUrl).toHaveBeenLastCalledWith(expect.any(String), {
        downloadAs: null,
        expiresInSeconds: 300,
      });
      expect(
        await db().auditLog.count({
          where: { action: "committees.expense.receipt_viewed" },
        }),
      ).toBe(2);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Reviewing                                                                */
  /* ------------------------------------------------------------------------ */

  describe("reviewing", () => {
    it("records who approved and when, and tells the submitter", async () => {
      const { id } = await claim(alice);
      expect((await getExpense(as(carol), id)).canReview).toBe(true);
      await reviewExpense(as(carol), id, { decision: "APPROVED", note: "Thanks" });

      const expense = await getExpense(as(alice), id);
      expect(expense).toMatchObject({
        status: "APPROVED",
        reviewer: { id: carol.id },
        reviewNote: "Thanks",
        canReview: false,
      });
      expect(expense.reviewedAt).not.toBeNull();
      const [notice] = await db().notification.findMany({
        where: { recipientId: alice.id },
      });
      expect(notice?.type).toBe("committees.expense.reviewed");
      expect(notice?.title).toBe("carol approved your expense");
      expect(notice?.body).toContain("Dinner TRY 1,250.50 on Turkey Trip");
      expect(notice?.link).toBe(`/committees/expenses/${id}`);
    });

    it("is refused to members, to one's own claim, and a second time", async () => {
      const { id } = await claim(alice);
      await expect(
        reviewExpense(as(bob), id, { decision: "APPROVED" }),
      ).rejects.toBeInstanceOf(ForbiddenError);

      const own = await claim(carol);
      await expect(
        reviewExpense(as(carol), own.id, { decision: "APPROVED" }),
      ).rejects.toThrow(/your own expense/);
      expect((await getExpense(as(carol), own.id)).canReview).toBe(false);

      await reviewExpense(as(carol), id, { decision: "REJECTED" });
      await expect(
        reviewExpense(as(carol), id, { decision: "APPROVED" }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("needs the approve right organisation-wide, not scoped to a unit", async () => {
      const unit = await db().organizationalUnit.create({
        data: { key: "cairo", name: "Cairo", path: "/cairo", depth: 0 },
        select: { id: true },
      });
      const scoped = await createRole("scoped-approver", [
        COMMITTEES_PERMISSIONS.ACCESS,
        COMMITTEES_PERMISSIONS.EXPENSE_READ,
        COMMITTEES_PERMISSIONS.EXPENSE_APPROVE,
      ]);
      const frank = await createUser({ email: "frank@example.com", orgUnitId: unit.id });
      await grantRole(frank.id, scoped.id, {
        scopeType: "ORG_UNIT",
        scopeOrgUnitId: unit.id,
      });
      const { id } = await claim(alice);
      await expect(
        reviewExpense(as(frank), id, { decision: "APPROVED" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      // Without a global grant they are not an approver, so they see only their own.
      expect((await listExpenses(as(frank))).total).toBe(0);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Converting to USD (ADR-038)                                              */
  /* ------------------------------------------------------------------------ */

  describe("converting to USD", () => {
    it("fixes the rate of the moment of submission, and the database derives the USD amount", async () => {
      const { id } = await claim(alice);
      const expense = await getExpense(as(alice), id);
      // TRY 1,250.50 at 49.45021 per USD = USD 25.29.
      expect(expense.amountUsdMinor).toBe(2529);
      expect(expense.usd).toEqual({
        amountMinor: 2529,
        rate: "49.45021",
        rateAt: TODAY.publishedAt,
        source: "exchangerate-api",
        convertedAt: expect.any(Date),
        timing: "submission",
      });
      expect((await listExpenses(as(alice))).rows[0]?.amountUsdMinor).toBe(2529);

      // A later rate never changes a claim already converted.
      exchange.getUsdRates.mockResolvedValue({
        ...TODAY,
        perUsd: new Map([...TODAY.perUsd, ["TRY", "60"]]),
      });
      expect((await getExpense(as(carol), id)).usd?.rate).toBe("49.45021");
    });

    it("converts a claim made in USD at par, without asking the feed", async () => {
      exchange.getUsdRates.mockClear();
      const { id } = await claim(alice, { currency: "USD", amount: "259.05" });
      expect(exchange.getUsdRates).not.toHaveBeenCalled();
      expect((await getExpense(as(alice), id)).usd).toMatchObject({
        amountMinor: 25905,
        rate: "1",
        source: "fixed",
      });
    });

    it("saves a claim when no rate can be had, and converts it later with that day's rate", async () => {
      exchange.getUsdRates.mockResolvedValue(null);
      const { id } = await claim(alice);
      const pending = await getExpense(as(alice), id);
      expect(pending).toMatchObject({
        usd: null,
        amountUsdMinor: null,
        status: "SUBMITTED",
      });
      expect((await getExpenseTotals(as(carol))).usd).toEqual({
        claimedMinor: 0,
        approvedMinor: 0,
        count: 1,
        pendingCount: 1,
      });
      // Reviewed while still unconverted: the rate can still be added afterwards.
      await reviewExpense(as(carol), id, { decision: "APPROVED" });

      // Ten minutes later the feed answers again (only Date is faked; the database is real).
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(Date.now() + 10 * 60 * 1000));
      try {
        exchange.getUsdRates.mockResolvedValue(TODAY);
        expect((await getExpenseTotals(as(carol))).usd).toEqual({
          claimedMinor: 2529,
          approvedMinor: 2529,
          count: 1,
          pendingCount: 0,
        });
      } finally {
        vi.useRealTimers();
      }
      expect((await getExpense(as(alice), id)).usd).toMatchObject({
        amountMinor: 2529,
        rate: "49.45021",
        timing: "later",
      });
    });

    it("shows the USD total on the missions list, counting claims not converted yet", async () => {
      await claim(alice, { amount: "100.00" });
      exchange.getUsdRates.mockResolvedValue(null);
      await claim(bob, { amount: "20.00", currency: "EUR" });
      const [turkeyRow] = (await listMissions(as(carol))).rows;
      expect(turkeyRow?.totals?.usd).toEqual({
        claimedMinor: 202,
        approvedMinor: 0,
        count: 2,
        pendingCount: 1,
      });
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Deleting                                                                 */
  /* ------------------------------------------------------------------------ */

  describe("deleting", () => {
    it("lets an administrator delete a claim whatever its status, out of every list and total", async () => {
      const dinner = await claim(alice, { amount: "100.00" });
      const taxi = await claim(alice, { amount: "50.00", category: "TRANSPORTATION" });
      await reviewExpense(as(carol), dinner.id, { decision: "APPROVED" });
      expect((await getExpense(as(carol), dinner.id)).canDelete).toBe(true);

      await deleteExpense(as(carol), dinner.id);

      expect((await listExpenses(as(carol))).rows.map((row) => row.id)).toEqual([
        taxi.id,
      ]);
      expect((await listExpenses(as(alice))).total).toBe(1);
      expect((await getExpenseTotals(as(carol))).currencies).toEqual([
        { currency: "TRY", claimedMinor: 5000, approvedMinor: 0, count: 1 },
      ]);
      expect((await listMissions(as(carol))).rows[0]?.expenseCount).toBe(1);
      await expect(getExpense(as(alice), dinner.id)).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await expect(getExpense(as(carol), dinner.id)).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await expect(getReceiptLink(as(carol), dinner.id)).rejects.toBeInstanceOf(
        NotFoundError,
      );

      // Kept on record, marked by whom.
      const row = await db().committeeMissionExpense.findUniqueOrThrow({
        where: { id: dinner.id },
        select: { deletedBy: true, deletedAt: true, status: true },
      });
      expect(row).toMatchObject({ deletedBy: carol.id, status: "APPROVED" });
      expect(row.deletedAt).not.toBeNull();
      const [audit] = await db().auditLog.findMany({
        where: { action: "committees.expense.deleted" },
      });
      expect(audit?.severity).toBe("WARNING");
      expect(audit?.summary).toBe(
        "Deleted Dinner TRY 100.00 on Turkey Trip claimed by alice (approved)",
      );
      expect(
        await db().eventOutbox.count({
          where: { name: "committees.MissionExpenseDeleted" },
        }),
      ).toBe(1);
      const notice = await db().notification.findFirst({
        where: { recipientId: alice.id, type: "committees.expense.deleted" },
      });
      expect(notice?.title).toBe("carol deleted your expense");
      expect(notice?.link).toBe("/committees/expenses");

      // Once: a second delete, or a review, finds nothing.
      await expect(deleteExpense(as(carol), dinner.id)).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await expect(
        reviewExpense(as(carol), taxi.id, { decision: "REJECTED" }),
      ).resolves.toBeUndefined();
      await deleteExpense(as(carol), taxi.id);
      await expect(
        reviewExpense(as(carol), taxi.id, { decision: "APPROVED" }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("lets an administrator delete their own claim, telling nobody", async () => {
      const own = await claim(carol);
      await deleteExpense(as(carol), own.id);
      expect((await listExpenses(as(carol))).total).toBe(0);
      expect(await db().notification.count()).toBe(0);
    });

    it("is refused to members and to an administrator scoped to a unit", async () => {
      const { id } = await claim(alice);
      expect((await getExpense(as(alice), id)).canDelete).toBe(false);
      await expect(deleteExpense(as(alice), id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(deleteExpense(as(bob), id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(deleteExpense(as(erin), id)).rejects.toBeInstanceOf(ForbiddenError);

      const unit = await db().organizationalUnit.create({
        data: { key: "giza", name: "Giza", path: "/giza", depth: 0 },
        select: { id: true },
      });
      const scoped = await createRole("scoped-admin", [
        COMMITTEES_PERMISSIONS.ACCESS,
        COMMITTEES_PERMISSIONS.ADMINISTER,
      ]);
      const gina = await createUser({ email: "gina@example.com", orgUnitId: unit.id });
      await grantRole(gina.id, scoped.id, {
        scopeType: "ORG_UNIT",
        scopeOrgUnitId: unit.id,
      });
      await expect(deleteExpense(as(gina), id)).rejects.toBeInstanceOf(ForbiddenError);
      expect((await listExpenses(as(carol))).total).toBe(1);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Database invariants, for every writer                                    */
  /* ------------------------------------------------------------------------ */

  describe("database invariants", () => {
    it("never edits or deletes a claim, and reviews it once", async () => {
      const { id } = await claim(alice);
      await expect(
        db()
          .$executeRaw`UPDATE committees.mission_expenses SET amount_minor = 1 WHERE id = ${id}::uuid`,
      ).rejects.toThrow(/cannot be edited/);
      await expect(
        db().$executeRaw`DELETE FROM committees.mission_expenses WHERE id = ${id}::uuid`,
      ).rejects.toThrow(/never deleted/);
      await reviewExpense(as(carol), id, { decision: "APPROVED" });
      await expect(
        db()
          .$executeRaw`UPDATE committees.mission_expenses SET status = 'REJECTED' WHERE id = ${id}::uuid`,
      ).rejects.toThrow(/cannot change/);
    });

    it("refuses self-review, an undescribed Other and a review without a reviewer", async () => {
      const { id } = await claim(alice);
      await expect(
        db().$executeRaw`
          UPDATE committees.mission_expenses
             SET status = 'APPROVED', reviewed_by = ${alice.id}::uuid, reviewed_at = now()
           WHERE id = ${id}::uuid`,
      ).rejects.toThrow(/mission_expenses_no_self_review/);
      await expect(
        db().$executeRaw`
          UPDATE committees.mission_expenses SET status = 'APPROVED' WHERE id = ${id}::uuid`,
      ).rejects.toThrow(/mission_expenses_review_recorded/);
      const receipt = await uploadReceipt(alice);
      await expect(
        db().$executeRaw`
          INSERT INTO committees.mission_expenses
            (mission_id, submitted_by, category, expense_date, amount_minor, currency, receipt_id)
          VALUES (${turkey}::uuid, ${alice.id}::uuid, 'OTHER', CURRENT_DATE, 100, 'TRY',
                  ${receipt}::uuid)`,
      ).rejects.toThrow(/mission_expenses_other_described/);
    });

    it("marks a claim deleted on its own, with who did it, and never changes it again", async () => {
      const { id } = await claim(alice);
      await expect(
        db().$executeRaw`
          UPDATE committees.mission_expenses SET deleted_at = now() WHERE id = ${id}::uuid`,
      ).rejects.toThrow(/mission_expenses_deleted_recorded/);
      await expect(
        db().$executeRaw`
          UPDATE committees.mission_expenses
             SET deleted_at = now(), deleted_by = ${carol.id}::uuid, status = 'APPROVED',
                 reviewed_by = ${carol.id}::uuid, reviewed_at = now()
           WHERE id = ${id}::uuid`,
      ).rejects.toThrow(/cannot also review it/);

      await reviewExpense(as(carol), id, { decision: "REJECTED" });
      await db().$executeRaw`
        UPDATE committees.mission_expenses
           SET deleted_at = now(), deleted_by = ${carol.id}::uuid
         WHERE id = ${id}::uuid`;
      await expect(
        db().$executeRaw`
          UPDATE committees.mission_expenses SET deleted_at = NULL, deleted_by = NULL
           WHERE id = ${id}::uuid`,
      ).rejects.toThrow(/deleted mission expense cannot change/);
      await expect(
        db().$executeRaw`DELETE FROM committees.mission_expenses WHERE id = ${id}::uuid`,
      ).rejects.toThrow(/never deleted/);
    });

    it("derives the USD amount itself, and fixes a rate once, whole", async () => {
      exchange.getUsdRates.mockResolvedValue(null);
      const { id } = await claim(alice);
      await expect(
        db().$executeRaw`
          UPDATE committees.mission_expenses SET amount_usd_minor = 1 WHERE id = ${id}::uuid`,
      ).rejects.toThrow(/amount_usd_minor/);
      await expect(
        db().$executeRaw`
          UPDATE committees.mission_expenses SET usd_rate = 50 WHERE id = ${id}::uuid`,
      ).rejects.toThrow(/mission_expenses_usd_recorded/);
      await db().$executeRaw`
        UPDATE committees.mission_expenses
           SET usd_rate = 50, usd_rate_at = now(), usd_rate_source = 'test',
               usd_converted_at = now()
         WHERE id = ${id}::uuid`;
      const [row] = await db().$queryRaw<{ amount_usd_minor: bigint }[]>`
        SELECT amount_usd_minor FROM committees.mission_expenses WHERE id = ${id}::uuid`;
      // TRY 1,250.50 at 50 per USD = USD 25.01.
      expect(Number(row?.amount_usd_minor)).toBe(2501);
      await expect(
        db().$executeRaw`
          UPDATE committees.mission_expenses SET usd_rate = 49 WHERE id = ${id}::uuid`,
      ).rejects.toThrow(/fixed once set/);
      await expect(
        db().$executeRaw`
          INSERT INTO committees.mission_expenses
            (mission_id, submitted_by, category, expense_date, amount_minor, currency,
             usd_rate, usd_rate_at, usd_rate_source, usd_converted_at)
          VALUES (${turkey}::uuid, ${alice.id}::uuid, 'DINNER', CURRENT_DATE, 100, 'USD',
                  2, now(), 'test', now())`,
      ).rejects.toThrow(/mission_expenses_usd_par/);
    });

    it("has row-level security on the new tables", async () => {
      const tables = await db().$queryRaw<{ relname: string; relrowsecurity: boolean }[]>`
        SELECT c.relname, c.relrowsecurity FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'committees'
           AND c.relname IN ('missions', 'expense_receipts', 'mission_expenses')`;
      expect(tables).toHaveLength(3);
      expect(tables.every((table) => table.relrowsecurity)).toBe(true);
    });
  });
});
