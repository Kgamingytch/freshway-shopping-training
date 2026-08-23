const { Events } = require("discord.js");
const config = require("../config");
const { startApi } = require("../lib/api");
const { scheduleTasks } = require("../lib/scheduler");
const { refreshPresence } = require("../lib/presence");

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`[READY] Logged in as ${client.user.tag}`);
    console.log(`[READY] Serving ${client.guilds.cache.size} guild(s)`);

    // Validate channel + role configuration so missing IDs are obvious.
    console.log("[CONFIG] Channel map:");
    for (const [key, getter] of Object.entries(config.channels)) {
      const id = getter();
      console.log(`[CONFIG]   ${key} -> ${id || "(not set)"}`);
    }
    for (const [key, getter] of Object.entries(config.roles)) {
      if (!getter()) {
        console.warn(`[CONFIG] Missing role ID for "${key}" (FRESHWAY_ROLE_${key.toUpperCase()})`);
      }
    }
    if (!process.env.GUILD_ID?.trim()) {
      console.warn("[CONFIG] GUILD_ID not set - /api/role requests without an explicit guildId will fail");
    }
    if (!config.api.secret()) {
      console.warn("[CONFIG] BOT_API_SECRET not set - HTTP API disabled");
    }

    // Presence is best-effort - never let it block the API or schedulers.
    try {
      await refreshPresence(client);
    } catch (e) {
      console.error("[READY] Presence init failed:", e);
    }

    startApi(client);
    scheduleTasks(client);
  },
};
