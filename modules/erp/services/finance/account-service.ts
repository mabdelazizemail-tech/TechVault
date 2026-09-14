import type { Prisma } from "@prisma/client";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { diffForAudit, recordAudit } from "@/platform/audit/audit";
import { type Actor, requirePermission } from "@/platform/authz/authz";
import { publish } from "@/platform/events/publish";
import { ERP_EVENTS } from "../../contracts/events";
import { ERP_PERMISSIONS } from "../../contracts/permissions";
import {
  accountCreateSchema,
  accountUpdateSchema,
  activeSchema,
  listParamsSchema,
} from "../../contracts/schemas";
import {
  ACCOUNT_TYPE_LABELS,
  DEFAULT_NORMAL_BALANCE,
  type AccountActivity,
  type AccountDetail,
  type AccountListItem,
  type AccountOption,
  type AccountType,
  type Paginated,
} from "../../contracts/types";
import {
  accountListSelect,
  accountRefSelect,
  costCentreRefSelect,
} from "../../repositories/selects";
import {
  ERP_MODULE,
  asFinanceError,
  assertId,
  auditFields,
  dateFromIso,
  isUniqueViolation,
  isoDateOf,
  likePattern,
  parseInput,
  toAccountListItem,
  toAmount,
} from "./support";

/**
 * The chart of accounts.
 *
 * Accounts form a tree: headings group, postable accounts take postings. A child
 * shares its parent's type; an account used in journal entries keeps its type and
 * stays postable. The database enforces the same rules (ADR-022).
 */

const TREE_PAGE_SIZE = 100;
const ACTIVITY_PAGE_SIZE = 50;
/** A picker lists at most this many accounts (§29: a type-ahead picker replaces it). */
const OPTION_LIMIT = 1000;

export async function listAccounts(
  actor: Actor,
  rawParams: Record<string, unknown> = {},
): Promise<Paginated<AccountListItem>> {
  await requirePermission(actor, ERP_PERMISSIONS.ACCOUNT_READ);
  const params = listParamsSchema.parse(rawParams);
  const pattern =
    params.q === undefined || params.q === "" ? null : likePattern(params.q);
  const type = params.type ?? null;
  const active = params.active === "all" ? null : params.active === "active";

  // The tree is walked in the database and ordered by the path of codes, so a page
  // of 100 reads in hierarchy order without loading the chart into memory.
  const hits = await prisma.$queryRaw<{ id: string; depth: number; total: bigint }[]>`
    WITH RECURSIVE tree AS (
      SELECT a.id, 0 AS depth, ARRAY[a.code]::text[] AS path
        FROM erp.accounts a
       WHERE a.parent_id IS NULL
      UNION ALL
      SELECT c.id, t.depth + 1, t.path || c.code
        FROM erp.accounts c
        JOIN tree t ON c.parent_id = t.id
    )
    SELECT t.id, t.depth, count(*) OVER () AS total
      FROM tree t
      JOIN erp.accounts a ON a.id = t.id
     WHERE (${pattern}::text IS NULL
            OR a.code ILIKE ${pattern} OR a.name ILIKE ${pattern} OR a.name_ar ILIKE ${pattern})
       AND (${type}::text IS NULL OR a.type::text = ${type})
       AND (${active}::boolean IS NULL OR a.is_active = ${active})
     ORDER BY t.path
     LIMIT ${TREE_PAGE_SIZE} OFFSET ${(params.page - 1) * TREE_PAGE_SIZE}`;

  const rows =
    hits.length === 0
      ? []
      : await prisma.erpAccount.findMany({
          where: { id: { in: hits.map((hit) => hit.id) } },
          select: accountListSelect,
        });
  const byId = new Map(rows.map((row) => [row.id, row]));

  return {
    rows: hits.flatMap((hit) => {
      const row = byId.get(hit.id);
      return row === undefined ? [] : [toAccountListItem(row, hit.depth)];
    }),
    total: Number(hits[0]?.total ?? 0),
    page: params.page,
    pageSize: TREE_PAGE_SIZE,
  };
}

/** Active accounts for a picker: postable ones for journal lines, headings for parents. */
export async function listAccountOptions(
  actor: Actor,
  options: { postable: boolean },
): Promise<AccountOption[]> {
  await requirePermission(actor, ERP_PERMISSIONS.ACCOUNT_READ);
  const rows = await prisma.erpAccount.findMany({
    where: { isActive: true, isPostable: options.postable },
    orderBy: { code: "asc" },
    take: OPTION_LIMIT,
    select: { ...accountRefSelect, type: true, isPostable: true },
  });
  return rows;
}

export async function getAccount(
  actor: Actor,
  accountId: string,
): Promise<AccountDetail> {
  await requirePermission(actor, ERP_PERMISSIONS.ACCOUNT_READ);
  assertId(accountId, "account");

  const row = await prisma.erpAccount.findUnique({
    where: { id: accountId },
    select: {
      ...accountListSelect,
      description: true,
      createdAt: true,
      updatedAt: true,
      parent: { select: accountRefSelect },
    },
  });
  if (row === null) throw new NotFoundError("account");

  const [sums, lineCount] = await Promise.all([
    prisma.erpJournalLine.aggregate({
      where: { accountId, entry: { status: { in: ["POSTED", "REVERSED"] } } },
      _sum: { debitMinor: true, creditMinor: true },
    }),
    prisma.erpJournalLine.count({ where: { accountId } }),
  ]);
  const debit = sums._sum.debitMinor ?? 0n;
  const credit = sums._sum.creditMinor ?? 0n;

  return {
    ...toAccountListItem(row, 0),
    description: row.description,
    parent: row.parent,
    totals: {
      debitMinor: toAmount(debit),
      creditMinor: toAmount(credit),
      balanceMinor: toAmount(
        row.normalBalance === "DEBIT" ? debit - credit : credit - debit,
      ),
    },
    hasPostings: lineCount > 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Posted lines on one account, newest first, with totals across every page. */
export async function listAccountActivity(
  actor: Actor,
  accountId: string,
  rawParams: Record<string, unknown> = {},
): Promise<AccountActivity> {
  await requirePermission(actor, ERP_PERMISSIONS.ACCOUNT_READ);
  await requirePermission(actor, ERP_PERMISSIONS.JOURNAL_READ);
  assertId(accountId, "account");
  const account = await prisma.erpAccount.findUnique({
    where: { id: accountId },
    select: { id: true },
  });
  if (account === null) throw new NotFoundError("account");

  const params = listParamsSchema.parse(rawParams);
  const where: Prisma.ErpJournalLineWhereInput = {
    accountId,
    entry: {
      status: { in: ["POSTED", "REVERSED"] },
      ...(params.from !== undefined || params.to !== undefined
        ? {
            entryDate: {
              ...(params.from !== undefined ? { gte: dateFromIso(params.from) } : {}),
              ...(params.to !== undefined ? { lte: dateFromIso(params.to) } : {}),
            },
          }
        : {}),
    },
  };

  const [total, sums, rows] = await Promise.all([
    prisma.erpJournalLine.count({ where }),
    prisma.erpJournalLine.aggregate({
      where,
      _sum: { debitMinor: true, creditMinor: true },
    }),
    prisma.erpJournalLine.findMany({
      where,
      orderBy: [
        { entry: { entryDate: "desc" } },
        { entry: { journalNumber: "desc" } },
        { lineNo: "asc" },
      ],
      skip: (params.page - 1) * ACTIVITY_PAGE_SIZE,
      take: ACTIVITY_PAGE_SIZE,
      select: {
        id: true,
        description: true,
        debitMinor: true,
        creditMinor: true,
        costCentre: { select: costCentreRefSelect },
        entry: {
          select: {
            id: true,
            journalNumber: true,
            entryDate: true,
            description: true,
            status: true,
          },
        },
      },
    }),
  ]);

  return {
    rows: rows.map((line) => ({
      lineId: line.id,
      entryId: line.entry.id,
      journalNumber: line.entry.journalNumber ?? "",
      entryDate: isoDateOf(line.entry.entryDate),
      description: line.description ?? line.entry.description,
      entryStatus: line.entry.status,
      costCentre: line.costCentre,
      debitMinor: toAmount(line.debitMinor),
      creditMinor: toAmount(line.creditMinor),
    })),
    total,
    page: params.page,
    pageSize: ACTIVITY_PAGE_SIZE,
    totals: {
      debitMinor: toAmount(sums._sum.debitMinor ?? 0n),
      creditMinor: toAmount(sums._sum.creditMinor ?? 0n),
    },
  };
}

/** A parent must exist, be a heading, and share the child's type. */
async function assertParent(
  parentId: string | null,
  type: AccountType,
  selfId?: string,
): Promise<void> {
  if (parentId === null) return;
  const invalid = (message: string) =>
    new ValidationError("Please correct the highlighted fields.", {
      parentId: [message],
    });
  if (parentId === selfId) throw invalid("An account cannot be its own parent.");

  const parent = await prisma.erpAccount.findUnique({
    where: { id: parentId },
    select: { code: true, type: true, isPostable: true },
  });
  if (parent === null) throw invalid("Choose a valid parent account.");
  if (parent.type !== type) {
    throw invalid(
      `${parent.code} is not an ${ACCOUNT_TYPE_LABELS[type].toLowerCase()} account.`,
    );
  }
  if (parent.isPostable) {
    throw invalid(`${parent.code} takes postings, so it cannot have sub-accounts.`);
  }
}

export async function createAccount(
  actor: Actor,
  input: unknown,
): Promise<{ id: string }> {
  await requirePermission(actor, ERP_PERMISSIONS.ACCOUNT_CREATE);
  const data = parseInput(accountCreateSchema, input);
  await assertParent(data.parentId, data.type);
  const normalBalance = data.normalBalance ?? DEFAULT_NORMAL_BALANCE[data.type];

  try {
    return await prisma.$transaction(async (tx) => {
      const account = await tx.erpAccount.create({
        data: {
          code: data.code,
          name: data.name,
          nameAr: data.nameAr,
          type: data.type,
          normalBalance,
          parentId: data.parentId,
          isPostable: data.isPostable,
          description: data.description,
          createdBy: actor.id,
          updatedBy: actor.id,
        },
        select: { id: true },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.account.created",
          module: ERP_MODULE,
          entityType: "account",
          entityId: account.id,
          summary: `Created account ${data.code} ${data.name}`,
          changes: {
            code: data.code,
            name: data.name,
            type: data.type,
            normalBalance,
            parentId: data.parentId,
            isPostable: data.isPostable,
          },
        },
        tx,
      );
      await publish(tx, {
        name: ERP_EVENTS.ACCOUNT_CREATED,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: { accountId: account.id, code: data.code, type: data.type },
      });
      return account;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError("An account with this code already exists.");
    }
    throw asFinanceError(error);
  }
}

export async function updateAccount(
  actor: Actor,
  accountId: string,
  input: unknown,
): Promise<{ id: string }> {
  await requirePermission(actor, ERP_PERMISSIONS.ACCOUNT_UPDATE);
  assertId(accountId, "account");
  const data = parseInput(accountUpdateSchema, input);

  const before = await prisma.erpAccount.findUnique({
    where: { id: accountId },
    select: {
      code: true,
      name: true,
      nameAr: true,
      type: true,
      normalBalance: true,
      parentId: true,
      isPostable: true,
      description: true,
    },
  });
  if (before === null) throw new NotFoundError("account");
  await assertParent(data.parentId, data.type, accountId);

  const { code, ...current } = before;
  const next = {
    name: data.name,
    nameAr: data.nameAr,
    type: data.type,
    normalBalance:
      data.normalBalance ??
      (data.type === before.type
        ? before.normalBalance
        : DEFAULT_NORMAL_BALANCE[data.type]),
    parentId: data.parentId,
    isPostable: data.isPostable,
    description: data.description,
  };
  const changes = diffForAudit(current, next);
  if (Object.keys(changes).length === 0) return { id: accountId };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.erpAccount.update({
        where: { id: accountId },
        data: { ...next, updatedBy: actor.id },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.account.updated",
          module: ERP_MODULE,
          entityType: "account",
          entityId: accountId,
          summary: `Updated account ${code}`,
          changes,
        },
        tx,
      );
      await publish(tx, {
        name: ERP_EVENTS.ACCOUNT_UPDATED,
        actorId: actor.id,
        correlationId: actor.correlationId ?? null,
        payload: { accountId, code, changedFields: Object.keys(changes) },
      });
    });
  } catch (error) {
    throw asFinanceError(error);
  }
  return { id: accountId };
}

export async function setAccountActive(
  actor: Actor,
  accountId: string,
  input: unknown,
): Promise<{ id: string }> {
  await requirePermission(actor, ERP_PERMISSIONS.ACCOUNT_ADMINISTER);
  assertId(accountId, "account");
  const { isActive } = parseInput(activeSchema, input);

  const account = await prisma.erpAccount.findUnique({
    where: { id: accountId },
    select: { code: true, isActive: true },
  });
  if (account === null) throw new NotFoundError("account");
  if (account.isActive === isActive) return { id: accountId };

  await prisma.$transaction(async (tx) => {
    await tx.erpAccount.update({
      where: { id: accountId },
      data: { isActive, updatedBy: actor.id },
    });
    await recordAudit(
      {
        ...auditFields(actor),
        action: isActive ? "erp.account.activated" : "erp.account.deactivated",
        module: ERP_MODULE,
        entityType: "account",
        entityId: accountId,
        summary: `${isActive ? "Activated" : "Deactivated"} account ${account.code}`,
        changes: { isActive: { from: account.isActive, to: isActive } },
        severity: isActive ? "INFO" : "NOTICE",
      },
      tx,
    );
    await publish(tx, {
      name: ERP_EVENTS.ACCOUNT_UPDATED,
      actorId: actor.id,
      correlationId: actor.correlationId ?? null,
      payload: { accountId, code: account.code, changedFields: ["isActive"] },
    });
  });
  return { id: accountId };
}
