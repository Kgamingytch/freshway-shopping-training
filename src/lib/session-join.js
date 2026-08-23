// Session join buttons - "Join as Co-Host" / "Join as Helper" on session
// announcements posted to the trainings channel.
//
// Clicking a button sends the Discord user id + session id + role to the
// FreshWay website (/api/training/discord-signup), which converts the
// Discord id into a profile and registers the signup (Roblox name and staff
// status are resolved there and returned).

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const config = require("../config");

const JOIN_CO_HOST_PREFIX = "session_join_co_host:";
const JOIN_HELPER_PREFIX = "session_join_helper:";

function siteBase() {
  return process.env.FRESHWAY_SITE_URL?.trim().replace(/\/+$/, "") || null;
}

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
 * Ask the website to register a Discord user as co-host/helper for a session.
 * The website resolves the Discord id to a profile, Roblox account and staff
 * status, performs the signup, and notifies the host.
 */
async function signupViaWebsite({ discordId, sessionId, role }) {
  const base = siteBase();
  const secret = config.api.secret();
  if (!base || !secret) {
    console.warn("[SessionJoin] FRESHWAY_SITE_URL / BOT_API_SECRET not set - cannot reach website");
    return { ok: false, error: "Signup is not available right now" };
  }
  try {
    const res = await fetch(`${base}/api/training/discord-signup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bot-secret": secret,
      },
      body: JSON.stringify({ discordId, sessionId, role }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.ok) {
      return { ok: false, error: (data && data.error) || `HTTP ${res.status}` };
    }
    return {
      ok: true,
      displayName: data.displayName ?? null,
      robloxUsername: data.robloxUsername ?? null,
      discordUsername: data.discordUsername ?? null,
      isStaff: !!data.isStaff,
    };
  } catch {
    return { ok: false, error: "Website unreachable" };
  }
}

/** Handle a join button click (deferred, ephemeral reply). */
async function handleSessionJoin(interaction) {
  const parsed = parseJoinCustomId(interaction.customId);
  if (!parsed) return false;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const roleLabel = parsed.role === "co_host" ? "Co-Host" : "Helper";
  const result = await signupViaWebsite({
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
