// Supabase access for the bot.
//
// The bot reads the same FreshWay tables the website uses (profiles,
// training_sessions, trainer_certifications, ...) so notifications and
// presence can fetch live data themselves. Configure SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY in the environment.

const { createClient } = require("@supabase/supabase-js");

let client = null;

/** Returns a service-role Supabase client, or null when not configured. */
function getSupabase() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  if (!client) {
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

module.exports = { getSupabase };
