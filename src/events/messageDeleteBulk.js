const { Events } = require("discord.js");
const config = require("../config");
const { buildEmbed } = require("../lib/embeds");

module.exports = {
  name: Events.MessageBulkDelete,
  once: false,
  async execute(messages, channel) {
    try {
      const logId = config.channels.messageLogs();
      if (!logId) return;
      if (channel?.id === logId) return; // avoid loops

      const channelName = channel?.name ? `#${channel.name}` : `<#${channel?.id ?? "unknown"}>`;
      const description = [
        `> **Channel:** ${channelName}`,
        `> **Messages deleted:** ${messages.size}`,
      ].join("\n");

      const logChannel = await channel?.client.channels.fetch(logId).catch(() => null);
      if (!logChannel?.isTextBased()) return;
      await logChannel.send({
        embeds: [buildEmbed({ title: "Bulk Message Delete", description, color: config.colors.logGray })],
      });
    } catch (e) {
      console.error("[MsgLog] messageDeleteBulk failed:", e);
    }
  },
};
