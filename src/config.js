const { GatewayIntentBits, Partials } = require("discord.js");

module.exports = {
  // Bot metadata
  bot: {
    name: "FreshWay Shopping Training",
    version: "1.0.0",
    color: 0x1a5632, // FreshWay green
  },

  // Brand colors used by embeds
  colors: {
    green: 0x1a5632, // FreshWay brand green
    logGray: 0x66756a, // neutral gray for log embeds
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

  // Channel IDs — resolved from environment at call time so the hosting
  // panel can set them without a code change.
  channels: {
    trainings: () => process.env.FRESHWAY_CHANNEL_TRAININGS?.trim() || null,
    logs: () => process.env.FRESHWAY_CHANNEL_LOGS?.trim() || null,
    timetable: () => process.env.FRESHWAY_CHANNEL_TIMETABLE?.trim() || null,
    punishmentLogs: () => process.env.FRESHWAY_CHANNEL_PUNISHMENT_LOGS?.trim() || null,
    announcements: () => process.env.FRESHWAY_CHANNEL_ANNOUNCEMENTS?.trim() || null,
  },

  // Role IDs
  roles: {
    trainer: () => process.env.FRESHWAY_ROLE_TRAINER?.trim() || null,
    staff: () => process.env.FRESHWAY_ROLE_STAFF?.trim() || null,
    management: () => process.env.FRESHWAY_ROLE_MANAGEMENT?.trim() || null,
  },

  // HTTP API — used by the FreshWay website to send Discord messages
  api: {
    port: () => {
      const p = parseInt(process.env.BOT_API_PORT || "3001", 10);
      return Number.isFinite(p) ? p : 3001;
    },
    secret: () => process.env.BOT_API_SECRET?.trim() || null,
  },
};
