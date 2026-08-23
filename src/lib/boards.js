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
const { buildSessionManageRow, MANAGE_PREFIX } = require("./session-join");
const config = require("../config");

const TIMETABLE_REFRESH_ID = "timetable_refresh";
const TRAININGS_REFRESH_ID = "trainings_board_refresh";

// Discord renders every action row below ALL embeds in a message, so each
// session gets its own message: the Manage button sits directly under its
// own embed. The board is a header message + one message per session.
const HEADER_TITLE = "Upcoming Training Sessions";
const NO_SESSIONS_DESC = "> **No sessions scheduled.**";

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

// ---------- Trainings board (one message per session) ----------

/** Build an embed, omitting the title key when there is none. */
function boardEmbed({ title, description }) {
  const embed = buildEmbed({ title: title ?? "", description: description ?? "" });
  if (!title) delete embed.title;
  return embed;
}

/** One session's embed: host, time, game, Co-Hosts, Helpers. */
function buildSessionEmbed(session) {
  const time = session.scheduled_at
    ? `<t:${Math.floor(new Date(session.scheduled_at).getTime() / 1000)}:F>`
    : "Not scheduled";
  const lines = [
    `> Host: ${session.hostName}`,
    `> Time: ${time}`,
    session.roblox_game_link ? `> Game: [Join Server](${session.roblox_game_link})` : "",
    `> Co-Hosts: ${session.coHostNames.length ? session.coHostNames.join(", ") : "None"}`,
    `> Helpers: ${session.helperNames.length ? session.helperNames.join(", ") : "None"}`,
  ].filter(Boolean);
  return boardEmbed({ title: session.title, description: lines.join("\n") });
}

/** Refresh button on its own row (only the last session message has it). */
function buildRefreshRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(TRAININGS_REFRESH_ID)
      .setLabel("Refresh")
      .setStyle(ButtonStyle.Secondary),
  );
}

/** Payload for one session message: embed + Manage row (+ Refresh when last). */
function buildSessionMessagePayload(session, { isLast }) {
  const components = [buildSessionManageRow(session.id)];
  if (isLast) components.push(buildRefreshRow());
  return { embeds: [buildSessionEmbed(session)], components };
}

/**
 * Update the trainings board: a header message ("Upcoming Training
 * Sessions", nothing else), then one message per session with its own
 * Manage button under its embed. Only the last session's message carries
 * the Refresh row. Messages are edited in place when their content changed,
 * new sessions are posted at the end, removed sessions are deleted.
 */
async function updateTrainingsBoard(client) {
  const id = config.channels.trainings();
  if (!id) {
    return { ok: false, count: 0, changed: false, error: "trainings channel not configured" };
  }
  const channel = await client.channels.fetch(id).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    return { ok: false, count: 0, changed: false, error: "trainings channel not found" };
  }

  let sessions = [];
  try {
    sessions = await fetchBoardSessions(10);
  } catch (e) {
    console.error("[Boards] Trainings board: failed to fetch sessions:", e);
    return { ok: false, count: 0, changed: false, error: "Failed to fetch sessions" };
  }

  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  const list = messages ? [...messages.values()] : [];
  const isBot = (m) => m.author?.id === client.user.id;

  // The session id a message belongs to, or null when it is not a session
  // message. Messages with more than one Manage button are the old combined
  // board layout and return null so they get cleaned up.
  const manageIdOf = (m) => {
    let found = null;
    for (const row of m.components ?? []) {
      for (const b of row.components ?? []) {
        const bid = buttonId(b);
        if (bid && bid.startsWith(MANAGE_PREFIX)) {
          if (found !== null) return null;
          found = bid.slice(MANAGE_PREFIX.length);
        }
      }
    }
    return found;
  };

  let changed = false;

  // Remove the old single-message board layout (header embed + buttons in
  // one message) if it still exists.
  for (const m of list) {
    if (
      isBot(m) &&
      (m.components?.length ?? 0) > 0 &&
      m.embeds?.[0]?.title === HEADER_TITLE
    ) {
      await m.delete().catch(() => {});
      changed = true;
    }
  }

  // Header message: only the title, nothing else.
  let header = list.find(
    (m) =>
      isBot(m) &&
      m.embeds?.[0]?.title === HEADER_TITLE &&
      (m.components?.length ?? 0) === 0,
  ) ?? null;
  if (!header) {
    header = await channel
      .send({ embeds: [boardEmbed({ title: HEADER_TITLE, description: "" })] })
      .catch(() => null);
    changed = true;
  }

  // No sessions: a single "No sessions scheduled." message under the header.
  if (!sessions.length) {
    for (const m of list) {
      if (manageIdOf(m) !== null) {
        await m.delete().catch(() => {});
        changed = true;
      }
    }
    const noSessions = list.find(
      (m) =>
        isBot(m) &&
        m.embeds?.[0]?.description === NO_SESSIONS_DESC &&
        (m.components?.length ?? 0) === 0,
    ) ?? null;
    if (!noSessions) {
      await channel
        .send({ embeds: [boardEmbed({ description: NO_SESSIONS_DESC })] })
        .catch(() => {});
      changed = true;
    }
    if (changed) console.log(`[Boards] Trainings board updated in ${id} (no sessions)`);
    return { ok: true, count: 0, changed };
  }

  // Remove a stale "No sessions" message when sessions exist again.
  for (const m of list) {
    if (
      isBot(m) &&
      m.embeds?.[0]?.description === NO_SESSIONS_DESC &&
      (m.components?.length ?? 0) === 0
    ) {
      await m.delete().catch(() => {});
      changed = true;
    }
  }

  // Map each existing session message to its session id.
  const byId = new Map();
  for (const m of list) {
    const sid = manageIdOf(m);
    if (sid !== null) byId.set(sid, m);
  }

  // Delete messages for sessions that no longer exist.
  const desiredIds = new Set(sessions.map((s) => s.id));
  for (const [sid, m] of byId) {
    if (!desiredIds.has(sid)) {
      await m.delete().catch(() => {});
      changed = true;
    }
  }

  // Upsert session messages in order; the last one carries the Refresh row.
  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    const payload = buildSessionMessagePayload(session, { isLast: i === sessions.length - 1 });
    const existing = byId.get(session.id);
    if (existing) {
      const newFp = `${payload.embeds.map(embedFingerprint).join("|")}::${componentsFingerprint(payload.components)}`;
      const oldFp = `${(existing.embeds ?? []).map(embedFingerprint).join("|")}::${componentsFingerprint(existing.components)}`;
      if (newFp !== oldFp) {
        await existing.edit(payload).catch((e) => console.error("[Boards] Failed to edit session message:", e));
        changed = true;
      }
    } else {
      await channel.send(payload).catch((e) => console.error("[Boards] Failed to post session message:", e));
      changed = true;
    }
  }

  if (changed) console.log(`[Boards] Trainings board updated in ${id} (${sessions.length} sessions)`);
  return { ok: true, count: sessions.length, changed };
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
  fetchBoardSessions,
  buildTimetableBoardEmbed,
  buildTimetableRow,
  buildSessionEmbed,
  buildSessionMessagePayload,
  autoUpdateBoard,
  updateTrainingsBoard,
  updateTimetableBoard,
};
