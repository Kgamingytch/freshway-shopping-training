// [home]
// Subscription store - persists board subscriptions in Supabase
// (board_subscriptions table) with the local JSON file as fallback.
//
// Table shape (create in Supabase if missing):
//   board_subscriptions (
//     user_id     text not null,
//     session_id  text not null,   -- "*" = global subscription
//     title       text,
//     created_at  timestamptz default now(),
//     primary key (user_id, session_id)
//   )

const { getSupabase } = require("./supabase");

/** Read every subscription. Supabase first; falls back to the file store. */
async function readAll(fileFallback) {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from("board_subscriptions").select("user_id, session_id, title");
    if (!error && Array.isArray(data)) {
      return data.map((r) => ({
        userId: String(r.user_id),
        sessionId: String(r.session_id),
        title: r.title ?? null,
      }));
    }
    if (error) console.warn("[Subs] Supabase read failed, using file fallback:", error.message);
  }
  return fileFallback();
}

/** Write a full subscription list (replace-all strategy). */
async function writeAll(fileFallback, subscriptions) {
  const sb = getSupabase();
  // Always keep the file updated as a fallback snapshot.
  fileFallback(subscriptions);
  if (!sb) return;
  const rows = subscriptions.map((s) => ({ user_id: s.userId, session_id: s.sessionId, title: s.title }));
  // Simple + safe: wipe and reinsert (subscription lists are small).
  const del = await sb.from("board_subscriptions").delete().neq("user_id", "__never__");
  if (del.error) {
    console.warn("[Subs] Supabase clear failed:", del.error.message);
    return;
  }
  if (rows.length > 0) {
    const ins = await sb.from("board_subscriptions").insert(rows);
    if (ins.error) console.warn("[Subs] Supabase insert failed:", ins.error.message);
  }
}

module.exports = { readAll, writeAll };
