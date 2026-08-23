require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const { Client, Collection } = require("discord.js");
const config = require("./config");

// --- Validate env ---
const required = ["DISCORD_TOKEN", "CLIENT_ID"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`[FATAL] Missing env variable: ${key}`);
    process.exit(1);
  }
}

// --- Create client ---
const client = new Client(config.clientOptions);
client.commands = new Collection();
client.config = config;

// --- Load commands ---
const commandsPath = path.resolve(config.paths.commands);
if (fs.existsSync(commandsPath)) {
  const commandFiles = fs
    .readdirSync(commandsPath)
    .filter((f) => f.endsWith(".js"));

  for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));
    if ("data" in command && "execute" in command) {
      client.commands.set(command.data.name, command);
      console.log(`[CMD] Loaded /${command.data.name}`);
    } else {
      console.warn(`[CMD] Skipping ${file} - missing "data" or "execute"`);
    }
  }
}

// --- Load events ---
const eventsPath = path.resolve(config.paths.events);
if (fs.existsSync(eventsPath)) {
  const eventFiles = fs
    .readdirSync(eventsPath)
    .filter((f) => f.endsWith(".js"));

  for (const file of eventFiles) {
    const event = require(path.join(eventsPath, file));
    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args));
    } else {
      client.on(event.name, (...args) => event.execute(...args));
    }
    console.log(`[EVENT] Loaded ${event.name}`);
  }
}

// --- Global DM proof listener (verification) ---
const { handleProofDm } = require("./lib/verification");
client.on("messageCreate", (message) => {
  // Let the verification module try to handle DM proof images
  handleProofDm(message).catch(() => {});
});

// --- Global error handling ---
process.on("unhandledRejection", (err) => {
  console.error("[ERROR] Unhandled rejection:", err);
});

process.on("uncaughtException", (err) => {
  console.error("[ERROR] Uncaught exception:", err);
});

// --- Login ---
console.log(`[BOOT] Starting ${config.bot.name} v${config.bot.version}...`);
client
  .login(process.env.DISCORD_TOKEN)
  .then(() => {
    // Sync slash commands on every start so the panel never has to run
    // deploy-commands manually.
    const { syncCommands } = require("./lib/sync-commands");
    return syncCommands();
  })
  .catch((err) => {
    console.error("[FATAL] Failed to log in:", err);
    process.exit(1);
  });
