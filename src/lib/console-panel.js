// [engineering]
// Console panel - a single self-updating Components V2 message that shows
// the bot process's live log tail plus power controls (Start / Restart /
// Kill) that talk to the Pterodactyl panel API.
//
// Why: the Pterodactyl browser console (websocket) is broken (mixed-content
// ws:// from an https page), so this channel acts as the console instead:
//   - log lines stream in and are appended to the one message
//   - power buttons let the bot restart / kill / start itself from Discord
//
// The message id persists in data/console-panel.json so restarts edit the
// same message instead of posting duplicates.
//
// Log source: we tee console.log / console.error / console.warn into a
// ring buffer (plus a file). On boot the panel shows the tail of that file.
// Runtime lines are appended live via message edits (throttled).

const fs = require("node:fs");
const path = require("node:path");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} = require("discord.js");
const config = require("../config");
const E = require("./emojis");

const PANEL_CHANNEL_FALLBACK = "1525794663707971725";

const POWER_PREFIX = "fw_power:"; // + signal (start|restart|kill)

// Pterodactyl client API (from env - same credentials the panel uses).
const PTERO_URL = process.env.PTERO_URL?.replace(/\/$/, "") || "https://panel.kriatech.qzz.io";
const PTERO_KEY = process.env.PTERO_CLIENT_KEY?.trim() || null;
const PTERO_SERVER = process.env.PTERO_SERVER_ID?.trim() || "9aa7a391-3168-411c-ac3b-dd5d57920edc";

const BRAND_GREEN = 0x1a5632;
const MAX_LOG_LINES = 20;
const MAX_LOG_CHARS = 3500; // keep well under Discord's 4000-char V2 budget
const EDIT_INTERVAL_MS = 2500; // throttle live edits
const FLUSH_INTERVAL_MS = 5000; // file flush

// ---------- Log ring buffer + file tee ----------

const DATA_DIR = path.resolve(__dirname, "../../data");
const LOG_FILE = path.join(DATA_DIR, "console-panel.log");
const STATE_FILE = path.join(DATA_DIR, "console-panel.json");

const ring = [];
const RING_SIZE = 300;

function stamp() {
  return new Date().toISOString().replace("T", " ").slice(5, 19); // MM-DD HH:MM:SS
}

function levelOf(args) {
  const first = args[0];
  if (typeof first === "string") {
    if (first.startsWith("[ERROR]") || first.startsWith("[FATAL]")) return "err";
    if (first.startsWith("[WARN]")) return "warn";
  }
  return "info";
}

function recordLine(level, text) {
  const line = { t: stamp(), level, text: String(text).slice(0, 300) };
  ring.push(line);
  if (ring.length > RING_SIZE) ring.shift();
  return line;
}

// Buffer for lazy file writes (so console logging never blocks the event loop
// on disk and logging during boot doesn't slow start-up).
let writeBuf = [];
function flushWriteBuf() {
  if (writeBuf.length === 0) return;
  const chunk = writeBuf.join("\n") + "\n";
  writeBuf = [];
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, chunk);
  } catch {
    /* disk issues must never crash logging */
  }
}

function formatLine(line) {
  const mark = line.level === "err" ? E.cross : line.level === "warn" ? E.warning : E.check;
  return `\`${line.t}\` ${mark} ${line.text}`;
}

/** Tail the on-disk log file into the ring on boot. */
function loadTailFromDisk() {
  try {
    if (!fs.existsSync(LOG_FILE)) return;
    const raw = fs.readFileSync(LOG_FILE, "utf8");
    const lines = raw.trimEnd().split("\n").slice(-RING_SIZE);
    for (const l of lines) {
      // Stored format: "MM-DD HH:MM:SS emoji text" - keep it as-is.
      const text = l.slice(20).replace(/^(<:\w+:\d+> )?/, "");
      const level = l.includes(`${E.cross} `) ? "err" : l.includes(`${E.warning} `) ? "warn" : "info";
      ring.push({ t: l.slice(0, 11), level, text: text.slice(0, 300) });
    }
  } catch {
    /* best effort */
  }
}

let teeInstalled = false;
/** Install the console tee exactly once. */
function installTee() {
  if (teeInstalled) return;
  teeInstalled = true;
  loadTailFromDisk();

  for (const method of ["log", "warn", "error"]) {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      try {
        const level = method === "error" ? "err" : method === "warn" ? "warn" : "info";
        const text = args
          .map((a) => (typeof a === "string" ? a : require("node:util").inspect(a, { depth: 1 })))
          .join(" ");
        const line = recordLine(level, text);
        writeBuf.push(`${line.t} ${formatLine(line)}`);
      } catch {
        /* never throw from logging */
      }
      original(...args);
    };
  }
  setInterval(flushWriteBuf, FLUSH_INTERVAL_MS).unref();
  console.log("[ConsolePanel] Console tee installed.");
}

// ---------- Persistent message id ----------

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveState(state) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch {
    /* best effort */
  }
}

// ---------- Pterodactyl power API ----------

function pteroHeaders() {
  return {
    Authorization: `Bearer ${PTERO_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/** Send a power signal; returns { ok, status, error }. */
async function sendPowerSignal(signal) {
  if (!PTERO_KEY) return { ok: false, status: null, error: "PTERO_CLIENT_KEY not configured" };
  try {
    const res = await fetch(
      `${PTERO_URL}/api/client/servers/${PTERO_SERVER}/power`,
      {
        method: "POST",
        headers: pteroHeaders(),
        body: JSON.stringify({ signal }),
      },
    );
    if (res.status === 204) return { ok: true, status: res.status };
    const text = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
  } catch (e) {
    return { ok: false, status: null, error: e?.message ?? String(e) };
  }
}

/** Current server power state from the panel (best effort). */
async function fetchPowerState() {
  if (!PTERO_KEY) return null;
  try {
    const res = await fetch(
      `${PTERO_URL}/api/client/servers/${PTERO_SERVER}/resources?seconds=1`,
      { headers: pteroHeaders() },
    );
    if (!res.ok) return null;
    const json = await res.json();
    return json?.attributes?.current_state ?? null;
  } catch {
    return null;
  }
}

// Restart procedure taught by the panel owner: the container's restart hangs
// in "stopping" forever, so we send restart, wait, then kill. The container's
// start.sh restart loop boots the bot again afterwards.
const RESTART_KILL_DELAY_MS = 10000;

function powerButtons(currentState) {
  const running = currentState === "running" || currentState === "starting";
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(POWER_PREFIX + "restart")
      .setLabel("Restart")
      .setEmoji(E.parse(E.schedule))
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(POWER_PREFIX + "kill")
      .setLabel("Kill")
      .setEmoji(E.parse(E.cross))
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!running),
    new ButtonBuilder()
      .setCustomId(POWER_PREFIX + "start")
      .setLabel("Start")
      .setEmoji(E.parse(E.check))
      .setStyle(ButtonStyle.Success)
      .setDisabled(running),
  );
}

// ---------- Panel builder ----------

function buildLogText(extraLines = []) {
  const all = [...ring.slice(-(MAX_LOG_LINES - extraLines.length)), ...extraLines];
  let lines = all.map(formatLine);
  // Trim from the top until we fit the character budget.
  while (lines.length > 1 && lines.join("\n").length > MAX_LOG_CHARS) lines = lines.slice(1);
  return lines.join("\n") || "_No log output yet._";
}

function buildPanelComponents({ state, footer, extraLines = [] }) {
  const header = new ContainerBuilder().setAccentColor(BRAND_GREEN);
  header.addTextDisplayComponents((t) =>
    t.setContent(`## ${E.roblox} FreshWay Bot Console`),
  );
  header.addTextDisplayComponents((t) =>
    t.setContent(
      [
        `${E.connected} **Panel state:** \`${state ?? "unknown"}\``,
        `${E.time} **Updated:** <t:${Math.floor(Date.now() / 1000)}:R>`,
        footer ? `-# ${footer}` : "-# Logs stream live; use the buttons below for power actions.",
      ].join("\n"),
    ),
  );
  header.addActionRowComponents(powerButtons(state));
  const components = [header, new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)];

  const logs = new ContainerBuilder().setAccentColor(0x66756a);
  logs.addTextDisplayComponents((t) =>
    t.setContent(`### ${E.history} Live Log Tail\n${buildLogText(extraLines)}`),
  );
  components.push(logs);
  return components;
}

function panelPayload(opts = {}) {
  return { flags: MessageFlags.IsComponentsV2, components: buildPanelComponents(opts) };
}

// ---------- Update loop ----------

let editing = false;
let pendingRefresh = false;

async function updateConsolePanel(client, { footer, extraLines } = {}) {
  const channelId =
    process.env.FRESHWAY_CHANNEL_CONSOLE?.trim() || PANEL_CHANNEL_FALLBACK;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return null;

  const state = loadState();
  const isV2Panel = (m) =>
    m.author?.id === client.user.id &&
    m.flags?.has?.(MessageFlags.IsComponentsV2) &&
    (m.components ?? []).some((c) =>
      (c.components ?? []).some((b) => (b?.data?.custom_id ?? b?.customId)?.startsWith?.(POWER_PREFIX)),
    );

  let panel = null;
  if (state.messageId) {
    panel = (await channel.messages.fetch(state.messageId).catch(() => null)) ?? null;
  }
  if (!panel) {
    panel =
      [...(await channel.messages.fetch({ limit: 20 }).catch(() => new Map())).values()].find(
        isV2Panel,
      ) ?? null;
  }

  const payload = panelPayload({ state: await fetchPowerState(), footer, extraLines });
  if (panel) {
    const edited = await panel.edit(payload).then(() => true).catch(() => false);
    if (!edited) panel = null;
  }
  if (!panel) {
    panel = await channel.send(payload).catch((e) => {
      console.error("[ConsolePanel] Failed to post panel:", e?.message ?? e);
      return null;
    });
  }
  if (panel) {
    state.messageId = panel.id;
    saveState(state);
  }
  return panel;
}

/**
 * Live-update the panel (throttled). Extra lines are lines logged while we
 * were mid-edit last time, so nothing is lost.
 */
async function refreshConsolePanel(client) {
  if (!client?.isReady?.() || editing) {
    pendingRefresh = true;
    return;
  }
  editing = true;
  try {
    do {
      pendingRefresh = false;
      await updateConsolePanel(client);
      if (pendingRefresh) await new Promise((r) => setTimeout(r, EDIT_INTERVAL_MS));
    } while (pendingRefresh);
  } catch (e) {
    console.error("[ConsolePanel] refresh failed:", e?.message ?? e);
  } finally {
    editing = false;
  }
}

/** Start the periodic refresh loop (safe to call once at boot). */
function startConsolePanel(client) {
  installTee();
  if (startConsolePanel._started) return;
  startConsolePanel._started = true;

  // Periodic refresh: picks up new log lines + fresh power state.
  setInterval(() => refreshConsolePanel(client), EDIT_INTERVAL_MS).unref();

  // Full update (with state fetch) once a minute.
  setInterval(() => updateConsolePanel(client).catch(() => {}), 60000).unref();

  console.log("[ConsolePanel] Console panel loop started.");
  // Post the initial panel once the client is ready.
  if (client.isReady()) {
    updateConsolePanel(client).catch(() => {});
  } else {
    client.once("ready", () => updateConsolePanel(client).catch(() => {}));
  }
}

// ---------- Power button handler ----------

/** Handle a fw_power:<signal> button. Returns true if handled. */
async function handleConsolePowerButton(interaction) {
  const id = interaction.customId;
  if (!id.startsWith(POWER_PREFIX)) return false;
  const signal = id.slice(POWER_PREFIX.length);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (signal === "restart") {
    await interaction.editReply({
      content: `${E.schedule} Restarting: sending restart signal, then kill in ${RESTART_KILL_DELAY_MS / 1000}s (panel quirk)...`,
    });
    const first = await sendPowerSignal("restart");
    if (!first.ok) {
      await interaction.editReply({ content: `${E.cross} Restart signal failed: ${first.error}` });
      return true;
    }
    await new Promise((r) => setTimeout(r, RESTART_KILL_DELAY_MS));
    await sendPowerSignal("kill"); // panel hangs in "stopping" without this
    await interaction.editReply({
      content: `${E.check} Restart issued (restart + kill sent). The container's start script boots the bot again - expect a few minutes while it pulls code and installs.`,
    });
    return true;
  }

  const res = await sendPowerSignal(signal);
  if (res.ok) {
    await interaction.editReply({ content: `${E.check} Power signal \`${signal}\` sent to the panel.` });
  } else {
    await interaction.editReply({ content: `${E.cross} \`${signal}\` failed: ${res.error}` });
  }
  return true;
}

module.exports = {
  POWER_PREFIX,
  startConsolePanel,
  updateConsolePanel,
  refreshConsolePanel,
  handleConsolePowerButton,
};
