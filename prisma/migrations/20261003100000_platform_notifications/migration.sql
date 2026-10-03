-- CreateTable
CREATE TABLE "platform"."notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "recipient_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "actor_id" UUID,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(6),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_recipient_id_created_at_id_idx" ON "platform"."notifications"("recipient_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "notifications_actor_id_idx" ON "platform"."notifications"("actor_id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_recipient_id_type_source_id_key" ON "platform"."notifications"("recipient_id", "type", "source_id");

-- AddForeignKey
ALTER TABLE "platform"."notifications" ADD CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "iam"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform"."notifications" ADD CONSTRAINT "notifications_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "iam"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Invariants Prisma cannot express (ADR-036)
-- ---------------------------------------------------------------------------
-- A notification's link is rendered as an href, so it must be an application
-- path: one leading slash, never "//host" or "/\host", which browsers treat as
-- another site. Text lengths are bounded so a bell cannot be flooded with a
-- novel. `type` is the dotted kind the writer declares.
ALTER TABLE "platform"."notifications"
  ADD CONSTRAINT "notifications_link_is_path"
    CHECK (
      left("link", 1) = '/'
      AND substr("link", 2, 1) NOT IN ('/', chr(92))
      AND char_length("link") <= 500
    ),
  ADD CONSTRAINT "notifications_title_length"
    CHECK (char_length(btrim("title")) BETWEEN 1 AND 200),
  ADD CONSTRAINT "notifications_body_length"
    CHECK (char_length("body") <= 1000),
  ADD CONSTRAINT "notifications_type_format"
    CHECK ("type" ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$' AND char_length("type") <= 100);

-- The bell's unread count reads only unread rows.
CREATE INDEX "notifications_unread_idx"
  ON "platform"."notifications" ("recipient_id")
  WHERE "read_at" IS NULL;

-- ---------------------------------------------------------------------------
-- Row-level security: deny by default, no policies (ADR-015)
-- ---------------------------------------------------------------------------
-- The application reads and writes these rows; no client role reads them.
ALTER TABLE "platform"."notifications" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE platform.notifications FROM %I', api_role);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Live delivery over Supabase Realtime
-- ---------------------------------------------------------------------------
-- After a notification is inserted, tell its recipient's private topic that one
-- arrived. The signal carries the notification id only; the browser then fetches
-- the text through the application, which authorises the read. realtime.send
-- writes inside this transaction, so a rolled-back change is never announced, and
-- it catches its own errors, so a Realtime outage cannot fail the business write.
-- On plain Postgres (the integration suite) there is no Realtime and nothing is
-- sent.
CREATE OR REPLACE FUNCTION "platform"."notifications_announce"()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM realtime.send(
    jsonb_build_object('id', NEW.id),
    'notification.created',
    'platform:user:' || NEW.recipient_id,
    true
  );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION "platform"."notifications_announce"() FROM PUBLIC;

CREATE TRIGGER "notifications_announce"
  AFTER INSERT ON "platform"."notifications"
  FOR EACH ROW
  EXECUTE FUNCTION "platform"."notifications_announce"();

-- Who may listen: a signed-in user, on their own topic only, receive only. The
-- policy compares the topic with the token's subject directly, so `authenticated`
-- needs no privilege on the platform schema (ADR-015 stays intact). It does not
-- consult iam.users: a deactivated account whose token has not yet expired could
-- receive notification ids for its own topic until it does — ids only, because
-- the text is read through the application, which refuses inactive accounts.
-- Permissive policies combine with OR, so messaging's policies are unaffected.
-- Supabase only: skipped where Realtime does not exist.
DO $$
BEGIN
  IF to_regclass('realtime.messages') IS NULL
     OR to_regprocedure('realtime.topic()') IS NULL
     OR to_regprocedure('auth.uid()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE NOTICE 'Supabase Realtime not present; skipping the notifications policy.';
    RETURN;
  END IF;

  DROP POLICY IF EXISTS platform_notifications_receive ON realtime.messages;
  CREATE POLICY platform_notifications_receive ON realtime.messages
    FOR SELECT TO authenticated
    USING (
      extension = 'broadcast'
      AND (SELECT auth.uid()) IS NOT NULL
      AND (SELECT realtime.topic()) = 'platform:user:' || (SELECT auth.uid())::text
    );
END $$;
