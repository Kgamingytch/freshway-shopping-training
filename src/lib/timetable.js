// Training timetable - posts the upcoming training schedule to the
// timetable channel as an embed with an action row of buttons.
//
// Usage:
//   /timetable                     → post (or refresh) the schedule
//   POST /api/timetable/post       → trigger from the website
//   "Refresh" button on the message → re-fetches and edits in place

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { getSupabase } = require("./supabase");
const { buildEmbed } = require("./embeds");
const config = require("../config");

const TIMETABLE_REFRESH_ID = "timetable_refresh";

function portalBase() {
  return process.env.FRESHWAY_PORTAL_URL?.trim().replace(/\/+$/, "") || null;
}

/** Fetch upcoming sessions (scheduled + ongoing) with host names. */
async function fetchUpcomingSessions(limit = 10) {
  const sb = getSupabase();
  if (!sb) {
    console.warn("[Timetable] SUPABASE not configured - cannot fetch sessions");
    return [];
  }

  const { data } = await sb
    .from("training_sessions")
    .select("id, title, scheduled_at, host_user_id, roblox_game_link")
    .in("status", ["scheduled", "ongoing"])
    .order("scheduled_at", { ascending: true })
    .limit(limit);
  const sessions = data ?? [];

  // Resolve host names (Roblox name preferred, fall back to Discord).
  const hostIds = [...new Set(sessions.map((s) => s.host_user_id).filter(Boolean))];
  let profileMap = new Map();
  let robloxMap = new Map();
  if (hostIds.length > 0) {
    const [profiles, roblox] = await Promise.all([
      sb.from("profiles").select("id, discord_username").in("id", hostIds),
      sb.from("roblox_accounts").select("user_id, roblox_username").in("user_id", hostIds),
    ]);
    profileMap = new Map((profiles.data ?? []).map((p) => [p.id, p.discord_username]));
    robloxMap = new Map((roblox.data ?? []).map((r) => [r.user_id, r.roblox_username]));
  }

  return sessions.map((s) => ({
    ...s,
    hostName: s.host_user_id
      ? (robloxMap.get(s.host_user_id) ?? profileMap.get(s.host_user_id) ?? "Unknown")
      : "Unassigned",
  }));
}

/** Build the timetable embed. With no sessions it simply says so. */
function buildTimetableEmbed(sessions) {
  if (!sessions.length) {
    return buildEmbed({
      title: "Training Timetable",
      description: "> **No sessions scheduled.**",
    });
  }

  const lines = [];
  for (const s of sessions) {
    const time = s.scheduled_at
      ? `<t:${Math.floor(new Date(s.scheduled_at).getTime() / 1000)}:F>`
      : "Not scheduled";
    lines.push(`> **${s.title}** - ${time}`);
    lines.push(`> Host: ${s.hostName}`);
    if (s.roblox_game_link) {
      lines.push(`> Game: [Join Server](${s.roblox_game_link})`);
    }
    lines.push("");
  }

  return buildEmbed({
    title: "Training Timetable",
    description: lines.join("\n").trim(),
  });
}

/** Action row with a Refresh button and (optionally) a portal link. */
function buildTimetableRow() {
  const row = new ActionRowBuilder();
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(TIMETABLE_REFRESH_ID)
      .setLabel("Refresh")
      .setStyle(ButtonStyle.Secondary),
  );
  const portal = portalBase();
  if (portal) {
    row.addComponents(
      new ButtonBuilder()
        .setLabel("View on Portal")
        .setStyle(ButtonStyle.Link)
        .setURL(`${portal}/timetable`),
    );
  }
  return row;
}

/** Post the timetable to a channel (defaults to the configured one). */
async function postTimetable(client, { channelId } = {}) {
  const id = channelId || config.channels.timetable();
  if (!id) {
    console.warn("[Timetable] No timetable channel configured (FRESHWAY_CHANNEL_TIMETABLE)");
    return { ok: false, count: 0, error: "Timetable channel not configured" };
  }

  const channel = await client.channels.fetch(id).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    console.warn(`[Timetable] Channel ${id} not found or not a text channel`);
    return { ok: false, count: 0, error: "Timetable channel not found" };
  }

  const sessions = await fetchUpcomingSessions();
  const sent = await channel
    .send({
      embeds: [buildTimetableEmbed(sessions)],
      components: [buildTimetableRow()],
    })
    .catch((e) => {
      console.error("[Timetable] Failed to send:", e);
      return null;
    });

  if (!sent) return { ok: false, count: 0, error: "Failed to send" };
  console.log(`[Timetable] Posted ${sessions.length} session(s) to ${id}`);
  return { ok: true, count: sessions.length };
}

/** Re-fetch and edit an existing timetable message in place (Refresh button). */
async function updateTimetableMessage(client, message) {
  try {
    const sessions = await fetchUpcomingSessions();
    await message.edit({
      embeds: [buildTimetableEmbed(sessions)],
      components: [buildTimetableRow()],
    });
    console.log(`[Timetable] Refreshed message in ${message.channelId}`);
    return true;
  } catch (e) {
    console.error("[Timetable] Refresh failed:", e);
    return false;
  }
}

/**
 * Auto-update the timetable: edits the last bot-posted timetable message in
 * the channel if one exists, otherwise posts a fresh one. Used by the
 * scheduler so the schedule stays current without spamming the channel.
 */
async function autoUpdateTimetable(client) {
  const id = config.channels.timetable();
  if (!id) {
    return { ok: false, count: 0, error: "Timetable channel not configured" };
  }

  const channel = await client.channels.fetch(id).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    return { ok: false, count: 0, error: "Timetable channel not found" };
  }

  try {
    const sessions = await fetchUpcomingSessions();

    // Find the most recent bot message that carries the timetable buttons.
    const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
    const existing = messages
      ? [...messages.values()].find(
          (m) =>
            m.author?.id === client.user.id &&
            m.components?.some((row) =>
              row.components?.some((b) => b.customId === TIMETABLE_REFRESH_ID),
            ),
        )
      : null;

    if (existing) {
      await existing.edit({
        embeds: [buildTimetableEmbed(sessions)],
        components: [buildTimetableRow()],
      });
      console.log(`[Timetable] Auto-updated message in ${id} (${sessions.length} sessions)`);
    } else {
      await channel.send({
        embeds: [buildTimetableEmbed(sessions)],
        components: [buildTimetableRow()],
      });
      console.log(`[Timetable] Auto-posted to ${id} (${sessions.length} sessions)`);
    }
    return { ok: true, count: sessions.length };
  } catch (e) {
    console.error("[Timetable] Auto-update failed:", e);
    return { ok: false, count: 0, error: "Failed to auto-update" };
  }
}

module.exports = {
  TIMETABLE_REFRESH_ID,
  fetchUpcomingSessions,
  buildTimetableEmbed,
  buildTimetableRow,
  postTimetable,
  updateTimetableMessage,
  autoUpdateTimetable,
};
