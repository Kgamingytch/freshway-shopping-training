// [vacancies]
// Public Training Board - Discord Components V2 style.
//
// One self-updating V2 message in its own channel that everyone can see:
//   - Header container (brand green): "FreshWay Training Board" heading with a
//     "Next session" line, helper text and a "My Subscriptions" button.
//   - One container per session: status chip, timestamp (full + relative),
//     Host / Co-Host / Helper mentions, optional game link and a per-session
//     "Subscribe" button.
//
// "Subscribe" opts the user into DM updates for THAT session; "My
// Subscriptions" lists everything they follow with Unsubscribe buttons.
// Legacy string subscriptions (from the old global button) are kept and
// receive updates for every session ("*").
//
// Board message id, fingerprints and subscriptions persist in
// data/public-board.json so restarts do not post duplicates.

const fs = require("node:fs");
const path = require("node:path");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
} = require("discord.js");
const { getSupabase } = require("./supabase");
const { sendDiscordDm } = require("./dms");
const config = require("../config");
const E = require("./emojis");
const subStore = require("./sub-store");

// ---------- Subscription accessors (Supabase-backed, file fallback) ----------

async function readSubscriptions() {
  return subStore.readAll(() => loadState().subscriptions);
}

async function writeSubscriptions(subs) {
  return subStore.writeAll((snapshot) => {
    const state = loadState();
    state.subscriptions = snapshot;
    saveState(state);
  }, subs);
}

// Emojis come from the central custom-emoji registry (see ./emojis).
const HEADER_EMOJI = E.training;
const BUTTON_EMOJI = E.bookmarkflag;

const BRAND_GREEN = 0x1a5632;

const SUBSCRIBE_ID = "public_board_subscribe"; // legacy global button id
const UNSUBSCRIBE_PREFIX = "public_board_unsubscribe"; // legacy global id

const PB_SUB_PREFIX = "pb_sub:"; // + sessionId
const PB_UNSUB_PREFIX = "pb_unsub:"; // + sessionId
const PB_MINE_ID = "pb_mine";
const PB_UNSUB_ALL_ID = "pb_unsub_all";

// Optional fallback image used as the thumbnail when the host has no
// resolvable Roblox avatar.
const SHIFT_IMAGE_URL = process.env.FRESHWAY_SHIFT_IMAGE_URL?.trim() || null;

// ---------- Host Roblox avatar headshots (cached) ----------

// host_user_id (profiles.id) -> headshot imageUrl (or null if unresolvable).
const avatarCache = new Map();
const AVATAR_TTL_MS = 30 * 60 * 1000; // 30 minutes
const robloxIdCache = new Map(); // roblox username -> roblox user id

function cacheGet(map, key) {
  const hit = map.get(key);
  if (hit && Date.now() - hit.t < AVATAR_TTL_MS) return hit.v;
  if (hit) map.delete(key);
  return undefined;
}

function cacheSet(map, key, value) {
  map.set(key, { v: value, t: Date.now() });
}

const ROBLOX_FETCH = {
  headers: { "User-Agent": "FreshWayShoppingBot/1.0" },
  signal: AbortSignal.timeout(8000),
};

/** Resolve a Roblox username to a Roblox user id (cached). */
async function robloxUserIdForUsername(username) {
  const cached = cacheGet(robloxIdCache, username);
  if (cached !== undefined) return cached;
  let id = null;
  try {
    const res = await fetch("https://users.roblox.com/v1/usernames/users", {
      method: "POST",
      headers: { ...ROBLOX_FETCH.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }),
      signal: ROBLOX_FETCH.signal,
    });
    if (res.ok) {
      const json = await res.json();
      id = json?.data?.[0]?.id ?? null;
    }
  } catch (e) {
    console.warn("[PublicBoard] Roblox username lookup failed:", e?.message ?? e);
  }
  cacheSet(robloxIdCache, username, id);
  return id;
}

/** Get the Roblox headshot URL for a host (profile id), cached. */
async function hostAvatarUrl(sb, hostUserId) {
  if (!hostUserId) return null;
  const cached = cacheGet(avatarCache, hostUserId);
  if (cached !== undefined) return cached;

  let url = null;
  try {
    // roblox_accounts.user_id -> roblox_username
    const { data } = await sb
      .from("roblox_accounts")
      .select("roblox_username")
      .eq("user_id", hostUserId)
      .maybeSingle();
    const username = data?.roblox_username;
    if (username) {
      const robloxId = await robloxUserIdForUsername(username);
      if (robloxId) {
        const res = await fetch(
          `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${robloxId}&size=150x150&format=Png&isCircular=false`,
          ROBLOX_FETCH,
        );
        if (res.ok) {
          const json = await res.json();
          url = json?.data?.[0]?.imageUrl ?? null;
        }
      }
    }
  } catch (e) {
    console.warn("[PublicBoard] Host avatar lookup failed:", e?.message ?? e);
  }
  cacheSet(avatarCache, hostUserId, url);
  return url;
}

// ---------- Persistent state (subscriptions + message ids) ----------

const DATA_DIR = path.resolve(__dirname, "../../data");
const DATA_FILE = path.join(DATA_DIR, "public-board.json");

function defaultState() {
  return { subscriptions: [], messages: { v2: null, header: null, sessions: {} } };
}

/**
 * Normalise stored subscriptions: legacy entries are plain user-id strings
 * (global "*" subscriptions); new entries are { userId, sessionId, title }.
 */
function normaliseSubscriptions(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((entry) =>
      typeof entry === "string"
        ? { userId: entry, sessionId: "*", title: null }
        : entry && entry.userId && entry.sessionId
          ? { userId: String(entry.userId), sessionId: String(entry.sessionId), title: entry.title ?? null }
          : null,
    )
    .filter(Boolean);
}

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return {
      subscriptions: normaliseSubscriptions(parsed.subscriptions),
      messages: {
        v2: typeof parsed.messages?.v2 === "string" ? parsed.messages.v2 : null,
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
async function fetchPublicSessions(limit = 5) {
  const sb = getSupabase();
  if (!sb) {
    console.warn("[PublicBoard] Supabase not configured - cannot fetch sessions");
    return [];
  }

  const { data } = await sb
    .from("training_sessions")
    .select(
      "id, title, session_type, status, scheduled_at, host_user_id, co_host_user_ids, helper_user_ids, roblox_game_link",
    )
    .in("status", ["pending", "scheduled", "ongoing"])
    .order("scheduled_at", { ascending: true, nullsFirst: false })
    .limit(limit);
  const sessions = data ?? [];

  // Resolve host / co-host / helper identities. Prefer a Discord mention
  // (profiles.discord_id), fall back to Roblox username, then Discord name.
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
      sb.from("profiles").select("id, discord_username, discord_id").in("id", ids),
      sb.from("roblox_accounts").select("user_id, roblox_username").in("user_id", ids),
    ]);
    profileMap = new Map((profiles.data ?? []).map((p) => [p.id, p]));
    robloxMap = new Map((roblox.data ?? []).map((r) => [r.user_id, r.roblox_username]));
  }

  // Resolve host Roblox avatars (in parallel; cached).
  const avatarMap = new Map();
  await Promise.all(
    sessions.map(async (s) => {
      if (s.host_user_id) avatarMap.set(s.host_user_id, await hostAvatarUrl(sb, s.host_user_id));
    }),
  );

  const displayFor = (userId) => {
    if (!userId) return null;
    const profile = profileMap.get(userId);
    if (profile?.discord_id) return `<@${profile.discord_id}>`;
    return robloxMap.get(userId) ?? profile?.discord_username ?? "Unknown";
  };

  return sessions.map((s) => ({
    ...s,
    hostAvatarUrl: s.host_user_id ? (avatarMap.get(s.host_user_id) ?? null) : null,
    hostMention: s.host_user_id ? displayFor(s.host_user_id) : null,
    coHostMentions: (s.co_host_user_ids ?? []).map(displayFor).filter(Boolean),
    helperMentions: (s.helper_user_ids ?? []).map(displayFor).filter(Boolean),
  }));
}

// ---------- V2 component builders ----------

function capitalise(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

function unixSeconds(iso) {
  return Math.floor(new Date(iso).getTime() / 1000);
}

/** Emoji + accent colour per session status. */
function statusStyle(status) {
  switch (status) {
    case "scheduled":
      return { emoji: E.schedule, color: 0xe6a817, label: "Scheduled" };
    case "ongoing":
      return { emoji: E.connected, color: 0x1f8b4c, label: "Ongoing" };
    case "cancelled":
      return { emoji: E.cross, color: 0xcc3b3b, label: "Cancelled" };
    default:
      return { emoji: E.history, color: 0x95a5a6, label: capitalise(status || "Pending") };
  }
}

/** Build the full V2 component list: header container + one per session. */
function buildV2Components(sessions, client) {
  const components = [];

  // ----- Header container -----
  const header = new ContainerBuilder().setAccentColor(BRAND_GREEN);
  header.addTextDisplayComponents((t) => t.setContent(`## ${HEADER_EMOJI} FreshWay Training Board`));

  if (sessions.length === 0) {
    header.addTextDisplayComponents(
      (t) =>
        t.setContent(
          "> There are currently no active trainings at this moment, please check back at a later time.",
        ),
    );
  } else {
    const next = sessions.find((s) => s.scheduled_at) ?? sessions[0];
    const nextLine = next.scheduled_at
      ? `${next.title} · <t:${unixSeconds(next.scheduled_at)}:R>`
      : `${next.title} · not scheduled yet`;
    const st = statusStyle(next.status);
    header.addTextDisplayComponents((t) => t.setContent(`${st.emoji} **Next session:** ${nextLine}`));
  }
  header.addTextDisplayComponents(
    (t) =>
      t.setContent(
        "-# Use the buttons under a session to subscribe or unsubscribe from DM updates.",
      ),
  );
  header.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(PB_MINE_ID)
        .setLabel("My Subscriptions")
        .setEmoji(BUTTON_EMOJI)
        .setStyle(ButtonStyle.Success),
    ),
  );
  components.push(header);

  // ----- One container per session -----
  for (const s of sessions) {
    components.push(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
    );

    const st = statusStyle(s.status);
    const time = s.scheduled_at
      ? `<t:${unixSeconds(s.scheduled_at)}:F> (<t:${unixSeconds(s.scheduled_at)}:R>)`
      : "Not scheduled";
    const lines = [
      `**${s.title}**`,
      `${st.emoji} \`${st.label}\`${s.session_type ? ` · ${s.session_type}` : ""}`,
      `${E.time} ${time}`,
      `${E.security} **Host:** ${s.hostMention ?? "Unassigned"}`,
    ];
    if (s.coHostMentions?.length || s.helperMentions?.length) {
      const co = s.coHostMentions?.length ? `Co-Host: ${s.coHostMentions.join(", ")}` : null;
      const he = s.helperMentions?.length ? `Helper: ${s.helperMentions.join(", ")}` : null;
      lines.push(`${E.people} ${[co, he].filter(Boolean).join(" · ")}`);
    }
    if (s.roblox_game_link) lines.push(`${E.roblox} [Join Server](${s.roblox_game_link})`);

    const container = new ContainerBuilder().setAccentColor(st.color);
    const thumbUrl = s.hostAvatarUrl ?? SHIFT_IMAGE_URL;
    if (thumbUrl) {
      const section = new SectionBuilder().addTextDisplayComponents((t) =>
        t.setContent(lines.join("\n")),
      );
      section.setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbUrl));
      container.addSectionComponents(section);
    } else {
      container.addTextDisplayComponents((t) => t.setContent(lines.join("\n")));
    }
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(PB_SUB_PREFIX + s.id)
          .setLabel("Subscribe")
          .setEmoji(BUTTON_EMOJI)
          .setStyle(ButtonStyle.Success),
      ),
    );
    components.push(container);
  }

  return components;
}

// ---------- Board update ----------

// Last posted session signature (module level). Guards against pointless
// edits from the 20s scheduler; resets on restart (one extra edit, fine).
let lastSignature = null;

/**
 * Update the public board message in place. The old multi-message embed
 * layout is cleaned up automatically.
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
    sessions = await fetchPublicSessions(5);
  } catch (e) {
    console.error("[PublicBoard] Failed to fetch sessions:", e);
    return { ok: false, count: 0, changed: false, error: "Failed to fetch sessions" };
  }

  const state = loadState();
  const stateBefore = JSON.stringify(state);
  const signature = JSON.stringify(sessions);

  const isV2 = (m) => m.author?.id === client.user.id && m.flags?.has?.(MessageFlags.IsComponentsV2);
  const isBot = (m) => m.author?.id === client.user.id;

  // Resolve the V2 board message: state id -> adopt any V2 message -> none.
  let board = null;
  if (state.messages.v2) {
    board = (await channel.messages.fetch(state.messages.v2).catch(() => null)) ?? null;
  }
  if (!board) {
    board =
      [...(await channel.messages.fetch({ limit: 30 }).catch(() => new Map())).values()].find(
        isV2,
      ) ?? null;
  }

  const payload = {
    flags: MessageFlags.IsComponentsV2,
    components: buildV2Components(sessions, client),
  };

  if (board && lastSignature === signature) {
    // Nothing changed since the last post; skip the edit entirely.
  } else if (board) {
    const edited = await board.edit(payload).then(() => true).catch(() => false);
    if (!edited) {
      board = await channel.send(payload).catch((e) => {
        console.error("[PublicBoard] Failed to post board:", e?.message ?? e);
        return null;
      });
    }
    lastSignature = signature;
  } else {
    board = await channel.send(payload).catch((e) => {
      console.error("[PublicBoard] Failed to post board:", e?.message ?? e);
      return null;
    });
    lastSignature = signature;
  }
  if (board) state.messages.v2 = board.id;

  // Clean up old-layout bot messages (embed header/session messages).
  for (const m of [...(await channel.messages.fetch({ limit: 30 }).catch(() => new Map())).values()]) {
    const oldStyle =
      isBot(m) &&
      m.id !== board?.id &&
      ((m.embeds?.length ?? 0) > 0 ||
        (m.components ?? []).some((row) =>
          (row.components ?? []).some((b) => (b?.data?.custom_id ?? b?.customId) === SUBSCRIBE_ID),
        ));
    if (oldStyle) await m.delete().catch(() => {});
  }

  if (JSON.stringify(state) !== stateBefore) saveState(state);
  console.log(
    `[PublicBoard] Updated in ${channelId} (${sessions.length} session${sessions.length === 1 ? "" : "s"})`,
  );
  return { ok: true, count: sessions.length, changed: true };
}

// ---------- Subscription handlers ----------

function unsubRow(sessionId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(PB_UNSUB_PREFIX + sessionId)
      .setLabel("Unsubscribe")
      .setStyle(ButtonStyle.Danger),
  );
}

/** Per-session Subscribe button. */
async function handleSessionSubscribe(interaction, sessionId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const subs = await readSubscriptions();
  const already = subs.some(
    (s) => s.userId === interaction.user.id && s.sessionId === sessionId,
  );
  if (already) {
    await interaction.editReply({
      content: "You are already subscribed to this session.",
      components: [unsubRow(sessionId)],
    });
    return true;
  }
  const session = await fetchPublicSessions(25).then((all) => all.find((x) => x.id === sessionId));
  subs.push({
    userId: interaction.user.id,
    sessionId,
    title: session?.title ?? null,
  });
  await writeSubscriptions(subs);
  await interaction.editReply({
    content: `You're subscribed to **${session?.title ?? "this session"}**! You'll get a DM when it is added, changes status, or is cancelled.`,
    components: [unsubRow(sessionId)],
  });
  return true;
}

/** Per-session Unsubscribe button. */
async function handleSessionUnsubscribe(interaction, sessionId) {
  await interaction.deferUpdate();
  const subs = await readSubscriptions();
  await writeSubscriptions(
    subs.filter((s) => !(s.userId === interaction.user.id && s.sessionId === sessionId)),
  );
  await interaction.editReply({
    content: "Unsubscribed. You will no longer receive DM updates for this session.",
    components: [],
  });
  return true;
}

/** "My Subscriptions": ephemeral list with Unsubscribe buttons. */
async function handleMySubscriptions(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const subs = await readSubscriptions();
  const mine = subs.filter((s) => s.userId === interaction.user.id);
  if (mine.length === 0) {
    await interaction.editReply({
      content:
        "You have no subscriptions yet. Press **Subscribe** under a session on the board to get DM updates about it.",
      components: [],
    });
    return true;
  }

  const components = [];
  for (let i = 0; i < mine.length && components.length < 5; i += 5) {
    components.push(
      new ActionRowBuilder().addComponents(
        ...mine.slice(i, i + 5).map((s) =>
          new ButtonBuilder()
            .setCustomId(PB_UNSUB_PREFIX + s.sessionId)
            .setLabel(`Unsubscribe: ${(s.title ?? "session").slice(0, 60)}`)
            .setStyle(ButtonStyle.Danger),
        ),
      ),
    );
  }
  if (mine.length > 5) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(PB_UNSUB_ALL_ID)
          .setLabel("Unsubscribe from all")
          .setStyle(ButtonStyle.Danger),
      ),
    );
  }
  await interaction.editReply({
    content: `You are subscribed to **${mine.length}** session${mine.length === 1 ? "" : "s"}:`,
    components,
  });
  return true;
}

/** Unsubscribe from everything. */
async function handleUnsubscribeAll(interaction) {
  await interaction.deferUpdate();
  const subs = await readSubscriptions();
  await writeSubscriptions(subs.filter((s) => s.userId !== interaction.user.id));
  await interaction.editReply({
    content: "Unsubscribed from all session updates.",
    components: [],
  });
  return true;
}

// ----- Legacy global Subscribe/Unsubscribe (old board messages) -----

/** Legacy global subscribe button: opt in to every session. */
async function handleSubscribeButton(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const subs = await readSubscriptions();
  if (subs.some((s) => s.userId === interaction.user.id && s.sessionId === "*")) {
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
  subs.push({ userId: interaction.user.id, sessionId: "*", title: null });
  await writeSubscriptions(subs);
  await interaction.editReply({
    content:
      "You're subscribed! You'll get a DM whenever a training session is added, changes status, or is cancelled.",
  });
  return true;
}

/** Legacy global unsubscribe button. */
async function handleUnsubscribeButton(interaction) {
  await interaction.deferUpdate();
  const subs = await readSubscriptions();
  await writeSubscriptions(
    subs.filter((s) => !(s.userId === interaction.user.id && s.sessionId === "*")),
  );
  await interaction.editReply({
    content: "You are unsubscribed. You will no longer receive training update DMs.",
    components: [],
  });
  return true;
}

// ---------- Subscriber DMs ----------

/**
 * DM everyone subscribed to the given session (or to "*" / everything).
 * Rate limited; failures are ignored. Returns the number of DMs sent.
 */
async function notifySubscribers(client, { title, description, sessionId }) {
  const subscriptions = await readSubscriptions();
  const recipients = [
    ...new Set(
      subscriptions
        .filter((s) => !sessionId || s.sessionId === sessionId || s.sessionId === "*")
        .map((s) => s.userId),
    ),
  ];
  if (recipients.length === 0) return 0;

  let sent = 0;
  const failed = [];
  for (const discordId of recipients) {
    try {
      const ok = await sendDiscordDm(client, discordId, { title, description });
      if (ok) sent++;
      else failed.push(discordId);
    } catch (e) {
      failed.push(discordId);
      console.error(`[PublicBoard] DM to ${discordId} threw:`, e?.message ?? e);
    }
    await new Promise((r) => setTimeout(r, 350));
  }
  console.log(
    `[PublicBoard] Notified ${sent}/${recipients.length} subscriber(s)` +
      (failed.length ? ` - failed: ${failed.join(", ")}` : "") +
      (sessionId ? ` (session ${sessionId})` : " (all)"),
  );
  return sent;
}

module.exports = {
  HEADER_TITLE: `${HEADER_EMOJI} | Training Board`,
  SUBSCRIBE_ID,
  UNSUBSCRIBE_PREFIX,
  PB_SUB_PREFIX,
  PB_UNSUB_PREFIX,
  PB_MINE_ID,
  PB_UNSUB_ALL_ID,
  fetchPublicSessions,
  buildV2Components,
  updatePublicBoard,
  handleSessionSubscribe,
  handleSessionUnsubscribe,
  handleMySubscriptions,
  handleUnsubscribeAll,
  handleSubscribeButton,
  handleUnsubscribeButton,
  notifySubscribers,
};
