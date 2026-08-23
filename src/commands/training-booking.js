const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { buildBookingRows } = require("../lib/booking");
const { canManage } = require("../lib/guards");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("training-booking")
    .setDescription("Book a training session or shift (same system as the portal)"),

  async execute(interaction) {
    if (!canManage(interaction)) {
      return interaction.reply({
        content: "You need the Trainer, Staff, or Management role to use this.",
        flags: MessageFlags.Ephemeral,
      });
    }

    // Ephemeral prompt with the session-type select menu + Cancel button.
    // Picking a type opens the booking modal; on submit the session is
    // created and the trainings board updates.
    await interaction.reply({
      content: "Select a **session type** to continue:",
      components: buildBookingRows(),
      flags: MessageFlags.Ephemeral,
    });
  },
};
