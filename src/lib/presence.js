// Bot presence — sets the bot's activity status with live training metrics
// from Supabase. Self-scheduled by the bot; also triggerable on demand via
// the HTTP API (/api/presence/refresh).

const { ActivityType } = require("discord.js");
const { getSupabase } = require("./supabase");

/**
 * Refresh the bot's activity with live metrics.
 * Activity types: 0 Playing, 1 Streaming, 2 Listening, 3 Watching, ...
 */
async function refreshPresence(client) {
  const sb = getSupabase();
  if (!sb) {
    console.warn("[Presence] SUPABASE not configured — using static activity");
    setActivity(client, "FreshWay Training Portal");
    return { ok: false, activity: "FreshWay Training Portal", error: "SUPABASE not configured" };
  }

  try {
    const [staffResult, sessionsResult, trainersResult, pendingCertsResult] = await Promise.all([
      sb.from("training_staff").select("id", { count: "exact", head: true }),
      sb.from("training_sessions").select("status").then(({ data }) => data ?? []),
      sb.from("trainer_certifications").select("user_id").eq("status", "approved").then(({ data }) => data ?? []),
      sb.from("trainer_certifications").select("id").eq("status", "pending_review").then(({ data }) => data ?? []),
    ]);

    const staffCount = staffResult.count ?? 0;
    const activeSessions = sessionsResult.filter((s) => s.status === "scheduled" || s.status === "ongoing").length;
    const trainerCount = trainersResult.length;
    const pendingCerts = pendingCertsResult.length;

    const parts = [];
    if (staffCount > 0) parts.push(`${staffCount} staff`);
    if (trainerCount > 0) parts.push(`${trainerCount} trainers`);
    if (activeSessions > 0) parts.push(`${activeSessions} active session${activeSessions === 1 ? "" : "s"}`);
    if (pendingCerts > 0) parts.push(`${pendingCerts} pending cert${pendingCerts === 1 ? "" : "s"}`);

    const activityText = parts.length > 0
      ? `FreshWay Training — ${parts.join(" · ")}`
      : "FreshWay Training Portal";

    setActivity(client, activityText);
    console.log(`[Presence] Bot activity updated: ${activityText}`);
    return { ok: true, activity: activityText };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Unknown error";
    console.error("[Presence] Failed to update bot presence:", error);
    setActivity(client, "FreshWay Training Portal");
    return { ok: false, activity: "FreshWay Training Portal", error };
  }
}

function setActivity(client, text) {
  client.user?.setPresence({
    activities: [{ name: text, type: ActivityType.Watching }],
    status: "online",
  });
}

module.exports = { refreshPresence };
