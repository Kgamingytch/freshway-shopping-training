// Channel posting - sends FreshWay embeds to configured Discord channels.
//
// Channel IDs come from environment variables (see config.channels), so the
// bot never creates channels: the guild owner creates them and the hosting
// panel / .env provides the IDs.

const { buildEmbed, FW_LOG_GRAY } = require("./embeds");
const config = require("../config");

/** Resolve a channel ID for a config key (e.g. "trainings", "logs"). */
function channelIdFor(key) {
  const getter = config.channels[key];
  return getter ? getter() : null;
}

/**
 * Send an embed to a channel by raw ID or config key.
 * Returns true on success, false on any failure (missing config, missing
 * channel, Discord error) - callers treat this as best-effort.
 */
async function sendChannelEmbed(client, { channelId, channelKey, title, description, color, mentionRoleId, components }) {
  const id = channelId || (channelKey ? channelIdFor(channelKey) : null);
  if (!id) {
    console.warn(`[Channel] No channel ID configured for "${channelKey || "unknown"}"`);
    return false;
  }

  const channel = await client.channels.fetch(id).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    console.warn(`[Channel] Channel ${id} not found or not a text channel`);
    return false;
  }

  const content = mentionRoleId ? `<@&${mentionRoleId}>` : " ";
  try {
    await channel.send({
      content,
      embeds: [buildEmbed({ title, description, color })],
      ...(components ? { components } : {}),
    });
    console.log(`[Channel] Embed sent to ${id}: ${title}`);
    return true;
  } catch (e) {
    console.error(`[Channel] Failed to send embed to ${id}:`, e);
    return false;
  }
}

/** Send an embed to the logs channel (neutral gray). */
async function sendLogEmbed(client, title, description) {
  return sendChannelEmbed(client, { channelKey: "logs", title, description, color: FW_LOG_GRAY });
}

/** Send an embed to the announcements channel. */
async function sendAnnouncementEmbed(client, title, description) {
  return sendChannelEmbed(client, { channelKey: "announcements", title, description });
}

/** Send an embed to the trainings channel, optionally mentioning a role. */
async function sendTrainingChannelEmbed(client, title, description, { mentionRoleId } = {}) {
  return sendChannelEmbed(client, { channelKey: "trainings", title, description, mentionRoleId });
}

module.exports = {
  channelIdFor,
  sendChannelEmbed,
  sendLogEmbed,
  sendAnnouncementEmbed,
  sendTrainingChannelEmbed,
};
