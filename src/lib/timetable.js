// Training timetable - the timetable channel shows a single self-updating
// board message (see ./boards). This module keeps the /timetable command
// and HTTP API surface: post (or refresh) the board, and the in-place
// refresh triggered by the message's Refresh button.
//
// Usage:
//   /timetable                     → post (or refresh) the schedule
//   POST /api/timetable/post       → trigger from the website
//   "Refresh" button on the message → re-fetches and edits in place
//   scheduler                       → auto-updates every 20 seconds

const boards = require("./boards");
const config = require("../config");

const TIMETABLE_REFRESH_ID = boards.TIMETABLE_REFRESH_ID;
const fetchUpcomingSessions = boards.fetchBoardSessions;
const buildTimetableEmbed = boards.buildTimetableBoardEmbed;
const buildTimetableRow = boards.buildTimetableRow;

/** Post the timetable to a channel (defaults to the configured one). */
async function postTimetable(client, { channelId } = {}) {
  const id = channelId || config.channels.timetable();
  if (!id) {
    console.warn("[Timetable] No timetable channel configured (FRESHWAY_CHANNEL_TIMETABLE)");
    return { ok: false, count: 0, error: "Timetable channel not configured" };
  }

  const channel = await client.channels.fetch(id).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    console.warn(`[Timetable] Channel ${id} not found or not a text channel`);
    return { ok: false, count: 0, error: "Timetable channel not found" };
  }

  const sessions = await fetchUpcomingSessions();
  const sent = await channel
    .send({
      embeds: [buildTimetableEmbed(sessions)],
      components: [buildTimetableRow()],
    })
    .catch((e) => {
      console.error("[Timetable] Failed to send:", e);
      return null;
    });

  if (!sent) return { ok: false, count: 0, error: "Failed to send" };
  console.log(`[Timetable] Posted ${sessions.length} session(s) to ${id}`);
  return { ok: true, count: sessions.length };
}

/** Re-fetch and edit an existing timetable message in place (Refresh button). */
async function updateTimetableMessage(client, message) {
  try {
    const sessions = await fetchUpcomingSessions();
    await message.edit({
      embeds: [buildTimetableEmbed(sessions)],
      components: [buildTimetableRow()],
    });
    console.log(`[Timetable] Refreshed message in ${message.channelId}`);
    return true;
  } catch (e) {
    console.error("[Timetable] Refresh failed:", e);
    return false;
  }
}

/** Auto-update the timetable board (used by the scheduler / boards engine). */
async function autoUpdateTimetable(client) {
  return boards.updateTimetableBoard(client);
}

module.exports = {
  TIMETABLE_REFRESH_ID,
  fetchUpcomingSessions,
  buildTimetableEmbed,
  buildTimetableRow,
  postTimetable,
  updateTimetableMessage,
  autoUpdateTimetable,
};
