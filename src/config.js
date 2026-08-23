const { GatewayIntentBits, Partials } = require("discord.js");

module.exports = {
  // Bot metadata
  bot: {
    name: "FreshWay Shopping Training",
    version: "1.0.0",
    color: 0x16a34a, // green
  },

  // Discord client options
  clientOptions: {
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
  },

  // Paths
  paths: {
    commands: "./src/commands",
    events: "./src/events",
  },
};
