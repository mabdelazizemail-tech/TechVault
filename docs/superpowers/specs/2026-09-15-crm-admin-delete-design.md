# CRM record deletion for administrators — design

**Date:** 2026-09-15 · **Status:** approved by the owner in conversation · **Module:** CRM (`modules/crm`)

## Goal

Let platform administrators delete any CRM record — companies, contacts, leads, opportunities and
activities (calls, emails, meetings, tasks, notes) — safely, with everything that belongs to the record
removed with it, and nobody else able to delete.

## Decisions

| # | Decision | Chosen |
| - | -------- | ------ |
| 1 | Who may delete | **Platform administrators only.** The five `crm.*.delete` permissions are removed from the Sales role; `platform-admin` keeps them (it holds the whole catalogue). |
| 2 | What delete does | **Soft delete**: set `deleted_at` (and `updated_at`/`updated_by`). Rows stay in the database; there is no restore screen and no permanent delete. |
| 3 | Related records | **Deleted together**, in one transaction, after a confirmation that lists what goes with the record. |
| 4 | Build approach | **One service per record type, no migration.** Matches the existing per-entity CRM services; the `deleted_at` columns already exist and every CRM query already filters them. |
| 5 | Activities shared with a surviving record | Deleting a **lead or company** keeps an activity also attached to a record that stays. Deleting a **contact or opportunity** takes every activity logged on it — activities are filed under the company automatically, so the company does not keep them — except a converted lead's history, which stays with the lead. (Refined with the owner on 2026-09-15, during implementation.) |

## Permissions

- Existing keys, unchanged: `crm.lead.delete`, `crm.account.delete`, `crm.contact.delete`,
  `crm.opportunity.delete`, `crm.activity.delete`.
- `CRM_SALES_PERMISSIONS` excludes the five delete keys (it already excludes `crm.pipeline.administer`).
  `npm run db:seed` rewrites each role's permissions from code, so re-running it removes them from Sales
  in any database.
- Every delete service first checks that the caller may read the record (otherwise 404), then
  `requirePermission` for `<resource>.delete` with the record's scope target — its owner, or for an activity
  the person who logged it — so a scoped grant given later still works.

## Cascade rules

All writes for one delete happen in one transaction. "Activities of X" means live activities whose
`lead_id`, `account_id`, `contact_id` or `opportunity_id` points at X.

| Deleted | Also deleted |
| ------- | ------------ |
| Company | Its live contacts; its live opportunities; activities of the company, of those contacts and of those opportunities, except those also attached to a lead that stays. |
| Contact | Its activities, except those that also belong to a lead that stays. (This includes a deal's calls or notes that name the contact.) |
| Lead | Its activities, except those also attached to a company, contact or opportunity that stays. The company, contact and opportunity a converted lead became are separate records and stay. |
| Opportunity | Its activities, stage history included, except those that also belong to a lead that stays. |
| Activity | Only itself. Calls, emails, meetings, tasks and notes can be deleted individually; the automatic `STATUS_CHANGE` and `STAGE_CHANGE` history entries cannot — they are deleted only with their record. |

For a company, every contact and opportunity of the company is deleted too, so an activity survives only if
it is also attached to a lead that stays.

Opportunity–contact join rows are kept (soft delete must not lose data); reads ignore links to deleted
contacts and deleted opportunities.

## Reads after a delete

A deleted record disappears everywhere, including where it is referenced from a live record:

- activity cards and timelines do not link to a deleted lead, company, contact or opportunity;
- a converted lead does not link to a deleted company, contact or opportunity;
- an opportunity's contact list and a contact's opportunity list skip deleted records;
- detail pages of deleted records are 404; lists, search, the tasks, notes and activities feeds and the
  dashboard counts exclude them.

A deleted company's name and a deleted contact's email become reusable (the live-row partial unique
indexes already allow it). ERP keeps working for a deleted company: the CRM reference contract reports it as
no longer existing, AR shows it as "no longer in CRM" and new invoices refuse it.

## Record keeping

- One audit record per delete action, severity WARNING, action `crm.<resource>.deleted`, entity the deleted
  record, with the ids of everything deleted with it in its details.
- One outbox event per delete action, ids only: `crm.LeadDeleted`, `crm.CustomerDeleted`
  (with the deleted contact and opportunity ids), `crm.ContactDeleted`, `crm.OpportunityDeleted`,
  `crm.ActivityDeleted`.

## Services and actions

- `deleteLead`, `deleteAccount`, `deleteContact`, `deleteOpportunity`, `deleteActivity`, each
  `(actor, id)`, exported from `modules/crm/contracts/service.ts`.
- `getDeletionImpact(actor, { type, id })` returns the counts shown in the confirmation (requires the same
  delete permission).
- Server Actions in `modules/crm/ui/actions.ts` wrap them and return the usual `ActionResult`.
- Deleting an already-deleted record is a 404, not a second deletion.

## Screens

- A Delete button (danger) in the header of the company, contact, lead and opportunity pages; after
  deleting, the user lands on that record type's list.
- Delete in each activity's menu on record timelines and on the Activities, Tasks and Notes pages (not for
  status and stage history entries).
- The confirmation names the record and shows the server's counts, e.g. "Delete Acme Trading? This also
  deletes 3 contacts, 2 opportunities and 41 activities. They disappear from the CRM and cannot be restored
  from the app."
- Buttons render only for holders of the permission; the server re-checks every time.

## Out of scope

Bulk delete, restore, permanent (hard) delete, deleting pipeline stages, showing ERP document counts in the
confirmation.

## Testing

- **Integration** (local `TEST_DATABASE_URL`):
  - an administrator deletes each record type;
  - cascade counts match the confirmation's counts;
  - a contact's and an opportunity's activities go although they are filed on the company, while a converted
    lead's history stays with the lead;
  - status and stage history entries cannot be deleted individually;
  - Sales and an outsider are refused for every delete;
  - deleted records are gone from lists, search, feeds and detail pages;
  - a company name and a contact email can be reused after delete;
  - the ERP reference contract reports a deleted company as no longer existing;
  - the audit record and event are written, and nothing is written on a refused or failed delete;
  - deleting twice is a 404.
- **Unit:** Sales holds no CRM delete permission; `platform-admin` holds all five.

## Documentation

- CLAUDE.md §6.1: replace "Activities are never deleted to rewrite history" with the administrator-only
  soft-delete rule; add ADR-024; update §28 (CRM) and §29 (no restore screen, no bulk delete).

## Rollout

No migration. Deploy the code, then run `npm run db:seed` so Sales loses the delete permissions, and verify
by direct query. Commit, push and seed only when the owner asks.
