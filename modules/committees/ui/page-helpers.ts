import { notFound } from "next/navigation";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import type { FilterSelect } from "@/components/ui/filter-bar";
import {
  DUE_WINDOWS,
  DUE_WINDOW_LABELS,
  TASK_DISPLAY_STATUSES,
  TASK_STATUS_LABELS,
  type PersonRef,
} from "../contracts/types";

/** Resolves a read for a page, turning "missing" and "not permitted" into the 404 page. */
export async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) notFound();
    throw error;
  }
}

export function flatParams(
  params: Record<string, string | string[] | undefined>,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  );
}

/** The status, due-date and responsible-person filters shared by task lists. */
export function taskFilterSelects(
  params: Record<string, string | undefined>,
  responsible: { users: readonly PersonRef[]; names: readonly string[] } | null,
): FilterSelect[] {
  return [
    {
      name: "status",
      label: "Status",
      value: params.status,
      allLabel: "All statuses",
      options: TASK_DISPLAY_STATUSES.map((status) => ({
        value: status,
        label: TASK_STATUS_LABELS[status],
      })),
    },
    {
      name: "responsible",
      label: "Responsible person",
      value: params.responsible,
      allLabel: "Anyone responsible",
      options: [
        { value: "me", label: "Assigned to me" },
        ...(responsible?.users ?? []).map((person) => ({
          value: `user:${person.id}`,
          label: person.name,
        })),
        ...(responsible?.names ?? []).map((name) => ({
          value: `name:${name}`,
          label: `${name} (not registered)`,
        })),
      ],
    },
    {
      name: "due",
      label: "Due date",
      value: params.due,
      allLabel: "Any due date",
      options: DUE_WINDOWS.map((window) => ({
        value: window,
        label: DUE_WINDOW_LABELS[window],
      })),
    },
  ];
}
