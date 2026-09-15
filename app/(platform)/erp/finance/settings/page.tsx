import type { Metadata } from "next";
import { PageHeader, Panel, PanelHeader } from "@/components/ui/primitives";
import { ERP_PERMISSIONS } from "@/modules/erp/contracts/permissions";
import { getFinanceSettings, listAccountOptions } from "@/modules/erp/contracts/service";
import { FinanceSettingsForm } from "@/modules/erp/ui/finance-settings-form";
import { orNotFound } from "@/modules/erp/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";
import { canGlobally } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Finance settings" };

/** Finance rules that are data, never code (ADR-027). */
export default async function FinanceSettingsPage() {
  const actor = await getActor();
  const settings = await orNotFound(getFinanceSettings(actor));
  const accounts = (await canGlobally(actor, ERP_PERMISSIONS.ACCOUNT_READ))
    ? await listAccountOptions(actor, { postable: true })
    : [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Finance settings"
        description="Who may post journal entries, and the equity accounts that year-end close and opening balances use."
      />
      <Panel>
        <PanelHeader title="Posting and equity accounts" />
        <FinanceSettingsForm
          settings={settings}
          equityAccounts={accounts.filter((account) => account.type === "EQUITY")}
        />
      </Panel>
    </div>
  );
}
