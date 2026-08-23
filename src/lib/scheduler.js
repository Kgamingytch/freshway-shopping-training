// Scheduled tasks - presence refresh and the session-reminder sweep run on
// intervals so the website doesn't need its own cron.

const { refreshPresence } = require("./presence");
const { sendSessionReminders } = require("./notifications");

const PRESENCE_INTERVAL_MS = 30 * 60 * 1000; // every 30 minutes
const REMINDERS_INTERVAL_MS = 15 * 60 * 1000; // every 15 minutes

/** Kick off the recurring tasks. Safe to call once on ready. */
function scheduleTasks(client) {
  refreshPresence(client).catch((e) => console.error("[SCHED] Initial presence failed:", e));
  setInterval(() => refreshPresence(client).catch(() => {}), PRESENCE_INTERVAL_MS);
  setInterval(() => sendSessionReminders(client).catch(() => {}), REMINDERS_INTERVAL_MS);
  console.log("[SCHED] Presence refresh every 30m, session reminders every 15m");
}

module.exports = { scheduleTasks };
