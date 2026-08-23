const { SlashCommandBuilder } = require("discord.js");
const { postTimetable } = require("../lib/timetable");
const { canManage } = require("../lib/guards");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("timetable")
    .setDescription("Post the training timetable to the timetable channel"),

  async execute(interaction) {
    if (!canManage(interaction)) {
      return interaction.reply({
        content: "You need the Trainer, Staff, or Management role to use this.",
        ephemeral: true,
      });
    }

    const result = await postTimetable(interaction.client);

    await interaction.reply({
      content: result.ok
        ? result.count > 0
          ? `Timetable posted - **${result.count}** session${result.count === 1 ? "" : "s"} scheduled.`
          : "Timetable posted - **no sessions scheduled**."
        : `Failed to post the timetable: ${result.error ?? "unknown error"}`,
      ephemeral: true,
    });
  },
};
