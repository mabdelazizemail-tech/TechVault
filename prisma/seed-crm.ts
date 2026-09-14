import { PrismaPg } from "@prisma/adapter-pg";
import {
  PrismaClient,
  type CrmCurrency,
  type CrmLeadSource,
  type CrmLeadStatus,
  type CrmPriority,
  type CrmSalesChannel,
} from "@prisma/client";
import { config as loadEnv } from "dotenv";

/**
 * CRM demo data for development: 8 companies, 15 contacts, 15 leads,
 * 12 opportunities across every pipeline stage (EGP and USD, direct and indirect),
 * and 30+ activities. All companies and people are fictional.
 *
 *   npm run db:seed:crm            # skips if CRM data already exists
 *   npm run db:seed:crm -- --reset # wipes CRM data first (never in production)
 *
 * Requires `npm run db:seed` first (pipeline stages) and at least one active user,
 * who becomes the owner of the demo records. Dates are relative to today, so the
 * pipeline always looks current.
 *
 * Written straight to the database rather than through the CRM services, so it
 * produces no audit records or events: demo data is not business activity.
 */

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined || connectionString === "") {
  throw new Error("DATABASE_URL is required to seed the CRM.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const DAY = 24 * 60 * 60 * 1000;
const now = new Date();
const daysFromNow = (days: number) => new Date(now.getTime() + days * DAY);
const dateOnly = (days: number) => {
  const date = daysFromNow(days);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};
const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
/** A moment earlier this month, never in the future. */
const earlierThisMonth = (days: number) =>
  new Date(Math.max(monthStart.getTime() + 60 * 60 * 1000, now.getTime() - days * DAY));
/** Major units to minor units (both CRM currencies use 100). */
const minor = (major: number) => major * 100;

const ACCOUNTS = [
  {
    name: "Northwind Logistics",
    website: "https://northwindlogistics.com",
    industry: "Logistics",
    companySize: "501-1000",
    country: "Netherlands",
    city: "Rotterdam",
    phone: "+31 10 555 0142",
    description:
      "Pan-European freight forwarder digitising customs and warehouse paperwork.",
  },
  {
    name: "Helios Energy",
    website: "https://heliosenergy.com",
    industry: "Energy",
    companySize: "1000+",
    country: "United States",
    city: "Houston",
    phone: "+1 713 555 0198",
    description: "Renewable power producer operating 40 solar and wind sites.",
  },
  {
    name: "Brightpath Health",
    website: "https://brightpathhealth.org",
    industry: "Healthcare",
    companySize: "201-500",
    country: "United States",
    city: "Boston",
    phone: "+1 617 555 0114",
    description:
      "Regional network of outpatient clinics moving off paper patient records.",
  },
  {
    name: "Corvid Software",
    website: "https://corvid.io",
    industry: "Software",
    companySize: "51-200",
    country: "Germany",
    city: "Berlin",
    phone: "+49 30 555 0177",
    description: "B2B SaaS for procurement teams.",
  },
  {
    name: "Meridian Retail Group",
    website: "https://meridianretail.co.uk",
    industry: "Retail",
    companySize: "1000+",
    country: "United Kingdom",
    city: "London",
    phone: "+44 20 5550 1234",
    description:
      "Operator of 180 high-street stores processing supplier invoices by hand.",
  },
  {
    name: "Pyramid Insurance Group",
    website: "https://pyramid-insurance.example",
    industry: "Insurance",
    companySize: "501-1000",
    country: "Egypt",
    city: "Giza",
    phone: "+20 2 5550 1480",
    description: "Motor and property insurer with a large paper claims archive.",
  },
  {
    name: "Nile Crest Bank",
    website: "https://nilecrestbank.example",
    industry: "Banking",
    companySize: "1000+",
    country: "Egypt",
    city: "Cairo",
    phone: "+20 2 5550 2210",
    description: "Retail bank with 120 branches and decades of loan files.",
  },
  {
    name: "Sinai Telecom",
    website: "https://sinaitelecom.example",
    industry: "Telecommunications",
    companySize: "1000+",
    country: "Egypt",
    city: "Cairo",
    phone: "+20 2 5550 3375",
    description: "Mobile operator digitising subscriber contracts.",
  },
];

/** [account index, first, last, title, email, phone] */
const CONTACTS: [number, string, string, string, string, string][] = [
  [
    0,
    "Sofia",
    "Janssen",
    "Chief Operating Officer",
    "sofia.janssen@northwindlogistics.com",
    "+31 6 5550 1101",
  ],
  [
    0,
    "Daan",
    "de Vries",
    "Head of IT",
    "daan.devries@northwindlogistics.com",
    "+31 6 5550 1102",
  ],
  [
    1,
    "Marcus",
    "Reed",
    "VP Operations",
    "marcus.reed@heliosenergy.com",
    "+1 713 555 0201",
  ],
  [
    1,
    "Alicia",
    "Torres",
    "Procurement Manager",
    "alicia.torres@heliosenergy.com",
    "+1 713 555 0202",
  ],
  [
    2,
    "Rachel",
    "Kim",
    "Chief Financial Officer",
    "rachel.kim@brightpathhealth.org",
    "+1 617 555 0301",
  ],
  [
    2,
    "Owen",
    "Patel",
    "Director of Digital",
    "owen.patel@brightpathhealth.org",
    "+1 617 555 0302",
  ],
  [
    3,
    "Lena",
    "Fischer",
    "Chief Executive Officer",
    "lena.fischer@corvid.io",
    "+49 151 5550 4401",
  ],
  [
    3,
    "Jonas",
    "Weber",
    "Chief Technology Officer",
    "jonas.weber@corvid.io",
    "+49 151 5550 4402",
  ],
  [
    4,
    "Harriet",
    "Cole",
    "Chief Customer Officer",
    "harriet.cole@meridianretail.co.uk",
    "+44 7700 900501",
  ],
  [
    4,
    "Samuel",
    "Hughes",
    "Head of Finance Operations",
    "samuel.hughes@meridianretail.co.uk",
    "+44 7700 900502",
  ],
  [
    5,
    "Omar",
    "Farouk",
    "Chief Operating Officer",
    "omar.farouk@pyramid-insurance.example",
    "+20 100 555 0611",
  ],
  [
    5,
    "Salma",
    "Hassan",
    "Records Manager",
    "salma.hassan@pyramid-insurance.example",
    "+20 100 555 0612",
  ],
  [
    6,
    "Karim",
    "Mansour",
    "Head of Operations",
    "karim.mansour@nilecrestbank.example",
    "+20 101 555 0711",
  ],
  [
    6,
    "Nour",
    "El-Sayed",
    "Digital Transformation Lead",
    "nour.elsayed@nilecrestbank.example",
    "+20 101 555 0712",
  ],
  [
    7,
    "Youssef",
    "Adel",
    "IT Director",
    "youssef.adel@sinaitelecom.example",
    "+20 102 555 0811",
  ],
];

type OpportunitySeed = {
  name: string;
  account: number;
  contact: number;
  stage: string;
  amount: number;
  currency: CrmCurrency;
  closeInDays: number;
  priority: CrmPriority;
  product: string;
  source: CrmLeadSource;
  channel: CrmSalesChannel;
  partnerName?: string;
};

const OPPORTUNITIES: OpportunitySeed[] = [
  {
    name: "Northwind Warehouse Records Digitization",
    account: 0,
    contact: 0,
    stage: "lead",
    amount: 38000,
    currency: "USD",
    closeInDays: 75,
    priority: "MEDIUM",
    product: "Digitization services",
    source: "REFERRAL",
    channel: "DIRECT",
  },
  {
    name: "Sinai Telecom Contract Archive",
    account: 7,
    contact: 14,
    stage: "lead",
    amount: 1850000,
    currency: "EGP",
    closeInDays: 90,
    priority: "LOW",
    product: "Digitization services",
    source: "WEBSITE",
    channel: "DIRECT",
  },
  {
    name: "Helios Field Records Capture",
    account: 1,
    contact: 2,
    stage: "qualified",
    amount: 92000,
    currency: "USD",
    closeInDays: 60,
    priority: "HIGH",
    product: "Capture software",
    source: "EVENT",
    channel: "DIRECT",
  },
  {
    name: "Brightpath Patient Records Portal",
    account: 2,
    contact: 5,
    stage: "qualified",
    amount: 54000,
    currency: "USD",
    closeInDays: 55,
    priority: "MEDIUM",
    product: "Document management software",
    source: "LINKEDIN",
    channel: "DIRECT",
  },
  {
    name: "Pyramid Claims Digitization",
    account: 5,
    contact: 10,
    stage: "discovery",
    amount: 4200000,
    currency: "EGP",
    closeInDays: 45,
    priority: "MEDIUM",
    product: "Digitization services",
    source: "PARTNER",
    channel: "INDIRECT",
    partnerName: "Nova Channel Partners",
  },
  {
    name: "Nile Crest Loan File Automation",
    account: 6,
    contact: 12,
    stage: "discovery",
    amount: 9500000,
    currency: "EGP",
    closeInDays: 50,
    priority: "HIGH",
    product: "Workflow automation",
    source: "REFERRAL",
    channel: "INDIRECT",
    partnerName: "Delta Systems",
  },
  {
    name: "Meridian Invoice Capture",
    account: 4,
    contact: 8,
    stage: "proposal",
    amount: 145000,
    currency: "USD",
    closeInDays: 30,
    priority: "HIGH",
    product: "Capture software",
    source: "ADVERTISEMENT",
    channel: "DIRECT",
  },
  {
    name: "Corvid Enterprise Expansion",
    account: 3,
    contact: 6,
    stage: "proposal",
    amount: 45000,
    currency: "USD",
    closeInDays: 21,
    priority: "MEDIUM",
    product: "Document management software",
    source: "WEBSITE",
    channel: "DIRECT",
  },
  {
    name: "Northwind Customs Document Workflow",
    account: 0,
    contact: 1,
    stage: "negotiation",
    amount: 83000,
    currency: "USD",
    closeInDays: 14,
    priority: "HIGH",
    product: "Workflow automation",
    source: "COLD_OUTREACH",
    channel: "DIRECT",
  },
  {
    name: "Nile Crest Branch Archive Scanning",
    account: 6,
    contact: 13,
    stage: "negotiation",
    amount: 15000000,
    currency: "EGP",
    closeInDays: 10,
    priority: "HIGH",
    product: "Digitization services",
    source: "EVENT",
    channel: "INDIRECT",
    partnerName: "Nova Channel Partners",
  },
  {
    name: "Brightpath Records Storage Upgrade",
    account: 2,
    contact: 4,
    stage: "closed_won",
    amount: 42000,
    currency: "USD",
    closeInDays: -3,
    priority: "MEDIUM",
    product: "Records storage",
    source: "REFERRAL",
    channel: "DIRECT",
  },
  {
    name: "Pyramid Records Storage Tender",
    account: 5,
    contact: 11,
    stage: "closed_lost",
    amount: 2600000,
    currency: "EGP",
    closeInDays: -5,
    priority: "MEDIUM",
    product: "Records storage",
    source: "PARTNER",
    channel: "DIRECT",
  },
];

type LeadSeed = {
  firstName: string;
  lastName: string;
  company: string;
  jobTitle: string;
  source: CrmLeadSource;
  industry: string;
  companySize: string;
  country: string;
  city: string;
  status: CrmLeadStatus;
  score: number;
  currency: CrmCurrency;
  interest?: string;
  budget?: number;
  timeline?: "IMMEDIATE" | "WITHIN_3_MONTHS" | "WITHIN_6_MONTHS" | "WITHIN_12_MONTHS";
  decisionMaker?: "YES" | "NO" | "UNKNOWN";
  painPoint?: string;
  daysAgo: number;
  /** For converted leads: [account index, contact index, opportunity index]. */
  converted?: [number, number, number];
};

const slug = (value: string) => value.toLowerCase().replace(/[^a-z]/g, "");
const emailFor = (lead: { firstName: string; lastName: string; company: string }) =>
  `${slug(lead.firstName)}.${slug(lead.lastName)}@${slug(lead.company)}.example`;

const LEADS: LeadSeed[] = [
  {
    firstName: "Priya",
    lastName: "Raman",
    company: "Orbital Freight",
    jobTitle: "Operations Manager",
    source: "WEBSITE",
    industry: "Logistics",
    companySize: "51-200",
    country: "India",
    city: "Mumbai",
    status: "NEW",
    score: 35,
    currency: "USD",
    daysAgo: 1,
  },
  {
    firstName: "Hana",
    lastName: "Mostafa",
    company: "Delta Pharma Distribution",
    jobTitle: "Quality Assurance Manager",
    source: "ADVERTISEMENT",
    industry: "Healthcare",
    companySize: "201-500",
    country: "Egypt",
    city: "Cairo",
    status: "NEW",
    score: 40,
    currency: "EGP",
    interest: "Batch record digitization",
    daysAgo: 2,
  },
  {
    firstName: "Aisha",
    lastName: "Khan",
    company: "Solace Biotech",
    jobTitle: "Head of R&D Operations",
    source: "LINKEDIN",
    industry: "Healthcare",
    companySize: "201-500",
    country: "United Kingdom",
    city: "Cambridge",
    status: "NEW",
    score: 42,
    currency: "USD",
    daysAgo: 2,
  },
  {
    firstName: "Lucas",
    lastName: "Moreau",
    company: "Vantage Legal",
    jobTitle: "Partner",
    source: "REFERRAL",
    industry: "Professional services",
    companySize: "11-50",
    country: "France",
    city: "Paris",
    status: "NEW",
    score: 30,
    currency: "USD",
    daysAgo: 3,
  },
  {
    firstName: "Mahmoud",
    lastName: "Saleh",
    company: "Alexandria Port Services",
    jobTitle: "Records Director",
    source: "EVENT",
    industry: "Logistics",
    companySize: "501-1000",
    country: "Egypt",
    city: "Alexandria",
    status: "CONTACTED",
    score: 55,
    currency: "EGP",
    interest: "Shipping manifest archive",
    daysAgo: 6,
  },
  {
    firstName: "Hiroshi",
    lastName: "Sato",
    company: "Nimbus Cloud",
    jobTitle: "VP Engineering",
    source: "COLD_OUTREACH",
    industry: "Software",
    companySize: "51-200",
    country: "Japan",
    city: "Tokyo",
    status: "CONTACTED",
    score: 48,
    currency: "USD",
    daysAgo: 8,
  },
  {
    firstName: "Olivia",
    lastName: "Bennett",
    company: "Halcyon Travel",
    jobTitle: "Finance Director",
    source: "WEBSITE",
    industry: "Other",
    companySize: "51-200",
    country: "Ireland",
    city: "Dublin",
    status: "CONTACTED",
    score: 52,
    currency: "USD",
    interest: "Invoice capture",
    daysAgo: 9,
  },
  {
    firstName: "Rania",
    lastName: "Aboul-Fotouh",
    company: "Cairo Municipal Utilities",
    jobTitle: "Head of Customer Records",
    source: "PARTNER",
    industry: "Government",
    companySize: "1000+",
    country: "Egypt",
    city: "Cairo",
    status: "CONTACTED",
    score: 58,
    currency: "EGP",
    daysAgo: 11,
  },
  {
    firstName: "Chloe",
    lastName: "Dubois",
    company: "Tidewater Foods",
    jobTitle: "Chief Operating Officer",
    source: "REFERRAL",
    industry: "Retail",
    companySize: "1000+",
    country: "Canada",
    city: "Vancouver",
    status: "QUALIFIED",
    score: 78,
    currency: "USD",
    interest: "Supplier invoice automation",
    budget: 60000,
    timeline: "WITHIN_3_MONTHS",
    decisionMaker: "YES",
    painPoint: "Invoices are keyed by hand across 60 stores.",
    daysAgo: 12,
  },
  {
    firstName: "Tarek",
    lastName: "Nabil",
    company: "Horus Microfinance",
    jobTitle: "Chief Executive Officer",
    source: "LINKEDIN",
    industry: "Financial services",
    companySize: "201-500",
    country: "Egypt",
    city: "Cairo",
    status: "QUALIFIED",
    score: 82,
    currency: "EGP",
    interest: "Loan application capture",
    budget: 2500000,
    timeline: "WITHIN_3_MONTHS",
    decisionMaker: "YES",
    painPoint: "Paper applications take nine days to reach credit review.",
    daysAgo: 14,
  },
  {
    firstName: "Nora",
    lastName: "Lindqvist",
    company: "Arcadia Schools",
    jobTitle: "Director of Technology",
    source: "EVENT",
    industry: "Education",
    companySize: "201-500",
    country: "Sweden",
    city: "Stockholm",
    status: "QUALIFIED",
    score: 71,
    currency: "USD",
    interest: "Student records archive",
    budget: 28000,
    timeline: "WITHIN_6_MONTHS",
    decisionMaker: "UNKNOWN",
    daysAgo: 16,
  },
  {
    firstName: "James",
    lastName: "O'Connor",
    company: "Redwood Insurance",
    jobTitle: "Head of Claims",
    source: "ADVERTISEMENT",
    industry: "Insurance",
    companySize: "501-1000",
    country: "United States",
    city: "Chicago",
    status: "QUALIFIED",
    score: 85,
    currency: "USD",
    interest: "Claims automation",
    budget: 95000,
    timeline: "IMMEDIATE",
    decisionMaker: "YES",
    painPoint: "A six-week claims backlog.",
    daysAgo: 5,
  },
  {
    firstName: "Victor",
    lastName: "Hale",
    company: "Beacon Robotics",
    jobTitle: "Research Assistant",
    source: "WEBSITE",
    industry: "Manufacturing",
    companySize: "1-10",
    country: "United States",
    city: "Austin",
    status: "DISQUALIFIED",
    score: 12,
    currency: "USD",
    painPoint: "Student research project; no purchase intent.",
    daysAgo: 20,
  },
  {
    firstName: "Lena",
    lastName: "Fischer",
    company: "Corvid Software",
    jobTitle: "Chief Executive Officer",
    source: "WEBSITE",
    industry: "Software",
    companySize: "51-200",
    country: "Germany",
    city: "Berlin",
    status: "CONVERTED",
    score: 88,
    currency: "USD",
    budget: 50000,
    timeline: "WITHIN_3_MONTHS",
    decisionMaker: "YES",
    daysAgo: 40,
    converted: [3, 6, 7],
  },
  {
    firstName: "Youssef",
    lastName: "Adel",
    company: "Sinai Telecom",
    jobTitle: "IT Director",
    source: "WEBSITE",
    industry: "Telecommunications",
    companySize: "1000+",
    country: "Egypt",
    city: "Cairo",
    status: "CONVERTED",
    score: 64,
    currency: "EGP",
    budget: 2000000,
    timeline: "WITHIN_6_MONTHS",
    decisionMaker: "YES",
    daysAgo: 25,
    converted: [7, 14, 1],
  },
];

async function main(): Promise<void> {
  const reset = process.argv.includes("--reset");

  if (reset) {
    if (process.env.APP_ENV === "production") {
      throw new Error("Refusing to reset CRM data in production.");
    }
    process.stdout.write("Resetting CRM data...\n");
    await prisma.crmActivity.deleteMany({});
    await prisma.crmOpportunityContact.deleteMany({});
    await prisma.crmLead.deleteMany({});
    await prisma.crmOpportunity.deleteMany({});
    await prisma.crmContact.deleteMany({});
    await prisma.crmAccount.deleteMany({});
  } else if ((await prisma.crmAccount.count()) > 0) {
    process.stdout.write(
      "CRM data already exists; nothing seeded. Use --reset to replace it.\n",
    );
    return;
  }

  const stages = await prisma.crmOpportunityStage.findMany({
    select: { id: true, key: true, name: true, defaultProbability: true },
  });
  const stageByKey = new Map(stages.map((stage) => [stage.key, stage]));
  if (stageByKey.size === 0) {
    throw new Error("No pipeline stages found. Run `npm run db:seed` first.");
  }

  const owners = await prisma.user.findMany({
    where: { isActive: true, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (owners.length === 0) {
    throw new Error("No active users to own the demo records. Bootstrap an admin first.");
  }
  const ownerFor = (index: number) => owners[index % owners.length]!.id;
  const author = ownerFor(0);

  process.stdout.write("Seeding companies and contacts...\n");
  const accountIds: string[] = [];
  for (const [index, account] of ACCOUNTS.entries()) {
    const created = await prisma.crmAccount.create({
      data: {
        ...account,
        ownerId: ownerFor(index),
        createdBy: author,
        createdAt: daysFromNow(-60 + index),
      },
      select: { id: true },
    });
    accountIds.push(created.id);
  }

  const contactIds: string[] = [];
  for (const [
    index,
    [account, firstName, lastName, jobTitle, email, phone],
  ] of CONTACTS.entries()) {
    const source = ACCOUNTS[account]!;
    const created = await prisma.crmContact.create({
      data: {
        firstName,
        lastName,
        jobTitle,
        email,
        phone,
        country: source.country,
        city: source.city,
        accountId: accountIds[account]!,
        ownerId: ownerFor(index),
        createdBy: author,
      },
      select: { id: true },
    });
    contactIds.push(created.id);
  }

  process.stdout.write("Seeding opportunities...\n");
  const opportunityIds: string[] = [];
  let activityCount = 0;
  for (const [index, seed] of OPPORTUNITIES.entries()) {
    const stage = stageByKey.get(seed.stage);
    if (stage === undefined) throw new Error(`Missing stage "${seed.stage}".`);
    const isWon = seed.stage === "closed_won";
    const isLost = seed.stage === "closed_lost";
    const closedAt = earlierThisMonth(Math.abs(seed.closeInDays));

    const created = await prisma.crmOpportunity.create({
      data: {
        name: seed.name,
        accountId: accountIds[seed.account]!,
        stageId: stage.id,
        status: isWon ? "WON" : isLost ? "LOST" : "OPEN",
        amountMinor: minor(seed.amount),
        currency: seed.currency,
        closeDate:
          isWon || isLost
            ? dateOnly(-Math.abs(seed.closeInDays))
            : dateOnly(seed.closeInDays),
        probability: stage.defaultProbability,
        priority: seed.priority,
        channel: seed.channel,
        partnerName: seed.partnerName ?? null,
        source: seed.source,
        product: seed.product,
        description: `${seed.product} for ${ACCOUNTS[seed.account]!.name}.`,
        ownerId: ownerFor(index),
        stageChangedAt: daysFromNow(-(index % 7) - 1),
        wonAt: isWon ? closedAt : null,
        lostAt: isLost ? closedAt : null,
        lostReason: isLost ? "COMPETITOR" : null,
        closeNotes: isLost
          ? "Awarded to the incumbent storage provider on price."
          : isWon
            ? "Signed a two-year agreement."
            : null,
        createdBy: author,
        createdAt: daysFromNow(-45 + index),
        contacts: { create: { contactId: contactIds[seed.contact]!, isPrimary: true } },
      },
      select: { id: true },
    });
    opportunityIds.push(created.id);

    await prisma.crmActivity.create({
      data: {
        type: "STAGE_CHANGE",
        subject:
          isWon || isLost
            ? `Moved to ${stage.name}`
            : `Opportunity created in ${stage.name}`,
        body: isLost ? "Lost reason: Competitor." : null,
        opportunityId: created.id,
        accountId: accountIds[seed.account]!,
        createdBy: author,
        occurredAt: isWon || isLost ? closedAt : daysFromNow(-30 + index),
        metadata: { toStage: stage.name, toStageId: stage.id },
      },
    });
    activityCount += 1;
  }

  process.stdout.write("Seeding leads...\n");
  const leadIds = new Map<string, string>();
  for (const [index, seed] of LEADS.entries()) {
    const email =
      seed.converted !== undefined ? CONTACTS[seed.converted[1]]![4] : emailFor(seed);
    const created = await prisma.crmLead.create({
      data: {
        firstName: seed.firstName,
        lastName: seed.lastName,
        company: seed.company,
        jobTitle: seed.jobTitle,
        email,
        phone:
          seed.country === "Egypt"
            ? `+20 100 555 09${String(10 + index)}`
            : `+1 555 01${String(10 + index)}`,
        website: `https://${slug(seed.company)}.example`,
        source: seed.source,
        industry: seed.industry,
        companySize: seed.companySize,
        country: seed.country,
        city: seed.city,
        interest: seed.interest ?? null,
        budgetMinor: seed.budget === undefined ? null : minor(seed.budget),
        currency: seed.currency,
        timeline: seed.timeline ?? null,
        decisionMaker: seed.decisionMaker ?? null,
        painPoint: seed.painPoint ?? null,
        score: seed.score,
        status: seed.status,
        statusChangedAt: daysFromNow(-Math.max(0, seed.daysAgo - 1)),
        ownerId: ownerFor(index),
        convertedAt: seed.converted !== undefined ? daysFromNow(-seed.daysAgo + 2) : null,
        convertedAccountId:
          seed.converted !== undefined ? accountIds[seed.converted[0]]! : null,
        convertedContactId:
          seed.converted !== undefined ? contactIds[seed.converted[1]]! : null,
        convertedOpportunityId:
          seed.converted !== undefined ? opportunityIds[seed.converted[2]]! : null,
        createdBy: author,
        createdAt: daysFromNow(-seed.daysAgo),
      },
      select: { id: true },
    });
    leadIds.set(`${seed.firstName} ${seed.lastName}`, created.id);

    await prisma.crmActivity.create({
      data: {
        type: "STATUS_CHANGE",
        subject: seed.converted !== undefined ? "Lead converted" : "Lead created",
        leadId: created.id,
        ...(seed.converted !== undefined
          ? {
              accountId: accountIds[seed.converted[0]]!,
              contactId: contactIds[seed.converted[1]]!,
              opportunityId: opportunityIds[seed.converted[2]]!,
            }
          : {}),
        createdBy: author,
        occurredAt: daysFromNow(-seed.daysAgo),
        metadata: { toStatus: seed.status },
      },
    });
    activityCount += 1;
  }

  process.stdout.write("Seeding activities...\n");
  const opp = (index: number) => ({
    opportunityId: opportunityIds[index]!,
    accountId: accountIds[OPPORTUNITIES[index]!.account]!,
    contactId: contactIds[OPPORTUNITIES[index]!.contact]!,
  });
  const lead = (name: string) => {
    const leadId = leadIds.get(name);
    if (leadId === undefined) throw new Error(`Unknown demo lead "${name}".`);
    return { leadId };
  };

  const logged: {
    type: "CALL" | "EMAIL" | "MEETING" | "TASK" | "NOTE";
    subject: string;
    body?: string;
    at: number;
    duration?: number;
    due?: number;
    priority?: CrmPriority;
    done?: boolean;
    links: Record<string, string>;
  }[] = [
    {
      type: "CALL",
      subject: "Scope call with Daan",
      body: "Walked through customs document volumes; they want a phased quote.",
      at: -2,
      duration: 30,
      links: opp(8),
    },
    {
      type: "EMAIL",
      subject: "Sent invoice capture proposal",
      body: "Proposal v2 with a phased rollout across 180 stores.",
      at: -5,
      links: opp(6),
    },
    {
      type: "MEETING",
      subject: "Proposal review with Harriet Cole",
      body: "Positive reception. Finance wants to see year-two pricing.",
      at: -1,
      duration: 60,
      links: opp(6),
    },
    {
      type: "MEETING",
      subject: "Discovery workshop",
      body: "Mapped the loan file journey from branch to credit committee.",
      at: -7,
      duration: 90,
      links: opp(5),
    },
    {
      type: "NOTE",
      subject: "Sponsor identified",
      body: "Nour El-Sayed is the day-to-day sponsor; Karim Mansour signs.",
      at: -6,
      links: opp(5),
    },
    {
      type: "CALL",
      subject: "Intro call with Marcus Reed",
      body: "Three regions, 400 field technicians, paper job sheets today.",
      at: -10,
      duration: 25,
      links: opp(2),
    },
    {
      type: "EMAIL",
      subject: "Redlines on the service agreement",
      body: "Legal returned comments on liability caps and data residency.",
      at: -3,
      links: opp(9),
    },
    {
      type: "TASK",
      subject: "Send revised agreement to legal",
      at: -1,
      due: 2,
      priority: "HIGH",
      links: opp(9),
    },
    {
      type: "TASK",
      subject: "Prepare phased pricing",
      at: -2,
      due: 1,
      priority: "HIGH",
      links: opp(8),
    },
    {
      type: "TASK",
      subject: "Book site survey in Giza",
      at: -4,
      due: 6,
      priority: "MEDIUM",
      links: opp(4),
    },
    {
      type: "NOTE",
      subject: "Security questionnaire required",
      body: "IT security review must complete before the proposal goes out.",
      at: -4,
      links: opp(3),
    },
    {
      type: "CALL",
      subject: "Expansion scoping with Jonas",
      body: "Adding 120 seats in the procurement team.",
      at: -6,
      duration: 40,
      links: opp(7),
    },
    {
      type: "TASK",
      subject: "Share implementation timeline",
      at: -9,
      due: -2,
      priority: "MEDIUM",
      done: true,
      links: opp(10),
    },
    {
      type: "CALL",
      subject: "Qualification call",
      body: "Budget confirmed for Q3; the COO owns the decision.",
      at: -4,
      duration: 35,
      links: lead("Chloe Dubois"),
    },
    {
      type: "EMAIL",
      subject: "Shared a microfinance case study",
      at: -2,
      links: lead("Tarek Nabil"),
    },
    {
      type: "MEETING",
      subject: "Claims automation demo",
      body: "Demoed triage rules; asked for a pilot proposal.",
      at: -1,
      duration: 45,
      links: lead("James O'Connor"),
    },
    {
      type: "TASK",
      subject: "Follow up after cold email",
      at: -3,
      due: 3,
      priority: "LOW",
      links: lead("Hiroshi Sato"),
    },
    {
      type: "NOTE",
      subject: "Met at the Cairo ICT expo",
      body: "Around 40 years of manifests in the port archive.",
      at: -6,
      links: lead("Mahmoud Saleh"),
    },
    {
      type: "EMAIL",
      subject: "Sent pricing overview",
      at: -8,
      links: lead("Rania Aboul-Fotouh"),
    },
  ];

  for (const entry of logged) {
    await prisma.crmActivity.create({
      data: {
        type: entry.type,
        subject: entry.subject,
        body: entry.body ?? null,
        occurredAt: daysFromNow(entry.at),
        durationMinutes: entry.duration ?? null,
        dueAt: entry.due !== undefined ? daysFromNow(entry.due) : null,
        priority: entry.type === "TASK" ? (entry.priority ?? "MEDIUM") : null,
        assigneeId: entry.type === "TASK" ? author : null,
        completedAt: entry.done === true ? daysFromNow(-2) : null,
        createdBy: author,
        ...entry.links,
      },
    });
    activityCount += 1;
  }

  process.stdout.write(
    `\nCRM demo data seeded: ${ACCOUNTS.length} companies, ${CONTACTS.length} contacts, ` +
      `${LEADS.length} leads, ${OPPORTUNITIES.length} opportunities, ${activityCount} activities.\n`,
  );
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`CRM seed failed: ${String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
