// Scheduled tasks - presence refresh, the session-reminder sweep, and the
// timetable auto-update run on intervals so the website doesn't need its own
// cron.

const { refreshPresence } = require("./presence");
const { sendSessionReminders } = require("./notifications");
const { autoUpdateTimetable } = require("./timetable");

const PRESENCE_INTERVAL_MS = 30 * 60 * 1000; // every 30 minutes
const REMINDERS_INTERVAL_MS = 15 * 60 * 1000; // every 15 minutes
const TIMETABLE_INTERVAL_MS = 30 * 60 * 1000; // every 30 minutes

/** Kick off the recurring tasks. Safe to call once on ready. */
function scheduleTasks(client) {
  refreshPresence(client).catch((e) => console.error("[SCHED] Initial presence failed:", e));
  autoUpdateTimetable(client).catch((e) => console.error("[SCHED] Initial timetable failed:", e));

  setInterval(() => refreshPresence(client).catch(() => {}), PRESENCE_INTERVAL_MS);
  setInterval(() => sendSessionReminders(client).catch(() => {}), REMINDERS_INTERVAL_MS);
  setInterval(() => autoUpdateTimetable(client).catch(() => {}), TIMETABLE_INTERVAL_MS);

  console.log("[SCHED] Presence every 30m, reminders every 15m, timetable every 30m");
}

module.exports = { scheduleTasks };
