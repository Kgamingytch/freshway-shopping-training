// Trello sync - creates a training-session card on the FreshWay Trello
// board so sessions booked via /training-booking appear there exactly like
// sessions created on the website. Mirrors the website's
// src/lib/training/trello.ts (card shape + desc format, including the
// "Site Session ID" line the website uses to find and delete cards).
//
// Configure TRELLO_API_KEY and TRELLO_TOKEN in the environment
// (TRELLO_BOARD_ID is optional - the sessions list id is fixed).

const SESSIONS_LIST_ID = "6a4139fc5d8dbacc8488dd22";

/**
 * Create a Trello card for a training session. Best-effort: never throws,
 * returns { ok } so callers can ignore failures.
 */
async function createSessionCard({ sessionId, title, hostName, gameLink, description, scheduledAt }) {
  const key = process.env.TRELLO_API_KEY?.trim();
  const token = process.env.TRELLO_TOKEN?.trim();
  if (!key || !token) {
    console.warn("[Trello] TRELLO_API_KEY / TRELLO_TOKEN not set - skipping card creation");
    return { ok: false, error: "Trello not configured" };
  }

  const descLines = [];
  if (hostName) descLines.push(`Host: ${hostName}`);
  if (gameLink) descLines.push(`Game: ${gameLink}`);
  if (description) descLines.push(`\n${description}`);
  descLines.push(`\nSite Session ID: ${sessionId}`);

  const params = new URLSearchParams({
    key,
    token,
    idList: SESSIONS_LIST_ID,
    name: "[Training] " + title,
    desc: descLines.join("\n"),
  });
  const boardId = process.env.TRELLO_BOARD_ID?.trim();
  if (boardId) params.set("idBoard", boardId);
  if (scheduledAt) params.set("due", scheduledAt);

  try {
    const url = `https://api.trello.com/1/cards?${params.toString()}`;
    console.log(
      "[Trello] POST /cards",
      url.replace(/key=[^&]+/, "key=***").replace(/token=[^&]+/, "token=***"),
    );
    const res = await fetch(url, { method: "POST" });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error(`[Trello] POST /cards ${res.status}: ${txt.slice(0, 200)}`);
      return { ok: false, error: `Trello POST ${res.status}` };
    }
    const card = await res.json();
    console.log(`[Trello] Card created for session ${sessionId}: ${card.id}`);
    return { ok: true, card };
  } catch (e) {
    console.error("[Trello] Failed to create card:", e?.message ?? e);
    return { ok: false, error: e?.message ?? "Failed" };
  }
}

module.exports = { SESSIONS_LIST_ID, createSessionCard };
