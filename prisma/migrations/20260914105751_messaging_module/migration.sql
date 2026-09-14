-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "messaging";

-- CreateEnum
CREATE TYPE "messaging"."MsgConversationType" AS ENUM ('DIRECT', 'GROUP');

-- CreateEnum
CREATE TYPE "messaging"."MsgMessageType" AS ENUM ('TEXT', 'DOCUMENT', 'SYSTEM');

-- CreateTable
CREATE TABLE "messaging"."conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" "messaging"."MsgConversationType" NOT NULL,
    "direct_key" TEXT,
    "title" TEXT,
    "last_message_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messaging"."conversation_participants" (
    "conversation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_delivered_at" TIMESTAMPTZ(6),
    "last_read_at" TIMESTAMPTZ(6),
    "left_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("conversation_id","user_id")
);

-- CreateTable
CREATE TABLE "messaging"."messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "sender_id" UUID,
    "message_type" "messaging"."MsgMessageType" NOT NULL DEFAULT 'TEXT',
    "content" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "edited_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messaging"."message_attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "message_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "ecm_document_id" UUID NOT NULL,
    "attached_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messaging"."user_presence" (
    "user_id" UUID NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_presence_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversations_direct_key_key" ON "messaging"."conversations"("direct_key");

-- CreateIndex
CREATE INDEX "conversation_participants_user_id_idx" ON "messaging"."conversation_participants"("user_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_id_idx" ON "messaging"."messages"("conversation_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "messages_sender_id_idx" ON "messaging"."messages"("sender_id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_id_conversation_id_key" ON "messaging"."messages"("id", "conversation_id");

-- CreateIndex
CREATE INDEX "message_attachments_ecm_document_id_idx" ON "messaging"."message_attachments"("ecm_document_id");

-- CreateIndex
CREATE INDEX "message_attachments_attached_by_idx" ON "messaging"."message_attachments"("attached_by");

-- CreateIndex
CREATE UNIQUE INDEX "message_attachments_message_id_ecm_document_id_key" ON "messaging"."message_attachments"("message_id", "ecm_document_id");

-- AddForeignKey
ALTER TABLE "messaging"."conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "messaging"."conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messaging"."conversation_participants" ADD CONSTRAINT "conversation_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messaging"."messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "messaging"."conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messaging"."messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messaging"."message_attachments" ADD CONSTRAINT "message_attachments_message_id_conversation_id_fkey" FOREIGN KEY ("message_id", "conversation_id") REFERENCES "messaging"."messages"("id", "conversation_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messaging"."message_attachments" ADD CONSTRAINT "message_attachments_attached_by_fkey" FOREIGN KEY ("attached_by") REFERENCES "iam"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messaging"."user_presence" ADD CONSTRAINT "user_presence_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- Raw SQL below: invariants, triggers, row-level security and Realtime
-- authorization that Prisma's schema language cannot express (ADR-020). Kept in
-- this migration, not supabase/migrations, so replaying history reproduces it
-- and `migrate dev` reports no drift (the ADR-014 precedent).
--
-- THE SECURITY MODEL IN ONE PARAGRAPH. The application reads and writes these
-- tables through its own connection, as their owner, and authorises every
-- operation in the service layer (ADR-002) — owners bypass RLS, so RLS is not
-- what protects the app's own queries. Three things here DO bind every role,
-- the application included: the CHECK constraints, the participation trigger on
-- messages and the document-access trigger on attachments. RLS is then enabled
-- deny-by-default with participant-only policies and no grants, exactly like
-- the other schemas (ADR-015). The browser's only direct contact with the
-- database is Supabase Realtime, authorised by the policies on
-- realtime.messages at the end of this file; it carries IDs, never content.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Invariants
-- ---------------------------------------------------------------------------
ALTER TABLE "messaging"."conversations"
  ADD CONSTRAINT "conversations_direct_key_check"
  CHECK (("type" = 'DIRECT') = ("direct_key" IS NOT NULL));

ALTER TABLE "messaging"."conversations"
  ADD CONSTRAINT "conversations_title_check"
  CHECK ("title" IS NULL OR char_length("title") BETWEEN 1 AND 200);

ALTER TABLE "messaging"."conversation_participants"
  ADD CONSTRAINT "conversation_participants_left_check"
  CHECK ("left_at" IS NULL OR "left_at" >= "joined_at");

-- A person writes TEXT and DOCUMENT messages; only the platform writes SYSTEM ones.
ALTER TABLE "messaging"."messages"
  ADD CONSTRAINT "messages_shape_check"
  CHECK (
    CASE "message_type"
      WHEN 'TEXT' THEN "sender_id" IS NOT NULL
                   AND "content" IS NOT NULL
                   AND char_length(btrim("content")) > 0
      WHEN 'DOCUMENT' THEN "sender_id" IS NOT NULL
      WHEN 'SYSTEM' THEN "sender_id" IS NULL AND "content" IS NOT NULL
    END
  );

ALTER TABLE "messaging"."messages"
  ADD CONSTRAINT "messages_content_length_check"
  CHECK ("content" IS NULL OR char_length("content") <= 4000);

-- ---------------------------------------------------------------------------
-- 2. Helper functions
-- ---------------------------------------------------------------------------
-- The requesting user's id from the JWT claims Supabase sets for API and Realtime
-- requests. Identical to auth.uid() (read from the project on 2026-09-14), defined
-- here so these functions also exist on a plain Postgres — the integration-test
-- database has no `auth` schema — where it returns NULL and every policy denies.
CREATE OR REPLACE FUNCTION "messaging"."requesting_user_id"()
  RETURNS uuid
  LANGUAGE sql
  STABLE
AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

-- SECURITY DEFINER so a policy on conversation_participants can consult
-- conversation_participants without recursing into its own policy. search_path
-- is pinned empty so nothing can shadow the schema-qualified names inside.
CREATE OR REPLACE FUNCTION "messaging"."is_active_user"(p_user_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM iam.users u
     WHERE u.id = p_user_id AND u.is_active AND u.deleted_at IS NULL
  )
$$;

-- Deactivating or deleting an account ends its participation immediately, here
-- as in the application (CLAUDE.md §11.1). Its history is kept.
CREATE OR REPLACE FUNCTION "messaging"."is_active_participant"(
  p_conversation_id uuid,
  p_user_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM messaging.conversation_participants p
      JOIN messaging.conversations c ON c.id = p.conversation_id
      JOIN iam.users u ON u.id = p.user_id
     WHERE p.conversation_id = p_conversation_id
       AND p.user_id = p_user_id
       AND p.left_at IS NULL
       AND c.deleted_at IS NULL
       AND u.is_active
       AND u.deleted_at IS NULL
  )
$$;

CREATE OR REPLACE FUNCTION "messaging"."shares_conversation"(p_user_a uuid, p_user_b uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM messaging.conversation_participants a
      JOIN messaging.conversation_participants b
        ON b.conversation_id = a.conversation_id
     WHERE a.user_id = p_user_a AND b.user_id = p_user_b
       AND a.left_at IS NULL AND b.left_at IS NULL
  )
$$;

-- May this person read this ECM document? ECM owns the answer: it combines IAM
-- permissions with per-document access grants (CLAUDE.md §6.3), and messaging
-- must not reimplement it or read ECM's tables. This asks ECM's database contract
-- function, `ecm.user_can_read_document(user_id, document_id)`, which ECM will
-- publish when it is built (Phase 3). Until that function exists the answer is
-- FALSE: sharing a document is impossible rather than unchecked.
CREATE OR REPLACE FUNCTION "messaging"."can_read_document"(
  p_user_id uuid,
  p_document_id uuid
)
  RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = ''
AS $$
DECLARE
  allowed boolean;
BEGIN
  IF p_user_id IS NULL
     OR p_document_id IS NULL
     OR to_regprocedure('ecm.user_can_read_document(uuid,uuid)') IS NULL THEN
    RETURN false;
  END IF;

  EXECUTE 'SELECT ecm.user_can_read_document($1, $2)'
    INTO allowed
    USING p_user_id, p_document_id;

  RETURN coalesce(allowed, false);
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Triggers — these bind the application's own connection too
-- ---------------------------------------------------------------------------
-- Deliberately NO custom ERRCODE on these exceptions: a code in the 23xxx class
-- makes Prisma report a generic constraint error and drop the message.

-- Nobody writes into a conversation they are not an active member of.
CREATE OR REPLACE FUNCTION "messaging"."messages_before_insert"()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
BEGIN
  IF NEW.sender_id IS NOT NULL
     AND NOT messaging.is_active_participant(NEW.conversation_id, NEW.sender_id) THEN
    RAISE EXCEPTION 'messaging: the sender is not an active participant of this conversation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "messages_participant_check"
  BEFORE INSERT ON "messaging"."messages"
  FOR EACH ROW
  EXECUTE FUNCTION "messaging"."messages_before_insert"();

-- After a message is inserted: move the conversation's sort key, then tell every
-- participant's private Realtime topic that something arrived. The signal
-- carries ids and the sender's display name only; the content is fetched through
-- the application, which authorises the read. realtime.send writes to
-- realtime.messages inside this transaction, so a rolled-back message is never
-- announced, and it catches its own errors, so a Realtime outage cannot block a
-- send. Where Realtime does not exist (plain Postgres) only the sort key moves.
CREATE OR REPLACE FUNCTION "messaging"."messages_after_insert"()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
DECLARE
  recipient record;
  sender_name text;
BEGIN
  UPDATE messaging.conversations
     SET last_message_at = GREATEST(coalesce(last_message_at, NEW.created_at), NEW.created_at),
         updated_at = now()
   WHERE id = NEW.conversation_id;

  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(u.full_name, u.email) INTO sender_name
    FROM iam.users u WHERE u.id = NEW.sender_id;

  FOR recipient IN
    SELECT p.user_id FROM messaging.conversation_participants p
     WHERE p.conversation_id = NEW.conversation_id AND p.left_at IS NULL
  LOOP
    PERFORM realtime.send(
      jsonb_build_object(
        'conversationId', NEW.conversation_id,
        'messageId', NEW.id,
        'senderId', NEW.sender_id,
        'senderName', sender_name,
        'createdAt', NEW.created_at
      ),
      'message.created',
      'messaging:user:' || recipient.user_id,
      true
    );
  END LOOP;

  RETURN NULL;
END;
$$;

CREATE TRIGGER "messages_announce"
  AFTER INSERT ON "messaging"."messages"
  FOR EACH ROW
  EXECUTE FUNCTION "messaging"."messages_after_insert"();

-- Delivery and read receipts: when a participant's watermark moves, tell every
-- participant (the reader's other tabs included, so their unread counts follow).
CREATE OR REPLACE FUNCTION "messaging"."participants_after_receipt"()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
DECLARE
  recipient record;
BEGIN
  IF NEW.last_read_at IS NOT DISTINCT FROM OLD.last_read_at
     AND NEW.last_delivered_at IS NOT DISTINCT FROM OLD.last_delivered_at THEN
    RETURN NULL;
  END IF;

  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN
    RETURN NULL;
  END IF;

  FOR recipient IN
    SELECT p.user_id FROM messaging.conversation_participants p
     WHERE p.conversation_id = NEW.conversation_id AND p.left_at IS NULL
  LOOP
    PERFORM realtime.send(
      jsonb_build_object(
        'conversationId', NEW.conversation_id,
        'userId', NEW.user_id,
        'lastReadAt', NEW.last_read_at,
        'lastDeliveredAt', NEW.last_delivered_at
      ),
      'receipt.updated',
      'messaging:user:' || recipient.user_id,
      true
    );
  END LOOP;

  RETURN NULL;
END;
$$;

CREATE TRIGGER "participants_receipt_announce"
  AFTER UPDATE OF "last_read_at", "last_delivered_at"
  ON "messaging"."conversation_participants"
  FOR EACH ROW
  EXECUTE FUNCTION "messaging"."participants_after_receipt"();

-- Sharing a document through chat grants nothing. The sharer must be able to read
-- the document at the moment of sharing, must be the author of the message it is
-- attached to, and must be an active participant. Every viewer is then checked
-- against ECM again, with their OWN permissions, when they open it.
CREATE OR REPLACE FUNCTION "messaging"."attachments_before_insert"()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
DECLARE
  parent record;
BEGIN
  SELECT m.sender_id, m.deleted_at INTO parent
    FROM messaging.messages m
   WHERE m.id = NEW.message_id AND m.conversation_id = NEW.conversation_id;

  IF NOT FOUND
     OR parent.sender_id IS DISTINCT FROM NEW.attached_by
     OR parent.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'messaging: a document can only be attached to the sharer''s own message';
  END IF;

  IF NOT messaging.is_active_participant(NEW.conversation_id, NEW.attached_by) THEN
    RAISE EXCEPTION 'messaging: the sharer is not an active participant of this conversation';
  END IF;

  IF NOT messaging.can_read_document(NEW.attached_by, NEW.ecm_document_id) THEN
    RAISE EXCEPTION 'messaging: the sharer may not read the document being shared';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "attachments_access_check"
  BEFORE INSERT ON "messaging"."message_attachments"
  FOR EACH ROW
  EXECUTE FUNCTION "messaging"."attachments_before_insert"();

-- An attachment is a historical fact: it is never re-pointed at another document.
CREATE OR REPLACE FUNCTION "messaging"."attachments_immutable"()
  RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'messaging.message_attachments is immutable; % is not permitted', TG_OP;
END;
$$;

CREATE TRIGGER "attachments_no_update"
  BEFORE UPDATE ON "messaging"."message_attachments"
  FOR EACH STATEMENT
  EXECUTE FUNCTION "messaging"."attachments_immutable"();

-- ---------------------------------------------------------------------------
-- 4. Row-level security: deny by default, participants only
-- ---------------------------------------------------------------------------
-- No grants to anon/authenticated exist, so these policies restrict nothing
-- today; they are what holds if a table is ever granted to a client role
-- (ADR-015). There are deliberately NO insert policies on conversations or
-- participants: creating a conversation needs the directory and the permission
-- model, so only the server does it. Nothing may UPDATE or DELETE messages.
ALTER TABLE "messaging"."conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messaging"."conversation_participants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messaging"."messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messaging"."message_attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messaging"."user_presence" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conversations_participant_read" ON "messaging"."conversations"
  FOR SELECT
  USING (
    "deleted_at" IS NULL
    AND "messaging"."is_active_participant"("id", (SELECT "messaging"."requesting_user_id"()))
  );

CREATE POLICY "participants_member_read" ON "messaging"."conversation_participants"
  FOR SELECT
  USING (
    "messaging"."is_active_participant"(
      "conversation_id", (SELECT "messaging"."requesting_user_id"())
    )
  );

-- A participant moves their own watermarks, nobody else's. (Which COLUMNS may be
-- updated is a grant decision: grant UPDATE (last_read_at, last_delivered_at)
-- only, should this table ever be granted to a client role.)
CREATE POLICY "participants_own_receipts" ON "messaging"."conversation_participants"
  FOR UPDATE
  USING (
    "user_id" = (SELECT "messaging"."requesting_user_id"())
    AND "messaging"."is_active_participant"("conversation_id", "user_id")
  )
  WITH CHECK (
    "user_id" = (SELECT "messaging"."requesting_user_id"())
    AND "messaging"."is_active_participant"("conversation_id", "user_id")
  );

CREATE POLICY "messages_participant_read" ON "messaging"."messages"
  FOR SELECT
  USING (
    "deleted_at" IS NULL
    AND "messaging"."is_active_participant"(
      "conversation_id", (SELECT "messaging"."requesting_user_id"())
    )
  );

CREATE POLICY "messages_participant_send" ON "messaging"."messages"
  FOR INSERT
  WITH CHECK (
    "sender_id" = (SELECT "messaging"."requesting_user_id"())
    AND "message_type" IN ('TEXT', 'DOCUMENT')
    AND "edited_at" IS NULL
    AND "deleted_at" IS NULL
    AND "messaging"."is_active_participant"("conversation_id", "sender_id")
  );

CREATE POLICY "attachments_participant_read" ON "messaging"."message_attachments"
  FOR SELECT
  USING (
    "messaging"."is_active_participant"(
      "conversation_id", (SELECT "messaging"."requesting_user_id"())
    )
  );

CREATE POLICY "attachments_sharer_insert" ON "messaging"."message_attachments"
  FOR INSERT
  WITH CHECK (
    "attached_by" = (SELECT "messaging"."requesting_user_id"())
    AND "messaging"."is_active_participant"("conversation_id", "attached_by")
    AND "messaging"."can_read_document"("attached_by", "ecm_document_id")
  );

-- "Last seen" is visible to oneself and to people one shares a conversation with.
CREATE POLICY "presence_read" ON "messaging"."user_presence"
  FOR SELECT
  USING (
    "user_id" = (SELECT "messaging"."requesting_user_id"())
    OR "messaging"."shares_conversation"(
      (SELECT "messaging"."requesting_user_id"()), "user_id"
    )
  );

CREATE POLICY "presence_own_write" ON "messaging"."user_presence"
  FOR ALL
  USING ("user_id" = (SELECT "messaging"."requesting_user_id"()))
  WITH CHECK ("user_id" = (SELECT "messaging"."requesting_user_id"()));

-- ---------------------------------------------------------------------------
-- 5. Realtime authorization (Supabase only)
-- ---------------------------------------------------------------------------
-- Private channels are authorised by RLS on realtime.messages: SELECT to receive,
-- INSERT to send. Three topic families, nothing else:
--
--   messaging:presence              Presence. Any active user may join and track.
--   messaging:user:<user id>        Broadcast, receive only, own id only. The
--                                   database sends here (message and receipt
--                                   signals); clients cannot.
--   messaging:conversation:<id>     Broadcast, send and receive, active
--                                   participants only. Typing indicators.
--
-- Typing and presence never touch a Postgres table: client broadcasts are
-- authorised when the channel is joined and then relayed in memory. Presence
-- cannot evaluate the application's permission model, so any ACTIVE account may
-- join it; it reveals which user ids are online and nothing more.
CREATE OR REPLACE FUNCTION "messaging"."realtime_topic_allowed"(
  p_topic text,
  p_extension text,
  p_is_send boolean
)
  RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = ''
AS $$
DECLARE
  uid uuid := messaging.requesting_user_id();
  target text;
BEGIN
  IF uid IS NULL OR p_topic IS NULL OR NOT messaging.is_active_user(uid) THEN
    RETURN false;
  END IF;

  IF p_topic = 'messaging:presence' THEN
    RETURN p_extension = 'presence';
  END IF;

  IF p_topic LIKE 'messaging:user:%' THEN
    RETURN NOT p_is_send
       AND p_extension = 'broadcast'
       AND substr(p_topic, 16) = uid::text;
  END IF;

  IF p_topic LIKE 'messaging:conversation:%' AND p_extension = 'broadcast' THEN
    target := substr(p_topic, 24);
    RETURN target ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND messaging.is_active_participant(target::uuid, uid);
  END IF;

  RETURN false;
END;
$$;

-- Functions are executable by PUBLIC by default; the definer-rights helpers must
-- not be callable as oracles ("is user X in conversation Y?").
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "messaging" FROM PUBLIC;

-- Revoke everything from the API roles, then give `authenticated` exactly what
-- the Realtime policies need. Guarded because these roles and the realtime schema
-- exist only on Supabase, not on the plain Postgres the integration suite uses.
DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA messaging FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA messaging FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA messaging FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL ROUTINES IN SCHEMA messaging FROM %I', api_role);
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA messaging REVOKE ALL ON TABLES FROM %I',
        api_role
      );
    END IF;
  END LOOP;

  IF to_regclass('realtime.messages') IS NULL
     OR to_regprocedure('realtime.topic()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE NOTICE 'Supabase Realtime not present; skipping messaging Realtime policies.';
    RETURN;
  END IF;

  -- USAGE lets the policies call the one function below. It exposes no table:
  -- the schema is not in PostgREST's exposed list and `authenticated` holds no
  -- table privilege in it.
  GRANT USAGE ON SCHEMA messaging TO authenticated;
  GRANT EXECUTE ON FUNCTION messaging.realtime_topic_allowed(text, text, boolean)
    TO authenticated;

  DROP POLICY IF EXISTS messaging_realtime_receive ON realtime.messages;
  CREATE POLICY messaging_realtime_receive ON realtime.messages
    FOR SELECT TO authenticated
    USING (messaging.realtime_topic_allowed((SELECT realtime.topic()), extension, false));

  DROP POLICY IF EXISTS messaging_realtime_send ON realtime.messages;
  CREATE POLICY messaging_realtime_send ON realtime.messages
    FOR INSERT TO authenticated
    WITH CHECK (messaging.realtime_topic_allowed((SELECT realtime.topic()), extension, true));
END $$;
