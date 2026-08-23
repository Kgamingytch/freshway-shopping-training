const { Events } = require("discord.js");
const config = require("../config");
const { buildEmbed } = require("../lib/embeds");

const TRUNC = 1024;

function truncate(s) {
  if (!s) return "*empty*";
  return s.length > TRUNC ? `${s.slice(0, TRUNC - 3)}...` : s;
}

module.exports = {
  name: Events.MessageUpdate,
  once: false,
  async execute(oldMessage, newMessage) {
    try {
      const logId = config.channels.messageLogs();
      if (!logId) return;
      if (oldMessage.channelId === logId || newMessage.channelId === logId) return; // avoid loops
      if (oldMessage.author?.bot || newMessage.author?.bot) return;
      if (newMessage.channel?.isDMBased?.()) return;
      if (oldMessage.content === newMessage.content) return;
      if (!oldMessage.content && !newMessage.content) return;

      const channelName = newMessage.channel?.name
        ? `#${newMessage.channel.name}`
        : `<#${newMessage.channelId}>`;

      const description = [
        `> **Channel:** ${channelName}`,
        `> **Author:** ${newMessage.author?.tag ?? "Unknown"}`,
        "",
        `> **Before:** ${truncate(oldMessage.content)}`,
        `> **After:** ${truncate(newMessage.content)}`,
        newMessage.url ? `> [Jump to message](${newMessage.url})` : "",
      ].join("\n");

      const logChannel = await newMessage.client.channels.fetch(logId).catch(() => null);
      if (!logChannel?.isTextBased()) return;
      await logChannel.send({
        embeds: [buildEmbed({ title: "Message Edited", description, color: config.colors.logGray })],
      });
    } catch (e) {
      console.error("[MsgLog] messageUpdate failed:", e);
    }
  },
};
