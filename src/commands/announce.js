const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { sendChannelEmbed } = require("../lib/channels");
const { canManage } = require("../lib/guards");
const config = require("../config");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Post a FreshWay announcement embed to a channel")
    .addStringOption((o) => o.setName("title").setDescription("Embed title").setRequired(true))
    .addStringOption((o) => o.setName("description").setDescription("Embed description (use > prefix lines)").setRequired(true))
    .addStringOption((o) =>
      o
        .setName("channel")
        .setDescription("Target channel (default: trainings)")
        .setRequired(false)
        .addChoices(
          { name: "Trainings", value: "trainings" },
          { name: "Announcements", value: "announcements" },
          { name: "Logs", value: "logs" },
          { name: "Timetable", value: "timetable" },
          { name: "Punishment Logs", value: "punishmentLogs" },
        ),
    ),

  async execute(interaction) {
    if (!canManage(interaction)) {
      return interaction.reply({
        content: "You need the Trainer, Staff, or Management role to use this.",
        flags: MessageFlags.Ephemeral,
      });
    }

    // Defer first so a slow channel fetch never trips the 3s window.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const title = interaction.options.getString("title", true);
    const description = interaction.options.getString("description", true);
    const channelKey = interaction.options.getString("channel") ?? "trainings";

    const mentionRoleId = channelKey === "trainings" ? (config.roles.trainer() ?? undefined) : undefined;

    const ok = await sendChannelEmbed(interaction.client, {
      channelKey,
      title,
      description,
      mentionRoleId,
    });

    await interaction.editReply({
      content: ok
        ? `Announcement posted to **${channelKey}**.`
        : "Failed to post the announcement (check the channel is configured and the bot can see it).",
    });
  },
};
