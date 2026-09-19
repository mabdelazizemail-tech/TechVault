import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { type Actor, canAll, requirePermission } from "@/platform/authz/authz";
import { CRM_PERMISSIONS } from "../contracts/permissions";
import type { ActivityDto, CrmDashboard, MoneyTotal } from "../contracts/types";
import { conversionRate, totalsFromGroups, weightedFromGroups } from "../domain/pipeline";
import { stageSelect, toStageDto } from "../repositories/selects";
import { listActivities } from "./activity-service";
import { ownerScope } from "./support";

/**
 * The CRM landing page figures.
 *
 * Every figure is computed over what the actor may see, so two salespeople with
 * OWN-scoped grants each see their own numbers, and every money figure is per
 * currency. These are indexed counts and sums over CRM tables — cheap at team
 * scale; when they stop being cheap they move to BI rollups (CLAUDE.md §6.7).
 */
export async function getCrmDashboard(actor: Actor): Promise<CrmDashboard> {
  await requirePermission(actor, CRM_PERMISSIONS.ACCESS);

  const rights = await canAll(actor, [
    CRM_PERMISSIONS.LEAD_READ,
    CRM_PERMISSIONS.OPPORTUNITY_READ,
    CRM_PERMISSIONS.ACTIVITY_READ,
  ]);
  const canLeads = rights[CRM_PERMISSIONS.LEAD_READ] === true;
  const canOpportunities = rights[CRM_PERMISSIONS.OPPORTUNITY_READ] === true;
  const canActivities = rights[CRM_PERMISSIONS.ACTIVITY_READ] === true;

  const [leads, opportunities, stages, recent, tasks] = await Promise.all([
    canLeads ? leadFigures(actor) : Promise.resolve(null),
    canOpportunities ? opportunityFigures(actor) : Promise.resolve(null),
    prisma.crmOpportunityStage.findMany({
      where: { isActive: true, kind: "OPEN" },
      orderBy: { position: "asc" },
      select: stageSelect,
    }),
    canActivities
      ? listActivities(actor, { page: 1, pageSize: 8 }, { view: "all" }).then(
          (page) => page.rows,
        )
      : Promise.resolve<ActivityDto[]>([]),
    canActivities
      ? listActivities(
          actor,
          { page: 1, pageSize: 6 },
          { view: "tasks", taskStatus: "open", mine: true },
        ).then((page) => page.rows)
      : Promise.resolve<ActivityDto[]>([]),
  ]);

  return {
    totalLeads: leads?.total ?? 0,
    newLeads: leads?.fresh ?? 0,
    qualifiedLeads: leads?.qualified ?? 0,
    openOpportunities: opportunities?.openCount ?? 0,
    pipeline: opportunities?.pipeline ?? [],
    weightedPipeline: opportunities?.weighted ?? [],
    wonCount: opportunities?.wonCount ?? 0,
    won: opportunities?.won ?? [],
    lostCount: opportunities?.lostCount ?? 0,
    conversionRate: leads === null ? null : conversionRate(leads.converted, leads.total),
    stageBreakdown: stages.map((stage) => {
      const groups =
        opportunities?.byStage.filter((group) => group.stageId === stage.id) ?? [];
      return {
        stage: toStageDto(stage),
        count: groups.reduce((sum, group) => sum + group._count._all, 0),
        totals: totalsFromGroups(groups),
      };
    }),
    recentActivity: recent,
    openTasks: tasks,
  };
}

async function leadFigures(actor: Actor) {
  const scoped = (await ownerScope(
    actor,
    CRM_PERMISSIONS.LEAD_READ,
  )) as Prisma.CrmLeadWhereInput;
  const where = (extra: Prisma.CrmLeadWhereInput): Prisma.CrmLeadWhereInput => ({
    AND: [{ deletedAt: null }, scoped, extra],
  });

  // One grouped count instead of four: every lead figure is a slice of it.
  const groups = await prisma.crmLead.groupBy({
    by: ["status"],
    where: where({}),
    _count: { _all: true },
  });
  const countOf = (status: string) =>
    groups.find((group) => group.status === status)?._count._all ?? 0;

  return {
    total: groups.reduce((sum, group) => sum + group._count._all, 0),
    fresh: countOf("NEW"),
    qualified: countOf("QUALIFIED"),
    converted: countOf("CONVERTED"),
  };
}

async function opportunityFigures(actor: Actor): Promise<{
  openCount: number;
  pipeline: MoneyTotal[];
  weighted: MoneyTotal[];
  wonCount: number;
  won: MoneyTotal[];
  lostCount: number;
  byStage: {
    stageId: string;
    currency: MoneyTotal["currency"];
    _count: { _all: number };
    _sum: { amountMinor: number | null };
  }[];
}> {
  const scoped = (await ownerScope(
    actor,
    CRM_PERMISSIONS.OPPORTUNITY_READ,
  )) as Prisma.CrmOpportunityWhereInput;
  const where = (
    extra: Prisma.CrmOpportunityWhereInput,
  ): Prisma.CrmOpportunityWhereInput => ({
    AND: [{ deletedAt: null }, scoped, extra],
  });

  // One grouped query instead of five: the open, won and lost figures and the
  // per-stage breakdown are all slices of the same status × stage × currency
  // grouping. Money stays per currency throughout (ADR-016).
  const [groups, openByAmount] = await Promise.all([
    prisma.crmOpportunity.groupBy({
      by: ["status", "stageId", "currency"],
      where: where({}),
      _count: { _all: true },
      _sum: { amountMinor: true },
    }),
    // Weighting rounds each deal, so open deals are grouped by amount and
    // probability rather than summed first.
    prisma.crmOpportunity.groupBy({
      by: ["currency", "amountMinor", "probability"],
      where: where({ status: "OPEN" }),
      _count: { _all: true },
    }),
  ]);

  type Group = (typeof groups)[number];
  const withStatus = (status: string) =>
    groups.filter((group) => group.status === status);
  const countOf = (rows: readonly Group[]) =>
    rows.reduce((sum, group) => sum + group._count._all, 0);

  const open = withStatus("OPEN");
  const won = withStatus("WON");

  return {
    openCount: countOf(open),
    // totalsFromGroups merges the several stage rows that share a currency.
    pipeline: totalsFromGroups(open),
    weighted: weightedFromGroups(openByAmount),
    wonCount: countOf(won),
    won: totalsFromGroups(won),
    lostCount: countOf(withStatus("LOST")),
    byStage: open.map((group) => ({
      stageId: group.stageId,
      currency: group.currency,
      _count: { _all: group._count._all },
      _sum: { amountMinor: group._sum.amountMinor },
    })),
  };
}
