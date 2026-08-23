// Supabase access for the bot.
//
// The bot reads the same FreshWay tables the website uses (profiles,
// training_sessions, trainer_certifications, ...) so notifications and
// presence can fetch live data themselves. Configure SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY in the environment.

const { createClient } = require("@supabase/supabase-js");

// Node 20 has no native WebSocket, but supabase-js eagerly builds its
// realtime client (which needs one). Provide `ws` as the transport so the
// client can be created on older runtimes; all our queries are plain REST
// and never open a realtime socket.
let WebSocketImpl = null;
try {
  WebSocketImpl = require("ws");
} catch {
  WebSocketImpl = null;
}

let client = null;

/** Returns a service-role Supabase client, or null when not configured. */
function getSupabase() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  if (!client) {
    try {
      client = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
        ...(WebSocketImpl ? { realtime: { transport: WebSocketImpl } } : {}),
      });
    } catch (e) {
      // A broken/unsupported Supabase config must never crash the bot —
      // callers already degrade gracefully when getSupabase() is null.
      console.error("[Supabase] Failed to create client:", e);
      return null;
    }
  }
  return client;
}

module.exports = { getSupabase };
