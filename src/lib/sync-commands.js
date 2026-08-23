// Slash command sync - registers commands with Discord on EVERY startup so
// the hosting panel never needs to run deploy-commands manually. Guild-
// scoped when GUILD_ID is set (instant), global otherwise.

const { REST, Routes } = require("discord.js");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Push the commands from src/commands to Discord.
 * Never throws - failures are logged so the bot keeps running.
 */
async function syncCommands() {
  const commands = [];
  const commandsPath = path.resolve(__dirname, "../commands");
  const commandFiles = fs.readdirSync(commandsPath).filter((f) => f.endsWith(".js"));

  for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    if ("data" in command) {
      commands.push(command.data.toJSON());
    }
  }

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  const guildId = process.env.GUILD_ID?.trim();
  const route = guildId
    ? Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId)
    : Routes.applicationCommands(process.env.CLIENT_ID);

  try {
    await rest.put(route, { body: commands });
    console.log(
      `[SYNC] Registered ${commands.length} command(s)${guildId ? ` to guild ${guildId}` : " globally"}`,
    );
  } catch (err) {
    console.error("[SYNC] Failed to sync slash commands:", err);
  }
}

module.exports = { syncCommands };
