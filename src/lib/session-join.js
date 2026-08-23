// Session manage flow on the trainings board.
//
// Each session embed on the trainings board has a single **Manage** button.
// Clicking it opens an ephemeral (for-your-eyes-only) message with the
// session's details and buttons to Join as Co-Host / Join as Helper - or a
// Leave button when you have already joined. Joining/leaving updates
// Supabase (training_session_signups + the session's co-host/helper arrays)
// and refreshes the board so the Co-Hosts / Helpers lines on the session
// embed stay current.
//
// The older per-session "Join as Co-Host" / "Join as Helper" buttons from
// announcements posted before this change still work (handleSessionJoin),
// so stale messages in the channel remain clickable.

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");
const { getSupabase } = require("./supabase");
const { sendDiscordDm } = require("./dms");
const { buildEmbed } = require("./embeds");

const JOIN_CO_HOST_PREFIX = "session_join_co_host:";
const JOIN_HELPER_PREFIX = "session_join_helper:";

const MANAGE_PREFIX = "session_manage:";
const MANAGE_JOIN_CO_HOST_PREFIX = "session_manage_join_co_host:";
const MANAGE_JOIN_HELPER_PREFIX = "session_manage_join_helper:";
const MANAGE_LEAVE_PREFIX = "session_manage_leave:";

function roleLabel(role) {
  return role === "co_host" ? "Co-Host" : "Helper";
}

// ---------- Legacy join buttons (pre-Manage announcements) ----------

/** Action row with the two join buttons for a session announcement. */
function buildSessionJoinRow(sessionId) {
  const row = new ActionRowBuilder();
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`${JOIN_CO_HOST_PREFIX}${sessionId}`)
      .setLabel("Join as Co-Host")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${JOIN_HELPER_PREFIX}${sessionId}`)
      .setLabel("Join as Helper")
      .setStyle(ButtonStyle.Secondary),
  );
  return row;
}

/** Parse a legacy join button custom id into { role, sessionId } or null. */
function parseJoinCustomId(customId) {
  if (customId.startsWith(JOIN_CO_HOST_PREFIX)) {
    return { role: "co_host", sessionId: customId.slice(JOIN_CO_HOST_PREFIX.length) };
  }
  if (customId.startsWith(JOIN_HELPER_PREFIX)) {
    return { role: "helper", sessionId: customId.slice(JOIN_HELPER_PREFIX.length) };
  }
  return null;
}

// ---------- Manage button ----------

/** Action row with the single Manage button for a session embed. */
function buildSessionManageRow(sessionId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${MANAGE_PREFIX}${sessionId}`)
      .setLabel("Manage")
      .setStyle(ButtonStyle.Secondary),
  );
}

// ---------- Shared Supabase helpers ----------

async function findProfile(sb, discordId) {
  try {
    const { data } = await sb
      .from("profiles")
      .select("id, discord_username")
      .eq("discord_id", discordId)
      .maybeSingle();
    return data ?? null;
  } catch (e) {
    console.error("[SessionJoin] Failed to look up profile:", e?.message ?? e);
    return null;
  }
}

async function findSession(sb, sessionId) {
  try {
    const { data } = await sb
      .from("training_sessions")
      .select("id, title, host_user_id, co_host_user_ids, helper_user_ids")
      .eq("id", sessionId)
      .maybeSingle();
    return data ?? null;
  } catch (e) {
    console.error("[SessionJoin] Failed to look up session:", e?.message ?? e);
    return null;
  }
}

async function currentSignupRole(sb, sessionId, userId) {
  try {
    const { data } = await sb
      .from("training_session_signups")
      .select("role")
      .eq("session_id", sessionId)
      .eq("user_id", userId)
      .maybeSingle();
    return data?.role ?? null;
  } catch (e) {
    console.error("[SessionJoin] Failed to look up signup:", e?.message ?? e);
    return null;
  }
}

async function resolveRobloxUsername(sb, userId) {
  try {
    const { data } = await sb
      .from("roblox_accounts")
      .select("roblox_username")
      .eq("user_id", userId)
      .maybeSingle();
    return data?.roblox_username ?? null;
  } catch (e) {
    console.error("[SessionJoin] Failed to look up Roblox account:", e?.message ?? e);
    return null;
  }
}

async function isStaffUser(sb, discordId, discordUsername) {
  try {
    const { data: byId } = await sb
      .from("training_staff")
      .select("id")
      .eq("discord_id", discordId)
      .limit(1);
    if ((byId ?? []).length > 0) return true;
    if (discordUsername) {
      const { data: byName } = await sb
        .from("training_staff")
        .select("id")
        .ilike("discord_username", discordUsername)
        .limit(1);
      return (byName ?? []).length > 0;
    }
    return false;
  } catch (e) {
    console.error("[SessionJoin] Failed to check staff status:", e?.message ?? e);
    return false;
  }
}

// ---------- Join / leave ----------

/**
 * Register a Discord user as co-host/helper for a session, natively in
 * Supabase. Mirrors the website's /api/training/discord-signup logic:
 * Discord id -> profile -> Roblox username -> staff status -> signup.
 */
async function registerSignup({ client, discordId, sessionId, role }) {
  const sb = getSupabase();
  if (!sb) {
    return { ok: false, error: "Signup is not available right now" };
  }

  const profile = await findProfile(sb, discordId);
  if (!profile) {
    return { ok: false, error: "Your Discord account is not linked to a FreshWay profile" };
  }

  const robloxUsername = await resolveRobloxUsername(sb, profile.id);
  const isStaff = await isStaffUser(sb, discordId, profile.discord_username);

  const session = await findSession(sb, sessionId);
  if (!session) {
    return { ok: false, error: "Session not found" };
  }

  const coHostIds = Array.isArray(session.co_host_user_ids) ? session.co_host_user_ids : [];
  const helperIds = Array.isArray(session.helper_user_ids) ? session.helper_user_ids : [];

  // Roles are mutually exclusive - joining one removes the other.
  let newCoHosts = coHostIds.filter((id) => id !== profile.id);
  let newHelpers = helperIds.filter((id) => id !== profile.id);
  if (role === "co_host" && !newCoHosts.includes(profile.id)) {
    newCoHosts = [...newCoHosts, profile.id];
  } else if (role === "helper" && !newHelpers.includes(profile.id)) {
    newHelpers = [...newHelpers, profile.id];
  }

  try {
    await sb.from("training_session_signups").upsert(
      { session_id: sessionId, user_id: profile.id, role },
      { onConflict: "session_id,user_id" },
    );
  } catch (e) {
    console.error("[SessionJoin] Failed to upsert signup:", e?.message ?? e);
    return { ok: false, error: "Could not save your signup. Please try again." };
  }

  try {
    const { error: updErr } = await sb
      .from("training_sessions")
      .update({
        co_host_user_ids: newCoHosts,
        helper_user_ids: newHelpers,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);
    if (updErr) {
      console.error("[SessionJoin] Failed to update session:", updErr.message);
      return { ok: false, error: "Could not update the session. Please try again." };
    }
  } catch (e) {
    console.error("[SessionJoin] Failed to update session:", e?.message ?? e);
    return { ok: false, error: "Could not update the session. Please try again." };
  }

  // Notify the host via DM (best effort).
  const joinerName = robloxUsername ?? profile.discord_username ?? "Unknown";
  if (session.host_user_id) {
    try {
      const { data: hostProfile } = await sb
        .from("profiles")
        .select("discord_id")
        .eq("id", session.host_user_id)
        .maybeSingle();
      if (hostProfile?.discord_id) {
        await sendDiscordDm(client, hostProfile.discord_id, {
          title: `Session Update: ${session.title}`,
          description:
            `> **${joinerName}** has joined the session as a **${roleLabel(role)}** via Discord.\n\n` +
            "> You can now coordinate with them before the session begins.",
        });
      }
    } catch (e) {
      console.error("[SessionJoin] Failed to notify host:", e?.message ?? e);
    }
  }

  return {
    ok: true,
    role,
    displayName: robloxUsername ?? profile.discord_username ?? null,
    robloxUsername,
    discordUsername: profile.discord_username ?? null,
    isStaff,
  };
}

/** Remove a user's signup from a session (leave). */
async function removeSignup({ client, discordId, sessionId }) {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const profile = await findProfile(sb, discordId);
    if (!profile) return false;
    const session = await findSession(sb, sessionId);
    if (!session) return false;

    await sb
      .from("training_session_signups")
      .delete()
      .eq("session_id", sessionId)
      .eq("user_id", profile.id);

    const coHostIds = Array.isArray(session.co_host_user_ids)
      ? session.co_host_user_ids.filter((id) => id !== profile.id)
      : [];
    const helperIds = Array.isArray(session.helper_user_ids)
      ? session.helper_user_ids.filter((id) => id !== profile.id)
      : [];

    await sb
      .from("training_sessions")
      .update({
        co_host_user_ids: coHostIds,
        helper_user_ids: helperIds,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);

    if (session.host_user_id) {
      const { data: hostProfile } = await sb
        .from("profiles")
        .select("discord_id")
        .eq("id", session.host_user_id)
        .maybeSingle();
      if (hostProfile?.discord_id) {
        await sendDiscordDm(client, hostProfile.discord_id, {
          title: `Session Update: ${session.title}`,
          description: "> A member has left the session. The Co-Host/Helper list has been updated.",
        });
      }
    }
    return true;
  } catch (e) {
    console.error("[SessionJoin] Failed to remove signup:", e?.message ?? e);
    return false;
  }
}

// ---------- Interaction handlers ----------

/** Ephemeral reply for the Manage flow: embed + join buttons or Leave. */
function buildManageReply(session, role) {
  const joined = role === "co_host" || role === "helper";
  const embed = buildEmbed({
    title: `Manage: ${session.title}`,
    description: joined
      ? `> You are joined as **${roleLabel(role)}** for this session.`
      : "> Choose an option below.",
  });
  const row = new ActionRowBuilder();
  if (joined) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${MANAGE_LEAVE_PREFIX}${session.id}`)
        .setLabel(`Leave (${roleLabel(role)})`)
        .setStyle(ButtonStyle.Danger),
    );
  } else {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${MANAGE_JOIN_CO_HOST_PREFIX}${session.id}`)
        .setLabel("Join as Co-Host")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`${MANAGE_JOIN_HELPER_PREFIX}${session.id}`)
        .setLabel("Join as Helper")
        .setStyle(ButtonStyle.Secondary),
    );
  }
  return { embeds: [embed], components: [row] };
}

/** Manage button: open the ephemeral join/leave menu for the session. */
async function handleSessionManage(interaction) {
  const sessionId = interaction.customId.slice(MANAGE_PREFIX.length);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const sb = getSupabase();
  if (!sb) {
    return interaction.editReply({ content: "Signup is not available right now." });
  }

  const profile = await findProfile(sb, interaction.user.id);
  if (!profile) {
    return interaction.editReply({ content: "Your Discord account is not linked to a FreshWay profile." });
  }

  const session = await findSession(sb, sessionId);
  if (!session) {
    return interaction.editReply({ content: "That session no longer exists." });
  }

  const role = await currentSignupRole(sb, sessionId, profile.id);
  await interaction.editReply(buildManageReply(session, role));
  return true;
}

/** Join/Leave buttons inside the ephemeral Manage menu. */
async function handleSessionJoinAction(interaction) {
  const id = interaction.customId;
  let action = null;
  let role = null;
  let sessionId = null;
  if (id.startsWith(MANAGE_JOIN_CO_HOST_PREFIX)) {
    action = "join";
    role = "co_host";
    sessionId = id.slice(MANAGE_JOIN_CO_HOST_PREFIX.length);
  } else if (id.startsWith(MANAGE_JOIN_HELPER_PREFIX)) {
    action = "join";
    role = "helper";
    sessionId = id.slice(MANAGE_JOIN_HELPER_PREFIX.length);
  } else if (id.startsWith(MANAGE_LEAVE_PREFIX)) {
    action = "leave";
    sessionId = id.slice(MANAGE_LEAVE_PREFIX.length);
  } else {
    return false;
  }

  await interaction.deferUpdate();

  let newRole = null;
  if (action === "join") {
    const result = await registerSignup({
      client: interaction.client,
      discordId: interaction.user.id,
      sessionId,
      role,
    });
    if (!result.ok) {
      return interaction.editReply({ content: `Could not join: ${result.error}` });
    }
    newRole = role;
  } else {
    const ok = await removeSignup({
      client: interaction.client,
      discordId: interaction.user.id,
      sessionId,
    });
    if (!ok) {
      return interaction.editReply({ content: "Could not leave the session. Please try again." });
    }
    newRole = null;
  }

  const sb = getSupabase();
  const session = sb ? await findSession(sb, sessionId) : null;
  await interaction.editReply(
    buildManageReply(session ?? { id: sessionId, title: "Session" }, newRole),
  );

  // Refresh the trainings board so the session embed's Co-Hosts / Helpers
  // lines update. Lazy require avoids the boards <-> session-join cycle.
  try {
    const boards = require("./boards");
    await boards.updateTrainingsBoard(interaction.client);
  } catch (e) {
    console.error("[SessionJoin] Failed to refresh board after join/leave:", e?.message ?? e);
  }
  return true;
}

/** Handle a legacy join button click (stale announcements). */
async function handleSessionJoin(interaction) {
  const parsed = parseJoinCustomId(interaction.customId);
  if (!parsed) return false;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const result = await registerSignup({
    client: interaction.client,
    discordId: interaction.user.id,
    sessionId: parsed.sessionId,
    role: parsed.role,
  });

  if (!result.ok) {
    await interaction.editReply({
      content: `Could not join as ${roleLabel(parsed.role)}: ${result.error ?? "unknown error"}`,
    });
    return true;
  }

  const name = result.displayName ?? result.robloxUsername ?? result.discordUsername ?? null;
  const staffSuffix = result.isStaff ? " (Staff)" : "";
  await interaction.editReply({
    content: `You joined as **${roleLabel(parsed.role)}** for this session${name ? ` - ${name}${staffSuffix}` : ""}.`,
  });
  return true;
}

module.exports = {
  JOIN_CO_HOST_PREFIX,
  JOIN_HELPER_PREFIX,
  MANAGE_PREFIX,
  MANAGE_JOIN_CO_HOST_PREFIX,
  MANAGE_JOIN_HELPER_PREFIX,
  MANAGE_LEAVE_PREFIX,
  buildSessionJoinRow,
  buildSessionManageRow,
  parseJoinCustomId,
  registerSignup,
  removeSignup,
  handleSessionManage,
  handleSessionJoinAction,
  handleSessionJoin,
};
