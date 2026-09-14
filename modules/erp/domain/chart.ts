import type { AccountType } from "../contracts/types";

/**
 * The starter chart of accounts seeded by `prisma/seed.ts` — deliberately minimal.
 *
 * One heading per account class, a current-assets group, and one postable account
 * under each heading so a first journal can be recorded straight away. Finance
 * administrators build the organisation's real chart from here; the seed creates
 * missing codes only and never overwrites an account someone has edited.
 *
 *   1000 Assets                       (heading)
 *     1100 Current Assets             (heading)
 *       1110 Cash
 *       1120 Bank
 *     1200 Receivables
 *   2000 Liabilities                  (heading)
 *     2100 Accounts Payable
 *   3000 Equity                       (heading)
 *     3100 Share Capital
 *   4000 Revenue                      (heading)
 *     4100 Sales Revenue
 *   5000 Expenses                     (heading)
 *     5100 General Expenses
 */
export type ChartSeedAccount = {
  code: string;
  name: string;
  nameAr: string;
  type: AccountType;
  parentCode: string | null;
  isPostable: boolean;
};

export const DEFAULT_CHART: readonly ChartSeedAccount[] = [
  {
    code: "1000",
    name: "Assets",
    nameAr: "الأصول",
    type: "ASSET",
    parentCode: null,
    isPostable: false,
  },
  {
    code: "1100",
    name: "Current Assets",
    nameAr: "الأصول المتداولة",
    type: "ASSET",
    parentCode: "1000",
    isPostable: false,
  },
  {
    code: "1110",
    name: "Cash",
    nameAr: "النقدية",
    type: "ASSET",
    parentCode: "1100",
    isPostable: true,
  },
  {
    code: "1120",
    name: "Bank",
    nameAr: "البنك",
    type: "ASSET",
    parentCode: "1100",
    isPostable: true,
  },
  {
    code: "1200",
    name: "Receivables",
    nameAr: "الذمم المدينة",
    type: "ASSET",
    parentCode: "1000",
    isPostable: true,
  },
  {
    code: "2000",
    name: "Liabilities",
    nameAr: "الخصوم",
    type: "LIABILITY",
    parentCode: null,
    isPostable: false,
  },
  {
    code: "2100",
    name: "Accounts Payable",
    nameAr: "الذمم الدائنة",
    type: "LIABILITY",
    parentCode: "2000",
    isPostable: true,
  },
  {
    code: "3000",
    name: "Equity",
    nameAr: "حقوق الملكية",
    type: "EQUITY",
    parentCode: null,
    isPostable: false,
  },
  {
    code: "3100",
    name: "Share Capital",
    nameAr: "رأس المال",
    type: "EQUITY",
    parentCode: "3000",
    isPostable: true,
  },
  {
    code: "4000",
    name: "Revenue",
    nameAr: "الإيرادات",
    type: "REVENUE",
    parentCode: null,
    isPostable: false,
  },
  {
    code: "4100",
    name: "Sales Revenue",
    nameAr: "إيرادات المبيعات",
    type: "REVENUE",
    parentCode: "4000",
    isPostable: true,
  },
  {
    code: "5000",
    name: "Expenses",
    nameAr: "المصروفات",
    type: "EXPENSE",
    parentCode: null,
    isPostable: false,
  },
  {
    code: "5100",
    name: "General Expenses",
    nameAr: "مصروفات عمومية",
    type: "EXPENSE",
    parentCode: "5000",
    isPostable: true,
  },
];
