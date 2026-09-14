import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { askThinkTank } from "@/modules/innovation/contracts/service";
import { AskThinkTank } from "@/modules/innovation/ui/ask-think-tank";
import { getActor } from "@/platform/auth/current-user";
import { INNOVATION_PERMISSIONS } from "@/modules/innovation/contracts/permissions";
import { can } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Ask Think Tank" };

/**
 * Ask Think Tank. A question arriving in the URL (from the overview's search box) is
 * answered on the server, so the first answer is in the page; later questions go
 * through a Server Action.
 */
export default async function AskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await getActor();
  if (!(await can(actor, INNOVATION_PERMISSIONS.ASSISTANT_ACCESS))) notFound();

  const raw = (await searchParams).q;
  const question = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";

  const initial =
    question.length >= 2
      ? await askThinkTank(actor, { question }).catch((error: unknown) => {
          if (error instanceof ValidationError || error instanceof ForbiddenError)
            return null;
          throw error;
        })
      : null;

  return <AskThinkTank initial={initial} />;
}
