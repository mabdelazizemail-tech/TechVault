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
  getArSettings,
  listAccountOptions,
  listPaymentMethods,
  listTaxRates,
} from "@/modules/erp/contracts/service";
import { AR_DOCUMENT_TYPE_LABELS } from "@/modules/erp/contracts/types";
import { formatBasisPoints } from "@/modules/erp/domain/ar";
import {
  ArSettingsForm,
  NumberSeriesForm,
  PaymentMethodFormButton,
  TaxRateFormButton,
} from "@/modules/erp/ui/ar-settings-forms";
import { orNotFound } from "@/modules/erp/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";
import { canGlobally } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "AR settings" };

/** Everything accounts receivable is configured by — data, never code. */
export default async function ArSettingsPage() {
  const actor = await getActor();
  const settings = await orNotFound(getArSettings(actor));
  const [taxRates, methods, accounts] = await Promise.all([
    listTaxRates(actor, { activeOnly: false }),
    listPaymentMethods(actor, { activeOnly: false }),
    (await canGlobally(actor, ERP_PERMISSIONS.ACCOUNT_READ))
      ? listAccountOptions(actor, { postable: true })
      : Promise.resolve([]),
  ]);
  const assetAccounts = accounts.filter((account) => account.type === "ASSET");
  const liabilityAccounts = accounts.filter((account) => account.type === "LIABILITY");

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="AR settings"
        description="Approval rules, defaults, aging buckets, tax rates, payment methods and document numbering for accounts receivable."
      />

      <Panel>
        <PanelHeader title="Rules and defaults" />
        <ArSettingsForm settings={settings} assetAccounts={assetAccounts} />
      </Panel>

      <Panel className="overflow-hidden">
        <PanelHeader
          title="Tax rates"
          description="Rates are data. Invoice lines keep the rate they were calculated with."
          actions={<TaxRateFormButton liabilityAccounts={liabilityAccounts} />}
        />
        {taxRates.length === 0 ? (
          <EmptyState
            title="No tax rates"
            description="Add the rates your invoices use, each credited to a liability account."
          />
        ) : (
          <ul className="divide-border divide-y">
            {taxRates.map((rate) => (
              <li key={rate.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">
                    {rate.code} · {formatBasisPoints(rate.rateBasisPoints)}
                  </span>
                  <span className="text-foreground-muted text-xs">
                    <span dir="auto">{rate.name}</span> · credited to{" "}
                    {rate.taxAccount.code} {rate.taxAccount.name}
                  </span>
                </span>
                {!rate.isActive && <Badge tone="warning">Inactive</Badge>}
                <TaxRateFormButton rate={rate} liabilityAccounts={liabilityAccounts} />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel className="overflow-hidden">
        <PanelHeader
          title="Payment methods"
          actions={<PaymentMethodFormButton depositAccounts={assetAccounts} />}
        />
        <ul className="divide-border divide-y">
          {methods.map((method) => (
            <li key={method.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold" dir="auto">
                  {method.name}
                </span>
                <span className="text-foreground-muted text-xs">
                  {method.code}
                  {method.defaultDepositAccount !== null &&
                    ` · deposits to ${method.defaultDepositAccount.code} ${method.defaultDepositAccount.name}`}
                </span>
              </span>
              {!method.isActive && <Badge tone="warning">Inactive</Badge>}
              <PaymentMethodFormButton method={method} depositAccounts={assetAccounts} />
            </li>
          ))}
        </ul>
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
              label={AR_DOCUMENT_TYPE_LABELS[series.documentType]}
            />
          ))}
        </div>
      </Panel>
    </div>
  );
}
