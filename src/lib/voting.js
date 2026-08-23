// Staff-case voting system (the /voting command, TM only).
//
// Flow:
//   1. A TM fills a form (reported person, reason, proof?) and the bot posts
//      a case embed to the voting channel with ✅ / ❌ reactions.
//   2. A discussion thread is created automatically and pings Training
//      Leadership, with Accept / Close the thread & deny it buttons.
//   3. Members vote with the reactions. When either side reaches
//      FRESHWAY_VOTE_THRESHOLD (default 5), the case auto-resolves
//      "according to public opinion" and the embed changes color.
//   4. Training Leadership can decide at any time with the thread buttons.

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");
const config = require("../config");
const { buildEmbed, FW_GREEN } = require("./embeds");
const { canLead } = require("./guards");

const VOTE_ACCEPT_PREFIX = "voting_accept:";
const VOTE_DENY_PREFIX = "voting_deny:";
const VOTE_MODAL_ID = "voting_modal";

const YES = "✅";
const NO = "❌";

// caseMessageId -> { reported, submittedBy, reason, proof, yes, no, resolved, threadId, controlsMessageId }
const cases = new Map();

function voteThreshold() {
  return config.voting.threshold();
}

/** Action row with the Training-Leadership-only case controls. */
function buildControlsRow(caseId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${VOTE_ACCEPT_PREFIX}${caseId}`)
      .setLabel("Accept")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${VOTE_DENY_PREFIX}${caseId}`)
      .setLabel("Close the thread & deny it")
      .setStyle(ButtonStyle.Danger),
  );
}

/** Handle the /voting modal submission - create the case, thread and reactions. */
async function handleVotingModal(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const reported = interaction.fields.getTextInputValue("v_report_subject").trim();
  const reason = interaction.fields.getTextInputValue("v_report_reason").trim();
  const proof = interaction.fields.getTextInputValue("v_report_proof").trim();

  const channelId = config.channels.voting();
  if (!channelId) {
    return interaction.editReply({ content: "The voting channel is not configured (FRESHWAY_CHANNEL_VOTING)." });
  }
  const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    return interaction.editReply({ content: "The voting channel could not be found." });
  }

  const embed = buildEmbed({
    title: `Staff Case: ${reported.slice(0, 240)}`,
    description: [
      `> **Reported:** ${reported}`,
      `> **Reason:** ${reason}`,
      `> **Proof:** ${proof || "No"}`,
      `> **Submitted by:** ${interaction.user.username}`,
      "",
      `> React with ${YES} to support or ${NO} to decline.`,
      `> The case auto-resolves once either side reaches **${voteThreshold()}** votes.`,
    ].join("\n"),
  });

  const msg = await channel.send({ embeds: [embed] }).catch((e) => {
    console.error("[Voting] Failed to send case embed:", e);
    return null;
  });
  if (!msg) {
    return interaction.editReply({ content: "Failed to post the case - please check the bot's permissions." });
  }

  await msg.react(YES).catch(() => {});
  await msg.react(NO).catch(() => {});

  // Automatic discussion thread pinging Training Leadership.
  let thread = null;
  let controlsMessage = null;
  try {
    thread = await msg.startThread({
      name: `Case - ${reported}`.slice(0, 100),
      autoArchiveDuration: 1440, // 24 hours
      reason: `Case opened by ${interaction.user.username}`,
    });
    const leadershipId = config.roles.trainingLeadership();
    controlsMessage = await thread
      .send({
        content: leadershipId
          ? `<@&${leadershipId}> A new staff case has been opened.`
          : "Training Leadership only.",
        embeds: [
          buildEmbed({
            title: "Case Controls",
            description:
              "> **Accept** approves the case and changes the embed color.\n> **Close the thread & deny it** rejects the case and closes this thread.",
          }),
        ],
        components: [buildControlsRow(msg.id)],
      })
      .catch(() => null);
  } catch (e) {
    console.error("[Voting] Failed to create thread:", e);
  }

  cases.set(msg.id, {
    reported,
    submittedBy: interaction.user.username,
    reason,
    proof,
    yes: new Set(),
    no: new Set(),
    resolved: false,
    channelId,
    threadId: thread?.id ?? null,
    controlsMessageId: controlsMessage?.id ?? null,
  });

  console.log(`[Voting] Case opened by ${interaction.user.username} for ${reported} (${channelId})`);
  await interaction.editReply({
    content: `Case created for **${reported}** - voting is open in <#${channelId}> and a discussion thread was created.`,
  });
}

/** Count a ✅/❌ reaction and auto-resolve the case when a side hits the threshold. */
async function handleVoteReaction(reaction, user) {
  if (user.bot) return;

  const caseData = cases.get(reaction.message.id);
  if (!caseData || caseData.resolved) return;

  const emoji = reaction.emoji?.name;
  if (emoji !== YES && emoji !== NO) return;

  if (emoji === YES) {
    caseData.yes.add(user.id);
    caseData.no.delete(user.id);
  } else {
    caseData.no.add(user.id);
    caseData.yes.delete(user.id);
  }

  const t = voteThreshold();
  if (caseData.no.size >= t) {
    await resolveCase(reaction.client, reaction.message.id, "declined");
  } else if (caseData.yes.size >= t) {
    await resolveCase(reaction.client, reaction.message.id, "accepted");
  }
}

/** Auto-resolve a case from public opinion - updates the embed + thread controls. */
async function resolveCase(client, messageId, outcome) {
  const caseData = cases.get(messageId);
  if (!caseData || caseData.resolved) return;
  caseData.resolved = true;

  const declined = outcome === "declined";
  const statusLine = declined
    ? "> **Status:** Declined according to public opinion."
    : "> **Status:** Accepted according to public opinion.";

  // Update the case embed in the voting channel.
  try {
    const channel = await client.channels.fetch(caseData.channelId).catch(() => null);
    const msg = channel ? await channel.messages.fetch(messageId).catch(() => null) : null;
    if (msg && msg.embeds?.[0]) {
      const embed = msg.embeds[0].toJSON();
      embed.color = declined ? config.colors.red : FW_GREEN;
      embed.description = `${embed.description ?? ""}\n\n${statusLine}`;
      embed.footer = { text: declined ? "Case declined" : "Case accepted" };
      await msg.edit({ embeds: [embed] });
    }
  } catch (e) {
    console.error("[Voting] Failed to update case embed:", e);
  }

  await disableControls(client, caseData, messageId, declined ? "Case declined by vote" : "Case accepted by vote");
  console.log(`[Voting] Case ${messageId} auto-${outcome} (${caseData.yes.size} yes / ${caseData.no.size} no)`);
}

/** Disable the thread controls (and optionally archive the thread). */
async function disableControls(client, caseData, messageId, statusText, { archiveThread } = {}) {
  if (!caseData.threadId || !caseData.controlsMessageId) return;
  try {
    const thread = await client.channels.fetch(caseData.threadId).catch(() => null);
    if (!thread) return;
    const controls = await thread.messages.fetch(caseData.controlsMessageId).catch(() => null);
    if (controls) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${VOTE_ACCEPT_PREFIX}${messageId}`)
          .setLabel("Accept")
          .setStyle(ButtonStyle.Success)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(`${VOTE_DENY_PREFIX}${messageId}`)
          .setLabel("Close the thread & deny it")
          .setStyle(ButtonStyle.Danger)
          .setDisabled(true),
      );
      await controls.edit({
        embeds: [buildEmbed({ title: "Case Controls", description: `> ${statusText}` })],
        components: [row],
      });
    }
    if (archiveThread && thread.archivable) {
      await thread.setArchived(true, statusText).catch(() => {});
    }
  } catch (e) {
    console.error("[Voting] Failed to disable case controls:", e);
  }
}

/** Handle the Accept / Close the thread & deny it buttons (Training Leadership only). */
async function handleVotingButton(interaction) {
  const isAccept = interaction.customId.startsWith(VOTE_ACCEPT_PREFIX);
  const caseId = interaction.customId.split(":")[1];

  await interaction.deferUpdate();

  const caseData = cases.get(caseId);
  if (!caseData) {
    return interaction.followUp({
      content: "Case data is no longer available (the bot may have restarted).",
      flags: MessageFlags.Ephemeral,
    });
  }
  if (!canLead(interaction)) {
    return interaction.followUp({
      content: "Only Training Leadership can decide a case.",
      flags: MessageFlags.Ephemeral,
    });
  }
  if (caseData.resolved) {
    return interaction.followUp({ content: "This case has already been decided.", flags: MessageFlags.Ephemeral });
  }
  caseData.resolved = true;

  const declined = !isAccept;
  const statusLine = declined
    ? `> **Status:** Declined by **${interaction.user.username}**.`
    : `> **Status:** Accepted by **${interaction.user.username}**.`;

  try {
    const channel = await interaction.client.channels.fetch(caseData.channelId).catch(() => null);
    const msg = channel ? await channel.messages.fetch(caseId).catch(() => null) : null;
    if (msg && msg.embeds?.[0]) {
      const embed = msg.embeds[0].toJSON();
      embed.color = declined ? config.colors.red : FW_GREEN;
      embed.description = `${embed.description ?? ""}\n\n${statusLine}`;
      embed.footer = { text: declined ? "Case declined" : "Case accepted" };
      await msg.edit({ embeds: [embed] });
    }
  } catch (e) {
    console.error("[Voting] Failed to update case embed:", e);
  }

  await disableControls(interaction.client, caseData, caseId, declined ? "Case declined" : "Case accepted", {
    archiveThread: true,
  });

  console.log(`[Voting] Case ${caseId} ${declined ? "declined" : "accepted"} by ${interaction.user.username}`);
  await interaction.followUp({
    content: declined ? "Case closed and denied." : "Case accepted - the embed color has been updated.",
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = {
  VOTE_ACCEPT_PREFIX,
  VOTE_DENY_PREFIX,
  VOTE_MODAL_ID,
  handleVotingModal,
  handleVotingButton,
  handleVoteReaction,
};
