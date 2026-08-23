// Direct messages — sends FreshWay-styled embeds to a user's DMs.
//
// discord.js handles rate limits and retries internally, so no manual
// backoff logic is needed here.

const { buildEmbed } = require("./embeds");

/**
 * Send a FreshWay embed to a user via DM.
 * Returns true on success, false on failure (unknown user, closed DMs, etc.).
 */
async function sendDiscordDm(client, discordId, { title, description, color }) {
  try {
    const user = await client.users.fetch(String(discordId)).catch(() => null);
    if (!user) {
      console.warn(`[DM] User ${discordId} not found — cannot send DM`);
      return false;
    }
    await user.send({ embeds: [buildEmbed({ title, description, color })] });
    console.log(`[DM] Embed sent to ${discordId}: ${title}`);
    return true;
  } catch (e) {
    console.error(`[DM] Failed to send embed to ${discordId}:`, e);
    return false;
  }
}

module.exports = { sendDiscordDm };
