// Staff-case voting system (the /voting command, TM only).
//
// Flow:
//   1. A TM fills a form (reported person, reason, proof?) and the bot posts
//      a case embed to the voting channel with ✅ Support / ❌ Decline
//      buttons (Discord v2 components).
//   2. A discussion thread is created automatically and pings Training
//      Leadership, with Accept / Close the thread & deny it buttons.
//   3. Anyone clicks a vote button; the embed shows the live tally. When
//      either side reaches FRESHWAY_VOTE_THRESHOLD (default 5), the case
//      auto-resolves "according to public opinion" and the embed changes
//      color.
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
const VOTE_YES_PREFIX = "voting_yes:";
const VOTE_NO_PREFIX = "voting_no:";
const VOTE_MODAL_ID = "voting_modal";

// caseMessageId -> { reported, submittedBy, reason, proof, yes, no, resolved, threadId, controlsMessageId }
const cases = new Map();

function voteThreshold() {
  return config.voting.threshold();
}

function caseBaseDescription(caseData) {
  return [
    `> **Reported:** ${caseData.reported}`,
    `> **Reason:** ${caseData.reason}`,
    `> **Proof:** ${caseData.proof || "No"}`,
    `> **Submitted by:** ${caseData.submittedBy}`,
  ].join("\n");
}

function caseTallyLine(caseData) {
  return `> **Votes:** ${caseData.yes.size} support / ${caseData.no.size} decline (auto-resolves at **${voteThreshold()}**).`;
}

function caseStatusLine(caseData) {
  if (!caseData.resolved) return "";
  const verdict = caseData.declined
    ? caseData.decidedBy
      ? `Declined by **${caseData.decidedBy}**.`
      : "Declined according to public opinion."
    : caseData.decidedBy
      ? `Accepted by **${caseData.decidedBy}**.`
      : "Accepted according to public opinion.";
  return `> **Status:** ${verdict}`;
}

function buildCaseEmbed(caseData) {
  return buildEmbed({
    title: `Staff Case: ${caseData.reported.slice(0, 240)}`,
    description: [
      caseBaseDescription(caseData),
      "",
      caseTallyLine(caseData),
      caseStatusLine(caseData),
      "",
      "> Vote with the buttons below.",
    ]
      .filter(Boolean)
      .join("\n"),
    color: caseData.resolved ? (caseData.declined ? config.colors.red : FW_GREEN) : FW_GREEN,
  });
}

/** Action row with the public ✅ Support / ❌ Decline vote buttons. */
function buildVoteRow(caseId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${VOTE_YES_PREFIX}${caseId}`)
      .setLabel("✅ Support")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${VOTE_NO_PREFIX}${caseId}`)
      .setLabel("❌ Decline")
      .setStyle(ButtonStyle.Danger),
  );
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

/** Handle the /voting modal submission - create the case, thread and vote buttons. */
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

  const caseData = {
    reported,
    submittedBy: interaction.user.username,
    reason,
    proof,
    yes: new Set(),
    no: new Set(),
    resolved: false,
    declined: false,
    decidedBy: null,
    channelId,
    threadId: null,
    controlsMessageId: null,
  };

  const msg = await channel.send({ embeds: [buildCaseEmbed(caseData)] }).catch((e) => {
    console.error("[Voting] Failed to send case embed:", e);
    return null;
  });
  if (!msg) {
    return interaction.editReply({ content: "Failed to post the case - please check the bot's permissions." });
  }
  caseData.channelId = msg.channelId;
  caseData.messageId = msg.id;

  // Attach the vote buttons (the case id is the message id).
  await msg.edit({ embeds: [buildCaseEmbed(caseData)], components: [buildVoteRow(msg.id)] }).catch(() => {});

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

  caseData.threadId = thread?.id ?? null;
  caseData.controlsMessageId = controlsMessage?.id ?? null;
  cases.set(msg.id, caseData);

  console.log(`[Voting] Case opened by ${interaction.user.username} for ${reported} (${channelId})`);
  await interaction.editReply({
    content: `Case created for **${reported}** - voting is open in <#${channelId}> and a discussion thread was created.`,
  });
}

/** Handle a ✅ Support / ❌ Decline vote button click, then maybe auto-resolve. */
async function handleVoteButton(interaction) {
  const isYes = interaction.customId.startsWith(VOTE_YES_PREFIX);
  const caseId = interaction.customId.split(":")[1];

  await interaction.deferUpdate();

  const caseData = cases.get(caseId);
  if (!caseData || caseData.resolved) {
    return interaction.followUp({
      content: "This case is already closed (or the bot restarted).",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (isYes) {
    caseData.yes.add(interaction.user.id);
    caseData.no.delete(interaction.user.id);
  } else {
    caseData.no.add(interaction.user.id);
    caseData.yes.delete(interaction.user.id);
  }

  const t = voteThreshold();
  if (caseData.no.size >= t) {
    caseData.resolved = true;
    caseData.declined = true;
    await resolveCase(interaction.client, caseId, "declined");
  } else if (caseData.yes.size >= t) {
    caseData.resolved = true;
    caseData.declined = false;
    await resolveCase(interaction.client, caseId, "accepted");
  } else {
    await refreshCaseEmbed(interaction.client, caseId);
  }

  await interaction.followUp({
    content: `Your vote was recorded (${caseData.yes.size} support / ${caseData.no.size} decline).`,
    flags: MessageFlags.Ephemeral,
  });
}

/** Rebuild the case embed in the voting channel from live state. */
async function refreshCaseEmbed(client, messageId) {
  const caseData = cases.get(messageId);
  if (!caseData) return;
  try {
    const channel = await client.channels.fetch(caseData.channelId).catch(() => null);
    const msg = channel ? await channel.messages.fetch(messageId).catch(() => null) : null;
    if (msg) {
      await msg.edit({ embeds: [buildCaseEmbed(caseData)], components: [buildVoteRow(messageId)] });
    }
  } catch (e) {
    console.error("[Voting] Failed to refresh case embed:", e);
  }
}

/** Auto-resolve a case from public opinion - updates the embed + thread controls. */
async function resolveCase(client, messageId, outcome) {
  const caseData = cases.get(messageId);
  if (!caseData) return;
  caseData.resolved = true;
  caseData.declined = outcome === "declined";

  await refreshCaseEmbed(client, messageId);

  const statusText = caseData.declined ? "Case declined by vote" : "Case accepted by vote";
  await disableControls(client, caseData, messageId, statusText);
  console.log(
    `[Voting] Case ${messageId} auto-${outcome} (${caseData.yes.size} yes / ${caseData.no.size} no)`,
  );
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
  caseData.declined = !isAccept;
  caseData.decidedBy = interaction.user.username;

  await refreshCaseEmbed(interaction.client, caseId);

  await disableControls(interaction.client, caseData, caseId, caseData.declined ? "Case declined" : "Case accepted", {
    archiveThread: true,
  });

  console.log(`[Voting] Case ${caseId} ${caseData.declined ? "declined" : "accepted"} by ${interaction.user.username}`);
  await interaction.followUp({
    content: caseData.declined ? "Case closed and denied." : "Case accepted - the embed color has been updated.",
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = {
  VOTE_ACCEPT_PREFIX,
  VOTE_DENY_PREFIX,
  VOTE_YES_PREFIX,
  VOTE_NO_PREFIX,
  VOTE_MODAL_ID,
  handleVotingModal,
  handleVotingButton,
  handleVoteButton,
};
