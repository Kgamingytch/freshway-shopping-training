// Live boards - one self-updating message per channel.
//
// Both the trainings channel and the timetable channel show a single
// message that is edited in place every few seconds, so the schedule is
// always current without spamming the channel.
//   - trainings board: a header embed ("Upcoming Training Sessions", nothing
//     else), one embed per session (host, time, game, Co-Hosts, Helpers),
//     each with its own **Manage** button row, and a Refresh button on its
//     own line under the last session (also the marker used to find the
//     message)
//   - timetable board: one embed + Refresh and optional "View on Portal"
//     link buttons
//
// Boards only edit their message when the content actually changed
// (fingerprint comparison), so the 20s scheduler does not spam the API.

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { getSupabase } = require("./supabase");
const { buildEmbed } = require("./embeds");
const { buildSessionManageRow } = require("./session-join");
const config = require("../config");

const TIMETABLE_REFRESH_ID = "timetable_refresh";
const TRAININGS_REFRESH_ID = "trainings_board_refresh";

// Discord allows at most 5 action rows per message; each session needs its
// own Manage row, plus one Refresh row at the bottom -> 4 sessions max.
const TRAININGS_BOARD_LIMIT = 4;

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
    .select("id, title, scheduled_at, host_user_id, co_host_user_ids, helper_user_ids, roblox_game_link")
    .in("status", ["scheduled", "ongoing"])
    .order("scheduled_at", { ascending: true })
    .limit(limit);
  const sessions = data ?? [];

  // Resolve host / co-host / helper names (Roblox preferred, fall back to Discord).
  const userIds = new Set();
  for (const s of sessions) {
    if (s.host_user_id) userIds.add(s.host_user_id);
    for (const id of s.co_host_user_ids ?? []) userIds.add(id);
    for (const id of s.helper_user_ids ?? []) userIds.add(id);
  }
  const ids = [...userIds];
  let profileMap = new Map();
  let robloxMap = new Map();
  if (ids.length > 0) {
    const [profiles, roblox] = await Promise.all([
      sb.from("profiles").select("id, discord_username").in("id", ids),
      sb.from("roblox_accounts").select("user_id, roblox_username").in("user_id", ids),
    ]);
    profileMap = new Map((profiles.data ?? []).map((p) => [p.id, p.discord_username]));
    robloxMap = new Map((roblox.data ?? []).map((r) => [r.user_id, r.roblox_username]));
  }
  const nameFor = (userId) =>
    userId ? (robloxMap.get(userId) ?? profileMap.get(userId) ?? "Unknown") : null;

  return sessions.map((s) => ({
    ...s,
    hostName: s.host_user_id ? (nameFor(s.host_user_id) ?? "Unknown") : "Unassigned",
    coHostNames: (s.co_host_user_ids ?? []).map(nameFor).filter(Boolean),
    helperNames: (s.helper_user_ids ?? []).map(nameFor).filter(Boolean),
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

/** Build an embed, omitting the title key when there is none. */
function boardEmbed({ title, description }) {
  const embed = buildEmbed({ title: title ?? "", description: description ?? "" });
  if (!title) delete embed.title;
  return embed;
}

/**
 * Trainings board embeds: a header embed with only the title, then one
 * embed per session (host, time, game, Co-Hosts, Helpers), and a note when
 * more sessions exist than fit on the board.
 */
function buildTrainingsBoardEmbeds(sessions) {
  const embeds = [boardEmbed({ title: "Upcoming Training Sessions", description: "" })];

  const shown = sessions.slice(0, TRAININGS_BOARD_LIMIT);
  if (!shown.length) {
    embeds.push(boardEmbed({ description: "> **No sessions scheduled.**" }));
    return embeds;
  }

  for (const s of shown) {
    const time = s.scheduled_at
      ? `<t:${Math.floor(new Date(s.scheduled_at).getTime() / 1000)}:F>`
      : "Not scheduled";
    const lines = [
      `> Host: ${s.hostName}`,
      `> Time: ${time}`,
      s.roblox_game_link ? `> Game: [Join Server](${s.roblox_game_link})` : "",
      `> Co-Hosts: ${s.coHostNames.length ? s.coHostNames.join(", ") : "None"}`,
      `> Helpers: ${s.helperNames.length ? s.helperNames.join(", ") : "None"}`,
    ].filter(Boolean);
    embeds.push(boardEmbed({ title: s.title, description: lines.join("\n") }));
  }

  if (sessions.length > TRAININGS_BOARD_LIMIT) {
    embeds.push(
      boardEmbed({
        description: `> *Showing the first ${TRAININGS_BOARD_LIMIT} sessions - see the timetable for the full list.*`,
      }),
    );
  }
  return embeds;
}

/**
 * Component rows for the trainings board: one Manage row per session, and
 * a Refresh button on its own row at the bottom (always present, even with
 * zero sessions, so the auto-updater can find this message reliably).
 */
function buildTrainingsBoardComponents(sessions) {
  const rows = [];
  for (const s of sessions.slice(0, TRAININGS_BOARD_LIMIT)) {
    rows.push(buildSessionManageRow(s.id));
  }
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(TRAININGS_REFRESH_ID)
        .setLabel("Refresh")
        .setStyle(ButtonStyle.Secondary),
    ),
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
async function autoUpdateBoard(client, { channelKey, markerId, buildEmbedsFn, buildComponentsFn, fetchLimit, label }) {
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

  const embeds = buildEmbedsFn(sessions);
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
    buildEmbedsFn: buildTrainingsBoardEmbeds,
    buildComponentsFn: buildTrainingsBoardComponents,
    fetchLimit: TRAININGS_BOARD_LIMIT + 1,
    label: "Trainings board",
  });
}

/** Refresh the timetable channel board. */
async function updateTimetableBoard(client) {
  return autoUpdateBoard(client, {
    channelKey: "timetable",
    markerId: TIMETABLE_REFRESH_ID,
    buildEmbedsFn: (sessions) => [buildTimetableBoardEmbed(sessions)],
    buildComponentsFn: () => [buildTimetableRow()],
    fetchLimit: 10,
    label: "Timetable",
  });
}

module.exports = {
  TIMETABLE_REFRESH_ID,
  TRAININGS_REFRESH_ID,
  TRAININGS_BOARD_LIMIT,
  fetchBoardSessions,
  buildTimetableBoardEmbed,
  buildTimetableRow,
  buildTrainingsBoardEmbeds,
  buildTrainingsBoardComponents,
  autoUpdateBoard,
  updateTrainingsBoard,
  updateTimetableBoard,
};
