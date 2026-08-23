// Live boards - one self-updating embed per channel.
//
// Both the trainings channel and the timetable channel show a single
// message that lists the upcoming sessions and is edited in place every
// few seconds, so the schedule is always current without spamming the
// channel. Discord components (buttons) live on the same message:
//   - trainings board: "Join as Co-Host" / "Join as Helper" per session
//     plus a Refresh button (also the marker used to find the message)
//   - timetable board: Refresh + optional "View on Portal" link buttons
//
// Boards only edit their message when the content actually changed
// (fingerprint comparison), so the 20s scheduler does not spam the API.

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { getSupabase } = require("./supabase");
const { buildEmbed } = require("./embeds");
const { buildSessionJoinRow } = require("./session-join");
const config = require("../config");

const TIMETABLE_REFRESH_ID = "timetable_refresh";
const TRAININGS_REFRESH_ID = "trainings_board_refresh";

// Discord allows at most 5 action rows per message; each session needs its
// own row (Co-Host + Helper buttons), so the trainings board shows 5.
const BOARD_LIMIT = 5;

function portalBase() {
  return process.env.FRESHWAY_PORTAL_URL?.trim().replace(/\/+$/, "") || null;
}

/** Fetch upcoming sessions (scheduled + ongoing) with host names. */
async function fetchBoardSessions(limit = 10) {
  const sb = getSupabase();
  if (!sb) {
    console.warn("[Boards] SUPABASE not configured - cannot fetch sessions");
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

// ---------- Timetable board ----------

/** Build the timetable embed. With no sessions it simply says so. */
function buildTimetableBoardEmbed(sessions) {
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

// ---------- Trainings board ----------

/** Build the trainings board embed: sessions with join buttons below. */
function buildTrainingsBoardEmbed(sessions) {
  const shown = sessions.slice(0, BOARD_LIMIT);
  if (!shown.length) {
    return buildEmbed({
      title: "Upcoming Training Sessions",
      description: "> **No sessions scheduled.**",
    });
  }

  const lines = [];
  for (const s of shown) {
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
  if (sessions.length > BOARD_LIMIT) {
    lines.push(`> *Showing the first ${BOARD_LIMIT} sessions - see the timetable for the full list.*`);
  }

  return buildEmbed({
    title: "Upcoming Training Sessions",
    description: lines.join("\n").trim(),
  });
}

/**
 * Component rows for the trainings board: one join-button row per session
 * plus a Refresh button appended to the last row. The Refresh button is
 * always present (even with zero sessions) so the auto-updater can find
 * this message reliably.
 */
function buildTrainingsBoardComponents(sessions) {
  const rows = [];
  for (const s of sessions.slice(0, BOARD_LIMIT)) {
    rows.push(buildSessionJoinRow(s.id));
  }
  if (rows.length === 0) {
    rows.push(new ActionRowBuilder());
  }
  rows[rows.length - 1].addComponents(
    new ButtonBuilder()
      .setCustomId(TRAININGS_REFRESH_ID)
      .setLabel("Refresh")
      .setStyle(ButtonStyle.Secondary),
  );
  return rows;
}

// ---------- Shared auto-update engine ----------

/**
 * Read a button's custom id regardless of shape: builders keep it in
 * `data.custom_id` (the `.customId` getter is undefined on this discord.js
 * version), while API-fetched messages expose `MessageButton.customId`.
 */
function buttonId(button) {
  return button?.data?.custom_id ?? button?.customId ?? null;
}

function embedFingerprint(embed) {
  return JSON.stringify({ t: embed.title, d: embed.description });
}

function componentsFingerprint(components) {
  return JSON.stringify(
    (components ?? []).map((row) => (row.components ?? []).map(buttonId)),
  );
}

/**
 * Find the board message in a channel: the most recent bot message that
 * carries a button with the given marker custom id.
 */
async function findBoardMessage(client, channel, markerId) {
  const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  if (!messages) return null;
  return (
    [...messages.values()].find(
      (m) =>
        m.author?.id === client.user.id &&
        m.components?.some((row) =>
          (row.components ?? []).some((b) => buttonId(b) === markerId),
        ),
    ) ?? null
  );
}

/**
 * Refresh one board: edit the existing board message in place when the
 * content changed, otherwise leave it alone; post a fresh one when missing.
 */
async function autoUpdateBoard(client, { channelKey, markerId, buildEmbedFn, buildComponentsFn, fetchLimit, label }) {
  const id = config.channels[channelKey] ? config.channels[channelKey]() : null;
  if (!id) {
    return { ok: false, count: 0, changed: false, error: `${channelKey} channel not configured` };
  }

  const channel = await client.channels.fetch(id).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    return { ok: false, count: 0, changed: false, error: `${channelKey} channel not found` };
  }

  let sessions = [];
  try {
    sessions = await fetchBoardSessions(fetchLimit ?? 10);
  } catch (e) {
    console.error(`[Boards] ${label}: failed to fetch sessions:`, e);
    return { ok: false, count: 0, changed: false, error: "Failed to fetch sessions" };
  }

  const embeds = [buildEmbedFn(sessions)];
  const components = buildComponentsFn ? buildComponentsFn(sessions) : undefined;

  const existing = await findBoardMessage(client, channel, markerId);

  if (existing) {
    const newEmbedsSig = embeds.map(embedFingerprint).join("|");
    const newCompsSig = componentsFingerprint(components);
    const oldEmbedsSig = (existing.embeds ?? []).map(embedFingerprint).join("|");
    const oldCompsSig = componentsFingerprint(existing.components);

    if (newEmbedsSig === oldEmbedsSig && newCompsSig === oldCompsSig) {
      return { ok: true, count: sessions.length, changed: false };
    }

    await existing.edit({ embeds, ...(components ? { components } : {}) });
    console.log(`[Boards] ${label} updated in ${id} (${sessions.length} sessions)`);
    return { ok: true, count: sessions.length, changed: true };
  }

  await channel.send({ embeds, ...(components ? { components } : {}) });
  console.log(`[Boards] ${label} posted to ${id} (${sessions.length} sessions)`);
  return { ok: true, count: sessions.length, changed: true };
}

/** Refresh the trainings channel board (session list + join buttons). */
async function updateTrainingsBoard(client) {
  return autoUpdateBoard(client, {
    channelKey: "trainings",
    markerId: TRAININGS_REFRESH_ID,
    buildEmbedFn: buildTrainingsBoardEmbed,
    buildComponentsFn: buildTrainingsBoardComponents,
    fetchLimit: BOARD_LIMIT + 1,
    label: "Trainings board",
  });
}

/** Refresh the timetable channel board. */
async function updateTimetableBoard(client) {
  return autoUpdateBoard(client, {
    channelKey: "timetable",
    markerId: TIMETABLE_REFRESH_ID,
    buildEmbedFn: buildTimetableBoardEmbed,
    buildComponentsFn: () => [buildTimetableRow()],
    fetchLimit: 10,
    label: "Timetable",
  });
}

module.exports = {
  TIMETABLE_REFRESH_ID,
  TRAININGS_REFRESH_ID,
  BOARD_LIMIT,
  fetchBoardSessions,
  buildTimetableBoardEmbed,
  buildTimetableRow,
  buildTrainingsBoardEmbed,
  buildTrainingsBoardComponents,
  autoUpdateBoard,
  updateTrainingsBoard,
  updateTimetableBoard,
};
