// [moderation]
// Host control panel - when the session HOST presses Manage, the bot DMs
// them a private control panel instead of the in-channel join menu.
//
// From the DM the host can:
//   - change the session status (select menu)
//   - change the scheduled time (modal)
//   - change the session type (modal)
//   - cancel (delete) the session
//
// Every change updates Supabase, refreshes the live boards, notifies
// per-session subscribers and logs to the logs channel. Non-hosts still get
// the normal Join as Co-Host/Helper ephemeral menu in-channel.

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
const { sendDiscordDm } = require("./dms");
const { buildEmbed } = require("./embeds");
const boards = require("./boards");
const config = require("../config");
const { sendLogEmbed } = require("./channels");
const E = require("./emojis");

const HOST_STATUS_PREFIX = "host_status:"; // + sessionId (select menu)
const HOST_TIME_PREFIX = "host_time:"; // + sessionId (button -> modal)
const HOST_TYPE_PREFIX = "host_type:"; // + sessionId (button -> modal)
const HOST_CANCEL_PREFIX = "host_cancel:"; // + sessionId (button)
const HOST_TIME_MODAL = "host_time_modal:"; // + sessionId
const HOST_TYPE_MODAL = "host_type_modal:"; // + sessionId

const STATUS_OPTIONS = [
  { label: "Pending", value: "pending" },
  { label: "Scheduled", value: "scheduled" },
  { label: "Ongoing", value: "ongoing" },
  { label: "Completed", value: "completed" },
];

function unixTimestamp(iso) {
  return iso ? `<t:${Math.floor(new Date(iso).getTime() / 1000)}:F>` : "Not scheduled";
}

// ---------- Audit log ----------

const HOST_CANCEL_CONFIRM_PREFIX = "host_cancel_confirm:"; // second-step id

/** Audit entry for a host action (best-effort, goes to the logs channel). */
async function auditHostAction(client, { hostTag, sessionTitle, action, detail }) {
  await sendLogEmbed(
    client,
    `${E.moderation} Host Action: ${action}`,
    [
      `> ${E.security} **Host:** ${hostTag}`,
      `> ${E.training} **Session:** ${sessionTitle}`,
      `> ${E.pencil} **Action:** ${detail}`,
    ].join("\n"),
  );
}

// ---------- Host detection ----------

/** The Discord ids of the session's host (via profiles.discord_id). */
async function resolveHostDiscordId(sb, hostUserId) {
  if (!hostUserId) return null;
  const { data: profile } = await sb
    .from("profiles")
    .select("discord_id")
    .eq("id", hostUserId)
    .maybeSingle();
  return profile?.discord_id ?? null;
}

/** Is this Discord user the host of the session? */
async function isSessionHost(sb, sessionId, discordId) {
  try {
    const { data: session } = await sb
      .from("training_sessions")
      .select("host_user_id")
      .eq("id", sessionId)
      .maybeSingle();
    if (!session?.host_user_id) return false;
    const hostDiscordId = await resolveHostDiscordId(sb, session.host_user_id);
    return hostDiscordId === String(discordId);
  } catch (e) {
    console.error("[HostPanel] isSessionHost failed:", e?.message ?? e);
    return false;
  }
}

// ---------- DM control panel ----------

function buildControlRows(sessionId) {
  const statusSelect = new StringSelectMenuBuilder()
    .setCustomId(HOST_STATUS_PREFIX + sessionId)
    .setPlaceholder("Change shift status")
    .addOptions(STATUS_OPTIONS.map((o) => ({ label: o.label, value: o.value })));
  const row1 = new ActionRowBuilder().addComponents(statusSelect);
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(HOST_TIME_PREFIX + sessionId)
      .setLabel("Change Time")
      .setEmoji(E.parse(E.time))
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(HOST_TYPE_PREFIX + sessionId)
      .setLabel("Change Type")
      .setEmoji(E.parse(E.tag))
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(HOST_CANCEL_PREFIX + sessionId)
      .setLabel("Cancel Session")
      .setEmoji(E.parse(E.warning))
      .setStyle(ButtonStyle.Danger),
  );
  return [row1, row2];
}

/**
 * DM the session host their control panel. Called when the host presses the
 * Manage button. Returns { sent, reason }.
 */
async function sendHostControlPanel(client, sessionId, hostDiscordId, session) {
  if (!hostDiscordId) return { sent: false, reason: "host not linked to a Discord account" };
  const time = unixTimestamp(session.scheduled_at);
  const description = [
    `> ${E.security} **Session:** ${session.title}`,
    `> ${E.time} **When:** ${time}`,
    session.session_type ? `> ${E.tag} **Type:** ${session.session_type}` : "",
    "",
    "> Use the controls below to manage your session. Boards update automatically.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const user = await client.users.fetch(String(hostDiscordId)).catch(() => null);
    if (!user) return { sent: false, reason: "host user not found" };
    await user.send({
      embeds: [buildEmbed({ title: `${E.moderation} Manage: ${session.title}`, description })],
      components: buildControlRows(sessionId),
    });
    console.log(`[HostPanel] Control panel DMed to ${hostDiscordId} for ${sessionId}`);
    return { sent: true };
  } catch (e) {
    console.error(`[HostPanel] Failed to DM host ${hostDiscordId}:`, e?.message ?? e);
    return { sent: false, reason: "DM failed (closed DMs?)" };
  }
}

// ---------- Board refresh + subscriber notify after a change ----------

async function afterChange(client, sessionId, extra) {
  await Promise.all([
    boards.updateTrainingsBoard(client).catch(() => {}),
    boards.updateTimetableBoard(client).catch(() => {}),
    require("./public-board").updatePublicBoard(client).catch(() => {}),
  ]);
  if (extra?.notify) {
    await require("./notifications").notifySessionStatusChanged(
      client,
      sessionId,
      extra.oldStatus ?? "unknown",
      extra.newStatus ?? "unknown",
    );
  }
}

// ---------- Interaction handlers ----------

/** Status select change. */
async function handleHostStatus(interaction, sessionId) {
  const newStatus = interaction.values?.[0];
  const sb = getSupabase();
  if (!sb) return interaction.editReply({ content: `${E.cross} Database unavailable.`, components: [] });

  const { data: session } = await sb
    .from("training_sessions")
    .select("title, status")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) {
    return interaction.editReply({ content: `${E.cross} That session no longer exists.`, components: [] });
  }

  const { error } = await sb
    .from("training_sessions")
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq("id", sessionId);
  if (error) {
    console.error("[HostPanel] status update failed:", error.message);
    return interaction.editReply({ content: `${E.cross} Failed to update status.`, components: [] });
  }

  await interaction.editReply({
    content: `${E.check} Status updated to **${newStatus}** for **${session.title}**.`,
    components: [],
  });
  await auditHostAction(interaction.client, {
    hostTag: `<@${interaction.user.id}>`,
    sessionTitle: session.title,
    action: "Status Change",
    detail: `${session.status} → ${newStatus}`,
  });
  // Board refresh + subscriber DMs happen AFTER the user gets a reply.
  await afterChange(interaction.client, sessionId, {
    notify: true,
    oldStatus: session.status,
    newStatus,
  });
  return true;
}

/** "Change Time" button -> open modal. */
async function handleHostTimeButton(interaction, sessionId) {
  const modal = new ModalBuilder()
    .setCustomId(HOST_TIME_MODAL + sessionId)
    .setTitle("Change session time")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("host_time_value")
          .setLabel("When (e.g. 2026-09-30 18:00 UTC)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
    );
  await interaction.showModal(modal);
  return true;
}

/** Time modal submit. */
async function handleHostTimeModal(interaction, sessionId) {
  const raw = interaction.fields.getTextInputValue("host_time_value")?.trim();
  const when = new Date(raw);
  if (Number.isNaN(when.getTime())) {
    return interaction.reply({
      content: `${E.cross} Could not parse that date. Use e.g. \`2026-09-30 18:00 UTC\`.`,
      flags: MessageFlags.Ephemeral,
    });
  }
  const sb = getSupabase();
  const { data: session } = await sb
    .from("training_sessions")
    .select("title")
    .eq("id", sessionId)
    .maybeSingle();
  const { error } = await sb
    .from("training_sessions")
    .update({ scheduled_at: when.toISOString(), updated_at: new Date().toISOString() })
    .eq("id", sessionId);
  if (error) {
    return interaction.reply({ content: `${E.cross} Failed to update time.`, flags: MessageFlags.Ephemeral });
  }
  await afterChange(interaction.client, sessionId, { notify: true });
  await interaction.reply({
    content: `${E.check} **${session?.title ?? "Session"}** is now scheduled for <t:${Math.floor(when.getTime() / 1000)}:F>.`,
    flags: MessageFlags.Ephemeral,
  });
  await auditHostAction(interaction.client, {
    hostTag: `<@${interaction.user.id}>`,
    sessionTitle: session?.title ?? "Session",
    action: "Time Change",
    detail: `New time: ${when.toISOString()}`,
  });
  return true;
}

/** "Change Type" button -> open modal. */
async function handleHostTypeButton(interaction, sessionId) {
  const modal = new ModalBuilder()
    .setCustomId(HOST_TYPE_MODAL + sessionId)
    .setTitle("Change session type")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("host_type_value")
          .setLabel("Session type")
          .setStyle(TextInputStyle.Short)
          .setValue("Store Colleague Training")
          .setRequired(true),
      ),
    );
  await interaction.showModal(modal);
  return true;
}

/** Type modal submit. */
async function handleHostTypeModal(interaction, sessionId) {
  const newType = interaction.fields.getTextInputValue("host_type_value")?.trim();
  const sb = getSupabase();
  const { data: session } = await sb
    .from("training_sessions")
    .select("title")
    .eq("id", sessionId)
    .maybeSingle();
  const { error } = await sb
    .from("training_sessions")
    .update({ session_type: newType, updated_at: new Date().toISOString() })
    .eq("id", sessionId);
  if (error) {
    return interaction.reply({ content: `${E.cross} Failed to update type.`, flags: MessageFlags.Ephemeral });
  }
  await afterChange(interaction.client, sessionId, {});
  await interaction.reply({
    content: `${E.check} **${session?.title ?? "Session"}** type updated to **${newType}**.`,
    flags: MessageFlags.Ephemeral,
  });
  await auditHostAction(interaction.client, {
    hostTag: `<@${interaction.user.id}>`,
    sessionTitle: session?.title ?? "Session",
    action: "Type Change",
    detail: `New type: ${newType}`,
  });
  return true;
}

/** "Cancel Session" button: first press asks for confirmation. */
async function handleHostCancel(interaction, sessionId) {
  const sb = getSupabase();
  if (!sb) return interaction.editReply({ content: `${E.cross} Database unavailable.`, components: [] });

  const { data: session } = await sb
    .from("training_sessions")
    .select("title, host_user_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) {
    return interaction.editReply({ content: `${E.cross} That session no longer exists.`, components: [] });
  }

  // Step 1: ask for confirmation (destructive action).
  const confirmId = HOST_CANCEL_CONFIRM_PREFIX + sessionId;
  if (!interaction.customId.startsWith(HOST_CANCEL_CONFIRM_PREFIX)) {
    await interaction.editReply({
      content: `${E.warning} Are you sure you want to cancel **${session.title}**? This removes it from all boards and notifies subscribers.`,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(confirmId)
            .setLabel("Yes, cancel it")
            .setEmoji(E.parse(E.warning))
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId("host_cancel_abort")
            .setLabel("Keep session")
            .setStyle(ButtonStyle.Secondary),
        ),
      ],
    });
    return true;
  }

  // Step 2: confirmed - delete.

  const { error } = await sb.from("training_sessions").delete().eq("id", sessionId);
  if (error) {
    console.error("[HostPanel] cancel failed:", error.message);
    return interaction.editReply({ content: `${E.cross} Failed to cancel the session.`, components: [] });
  }

  await interaction.editReply({
    content: `${E.check} **${session.title}** has been cancelled and removed from all boards.`,
    components: [],
  });
  await auditHostAction(interaction.client, {
    hostTag: `<@${interaction.user.id}>`,
    sessionTitle: session.title,
    action: "Session Cancelled",
    detail: "Session deleted permanently",
  });

  await Promise.all([
    boards.updateTrainingsBoard(interaction.client).catch(() => {}),
    boards.updateTimetableBoard(interaction.client).catch(() => {}),
    require("./public-board").updatePublicBoard(interaction.client).catch(() => {}),
  ]);
  await require("./notifications").notifySessionDeleted(
    interaction.client,
    sessionId,
    session.title,
    interaction.user.username,
  );
  return true;
}

/** Route a host-panel interaction; returns true if it was one of ours. */
async function handleHostPanelInteraction(interaction) {
  const id = interaction.customId;
  const sb = getSupabase();
  if (!sb) return false;

  const takeSessionId = (prefix) => (id.startsWith(prefix) ? id.slice(prefix.length) : null);

  // "Keep session" abort button inside the cancel confirmation.
  if (id === "host_cancel_abort") {
    await interaction.editReply({
      content: `${E.check} Cancelled the cancellation - your session is untouched.`,
      components: [],
    });
    return true;
  }

  const sessionId =
    takeSessionId(HOST_STATUS_PREFIX) ??
    takeSessionId(HOST_TIME_PREFIX) ??
    takeSessionId(HOST_TYPE_PREFIX) ??
    takeSessionId(HOST_CANCEL_PREFIX) ??
    takeSessionId(HOST_CANCEL_CONFIRM_PREFIX) ??
    (id.startsWith(HOST_TIME_MODAL) ? id.slice(HOST_TIME_MODAL.length) : null) ??
    (id.startsWith(HOST_TYPE_MODAL) ? id.slice(HOST_TYPE_MODAL.length) : null);
  if (!sessionId) return false;

  const isModal = interaction.isModalSubmit?.();

  // Acknowledge IMMEDIATELY - Discord kills interactions that are not
  // acknowledged within 3 seconds. Modal submits that open another modal are
  // the exception (showModal acknowledges on its own).
  if (!isModal) {
    if (id.startsWith(HOST_STATUS_PREFIX) || id.startsWith(HOST_CANCEL_PREFIX)) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    } else if (!interaction.replied && !interaction.deferred) {
      await interaction.deferUpdate().catch(() => {});
    }
  }

  // Authorisation: only the session's host may use these controls.
  const host = await isSessionHost(sb, sessionId, interaction.user.id);
  if (!host) {
    if (!interaction.replied && !interaction.deferred) {
      await interaction
        .reply({
          content: `${E.cross} Only the session host can use these controls.`,
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    } else {
      await interaction
        .editReply({ content: `${E.cross} Only the session host can use these controls.`, components: [] })
        .catch(() => {});
    }
    return true;
  }

  if (id.startsWith(HOST_STATUS_PREFIX)) {
    await handleHostStatus(interaction, sessionId);
  } else if (id.startsWith(HOST_TIME_PREFIX)) {
    await handleHostTimeButton(interaction, sessionId);
  } else if (id.startsWith(HOST_TYPE_PREFIX)) {
    await handleHostTypeButton(interaction, sessionId);
  } else if (id.startsWith(HOST_CANCEL_PREFIX)) {
    await handleHostCancel(interaction, sessionId);
  } else if (id.startsWith(HOST_TIME_MODAL)) {
    await handleHostTimeModal(interaction, sessionId);
  } else if (id.startsWith(HOST_TYPE_MODAL)) {
    await handleHostTypeModal(interaction, sessionId);
  }
  return true;
}

module.exports = {
  sendHostControlPanel,
  handleHostPanelInteraction,
  isSessionHost,
};
