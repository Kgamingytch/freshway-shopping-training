const { Events } = require("discord.js");
const config = require("../config");
const { buildEmbed } = require("../lib/embeds");

const TRUNC = 1024;

module.exports = {
  name: Events.MessageDelete,
  once: false,
  async execute(message) {
    try {
      const logId = config.channels.messageLogs();
      if (!logId) return;
      if (message.channelId === logId) return; // avoid loops
      if (message.channel?.isDMBased?.()) return;

      if (message.partial) {
        await message.fetch().catch(() => {});
      }
      if (message.author?.bot) return;

      const channelName = message.channel?.name ? `#${message.channel.name}` : `<#${message.channelId}>`;
      const attachments = message.attachments?.size
        ? ` (${message.attachments.size} attachment${message.attachments.size === 1 ? "" : "s"})`
        : "";
      const content = (message.content || "").length > TRUNC
        ? `${message.content.slice(0, TRUNC - 3)}...`
        : message.content || "*no text content*";

      const description = [
        `> **Channel:** ${channelName}`,
        `> **Author:** ${message.author?.tag ?? "Unknown"}${attachments}`,
        "",
        `> **Content:** ${content}`,
      ].join("\n");

      const logChannel = await message.client.channels.fetch(logId).catch(() => null);
      if (!logChannel?.isTextBased()) return;
      await logChannel.send({
        embeds: [buildEmbed({ title: "Message Deleted", description, color: config.colors.logGray })],
      });
    } catch (e) {
      console.error("[MsgLog] messageDelete failed:", e);
    }
  },
};
