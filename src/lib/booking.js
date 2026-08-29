// Training booking flow (the /training-booking command).
//
// The command opens an ephemeral message with a session-type select menu
// (Discord v2 component) and a Cancel button. Choosing a type opens the
// booking modal (title, when, game link, description, max participants).
// On submit the session is created in Supabase and the live boards are
// refreshed - the same system the portal uses.

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const { getSupabase } = require("./supabase");
const { notifySessionCreated } = require("./notifications");

const SESSION_TYPES = ["Training", "Store Shift", "Promotional Shift", "Community Event"];

const BOOKING_SELECT_ID = "booking_type_select";
const BOOKING_CANCEL_ID = "booking_cancel";
const BOOKING_MODAL_ID = "booking_modal"; // actual id is `booking_modal:<type>`

/** Action rows for the booking prompt: select menu + cancel button (separate rows, because a select menu fills its row). */
function buildBookingRows() {
  const select = new StringSelectMenuBuilder()
    .setCustomId(BOOKING_SELECT_ID)
    .setPlaceholder("Choose a session type")
    .addOptions(SESSION_TYPES.map((t) => ({ label: t, value: t })));
  const cancel = new ButtonBuilder()
    .setCustomId(BOOKING_CANCEL_ID)
    .setLabel("Cancel")
    .setStyle(ButtonStyle.Secondary);
  return [
    new ActionRowBuilder().addComponents(select),
    new ActionRowBuilder().addComponents(cancel),
  ];
}

/** Build the booking modal; the session type rides in the custom id. */
function buildBookingModal(sessionType) {
  const modal = new ModalBuilder()
    .setCustomId(`${BOOKING_MODAL_ID}:${sessionType}`)
    .setTitle(`Book ${sessionType}`);

  const title = new TextInputBuilder()
    .setCustomId("b_title")
    .setLabel("Session title")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);
  const when = new TextInputBuilder()
    .setCustomId("b_when")
    .setLabel("Date and time (e.g. 2026-08-25 18:00 UTC)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false);
  const gameLink = new TextInputBuilder()
    .setCustomId("b_game_link")
    .setLabel("Roblox game link")
    .setStyle(TextInputStyle.Short)
    .setRequired(false);
  const description = new TextInputBuilder()
    .setCustomId("b_description")
    .setLabel("Short description")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(500);
  const max = new TextInputBuilder()
    .setCustomId("b_max")
    .setLabel("Max participants (a number)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(title),
    new ActionRowBuilder().addComponents(when),
    new ActionRowBuilder().addComponents(gameLink),
    new ActionRowBuilder().addComponents(description),
    new ActionRowBuilder().addComponents(max),
  );
  return modal;
}

/** Recover the session type from the modal custom id. */
function typeFromModalCustomId(customId) {
  const t = customId.slice(BOOKING_MODAL_ID.length + 1);
  return SESSION_TYPES.includes(t) ? t : "Training";
}

/** Select handler: validate the type and open the booking modal. */
async function handleBookingSelect(interaction) {
  const sessionType = interaction.values?.[0];
  if (!sessionType || !SESSION_TYPES.includes(sessionType)) {
    return interaction.reply({
      content: "Invalid session type selected.",
      flags: MessageFlags.Ephemeral,
    });
  }
  await interaction.showModal(buildBookingModal(sessionType));
}

/** Cancel button: close the ephemeral booking prompt. */
async function handleBookingCancel(interaction) {
  await interaction.update({
    content: "Booking cancelled.",
    embeds: [],
    components: [],
  });
}

/** Modal submit: create the session and refresh the boards. */
async function handleBookingModal(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const title = interaction.fields.getTextInputValue("b_title").trim();
  if (!title) {
    return interaction.editReply({ content: "A session title is required." });
  }

  const sb = getSupabase();
  if (!sb) {
    return interaction.editReply({ content: "Supabase is not configured on this bot - cannot create sessions." });
  }

  const whenRaw = interaction.fields.getTextInputValue("b_when").trim();
  const gameLink = interaction.fields.getTextInputValue("b_game_link").trim();
  const description = interaction.fields.getTextInputValue("b_description").trim();
  const maxRaw = interaction.fields.getTextInputValue("b_max").trim();

  let scheduledAt = null;
  if (whenRaw) {
    const parsed = new Date(whenRaw);
    if (!Number.isNaN(parsed.getTime())) scheduledAt = parsed.toISOString();
  }

  let maxParticipants = null;
  if (maxRaw) {
    const n = parseInt(maxRaw, 10);
    if (Number.isFinite(n) && n >= 1) maxParticipants = n;
  }

  // Host defaults to the user who booked it.
  let hostUserId = null;
  let hostName = "";
  try {
    const { data: profile } = await sb
      .from("profiles")
      .select("id, discord_username")
      .eq("discord_id", interaction.user.id)
      .maybeSingle();
    hostUserId = profile?.id ?? null;
    if (hostUserId) {
      const { data: roblox } = await sb
        .from("roblox_accounts")
        .select("roblox_username")
        .eq("user_id", hostUserId)
        .maybeSingle();
      hostName = roblox?.roblox_username ?? profile?.discord_username ?? "";
    }
  } catch (e) {
    console.error("[Booking] Failed to resolve host profile:", e?.message ?? e);
  }

  const sessionType = typeFromModalCustomId(interaction.customId);

  let session = null;
  let error = null;
  try {
    const result = await sb
      .from("training_sessions")
      .insert({
        title,
        session_type: sessionType,
        host_user_id: hostUserId,
        description: description || null,
        roblox_game_link: gameLink || null,
        scheduled_at: scheduledAt,
        max_participants: maxParticipants,
        status: "scheduled",
      })
      .select("id, title, scheduled_at")
      .single();
    session = result.data;
    error = result.error;
  } catch (e) {
    error = e;
  }

  if (error || !session) {
    return interaction.editReply({
      content: `Failed to create the session: ${error?.message ?? "unknown error"}`,
    });
  }

  // Ask the website to sync the new session to Trello. Trello credentials stay
  // on the website and are never stored on or required by the bot.
  try {
    const base = process.env.FRESHWAY_SITE_URL?.trim().replace(/\/+$/, "");
    const secret = process.env.FRESHWAY_BOT_API_SECRET?.trim();
    if (!base || !secret) {
      console.warn("[Booking] FRESHWAY_SITE_URL / FRESHWAY_BOT_API_SECRET not set - skipping website Trello sync");
    } else {
      const trelloResponse = await fetch(`${base}/api/training/trello-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-bot-secret": secret },
        body: JSON.stringify({
          sessionId: session.id,
          title,
          hostName,
          gameLink: gameLink || null,
          description: description || null,
          scheduledAt,
        }),
      });
      if (!trelloResponse.ok) {
        console.error(`[Booking] Website Trello sync returned HTTP ${trelloResponse.status}`);
      }
    }
  } catch (e) {
    console.error("[Booking] Website Trello sync failed:", e?.message ?? e);
  }

  await notifySessionCreated(interaction.client, session.id);

  await interaction.editReply({
    content: `Session booked - **${session.title}** (${sessionType})${scheduledAt ? ` at ${new Date(scheduledAt).toLocaleString()}` : " (unscheduled)"}. It's now on the trainings board.`,
  });
}

module.exports = {
  SESSION_TYPES,
  BOOKING_SELECT_ID,
  BOOKING_CANCEL_ID,
  BOOKING_MODAL_ID,
  buildBookingRows,
  buildBookingModal,
  handleBookingSelect,
  handleBookingCancel,
  handleBookingModal,
};
