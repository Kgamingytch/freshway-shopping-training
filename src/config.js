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
    red: 0xb03a2e, // used for declined/rejected states
  },

  // Discord client options
  clientOptions: {
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
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

  // Channel IDs - resolved from environment at call time so the hosting
  // panel can set them without a code change. The training-division channels
  // below default to the live guild channel IDs; set the env var to override.
  channels: {
    trainings: () => process.env.FRESHWAY_CHANNEL_TRAININGS?.trim() || null,
    logs: () => process.env.FRESHWAY_CHANNEL_LOGS?.trim() || null,
    timetable: () => process.env.FRESHWAY_CHANNEL_TIMETABLE?.trim() || null,
    punishmentLogs: () => process.env.FRESHWAY_CHANNEL_PUNISHMENT_LOGS?.trim() || null,
    announcements: () => process.env.FRESHWAY_CHANNEL_ANNOUNCEMENTS?.trim() || null,
    verification: () => process.env.FRESHWAY_CHANNEL_VERIFICATION?.trim() || "1525788502648950855",
    verificationReviews: () => process.env.FRESHWAY_CHANNEL_VERIFICATION_REVIEWS?.trim() || "1525794994932154449",
    voting: () => process.env.FRESHWAY_CHANNEL_VOTING?.trim() || "1525791566919110736",
    messageLogs: () => process.env.FRESHWAY_CHANNEL_MESSAGE_LOGS?.trim() || "1525794474846982275",
  },

  // Role IDs
  roles: {
    trainer: () => process.env.FRESHWAY_ROLE_TRAINER?.trim() || null,
    staff: () => process.env.FRESHWAY_ROLE_STAFF?.trim() || null,
    management: () => process.env.FRESHWAY_ROLE_MANAGEMENT?.trim() || null,
    directory: () => process.env.FRESHWAY_ROLE_DIRECTORY?.trim() || null,
    tm: () => process.env.FRESHWAY_ROLE_TM?.trim() || process.env.FRESHWAY_ROLE_MANAGEMENT?.trim() || null,
    trainingLeadership:
      () => process.env.FRESHWAY_ROLE_TRAINING_LEADERSHIP?.trim() || process.env.FRESHWAY_ROLE_MANAGEMENT?.trim() || null,
  },

  // Staff-case voting (the /voting command)
  voting: {
    // Number of votes on one side that auto-resolves the case.
    threshold: () => {
      const t = parseInt(process.env.FRESHWAY_VOTE_THRESHOLD || "5", 10);
      return Number.isFinite(t) && t > 0 ? t : 5;
    },
  },

  // HTTP API - used by the FreshWay website to send Discord messages
  api: {
    port: () => {
      const p = parseInt(process.env.BOT_API_PORT || "3001", 10);
      return Number.isFinite(p) ? p : 3001;
    },
    secret: () => process.env.BOT_API_SECRET?.trim() || null,
  },
};
