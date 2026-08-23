# 🛒 FreshWay Shopping Training

A Discord bot for FreshWay's shopping training system.

## Setup

```bash
# Install dependencies
npm install

# Copy and fill in your bot token
cp .env.example .env

# Deploy slash commands
npm run deploy-commands

# Start the bot
npm start
```

## Development

```bash
# Auto-reload on file changes
npm run dev
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DISCORD_TOKEN` | ✅ | Bot token from [Discord Developer Portal](https://discord.com/developers/applications) |
| `CLIENT_ID` | ✅ | Application client ID |
| `GUILD_ID` | ❌ | Set to test commands in one server only (instant) |
| `OWNER_ID` | ❌ | Your Discord user ID for owner-only checks |

## Project Structure

```
src/
├── index.js              # Entry point
├── config.js             # Bot configuration
├── deploy-commands.js    # Slash command registration
├── commands/             # Slash commands
│   └── ping.js
└── events/               # Discord events
    ├── ready.js
    └── interactionCreate.js
```

## License

MIT
