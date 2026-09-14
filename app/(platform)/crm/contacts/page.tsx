import type { Metadata } from "next";
import Link from "next/link";
import { DataTable, type Column } from "@/components/ui/data-table";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { CRM_PERMISSIONS } from "@/modules/crm/contracts/permissions";
import { listContacts } from "@/modules/crm/contracts/service";
import type { ContactListItem } from "@/modules/crm/contracts/types";
import { Avatar } from "@/modules/crm/ui/badges";
import { ContactFormButton } from "@/modules/crm/ui/contact-form";
import { FilterBar } from "@/modules/crm/ui/filter-bar";
import { flatParams } from "@/modules/crm/ui/page-helpers";
import { getActor } from "@/platform/auth/current-user";
import { canAll } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Contacts" };

/** Contacts: the people you deal with, at the companies you sell to. */
export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = flatParams(await searchParams);
  const actor = await getActor();

  const sort = params.sort ?? "name";
  const dir =
    params.dir === "asc" || params.dir === "desc"
      ? params.dir
      : sort === "createdAt"
        ? "desc"
        : "asc";

  const rights = await canAll(actor, [
    CRM_PERMISSIONS.CONTACT_CREATE,
    CRM_PERMISSIONS.ACCOUNT_READ,
  ]);
  const canCreate = rights[CRM_PERMISSIONS.CONTACT_CREATE] === true;

  const result = await listContacts(actor, { ...params, sort, dir });

  const createButton = canCreate ? (
    <ContactFormButton currentUserId={actor.id} />
  ) : undefined;

  return (
    <div>
      <PageHeader
        title="Contacts"
        description="The people you deal with. Contacts are created when a lead converts, or directly here."
        actions={createButton}
      />

      <FilterBar
        basePath="/crm/contacts"
        query={params.q}
        searchLabel="Search name, email or company…"
      />

      <Panel className="overflow-hidden">
        <DataTable<ContactListItem>
          columns={COLUMNS}
          rows={result.rows}
          rowKey={(contact) => contact.id}
          rowHref={(contact) => `/crm/contacts/${contact.id}`}
          basePath="/crm/contacts"
          searchParams={params}
          sort={{ key: sort, direction: dir }}
          page={{ page: result.page, pageSize: result.pageSize, total: result.total }}
          emptyTitle={params.q === undefined ? "No contacts yet" : "No contacts match"}
          emptyDescription="A contact is a person at a company you sell to."
          emptyAction={createButton}
        />
      </Panel>
    </div>
  );
}

const COLUMNS: readonly Column<ContactListItem>[] = [
  {
    key: "name",
    header: "Name",
    sortable: true,
    cell: (contact) => (
      <span className="flex items-center gap-2">
        <Avatar name={contact.name} />
        <span dir="auto">{contact.name}</span>
      </span>
    ),
  },
  {
    key: "company",
    header: "Company",
    sortable: true,
    cell: (contact) =>
      contact.account === null ? (
        <span className="text-foreground-subtle">—</span>
      ) : (
        <Link
          href={`/crm/accounts/${contact.account.id}`}
          className="hover:underline"
          dir="auto"
        >
          {contact.account.name}
        </Link>
      ),
  },
  {
    key: "jobTitle",
    header: "Job title",
    hideOnMobile: true,
    cell: (contact) =>
      contact.jobTitle ?? <span className="text-foreground-subtle">—</span>,
  },
  {
    key: "email",
    header: "Email",
    hideOnMobile: true,
    cell: (contact) =>
      contact.email === null ? (
        <span className="text-foreground-subtle">—</span>
      ) : (
        <a href={`mailto:${contact.email}`} className="hover:underline">
          {contact.email}
        </a>
      ),
  },
  {
    key: "phone",
    header: "Phone",
    hideOnMobile: true,
    cell: (contact) =>
      contact.phone === null ? (
        <span className="text-foreground-subtle">—</span>
      ) : (
        <span dir="ltr">{contact.phone}</span>
      ),
  },
  {
    key: "owner",
    header: "Owner",
    hideOnMobile: true,
    cell: (contact) =>
      contact.owner?.name ?? <span className="text-foreground-subtle">Unassigned</span>,
  },
];
