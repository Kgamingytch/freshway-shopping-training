require("dotenv").config();
const { REST, Routes } = require("discord.js");
const fs = require("node:fs");
const path = require("node:path");

const commands = [];
const commandsPath = path.resolve(__dirname, "commands");
const commandFiles = fs.readdirSync(commandsPath).filter((f) => f.endsWith(".js"));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if ("data" in command) {
    commands.push(command.data.toJSON());
  }
}

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`[DEPLOY] Registering ${commands.length} command(s)...`);

    if (process.env.GUILD_ID) {
      // Guild-scoped (instant, good for testing)
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
        { body: commands }
      );
      console.log(`[DEPLOY] Registered to guild ${process.env.GUILD_ID}`);
    } else {
      // Global (takes ~1 hour to propagate)
      await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
        body: commands,
      });
      console.log("[DEPLOY] Registered globally (may take up to 1 hour)");
    }
  } catch (err) {
    console.error("[DEPLOY] Error:", err);
  }
})();
