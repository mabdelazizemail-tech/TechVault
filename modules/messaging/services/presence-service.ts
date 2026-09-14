import { prisma } from "@/lib/prisma";
import { type Actor, requirePermission } from "@/platform/authz/authz";
import { MESSAGING_PERMISSIONS } from "../contracts/permissions";

/**
 * "Last seen". Who is online right now is Realtime Presence and is never stored;
 * this keeps only the moment a person was last connected, for "Last seen 5
 * minutes ago" once they are gone.
 *
 * Written when a session connects and when it leaves, and at most once a minute
 * per person however many tabs they open — never on a heartbeat (ADR-020).
 */

export async function recordLastSeen(actor: Actor): Promise<void> {
  await requirePermission(actor, MESSAGING_PERMISSIONS.ACCESS);

  await prisma.$executeRaw`
    INSERT INTO messaging.user_presence (user_id, last_seen_at)
    VALUES (${actor.id}::uuid, now())
    ON CONFLICT (user_id) DO UPDATE
       SET last_seen_at = excluded.last_seen_at
     WHERE messaging.user_presence.last_seen_at < now() - interval '1 minute'
  `;
}
