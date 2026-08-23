// HTTP API - the FreshWay website calls these endpoints to send Discord
// messages. All Discord logic lives in this bot; the website only triggers.
//
// Every request must include the header `x-bot-secret` matching
// BOT_API_SECRET. If BOT_API_SECRET is not set the API does not start.

const http = require("node:http");
const config = require("../config");
const { sendDiscordDm } = require("./dms");
const { sendChannelEmbed } = require("./channels");
const { addGuildRole, removeGuildRole } = require("./roles");
const notifications = require("./notifications");
const timetable = require("./timetable");
const { refreshPresence } = require("./presence");
const { getUserProfile } = require("./avatar");

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * Start the HTTP API server. Must be called after the client is ready.
 */
function startApi(client) {
  const secret = config.api.secret();
  if (!secret) {
    console.warn("[API] BOT_API_SECRET not set - HTTP API disabled");
    return;
  }

  const server = http.createServer(async (req, res) => {
    if (req.headers["x-bot-secret"] !== secret) {
      return sendJson(res, 401, { ok: false, error: "Unauthorized" });
    }

    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const path = url.pathname;

    try {
      if (req.method === "GET" && path === "/health") {
        return sendJson(res, 200, { ok: true, bot: config.bot.name, version: config.bot.version });
      }

      if (req.method === "GET" && path.startsWith("/api/user/")) {
        const discordId = decodeURIComponent(path.slice("/api/user/".length));
        return sendJson(res, 200, await getUserProfile(client, discordId));
      }

      if (req.method !== "POST") {
        return sendJson(res, 405, { ok: false, error: "Method not allowed" });
      }

      const body = await readBody(req);

      switch (path) {
        case "/api/notify/session-created":
          await notifications.notifySessionCreated(client, body.sessionId);
          return sendJson(res, 200, { ok: true });

        case "/api/notify/session-status":
          await notifications.notifySessionStatusChanged(client, body.sessionId, body.oldStatus, body.newStatus);
          return sendJson(res, 200, { ok: true });

        case "/api/notify/session-deleted":
          await notifications.notifySessionDeleted(client, body.sessionId, body.title, body.deletedBy);
          return sendJson(res, 200, { ok: true });

        case "/api/notify/cert-reviewed":
          await notifications.notifyCertificationReviewed(client, body.userId, body.status, body.score, body.total);
          return sendJson(res, 200, { ok: true });

        case "/api/notify/punishment": {
          const result = await notifications.notifyPunishmentIssued(client, body);
          return sendJson(res, 200, { ok: true, dmSent: !!result.dmSent });
        }

        case "/api/notify/monthly-report":
          await notifications.notifyMonthlyReport(client, body.month, body.data);
          return sendJson(res, 200, { ok: true });

        case "/api/notify/reminders": {
          const result = await notifications.sendSessionReminders(client);
          return sendJson(res, 200, { ok: true, sent: result.sent, errors: result.errors });
        }

        case "/api/timetable/post": {
          const result = await timetable.postTimetable(client, { channelId: body.channelId });
          return sendJson(res, 200, result);
        }

        case "/api/dm": {
          const ok = await sendDiscordDm(client, body.discordId, {
            title: body.title,
            description: body.description,
            color: body.color,
          });
          return sendJson(res, 200, { ok });
        }

        case "/api/role": {
          const guildId = body.guildId || process.env.GUILD_ID?.trim();
          const roleId = body.roleId || config.roles.trainer();
          if (!guildId || !roleId || !body.userId) {
            return sendJson(res, 400, { ok: false, error: "guildId, roleId (or trainer role config) and userId required" });
          }
          const ok = body.action === "remove"
            ? await removeGuildRole(client, guildId, body.userId, roleId)
            : await addGuildRole(client, guildId, body.userId, roleId);
          return sendJson(res, 200, { ok });
        }

        case "/api/presence/refresh": {
          const result = await refreshPresence(client);
          return sendJson(res, 200, result);
        }

        default:
          return sendJson(res, 404, { ok: false, error: "Not found" });
      }
    } catch (e) {
      console.error("[API] Handler error:", e);
      return sendJson(res, 500, { ok: false, error: "Internal error" });
    }
  });

  server.listen(config.api.port(), () => {
    console.log(`[API] HTTP API listening on port ${config.api.port()}`);
  });
}

module.exports = { startApi };
