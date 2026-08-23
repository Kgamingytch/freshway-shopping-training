// Session join buttons - "Join as Co-Host" / "Join as Helper" on session
// announcements posted to the trainings channel.
//
// Clicking a button registers the user as co-host/helper for that session
// directly in Supabase (same conversion the website used to do): the
// Discord id is resolved to a FreshWay profile, the Roblox username and
// staff status are looked up, the signup is written to
// training_session_signups, the session's co_host/helper arrays are
// updated, and the session host is notified via DM.
//
// This used to call POST /api/training/discord-signup on the website, but
// that made the buttons depend on the website build being deployed. The
// bot already has service-role Supabase access, so it performs the signup
// itself - no website round-trip required.

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const { getSupabase } = require("./supabase");
const { sendDiscordDm } = require("./dms");

const JOIN_CO_HOST_PREFIX = "session_join_co_host:";
const JOIN_HELPER_PREFIX = "session_join_helper:";

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

/** Parse a join button custom id into { role, sessionId } or null. */
function parseJoinCustomId(customId) {
  if (customId.startsWith(JOIN_CO_HOST_PREFIX)) {
    return { role: "co_host", sessionId: customId.slice(JOIN_CO_HOST_PREFIX.length) };
  }
  if (customId.startsWith(JOIN_HELPER_PREFIX)) {
    return { role: "helper", sessionId: customId.slice(JOIN_HELPER_PREFIX.length) };
  }
  return null;
}

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

  // Convert the Discord id into a FreshWay profile.
  let profile = null;
  try {
    const { data } = await sb
      .from("profiles")
      .select("id, discord_username")
      .eq("discord_id", discordId)
      .maybeSingle();
    profile = data;
  } catch (e) {
    console.error("[SessionJoin] Failed to look up profile:", e?.message ?? e);
  }
  if (!profile) {
    return { ok: false, error: "Your Discord account is not linked to a FreshWay profile" };
  }

  // Resolve the Roblox username.
  let robloxUsername = null;
  try {
    const { data: roblox } = await sb
      .from("roblox_accounts")
      .select("roblox_username")
      .eq("user_id", profile.id)
      .maybeSingle();
    robloxUsername = roblox?.roblox_username ?? null;
  } catch (e) {
    console.error("[SessionJoin] Failed to look up Roblox account:", e?.message ?? e);
  }

  // Check staff status (matched by discord_id first, then username).
  let isStaff = false;
  try {
    const { data: byId } = await sb
      .from("training_staff")
      .select("id")
      .eq("discord_id", discordId)
      .limit(1);
    isStaff = (byId ?? []).length > 0;
    if (!isStaff && profile.discord_username) {
      const { data: byName } = await sb
        .from("training_staff")
        .select("id")
        .ilike("discord_username", profile.discord_username)
        .limit(1);
      isStaff = (byName ?? []).length > 0;
    }
  } catch (e) {
    console.error("[SessionJoin] Failed to check staff status:", e?.message ?? e);
  }

  // The session must exist.
  let session = null;
  try {
    const { data } = await sb
      .from("training_sessions")
      .select("id, title, host_user_id, co_host_user_ids, helper_user_ids")
      .eq("id", sessionId)
      .maybeSingle();
    session = data;
  } catch (e) {
    console.error("[SessionJoin] Failed to look up session:", e?.message ?? e);
  }
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
  const roleLabel = role === "co_host" ? "Co-Host" : "Helper";
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
            `> **${joinerName}** has joined the session as a **${roleLabel}** via Discord.\n\n` +
            "> You can now coordinate with them before the session begins.",
        });
      }
    } catch (e) {
      console.error("[SessionJoin] Failed to notify host:", e?.message ?? e);
    }
  }

  return {
    ok: true,
    displayName: robloxUsername ?? profile.discord_username ?? null,
    robloxUsername,
    discordUsername: profile.discord_username ?? null,
    isStaff,
  };
}

/** Handle a join button click (deferred, ephemeral reply). */
async function handleSessionJoin(interaction) {
  const parsed = parseJoinCustomId(interaction.customId);
  if (!parsed) return false;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const roleLabel = parsed.role === "co_host" ? "Co-Host" : "Helper";
  const result = await registerSignup({
    client: interaction.client,
    discordId: interaction.user.id,
    sessionId: parsed.sessionId,
    role: parsed.role,
  });

  if (!result.ok) {
    await interaction.editReply({
      content: `Could not join as ${roleLabel}: ${result.error ?? "unknown error"}`,
    });
    return true;
  }

  const name = result.displayName ?? result.robloxUsername ?? result.discordUsername ?? null;
  const staffSuffix = result.isStaff ? " (Staff)" : "";
  await interaction.editReply({
    content: `You joined as **${roleLabel}** for this session${name ? ` - ${name}${staffSuffix}` : ""}.`,
  });
  return true;
}

module.exports = { buildSessionJoinRow, parseJoinCustomId, handleSessionJoin };
