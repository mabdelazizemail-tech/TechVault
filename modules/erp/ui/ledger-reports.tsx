import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, EmptyState } from "@/components/ui/primitives";
import type {
  BalanceSheet,
  ProfitAndLoss,
  ReportAccount,
  StatementSection,
  TrialBalance,
} from "../contracts/types";
import { formatAmount, formatAmountOrBlank } from "./format";

/**
 * The ledger report tables (ADR-026). Server components: they lay out figures the
 * report service computed and decide nothing.
 */

const TH = "label-caps border-border border-b-2 px-4 py-2.5 whitespace-nowrap";
const CELL = "px-4 py-2.5";
const NUMBER = "px-4 py-2.5 text-end tabular-nums whitespace-nowrap";

function AccountCell({ account }: { account: ReportAccount }) {
  return (
    <Link
      href={`/erp/finance/accounts/${account.id}`}
      className="flex flex-col hover:underline"
    >
      <span>
        <span dir="ltr" className="font-semibold tabular-nums">
          {account.code}
        </span>{" "}
        <span dir="auto">{account.name}</span>
      </span>
      {account.nameAr !== null && (
        <span dir="rtl" lang="ar" className="text-foreground-muted text-xs">
          {account.nameAr}
        </span>
      )}
    </Link>
  );
}

/** A signed balance as an accountant reads it: "1,000.00 Dr" or "1,000.00 Cr". */
function DebitOrCredit({ minor }: { minor: number }) {
  if (minor === 0) return <>—</>;
  return (
    <>
      {formatAmount(Math.abs(minor))} {minor > 0 ? "Dr" : "Cr"}
    </>
  );
}

export function BalanceBadge({ balanced, label }: { balanced: boolean; label: string }) {
  return balanced ? (
    <Badge tone="success">{label}</Badge>
  ) : (
    <Badge tone="danger">Out of balance</Badge>
  );
}

export function TrialBalanceTable({ report }: { report: TrialBalance }) {
  if (report.rows.length === 0) {
    return (
      <EmptyState
        title="No postings in these dates"
        description="Accounts appear here once journal entries, invoices or receipts are posted to them."
      />
    );
  }
  const withOpening = report.from !== null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-surface">
          <tr>
            <th scope="col" className={`${TH} text-start`}>
              Account
            </th>
            {withOpening && (
              <th scope="col" className={`${TH} text-end`}>
                Opening
              </th>
            )}
            <th scope="col" className={`${TH} text-end`}>
              Debits
            </th>
            <th scope="col" className={`${TH} text-end`}>
              Credits
            </th>
            <th scope="col" className={`${TH} text-end`}>
              Debit balance
            </th>
            <th scope="col" className={`${TH} text-end`}>
              Credit balance
            </th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row) => (
            <tr
              key={row.account.id}
              className="border-border hover:bg-surface-hover border-b"
            >
              <td className={CELL}>
                <AccountCell account={row.account} />
              </td>
              {withOpening && (
                <td dir="ltr" className={NUMBER}>
                  <DebitOrCredit minor={row.openingMinor} />
                </td>
              )}
              <td dir="ltr" className={NUMBER}>
                {formatAmountOrBlank(row.debitMinor)}
              </td>
              <td dir="ltr" className={NUMBER}>
                {formatAmountOrBlank(row.creditMinor)}
              </td>
              <td dir="ltr" className={NUMBER}>
                {formatAmountOrBlank(row.closingDebitMinor)}
              </td>
              <td dir="ltr" className={NUMBER}>
                {formatAmountOrBlank(row.closingCreditMinor)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="rule-t font-bold">
            <td className={CELL}>Total</td>
            {withOpening && (
              <td dir="ltr" className={NUMBER}>
                {formatAmount(report.totals.openingDebitMinor)} Dr
                <br />
                {formatAmount(report.totals.openingCreditMinor)} Cr
              </td>
            )}
            <td dir="ltr" className={NUMBER}>
              {formatAmount(report.totals.debitMinor)}
            </td>
            <td dir="ltr" className={NUMBER}>
              {formatAmount(report.totals.creditMinor)}
            </td>
            <td dir="ltr" className={NUMBER} data-testid="trial-balance-debit-total">
              {formatAmount(report.totals.closingDebitMinor)}
            </td>
            <td dir="ltr" className={NUMBER} data-testid="trial-balance-credit-total">
              {formatAmount(report.totals.closingCreditMinor)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function SectionRows({ label, section }: { label: string; section: StatementSection }) {
  return (
    <>
      <tr className="bg-surface-sunken">
        <th scope="colgroup" colSpan={2} className={`${TH} text-start`}>
          {label}
        </th>
      </tr>
      {section.rows.length === 0 ? (
        <tr className="border-border border-b">
          <td colSpan={2} className={`${CELL} text-foreground-muted`}>
            Nothing posted.
          </td>
        </tr>
      ) : (
        section.rows.map((row) => (
          <tr
            key={row.account.id}
            className="border-border hover:bg-surface-hover border-b"
          >
            <td className={CELL}>
              <AccountCell account={row.account} />
            </td>
            <td dir="ltr" className={NUMBER}>
              {formatAmount(row.amountMinor)}
            </td>
          </tr>
        ))
      )}
      <tr className="border-border border-b font-bold">
        <td className={CELL}>Total {label.toLowerCase()}</td>
        <td dir="ltr" className={NUMBER}>
          {formatAmount(section.totalMinor)}
        </td>
      </tr>
    </>
  );
}

function StatementTable({
  children,
  footer,
}: {
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead className="sr-only">
          <tr>
            <th scope="col">Account</th>
            <th scope="col">Amount (EGP)</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
        <tfoot>{footer}</tfoot>
      </table>
    </div>
  );
}

export function ProfitAndLossTable({ report }: { report: ProfitAndLoss }) {
  return (
    <StatementTable
      footer={
        <tr className="rule-t text-base font-extrabold">
          <td className={CELL}>
            {report.netIncomeMinor < 0 ? "Net loss" : "Net profit"}
          </td>
          <td dir="ltr" className={NUMBER} data-testid="net-income">
            {formatAmount(Math.abs(report.netIncomeMinor))}
          </td>
        </tr>
      }
    >
      <SectionRows label="Revenue" section={report.revenue} />
      <SectionRows label="Expenses" section={report.expenses} />
    </StatementTable>
  );
}

export function BalanceSheetTable({ report }: { report: BalanceSheet }) {
  return (
    <StatementTable
      footer={
        <tr className="rule-t text-base font-extrabold">
          <td className={CELL}>Total liabilities and equity</td>
          <td dir="ltr" className={NUMBER}>
            {formatAmount(report.liabilitiesAndEquityMinor)}
          </td>
        </tr>
      }
    >
      <SectionRows label="Assets" section={report.assets} />
      <SectionRows label="Liabilities" section={report.liabilities} />
      <SectionRows label="Equity" section={report.equity} />
      <tr className="border-border border-b font-bold">
        <td className={CELL}>
          <span className="flex flex-col">
            <span>Profit or loss not yet closed</span>
            <span className="text-foreground-muted text-xs font-normal">
              Revenue less expenses to date. It moves into retained earnings once year-end
              close exists.
            </span>
          </span>
        </td>
        <td dir="ltr" className={NUMBER}>
          {formatAmount(report.unclosedProfitMinor)}
        </td>
      </tr>
    </StatementTable>
  );
}
