const { Events, ActivityType } = require("discord.js");

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    console.log(`[READY] Logged in as ${client.user.tag}`);
    console.log(`[READY] Serving ${client.guilds.cache.size} guild(s)`);

    client.user.setPresence({
      activities: [
        {
          name: "FreshWay Shopping Training",
          type: ActivityType.Watching,
        },
      ],
      status: "online",
    });
  },
};
