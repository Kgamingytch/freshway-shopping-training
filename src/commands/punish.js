const { SlashCommandBuilder } = require("discord.js");
const { notifyPunishmentIssued } = require("../lib/notifications");
const { canManage } = require("../lib/guards");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("punish")
    .setDescription("Issue a punishment — posts to punishment logs and DMs the target")
    .addUserOption((o) => o.setName("user").setDescription("Target user").setRequired(true))
    .addStringOption((o) => o.setName("type").setDescription("Warning, strike, mute, kick, ban").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason for the punishment").setRequired(true)),

  async execute(interaction) {
    if (!canManage(interaction)) {
      return interaction.reply({ content: "You need the Trainer, Staff, or Management role to use this.", ephemeral: true });
    }

    const target = interaction.options.getUser("user", true);
    const type = interaction.options.getString("type", true);
    const reason = interaction.options.getString("reason", true);

    const result = await notifyPunishmentIssued(interaction.client, {
      targetDiscord: target.username,
      targetDiscordId: target.id,
      type,
      reason,
      issuedBy: interaction.user.username,
    });

    await interaction.reply({
      content: `Punishment (${type}) issued to **${target.username}** — ${result.dmSent ? "DM sent" : "DM could not be sent (closed DMs or unknown user)"}.`,
      ephemeral: true,
    });
  },
};
