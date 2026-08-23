const { SlashCommandBuilder, MessageFlags } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("punishment-issue")
    .setDescription("Issue a punishment through the form system (coming soon)"),

  async execute(interaction) {
    return interaction.reply({
      content:
        "**/punishment-issue** is not available yet - the formats are still being worked on. Please use **/punish** for now.",
      flags: MessageFlags.Ephemeral,
    });
  },
};
