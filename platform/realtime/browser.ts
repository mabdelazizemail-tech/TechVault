import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

/**
 * The browser's connection to Supabase Realtime (ADR-020).
 *
 * Realtime is used for SIGNALS only — presence, typing, and "something changed"
 * notices carrying ids. Business data is never read through it or through the
 * Supabase client: the application fetches content with Server Actions, which
 * authorise every read (CLAUDE.md §8.6).
 *
 * Every channel is PRIVATE, so Supabase checks the policies on realtime.messages
 * against the signed-in user's token before delivering anything.
 *
 * The Supabase client is imported on first use, not with the page, so the
 * Realtime library costs nothing until a feature actually connects.
 */

let connection: Promise<SupabaseClient> | null = null;

async function connect(): Promise<SupabaseClient> {
  const { createClientSupabaseClient } = await import("@/platform/auth/supabase/client");
  const supabase = createClientSupabaseClient();
  // Hands the session's access token to the socket; the client keeps it current
  // as the session refreshes.
  await supabase.realtime.setAuth();
  return supabase;
}

function client(): Promise<SupabaseClient> {
  connection ??= connect().catch((error: unknown) => {
    connection = null;
    throw error;
  });
  return connection;
}

export type { RealtimeChannel };

/**
 * Opens a private channel. Configure listeners in `setup`, which runs before the
 * channel subscribes. Returns a function that leaves the channel.
 */
export async function openPrivateChannel(
  topic: string,
  setup: (channel: RealtimeChannel) => void,
  options: { presenceKey?: string; onStatus?: (status: string) => void } = {},
): Promise<{ channel: RealtimeChannel; leave: () => Promise<void> }> {
  const supabase = await client();
  const channel = supabase.channel(topic, {
    config: {
      private: true,
      broadcast: { self: false, ack: false },
      ...(options.presenceKey !== undefined
        ? { presence: { key: options.presenceKey } }
        : {}),
    },
  });
  setup(channel);
  channel.subscribe((status) => options.onStatus?.(status));

  return {
    channel,
    leave: async () => {
      await supabase.removeChannel(channel);
    },
  };
}
