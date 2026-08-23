const { SlashCommandBuilder, MessageFlags } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("trial-referral")
    .setDescription("Refer a trial trainer (coming soon)"),

  async execute(interaction) {
    return interaction.reply({
      content: "**/trial-referral** is unavailable at the moment. Explanations will be shared soon.",
      flags: MessageFlags.Ephemeral,
    });
  },
};
