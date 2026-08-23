const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check bot latency"),

  async execute(interaction) {
    const start = Date.now();
    await interaction.reply({ content: "🏓 Pinging..." });
    const latency = Date.now() - start;
    const wsLatency = interaction.client.ws.ping;

    await interaction.editReply(
      `🏓 **Pong!**\n> Bot latency: **${latency}ms**\n> WebSocket: **${wsLatency}ms**`
    );
  },
};
