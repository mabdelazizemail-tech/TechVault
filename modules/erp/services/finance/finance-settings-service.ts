import { ValidationError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { diffForAudit, recordAudit } from "@/platform/audit/audit";
import {
  type Actor,
  canAllGlobally,
  requireGlobalPermission,
} from "@/platform/authz/authz";
import { ERP_PERMISSIONS } from "../../contracts/permissions";
import { financeSettingsSchema } from "../../contracts/schemas";
import type { FinanceSettingsDto, JournalDefaults } from "../../contracts/types";
import { accountRefSelect } from "../../repositories/selects";
import { requireAccount } from "./ar/support";
import {
  ERP_MODULE,
  asFinanceError,
  auditFields,
  loadFinanceSettings,
  parseInput,
} from "./support";

/**
 * Finance configuration (ADR-027): whether people may post manual journal entries they
 * created or last edited, and the equity accounts that year-end close and opening
 * balance journals use. Data an administrator changes, never code.
 */

export async function getFinanceSettings(actor: Actor): Promise<FinanceSettingsDto> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.FINANCE_SETTINGS_ADMINISTER);
  const row = await prisma.erpFinanceSettings.findUnique({
    where: { id: 1 },
    select: {
      allowSelfPosting: true,
      retainedEarningsAccount: { select: accountRefSelect },
      openingBalanceAccount: { select: accountRefSelect },
    },
  });
  return {
    allowSelfPosting: row?.allowSelfPosting ?? false,
    retainedEarningsAccount: row?.retainedEarningsAccount ?? null,
    openingBalanceAccount: row?.openingBalanceAccount ?? null,
  };
}

/** The part of finance settings the journal form needs, for anyone who writes journals. */
export async function getJournalDefaults(actor: Actor): Promise<JournalDefaults> {
  const rights = await canAllGlobally(actor, [
    ERP_PERMISSIONS.JOURNAL_CREATE,
    ERP_PERMISSIONS.JOURNAL_UPDATE,
  ]);
  if (
    rights[ERP_PERMISSIONS.JOURNAL_CREATE] !== true &&
    rights[ERP_PERMISSIONS.JOURNAL_UPDATE] !== true
  ) {
    // Throws, and records the denial like every other refusal.
    await requireGlobalPermission(actor, ERP_PERMISSIONS.JOURNAL_CREATE);
  }
  const row = await prisma.erpFinanceSettings.findUnique({
    where: { id: 1 },
    select: { openingBalanceAccount: { select: accountRefSelect } },
  });
  return { openingBalanceAccount: row?.openingBalanceAccount ?? null };
}

export async function updateFinanceSettings(actor: Actor, input: unknown): Promise<void> {
  await requireGlobalPermission(actor, ERP_PERMISSIONS.FINANCE_SETTINGS_ADMINISTER);
  const data = parseInput(financeSettingsSchema, input);
  if (data.retainedEarningsAccountId !== null) {
    await requireAccount(
      data.retainedEarningsAccountId,
      ["EQUITY"],
      "retainedEarningsAccountId",
    );
  }
  if (data.openingBalanceAccountId !== null) {
    await requireAccount(
      data.openingBalanceAccountId,
      ["EQUITY"],
      "openingBalanceAccountId",
    );
  }
  if (
    data.retainedEarningsAccountId !== null &&
    data.retainedEarningsAccountId === data.openingBalanceAccountId
  ) {
    throw new ValidationError("Please correct the highlighted fields.", {
      openingBalanceAccountId: [
        "Use a different account from retained earnings, so opening balances stay visible.",
      ],
    });
  }

  const before = await loadFinanceSettings();
  const changes = diffForAudit(before, data);
  if (Object.keys(changes).length === 0) return;
  // Letting people post their own entries switches a control off, so it stands out.
  const weakensControl = data.allowSelfPosting && !before.allowSelfPosting;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.erpFinanceSettings.upsert({
        where: { id: 1 },
        create: { id: 1, ...data, updatedBy: actor.id },
        update: { ...data, updatedBy: actor.id },
      });
      await recordAudit(
        {
          ...auditFields(actor),
          action: "erp.finance_settings.updated",
          module: ERP_MODULE,
          entityType: "finance_settings",
          entityId: "1",
          summary: weakensControl
            ? "Allowed people to post journal entries they created or edited"
            : "Updated finance settings",
          changes,
          severity: weakensControl ? "WARNING" : "NOTICE",
        },
        tx,
      );
    });
  } catch (error) {
    throw asFinanceError(error);
  }
}
