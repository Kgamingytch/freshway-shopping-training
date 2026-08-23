// Scheduled tasks - the live boards (trainings + timetable) refresh every
// 20 seconds so the single self-updating embeds stay current; presence and
// session reminders run on slower intervals so the website doesn't need its
// own cron.

const { refreshPresence } = require("./presence");
const { sendSessionReminders } = require("./notifications");
const { updateTrainingsBoard, updateTimetableBoard } = require("./boards");

const BOARDS_INTERVAL_MS = 20 * 1000; // every 20 seconds
const PRESENCE_INTERVAL_MS = 30 * 60 * 1000; // every 30 minutes
const REMINDERS_INTERVAL_MS = 15 * 60 * 1000; // every 15 minutes

/** Kick off the recurring tasks. Safe to call once on ready. */
function scheduleTasks(client) {
  refreshPresence(client).catch((e) => console.error("[SCHED] Initial presence failed:", e));
  updateTrainingsBoard(client).catch((e) => console.error("[SCHED] Initial trainings board failed:", e));
  updateTimetableBoard(client).catch((e) => console.error("[SCHED] Initial timetable board failed:", e));

  setInterval(() => {
    updateTrainingsBoard(client).catch(() => {});
    updateTimetableBoard(client).catch(() => {});
  }, BOARDS_INTERVAL_MS);
  setInterval(() => refreshPresence(client).catch(() => {}), PRESENCE_INTERVAL_MS);
  setInterval(() => sendSessionReminders(client).catch(() => {}), REMINDERS_INTERVAL_MS);

  console.log("[SCHED] Boards every 20s, presence every 30m, reminders every 15m");
}

module.exports = { scheduleTasks };
