// Bot presence - sets a custom activity showing how many training sessions
// are currently scheduled. Self-scheduled by the bot; also triggerable on
// demand via the HTTP API (/api/presence/refresh).

const { ActivityType } = require("discord.js");
const { getSupabase } = require("./supabase");

/**
 * Refresh the bot's custom activity with the scheduled-session count.
 * With no sessions it says so.
 */
async function refreshPresence(client) {
  const sb = getSupabase();
  if (!sb) {
    console.warn("[Presence] SUPABASE not configured - using static activity");
    setActivity(client, "Training Portal");
    return { ok: false, activity: "Training Portal", error: "SUPABASE not configured" };
  }

  try {
    const { data: sessions } = await sb
      .from("training_sessions")
      .select("status")
      .eq("status", "scheduled");

    const scheduledCount = (sessions ?? []).length;
    const activityText =
      scheduledCount > 0
        ? `${scheduledCount} training session${scheduledCount === 1 ? "" : "s"} scheduled`
        : "No training sessions scheduled";

    setActivity(client, activityText);
    console.log(`[Presence] Bot activity updated: ${activityText}`);
    return { ok: true, activity: activityText };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Unknown error";
    console.error("[Presence] Failed to update bot presence:", error);
    setActivity(client, "Training Portal");
    return { ok: false, activity: "Training Portal", error };
  }
}

/** Set the bot's activity as a custom status so it reads as plain text. */
function setActivity(client, text) {
  client.user?.setPresence({
    activities: [
      {
        name: "Custom Status",
        type: ActivityType.Custom,
        state: text,
      },
    ],
    status: "online",
  });
}

module.exports = { refreshPresence };
