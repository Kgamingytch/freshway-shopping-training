const { Events } = require("discord.js");
const { updateTimetableMessage, TIMETABLE_REFRESH_ID } = require("../lib/timetable");

module.exports = {
  name: Events.InteractionCreate,
  once: false,
  async execute(interaction) {
    // ---- Buttons ----
    if (interaction.isButton()) {
      if (interaction.customId === TIMETABLE_REFRESH_ID) {
        await interaction.deferUpdate();
        const ok = await updateTimetableMessage(interaction.client, interaction.message);
        if (!ok) {
          await interaction
            .followUp({ content: "Could not refresh the timetable.", ephemeral: true })
            .catch(() => {});
        }
      }
      return;
    }

    // ---- Slash commands ----
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) {
      console.warn(`[CMD] No handler for /${interaction.commandName}`);
      return;
    }

    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(`[CMD] Error in /${interaction.commandName}:`, err);

      const reply = {
        content: "❌ Something went wrong running that command.",
        ephemeral: true,
      };

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply);
      } else {
        await interaction.reply(reply);
      }
    }
  },
};
