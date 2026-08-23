# 🛒 FreshWay Shopping Training

A Discord bot for FreshWay's shopping training system. This is the home of
**all** FreshWay Discord functionality - embeds, channel posting, DMs, role
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
| `FRESHWAY_CHANNEL_VERIFICATION` | ❌ | Verification welcome channel (defaults to `1525788502648950855`) |
| `FRESHWAY_CHANNEL_VERIFICATION_REVIEWS` | ❌ | Verification review channel (defaults to `1525794994932154449`) |
| `FRESHWAY_CHANNEL_VOTING` | ❌ | Staff-case voting channel (defaults to `1525791566919110736`) |
| `FRESHWAY_CHANNEL_MESSAGE_LOGS` | ❌ | Edited/deleted message log channel (defaults to `1525794474846982275`) |
| `FRESHWAY_ROLE_TRAINER` | ✅ | Certified Trainer role ID |
| `FRESHWAY_ROLE_STAFF` | ❌ | Staff role ID (command access) |
| `FRESHWAY_ROLE_MANAGEMENT` | ❌ | Management role ID (command access) |
| `FRESHWAY_ROLE_DIRECTORY` | ❌ | Directory role ID (assigned on accepted verification) |
| `FRESHWAY_ROLE_TM` | ❌ | Training Manager role ID (falls back to Management) |
| `FRESHWAY_ROLE_TRAINING_LEADERSHIP` | ❌ | Training Leadership role ID (falls back to Management) |
| `FRESHWAY_VOTE_THRESHOLD` | ❌ | Staff-case auto-resolve threshold (default `5`) |
| ~~`FRESHWAY_SITE_URL`~~ | - | **No longer required.** Join-button signups used to call the website's `/api/training/discord-signup`; the bot now registers them directly in Supabase. |

## HTTP API

The FreshWay website calls these endpoints (all `POST` unless noted). Every
request must send the `x-bot-secret` header matching `BOT_API_SECRET`.

| Endpoint | Body | Purpose |
|---|---|---|
| `GET /health` | - | Liveness check |
| `GET /api/user/{discordId}` | - | Current username/global name/avatar URL |
| `/api/notify/session-created` | `{ sessionId }` | Post new-session embed to trainings |
| `/api/notify/session-status` | `{ sessionId, oldStatus, newStatus }` | Post status change |
| `/api/notify/session-deleted` | `{ sessionId, title, deletedBy }` | Log deletion |
| `/api/notify/cert-reviewed` | `{ userId, status, score, total }` | Post cert review |
| `/api/notify/punishment` | `{ targetDiscord, targetDiscordId?, type, reason, issuedBy, expiresAt? }` | DM target + post to punishment logs (returns `{ ok, dmSent }`) |
| `/api/notify/monthly-report` | `{ month, data }` | Post report to announcements |
| `/api/notify/reminders` | `{}` | Run the session-reminder sweep now (returns `{ sent, errors }`) |
| `/api/dm` | `{ discordId, title, description, color? }` | Send a DM embed |
| `/api/role` | `{ userId, roleId?, action: "add"\|"remove", guildId? }` | Add/remove trainer role (roleId defaults to trainer role) |
| `/api/presence/refresh` | `{}` | Recompute and set bot activity (scheduled-session count) |
| `/api/timetable/post` | `{ channelId? }` | Post the training timetable (embed + buttons) to the timetable channel |

## Live boards (auto-updating)

Both the **trainings** channel and the **timetable** channel show a single
self-updating embed (a "board") that lists the upcoming sessions and is
refreshed **every 20 seconds** by the scheduler. Boards only edit their
message when the content actually changed, so nothing is spammed.

- **Trainings board** - lists the next sessions, each with **Join as
  Co-Host** / **Join as Helper** buttons plus a **Refresh** button. Creating a
  session (website or `/training-booking`) or deleting one updates this board
  immediately.
- **Timetable board** - full schedule with a **Refresh** button (and a
  **View on Portal** link when `FRESHWAY_PORTAL_URL` is set).

Session lifecycle notices (status changes, deletions) are logged to the
**logs** channel, not the trainings channel.

## Scheduled tasks

- **Live boards** (trainings + timetable) refresh every 20 seconds.
- **Presence** refreshes every 30 minutes with live metrics from Supabase.
- **Session reminders** (DM to hosts of sessions starting within an hour) run
  every 15 minutes.

## Slash commands

- `/ping` - latency check
- `/announce <title> <description> [channel]` - post a FreshWay embed (Trainer/Staff/Management)
- `/punish <user> <type> <reason>` - issue a punishment (Trainer/Staff/Management)
- `/timetable` - post the training schedule to the timetable channel as an embed with a **Refresh** button (and a **View on Portal** link when `FRESHWAY_PORTAL_URL` is set). With no sessions it just says no sessions are scheduled.
- `/verify-setup` - post the Training Division verification welcome embed to the verification channel (Trainer/Staff/Management)
- `/training-booking` - book a training session or shift. Opens a **session-type select menu** (Training, Store Shift, Promotional Shift, Community Event) and a **Cancel** button; picking a type opens the booking **modal** (title, when, game link, description, max participants). The session is created straight into Supabase (same system as the portal, host = you) and appears on the trainings board with join buttons (Trainer/Staff/Management)
- `/voting` - open a staff case for a Training Leadership vote (TM only)
- `/punishment-issue` - coming soon (formats still being worked on)
- `/trial-referral` - unavailable at the moment

The **Join as Co-Host** / **Join as Helper** buttons on the trainings board
register the signup directly in Supabase: the Discord id is resolved to a
profile (Roblox name + staff status), the signup is written to
`training_session_signups`, the session's co-host/helper arrays are updated,
and the session host is notified via DM.

## Training Division features

**Verification** - a welcome embed with a **Verify & Authorization** button
lives in the verification channel (auto-posted on startup if missing).
Clicking it opens the application form (name/Roblox/Discord, invited by,
requested rank, proof). Submissions are posted to the review channel with the
proof and **Accept / Fail** buttons, pinging Training Leadership. Accepted
requests get their requested rank role (Trainer or Directory) and the user is
DM'd. Users with a request under review cannot submit another one.

**Staff cases (/voting)** - TM-only. Opens a form (reported person, reason,
proof), posts a case embed to the voting channel with **✅ Support** /
**❌ Decline** buttons and a live vote tally, creates an automatic discussion
thread pinging Training Leadership, and gives leadership **Accept** /
**Close the thread & deny it** buttons. When either side reaches
`FRESHWAY_VOTE_THRESHOLD` votes the case auto-resolves according to public
opinion and the embed color updates.

**Message logs** - edited and deleted messages (including bulk deletes) are
logged to the message logs channel.

## Scheduled tasks

Slash commands are **synced automatically on every start** (guild-scoped when
`GUILD_ID` is set), so there's no need to run `npm run deploy-commands` after
pulling.

## Project Structure

```
src/
├── index.js              # Entry point
├── config.js             # Bot configuration (channels, roles, colors, API)
├── deploy-commands.js    # Slash command registration
├── commands/             # Slash commands
│   ├── ping.js
│   ├── announce.js
│   ├── punish.js
│   ├── timetable.js
│   ├── verify.js
│   ├── training-booking.js
│   ├── voting.js
│   ├── punishment-issue.js
│   └── trial-referral.js
├── events/               # Discord events
│   ├── ready.js          # Validates config, starts API + schedulers
│   ├── interactionCreate.js
│   ├── messageUpdate.js  # Edited-message logging
│   ├── messageDelete.js  # Deleted-message logging
│   ├── messageDeleteBulk.js

└── lib/                  # FreshWay bot functions
    ├── embeds.js         # FreshWay embed builder (green, > lines, footer)
    ├── channels.js       # Channel posting (trainings/logs/timetable/...)
    ├── dms.js            # DM sending
    ├── roles.js          # Role add/remove
    ├── notifications.js  # All notification templates (session, cert, punishment, reports, reminders)
    ├── presence.js       # Bot activity with live metrics
    ├── avatar.js         # Discord user profile/avatar lookups
    ├── verification.js   # Training Division verification flow
    ├── voting.js         # Staff-case voting system
    ├── supabase.js       # Supabase client for live data
    ├── guards.js         # Role checks for commands
    ├── scheduler.js      # Recurring tasks (presence, reminders)
    └── api.js            # HTTP API the website calls
```

## Troubleshooting

- **Node.js 20** works - `ws` is bundled as the WebSocket transport for
  supabase-js (which needs one on runtimes without a native WebSocket).
  supabase-js recommends Node 22+.

## License

MIT
