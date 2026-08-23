// Notification templates - ported from the FreshWay website
// (src/lib/training/discord-notifications.ts, punishments.ts, reports.ts,
// sessions.ts, whitelist.ts, quiz.ts). Every Discord message the FreshWay
// system can send lives here; the website only triggers these via the HTTP
// API.
//
// All fetches happen through Supabase (see ./supabase). When Supabase or a
// channel is not configured, functions degrade gracefully with a warning.

const { getSupabase } = require("./supabase");
const { sendDiscordDm } = require("./dms");
const {
  sendChannelEmbed,
  sendTrainingChannelEmbed,
  sendLogEmbed,
  sendAnnouncementEmbed,
} = require("./channels");
const config = require("../config");

// ---------- Helpers ----------

function unixTimestamp(iso) {
  return iso ? `<t:${Math.floor(new Date(iso).getTime() / 1000)}:F>` : "Not scheduled";
}

function relativeTimestamp(iso) {
  return `<t:${Math.floor(new Date(iso).getTime() / 1000)}:R>`;
}

async function fetchUsername(sb, userId) {
  if (!sb || !userId) return "Unknown";
  const { data: profile } = await sb
    .from("profiles")
    .select("discord_username")
    .eq("id", userId)
    .maybeSingle();
  return profile?.discord_username ?? "Unknown";
}

function capitalise(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------- Session notifications ----------

/** Notify the trainings channel when a new session is created. */
async function notifySessionCreated(client, sessionId) {
  try {
    const sb = getSupabase();
    if (!sb) {
      console.warn("[Notify] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set - skipping session-created notification");
      return;
    }
    const { data: session } = await sb
      .from("training_sessions")
      .select("*")
      .eq("id", sessionId)
      .single();
    if (!session) return;

    let hostName = "Unassigned";
    if (session.host_user_id) {
      const { data: profile } = await sb
        .from("profiles")
        .select("discord_username")
        .eq("id", session.host_user_id)
        .maybeSingle();
      const { data: roblox } = await sb
        .from("roblox_accounts")
        .select("roblox_username")
        .eq("user_id", session.host_user_id)
        .maybeSingle();
      hostName = roblox?.roblox_username ?? profile?.discord_username ?? "Unknown";
    }

    const description = [
      `> **Host:** ${hostName}`,
      `> **Scheduled:** ${unixTimestamp(session.scheduled_at)}`,
      session.description ? `> ${session.description.slice(0, 200)}` : "",
      session.roblox_game_link ? `> **Game:** [Join Server](${session.roblox_game_link})` : "",
      session.discord_channel ? `> **Discord:** ${session.discord_channel}` : "",
    ].filter(Boolean).join("\n");

    await sendChannelEmbed(client, {
      channelKey: "trainings",
      title: `New Training Session: ${session.title}`,
      description,
      mentionRoleId: config.roles.trainer() ?? undefined,
    });
  } catch (e) {
    console.error("[Notify] Failed to notify session created:", e);
  }
}

/** Notify the trainings channel when a session status changes. */
async function notifySessionStatusChanged(client, sessionId, oldStatus, newStatus) {
  try {
    const sb = getSupabase();
    if (!sb) return;
    const { data: session } = await sb
      .from("training_sessions")
      .select("title, scheduled_at")
      .eq("id", sessionId)
      .single();
    if (!session) return;

    await sendTrainingChannelEmbed(
      client,
      `Session ${capitalise(newStatus)}`,
      [
        `> **Session:** ${session.title}`,
        `> **Status:** ${oldStatus} → **${newStatus}**`,
        `> **Scheduled:** ${unixTimestamp(session.scheduled_at)}`,
      ].join("\n"),
    );
  } catch (e) {
    console.error("[Notify] Failed to notify status change:", e);
  }
}

/** Log when a session is deleted. */
async function notifySessionDeleted(client, sessionId, title, deletedBy) {
  await sendLogEmbed(client, "Session Deleted", [
    `> **Session:** ${title}`,
    `> **Deleted by:** ${deletedBy}`,
  ].join("\n"));
}

// ---------- Certification notifications ----------

/** Notify the trainings channel when a trainer certification is approved/rejected. */
async function notifyCertificationReviewed(client, userId, status, score, total) {
  try {
    const sb = getSupabase();
    const username = await fetchUsername(sb, userId);

    await sendTrainingChannelEmbed(
      client,
      `Certification ${capitalise(status)}`,
      [
        `> **Trainer:** ${username}`,
        `> **Score:** ${score}/${total} (${Math.round((score / total) * 100)}%)`,
        `> **Result:** **${status}**`,
      ].join("\n"),
    );
  } catch (e) {
    console.error("[Notify] Failed to notify cert review:", e);
  }
}

// ---------- Punishment notifications ----------

/**
 * Punishment issued: DM the target with a notice and post to the
 * punishment-logs channel. Returns { dmSent } so the website can store it.
 */
async function notifyPunishmentIssued(client, { targetDiscord, targetDiscordId, type, reason, issuedBy, expiresAt }) {
  const dmSent = await (async () => {
    if (!targetDiscordId) {
      // Try to resolve the Discord ID from the profile by username
      const sb = getSupabase();
      if (sb) {
        const { data: profile } = await sb
          .from("profiles")
          .select("discord_id")
          .ilike("discord_username", String(targetDiscord).replace(/^@/, ""))
          .maybeSingle()
          .catch(() => ({ data: null }));
        if (profile?.discord_id) {
          return await sendPunishmentDm(client, profile.discord_id, type, reason, expiresAt);
        }
      }
      return false;
    }
    return await sendPunishmentDm(client, targetDiscordId, type, reason, expiresAt);
  })();

  const punishmentChannel = config.channels.punishmentLogs() || config.channels.logs();
  await sendChannelEmbed(client, {
    channelId: punishmentChannel,
    title: `Punishment Issued: ${capitalise(type)}`,
    description: [
      `> **Target:** @${targetDiscord}`,
      `> **Type:** ${type}`,
      `> **Reason:** ${reason}`,
      `> **Issued by:** ${issuedBy}`,
    ].join("\n"),
    color: config.colors.logGray,
  });

  return { dmSent };
}

async function sendPunishmentDm(client, discordId, type, reason, expiresAt) {
  const expiryLine = expiresAt
    ? `> This ${type} expires on **${new Date(expiresAt).toLocaleDateString()}**.`
    : "> If you believe this was issued in error, please contact a Training Manager through the FreshWay Discord server for further review.";
  const description = [
    `> A **${type}** has been issued against your account by the Training Department.`,
    "",
    `> **Reason:** ${reason}`,
    "",
    expiryLine,
  ].join("\n");

  return await sendDiscordDm(client, discordId, {
    title: "Training Department Notice",
    description,
  });
}

// ---------- Monthly reports ----------

/** Post a monthly report summary to the announcements channel. */
async function notifyMonthlyReport(client, month, data = {}) {
  const staffCount = typeof data.staff_count === "number" ? data.staff_count : 0;
  const sessionsLogged = typeof data.sessions_logged === "number" ? data.sessions_logged : 0;
  const tasks = typeof data.tasks === "number" ? data.tasks : 0;

  await sendAnnouncementEmbed(client, `Monthly Report: ${month}`, [
    `> **Staff:** ${staffCount}`,
    `> **Sessions Logged:** ${sessionsLogged}`,
    `> **Tasks:** ${tasks}`,
    `> **Generated:** <t:${Math.floor(Date.now() / 1000)}:F>`,
  ].join("\n"));
}

// ---------- Session reminders ----------

/**
 * DM hosts of sessions starting in the next hour.
 * Returns { sent, errors }. Self-scheduled by the bot, also triggerable
 * through the HTTP API.
 */
async function sendSessionReminders(client) {
  const sb = getSupabase();
  if (!sb) {
    console.warn("[Reminders] SUPABASE not configured - skipping reminder sweep");
    return { sent: 0, errors: 0 };
  }

  const now = new Date();
  const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

  const { data: sessions } = await sb
    .from("training_sessions")
    .select("id, title, host_user_id, scheduled_at")
    .eq("status", "scheduled")
    .gte("scheduled_at", now.toISOString())
    .lte("scheduled_at", oneHourFromNow.toISOString());

  if (!sessions || sessions.length === 0) return { sent: 0, errors: 0 };

  let sent = 0;
  let errors = 0;

  for (const session of sessions) {
    if (!session.host_user_id) continue;
    try {
      const { data: profile } = await sb
        .from("profiles")
        .select("discord_id")
        .eq("id", session.host_user_id)
        .maybeSingle();
      if (!profile?.discord_id) continue;

      const ok = await sendDiscordDm(client, profile.discord_id, {
        title: "Session Reminder",
        description: [
          `> Your training session **${session.title}** starts ${relativeTimestamp(session.scheduled_at)}.`,
          "> Please ensure you are ready and the Roblox server is set up.",
          "> If you need to reschedule, update the session status from the Training Portal.",
        ].join("\n"),
      });
      if (ok) sent++;
      else errors++;
    } catch {
      errors++;
    }
    // Rate limit between DMs
    await new Promise((r) => setTimeout(r, 350));
  }

  console.log(`[Reminders] Sent ${sent} reminders, ${errors} errors`);
  return { sent, errors };
}

module.exports = {
  notifySessionCreated,
  notifySessionStatusChanged,
  notifySessionDeleted,
  notifyCertificationReviewed,
  notifyPunishmentIssued,
  notifyMonthlyReport,
  sendSessionReminders,
};
