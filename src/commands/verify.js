const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { ensureVerification } = require("../lib/verification");
const { canManage } = require("../lib/guards");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("verify-setup")
    .setDescription("Post the verification welcome embed to the verification channel"),

  async execute(interaction) {
    if (!canManage(interaction)) {
      return interaction.reply({
        content: "You need the Trainer, Staff, or Management role to use this.",
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const ok = await ensureVerification(interaction.client);

    await interaction.editReply({
      content: ok
        ? "The verification welcome embed is ready in the verification channel."
        : "Failed to post the verification embed (check FRESHWAY_CHANNEL_VERIFICATION and bot permissions).",
    });
  },
};
