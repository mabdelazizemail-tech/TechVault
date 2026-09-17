import type { Metadata } from "next";
import {
  Badge,
  EmptyState,
  PageHeader,
  Panel,
  PanelHeader,
} from "@/components/ui/primitives";
import { ERP_PERMISSIONS } from "@/modules/erp/contracts/permissions";
import {
  getApSettings,
  listAccountOptions,
  listWithholdingTaxRates,
} from "@/modules/erp/contracts/service";
import { FINANCE_DOCUMENT_TYPE_LABELS } from "@/modules/erp/contracts/types";
import { formatBasisPoints } from "@/modules/erp/domain/ar";
import { ApSettingsForm, WithholdingRateFormButton } from "@/modules/erp/ui/ap-settings-forms";
import { NumberSeriesForm } from "@/modules/erp/ui/ar-settings-forms";
import { orNotFound } from "@/modules/erp/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";
import { canGlobally } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "AP settings" };

/** Everything accounts payable is configured by — data, never code. */
export default async function ApSettingsPage() {
  const actor = await getActor();
  const settings = await orNotFound(getApSettings(actor));
  const [rates, accounts] = await Promise.all([
    listWithholdingTaxRates(actor, { activeOnly: false }),
    (await canGlobally(actor, ERP_PERMISSIONS.ACCOUNT_READ))
      ? listAccountOptions(actor, { postable: true })
      : Promise.resolve([]),
  ]);
  const liabilityAccounts = accounts.filter((account) => account.type === "LIABILITY");

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="AP settings"
        description="Approval rules, defaults, aging buckets, withholding tax rates and document numbering for accounts payable. Input VAT accounts are set on each tax rate in AR settings."
      />

      <Panel>
        <PanelHeader title="Rules and defaults" />
        <ApSettingsForm settings={settings} liabilityAccounts={liabilityAccounts} />
      </Panel>

      <Panel className="overflow-hidden">
        <PanelHeader
          title="Withholding tax rates"
          description="Deducted from supplier payments and credited to a liability account."
          actions={<WithholdingRateFormButton liabilityAccounts={liabilityAccounts} />}
        />
        {rates.length === 0 ? (
          <EmptyState
            title="No withholding rates"
            description="Add the rates your supplier payments withhold, each credited to a liability account."
          />
        ) : (
          <ul className="divide-border divide-y">
            {rates.map((rate) => (
              <li key={rate.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">
                    {rate.code} · {formatBasisPoints(rate.rateBasisPoints)}
                  </span>
                  <span className="text-foreground-muted text-xs">
                    <span dir="auto">{rate.name}</span> · credited to{" "}
                    {rate.payableAccount.code} {rate.payableAccount.name}
                  </span>
                </span>
                {!rate.isActive && <Badge tone="warning">Inactive</Badge>}
                <WithholdingRateFormButton
                  rate={rate}
                  liabilityAccounts={liabilityAccounts}
                />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel className="overflow-hidden">
        <PanelHeader
          title="Document numbering"
          description="Numbers are assigned when a document is posted, without gaps."
        />
        <div className="divide-border divide-y">
          {settings.numberSeries.map((series) => (
            <NumberSeriesForm
              key={series.id}
              series={series}
              label={FINANCE_DOCUMENT_TYPE_LABELS[series.documentType]}
            />
          ))}
        </div>
      </Panel>
    </div>
  );
}
