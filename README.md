# 🛒 FreshWay Shopping Training

A Discord bot for FreshWay's shopping training system. This is the home of
**all** FreshWay Discord functionality — embeds, channel posting, DMs, role
management, notifications, presence, and avatar lookups. The FreshWay website
only triggers the bot through its HTTP API; it contains no Discord code.

## Setup

```bash
# Install dependencies
npm install

# Copy and fill in your bot token + IDs
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
| `GUILD_ID` | ✅ | The Discord server the bot operates in |
| `OWNER_ID` | ❌ | Your Discord user ID for owner-only checks |
| `BOT_API_SECRET` | ❌ | Secret the website sends as `x-bot-secret`. API only starts when set. |
| `BOT_API_PORT` | ❌ | HTTP API port (default `3001`) |
| `SUPABASE_URL` | ✅ | FreshWay Supabase project URL (for notifications/presence data) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | FreshWay Supabase service role key |
| `FRESHWAY_CHANNEL_TRAININGS` | ✅ | Trainings channel ID |
| `FRESHWAY_CHANNEL_LOGS` | ✅ | Logs channel ID |
| `FRESHWAY_CHANNEL_TIMETABLE` | ❌ | Timetable channel ID |
| `FRESHWAY_CHANNEL_PUNISHMENT_LOGS` | ❌ | Punishment logs channel ID (falls back to logs) |
| `FRESHWAY_CHANNEL_ANNOUNCEMENTS` | ❌ | Announcements channel ID (monthly reports) |
| `FRESHWAY_ROLE_TRAINER` | ✅ | Certified Trainer role ID |
| `FRESHWAY_ROLE_STAFF` | ❌ | Staff role ID (command access) |
| `FRESHWAY_ROLE_MANAGEMENT` | ❌ | Management role ID (command access) |

## HTTP API

The FreshWay website calls these endpoints (all `POST` unless noted). Every
request must send the `x-bot-secret` header matching `BOT_API_SECRET`.

| Endpoint | Body | Purpose |
|---|---|---|
| `GET /health` | — | Liveness check |
| `GET /api/user/{discordId}` | — | Current username/global name/avatar URL |
| `/api/notify/session-created` | `{ sessionId }` | Post new-session embed to trainings |
| `/api/notify/session-status` | `{ sessionId, oldStatus, newStatus }` | Post status change |
| `/api/notify/session-deleted` | `{ sessionId, title, deletedBy }` | Log deletion |
| `/api/notify/cert-reviewed` | `{ userId, status, score, total }` | Post cert review |
| `/api/notify/punishment` | `{ targetDiscord, targetDiscordId?, type, reason, issuedBy, expiresAt? }` | DM target + post to punishment logs (returns `{ ok, dmSent }`) |
| `/api/notify/monthly-report` | `{ month, data }` | Post report to announcements |
| `/api/notify/reminders` | `{}` | Run the session-reminder sweep now (returns `{ sent, errors }`) |
| `/api/dm` | `{ discordId, title, description, color? }` | Send a DM embed |
| `/api/role` | `{ userId, roleId?, action: "add"\|"remove", guildId? }` | Add/remove trainer role (roleId defaults to trainer role) |
| `/api/presence/refresh` | `{}` | Recompute and set bot activity |

## Scheduled tasks

- **Presence** refreshes every 30 minutes with live metrics from Supabase.
- **Session reminders** (DM to hosts of sessions starting within an hour) run
  every 15 minutes.

## Slash commands

- `/ping` — latency check
- `/announce <title> <description> [channel]` — post a FreshWay embed (Trainer/Staff/Management)
- `/punish <user> <type> <reason>` — issue a punishment (Trainer/Staff/Management)

## Project Structure

```
src/
├── index.js              # Entry point
├── config.js             # Bot configuration (channels, roles, colors, API)
├── deploy-commands.js    # Slash command registration
├── commands/             # Slash commands
│   ├── ping.js
│   ├── announce.js
│   └── punish.js
├── events/               # Discord events
│   ├── ready.js          # Validates config, starts API + schedulers
│   └── interactionCreate.js
└── lib/                  # FreshWay bot functions
    ├── embeds.js         # FreshWay embed builder (green, > lines, footer)
    ├── channels.js       # Channel posting (trainings/logs/timetable/...)
    ├── dms.js            # DM sending
    ├── roles.js          # Role add/remove
    ├── notifications.js  # All notification templates (session, cert, punishment, reports, reminders)
    ├── presence.js       # Bot activity with live metrics
    ├── avatar.js         # Discord user profile/avatar lookups
    ├── supabase.js       # Supabase client for live data
    ├── guards.js         # Role checks for commands
    ├── scheduler.js      # Recurring tasks (presence, reminders)
    └── api.js            # HTTP API the website calls
```

## Troubleshooting

- **Node.js 20** works — `ws` is bundled as the WebSocket transport for
  supabase-js (which needs one on runtimes without a native WebSocket).
  supabase-js recommends Node 22+.

## License

MIT
