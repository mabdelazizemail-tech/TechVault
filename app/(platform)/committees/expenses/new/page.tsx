import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { COMMITTEES_PERMISSIONS } from "@/modules/committees/contracts/permissions";
import {
  isReceiptStorageAvailable,
  listMissionOptions,
} from "@/modules/committees/contracts/service";
import { todayInCairo } from "@/modules/committees/domain/dates";
import { ExpenseForm } from "@/modules/committees/ui/expense-form";
import { getActor } from "@/platform/auth/current-user";
import { can } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "New expense" };

/** Submitting a mission expense — a phone-first form; the service authorises the save. */
export default async function NewExpensePage() {
  const actor = await getActor();
  if (!(await can(actor, COMMITTEES_PERMISSIONS.EXPENSE_CREATE))) notFound();
  const missions = await listMissionOptions(actor);

  return (
    <div className="-mx-4 sm:mx-0">
      <ExpenseForm
        missions={missions}
        today={todayInCairo()}
        storageAvailable={isReceiptStorageAvailable()}
      />
    </div>
  );
}
