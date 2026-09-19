// Public Training Board - a read-only, public version of the trainings
// board, posted in its own channel so everyone (not just staff) can see
// upcoming trainings.
//
// Layout (matches the original board from the previous provider):
//   - Header message: "<:training:...> | Training Board" embed with the
//     "Subscribe to training's" button under it. When there are no active
//     trainings the header says so, exactly like the original.
//   - One message per session: a public embed (host, time, status, game,
//     Co-Hosts, Helpers) with no buttons.
//
// The **Subscribe** button lets anyone opt in to DM notifications whenever
// a session is added, changes status (pending / scheduled / ongoing /
// completed / cancelled), or is deleted.
//
// Subscriptions and the board's message ids persist in data/public-board.json
// so they survive bot restarts without needing a new Supabase table.

const fs = require("node:fs");
const path = require("node:path");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const { getSupabase } = require("./supabase");
const { sendDiscordDm } = require("./dms");
const { buildEmbed } = require("./embeds");
const config = require("../config");

// Emojis provided by the guild (do not change without updating the guild).
const HEADER_EMOJI = "<:training:1525213820358758601>";
const BUTTON_EMOJI = "<:announcement:1520666633633534112>";

const HEADER_TITLE = `${HEADER_EMOJI} | Training Board`;
const NO_SESSIONS_DESC =
  "There are currently no active trainings at this moment, please check back at a later time.";

const SUBSCRIBE_ID = "public_board_subscribe";
const UNSUBSCRIBE_PREFIX = "public_board_unsubscribe";

// ---------- Persistent state (subscriptions + message ids) ----------

const DATA_DIR = path.resolve(__dirname, "../../data");
const DATA_FILE = path.join(DATA_DIR, "public-board.json");

function defaultState() {
  return { subscriptions: [], messages: { header: null, sessions: {} } };
}

function loadState() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return {
      subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [],
      messages: {
        header: typeof parsed.messages?.header === "string" ? parsed.messages.header : null,
        sessions:
          parsed.messages?.sessions && typeof parsed.messages.sessions === "object"
            ? parsed.messages.sessions
            : {},
      },
    };
  } catch {
    return defaultState();
  }
}

function saveState(state) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error("[PublicBoard] Failed to save state:", e?.message ?? e);
  }
}

// ---------- Data ----------

/** Fetch upcoming public sessions (pending + scheduled + ongoing). */
async function fetchPublicSessions(limit = 10) {
  const sb = getSupabase();
  if (!sb) {
    console.warn("[PublicBoard] Supabase not configured - cannot fetch sessions");
    return [];
  }

  const { data } = await sb
    .from("training_sessions")
    .select(
      "id, title, status, scheduled_at, host_user_id, co_host_user_ids, helper_user_ids, roblox_game_link",
    )
    .in("status", ["pending", "scheduled", "ongoing"])
    .order("scheduled_at", { ascending: true, nullsFirst: false })
    .limit(limit);
  const sessions = data ?? [];

  // Resolve host / co-host / helper names (Roblox preferred, Discord fallback).
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

// ---------- Embeds & components ----------

function capitalise(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

/** The header embed: exact copy of the original board. */
function buildHeaderEmbed(sessions) {
  const description = sessions.length
    ? `> **${sessions.length}** upcoming training session${sessions.length === 1 ? "" : "s"} listed below.\n> Subscribe below to get a DM whenever a session is added or its status changes.`
    : `> ${NO_SESSIONS_DESC}`;
  return buildEmbed({ title: HEADER_TITLE, description });
}

/** One session's public embed: no buttons, just the details. */
function buildPublicSessionEmbed(session) {
  const time = session.scheduled_at
    ? `<t:${Math.floor(new Date(session.scheduled_at).getTime() / 1000)}:F>`
    : "Not scheduled";
  const lines = [
    `> Host: ${session.hostName}`,
    `> Time: ${time}`,
    session.status ? `> Status: ${capitalise(session.status)}` : "",
    session.roblox_game_link ? `> Game: [Join Server](${session.roblox_game_link})` : "",
    `> Co-Hosts: ${session.coHostNames.length ? session.coHostNames.join(", ") : "None"}`,
    `> Helpers: ${session.helperNames.length ? session.helperNames.join(", ") : "None"}`,
  ].filter(Boolean);
  return buildEmbed({ title: session.title, description: lines.join("\n") });
}

/** The Subscribe button row (green, with the announcement emoji). */
function buildSubscribeRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(SUBSCRIBE_ID)
      .setLabel("Subscribe to training's")
      .setEmoji(BUTTON_EMOJI)
      .setStyle(ButtonStyle.Success),
  );
}

// ---------- Fingerprints (avoid pointless edits) ----------

function buttonId(button) {
  return button?.data?.custom_id ?? button?.customId ?? null;
}

function hasButton(message, id) {
  return (message.components ?? []).some((row) =>
    (row.components ?? []).some((b) => buttonId(b) === id),
  );
}

function messageFingerprint(message) {
  const embed = message.embeds?.[0];
  return JSON.stringify({
    t: embed?.title ?? null,
    d: embed?.description ?? null,
    c: (message.components ?? []).map((row) => (row.components ?? []).map(buttonId)),
  });
}

function payloadFingerprint(payload) {
  return JSON.stringify({
    t: payload.embeds?.[0]?.title ?? null,
    d: payload.embeds?.[0]?.description ?? null,
    c: (payload.components ?? []).map((row) => (row.components ?? []).map(buttonId)),
  });
}

// ---------- Board update ----------

/**
 * Update the public board: header message (title + Subscribe button) and one
 * message per session. Messages are edited in place when their content
 * changed; new sessions are appended; removed sessions are deleted. Message
 * ids are persisted so restarts reuse the same messages instead of posting
 * duplicates. Only the bot's own messages are touched.
 */
async function updatePublicBoard(client) {
  const channelId = config.channels.publicBoard();
  if (!channelId) {
    return { ok: false, count: 0, changed: false, error: "public board channel not configured" };
  }
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    return { ok: false, count: 0, changed: false, error: "public board channel not found" };
  }

  let sessions = [];
  try {
    sessions = await fetchPublicSessions(10);
  } catch (e) {
    console.error("[PublicBoard] Failed to fetch sessions:", e);
    return { ok: false, count: 0, changed: false, error: "Failed to fetch sessions" };
  }

  const state = loadState();
  const stateBefore = JSON.stringify(state);
  const messages = await channel.messages.fetch({ limit: 30 }).catch(() => null);
  const list = messages ? [...messages.values()] : [];
  const isBot = (m) => m.author?.id === client.user.id;

  // ----- Header message -----
  const headerPayload = { embeds: [buildHeaderEmbed(sessions)], components: [buildSubscribeRow()] };
  let header = null;
  if (state.messages.header) {
    header = list.find((m) => m.id === state.messages.header) ?? null;
  }
  if (!header) {
    // Adopt an existing header (e.g. after a state-file loss) instead of
    // posting a duplicate.
    header = list.find((m) => isBot(m) && hasButton(m, SUBSCRIBE_ID)) ?? null;
  }
  if (header) {
    if (messageFingerprint(header) !== payloadFingerprint(headerPayload)) {
      const edited = await header.edit(headerPayload).then(() => true).catch(() => false);
      if (!edited) {
        header = await channel.send(headerPayload).catch(() => null);
      }
    }
  } else {
    header = await channel.send(headerPayload).catch(() => null);
  }
  if (header) state.messages.header = header.id;

  // ----- Session messages -----
  for (const [sid, mid] of Object.entries(state.messages.sessions)) {
    if (!sessions.some((s) => s.id === sid)) {
      const m = list.find((x) => x.id === mid);
      if (m) await m.delete().catch(() => {});
      delete state.messages.sessions[sid];
    }
  }

  for (const s of sessions) {
    const payload = { embeds: [buildPublicSessionEmbed(s)] };
    let m = null;
    if (state.messages.sessions[s.id]) {
      m = list.find((x) => x.id === state.messages.sessions[s.id]) ?? null;
    }
    if (!m) {
      // Adopt an existing message by embed title (state-file loss).
      m =
        list.find(
          (x) =>
            isBot(x) &&
            (x.components?.length ?? 0) === 0 &&
            x.embeds?.[0]?.title === String(s.title).slice(0, 256),
        ) ?? null;
    }
    if (m) {
      if (messageFingerprint(m) !== payloadFingerprint(payload)) {
        await m.edit(payload).catch((e) =>
          console.error("[PublicBoard] Failed to edit session message:", e?.message ?? e),
        );
      }
    } else {
      m = await channel.send(payload).catch((e) => {
        console.error("[PublicBoard] Failed to post session message:", e?.message ?? e);
        return null;
      });
    }
    if (m) state.messages.sessions[s.id] = m.id;
  }

  if (JSON.stringify(state) !== stateBefore) saveState(state);

  if (sessions.length === 0 && list.length > 0) {
    // header edit above already switched it to the "no active trainings" copy
  }
  console.log(
    `[PublicBoard] Updated in ${channelId} (${sessions.length} session${sessions.length === 1 ? "" : "s"})`,
  );
  return { ok: true, count: sessions.length, changed: true };
}

// ---------- Subscriptions ----------

/** Subscribe button: opt in, or show an Unsubscribe button when already in. */
async function handleSubscribeButton(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const state = loadState();
  if (state.subscriptions.includes(interaction.user.id)) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(UNSUBSCRIBE_PREFIX)
        .setLabel("Unsubscribe")
        .setStyle(ButtonStyle.Danger),
    );
    await interaction.editReply({
      content: "You are already subscribed to training updates.",
      components: [row],
    });
    return true;
  }
  state.subscriptions.push(interaction.user.id);
  saveState(state);
  await interaction.editReply({
    content:
      "You're subscribed! You'll get a DM whenever a training session is added, changes status, or is cancelled.",
  });
  return true;
}

/** Unsubscribe button inside the ephemeral menu. */
async function handleUnsubscribeButton(interaction) {
  await interaction.deferUpdate();
  const state = loadState();
  state.subscriptions = state.subscriptions.filter((id) => id !== interaction.user.id);
  saveState(state);
  await interaction.editReply({
    content: "You are unsubscribed. You will no longer receive training update DMs.",
    components: [],
  });
  return true;
}

/**
 * DM every subscriber (rate limited). Best effort: failures are ignored.
 * Returns the number of DMs successfully sent.
 */
async function notifySubscribers(client, { title, description }) {
  const state = loadState();
  const subscribers = state.subscriptions ?? [];
  if (subscribers.length === 0) return 0;

  let sent = 0;
  for (const discordId of subscribers) {
    try {
      const ok = await sendDiscordDm(client, discordId, { title, description });
      if (ok) sent++;
    } catch {
      // Ignore DM failures (closed DMs, etc.)
    }
    await new Promise((r) => setTimeout(r, 350));
  }
  console.log(`[PublicBoard] Notified ${sent}/${subscribers.length} subscriber(s)`);
  return sent;
}

module.exports = {
  HEADER_TITLE,
  NO_SESSIONS_DESC,
  SUBSCRIBE_ID,
  UNSUBSCRIBE_PREFIX,
  fetchPublicSessions,
  buildHeaderEmbed,
  buildPublicSessionEmbed,
  buildSubscribeRow,
  updatePublicBoard,
  handleSubscribeButton,
  handleUnsubscribeButton,
  notifySubscribers,
};
