// Training Division verification system.
//
// Flow:
//   1. A welcome embed with a "Verify & Authorization" button lives in the
//      verification channel (auto-posted on startup if missing, or via
//      /verify-setup).
//   2. Clicking the button opens an application modal (name/roblox/discord,
//      invited by, requested rank, proof link).
//   3. On submit the user is told the request is reviewed within 12-24 hours
//      and is DM'd; if they left proof blank they get 10 minutes to send a
//      screenshot in DMs.
//   4. The submission is posted to the review channel with the proof and
//      Accept / Fail buttons; Training Leadership is pinged.
//   5. Accept assigns the requested rank role and DMs the user. Fail DMs the
//      user. Both remove the buttons so a duplicate cannot be submitted while
//      one request is still pending.

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const config = require("../config");
const { buildEmbed, FW_GREEN } = require("./embeds");
const { sendDiscordDm } = require("./dms");
const { canLead } = require("./guards");

const VERIFY_BUTTON_ID = "verify_authorize";
const VERIFY_ACCEPT_PREFIX = "verify_accept:";
const VERIFY_FAIL_PREFIX = "verify_fail:";
const VERIFY_MODAL_ID = "verification_modal";

const PROOF_DM_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// In-memory pending submissions (also re-checked against the review channel
// so a bot restart does not let someone submit twice).
const pendingUsers = new Map();

/** The exact welcome copy from Training Leadership. */
function welcomeDescription() {
  return [
    "Welcome dear member! Here in the Training Division there are dedicated people with the number one point of synthesizing and training new staff to reach and show their maximum capabilities. As a trainer here you will have more responsibilities that will be discussed further.",
    "",
    "> Therefore, to continue to our verification please click the button below \"Verify & Authorization\" and continue with what is said in the form. If you are and have been invited please add the proof so that the security rate is maximum and to ensure that your request will be accepted.",
    "",
    "If you are a Directory Member please put the rank \"Directory\" if you are or invited and have passed our application/interview or have been handpicked please choose the rank \"Trainer\". Once you have submitted our Training Leadership will be pinged as quickly as possible for this request to be accepted. Thank you once again for choosing FreshWay!  <:vacancies:1525786469342511135>",
  ].join("\n");
}

function buildWelcomeEmbed() {
  return buildEmbed({ title: "FreshWay | Training Division", description: welcomeDescription() });
}

function buildWelcomeRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(VERIFY_BUTTON_ID)
      .setLabel("Verify & Authorization")
      .setStyle(ButtonStyle.Primary),
  );
}

/**
 * Make sure the welcome embed exists in the verification channel.
 * Posts it only when no bot message with the verify button is already there.
 */
async function ensureVerification(client) {
  const channelId = config.channels.verification();
  if (!channelId) {
    console.warn("[Verify] No verification channel configured (FRESHWAY_CHANNEL_VERIFICATION)");
    return false;
  }
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    console.warn(`[Verify] Verification channel ${channelId} not found or not a text channel`);
    return false;
  }
  try {
    const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
    const existing = messages
      ? [...messages.values()].find(
          (m) =>
            m.author?.id === client.user.id &&
            m.components?.some((row) => row.components?.some((b) => b.customId === VERIFY_BUTTON_ID)),
        )
      : null;
    if (existing) {
      console.log(`[Verify] Verification embed already present in ${channelId}`);
      return true;
    }
    await channel.send({ embeds: [buildWelcomeEmbed()], components: [buildWelcomeRow()] });
    console.log(`[Verify] Verification embed posted to ${channelId}`);
    return true;
  } catch (e) {
    console.error("[Verify] Failed to ensure verification embed:", e);
    return false;
  }
}

// ---------- Application form ----------

function buildVerificationModal() {
  const modal = new ModalBuilder().setCustomId(VERIFY_MODAL_ID).setTitle("FreshWay Verification");
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("v_name")
        .setLabel("1. Name, Roblox & Discord username")
        .setStyle(TextInputStyle.Short)
        .setRequired(true),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("v_invite")
        .setLabel("2. Who invited you & for what purpose?")
        .setStyle(TextInputStyle.Short)
        .setRequired(true),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("v_rank")
        .setLabel("3. Rank: Trainer or Directory?")
        .setStyle(TextInputStyle.Short)
        .setRequired(true),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("v_proof")
        .setLabel("4. Proof of invitation (image link)")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setPlaceholder("Paste an image link or type 'none'"),
    ),
  );
  return modal;
}

async function handleVerifyButton(interaction) {
  await interaction.showModal(buildVerificationModal());
}

/** True when the user already has a pending (undecided) submission. */
async function hasPendingSubmission(client, userId) {
  const channelId = config.channels.verificationReviews();
  if (!channelId) return false;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return false;
  try {
    const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    if (!messages) return false;
    for (const m of messages.values()) {
      if (m.author?.id !== client.user.id) continue;
      if (!m.components?.length) continue; // buttons removed = already decided
      const desc = m.embeds?.[0]?.description ?? "";
      if (desc.includes(`<@${userId}>`)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Collect a proof image/link from the user's DMs (10 minute window). */
async function collectProofInDm(interaction) {
  const dm = await interaction.user.createDM().catch(() => null);
  if (!dm) return null;
  await dm
    .send({
      embeds: [
        buildEmbed({
          title: "Proof of Invitation",
          description: "> Please send a screenshot of your invitation here.\n> You have **10 minutes** to attach it.",
        }),
      ],
    })
    .catch(() => {});
  try {
    const collected = await dm.awaitMessages({
      max: 1,
      time: PROOF_DM_TIMEOUT_MS,
      errors: ["time"],
    });
    const msg = collected.first();
    if (msg?.attachments?.size) return msg.attachments.first().url;
    const link = msg?.content?.match(/https?:\/\/\S+/);
    return link ? link[0] : null;
  } catch {
    return null; // timed out - proceed without proof
  }
}

async function handleVerificationModal(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const name = interaction.fields.getTextInputValue("v_name").trim();
  const invite = interaction.fields.getTextInputValue("v_invite").trim();
  const rank = interaction.fields.getTextInputValue("v_rank").trim();
  const proofInput = interaction.fields.getTextInputValue("v_proof").trim();

  const userId = interaction.user.id;

  // No duplicate submissions while one is under review.
  if (pendingUsers.has(userId) || (await hasPendingSubmission(interaction.client, userId))) {
    pendingUsers.set(userId, true);
    return interaction.editReply({
      content:
        "You already have a verification request under review. Please wait for our Training Leadership to review it (**12-24 hours**).",
    });
  }
  pendingUsers.set(userId, true);

  await sendDiscordDm(interaction.client, userId, {
    title: "Verification Received",
    description: [
      "> Your verification form has been received.",
      "> Our Training Leadership will review it within **12-24 hours**.",
      "> Please be patient while it is processed.",
    ].join("\n"),
  });

  // If they did not paste a proof link, give them 10 minutes to attach one.
  let proof = proofInput && proofInput.toLowerCase() !== "none" ? proofInput : null;
  if (!proof) {
    proof = await collectProofInDm(interaction);
  }

  const reviewChannelId = config.channels.verificationReviews();
  if (!reviewChannelId) {
    console.warn("[Verify] No review channel configured (FRESHWAY_CHANNEL_VERIFICATION_REVIEWS)");
    return interaction.editReply({
      content: "Your form was received, but the review channel is not configured yet. Please contact Training Leadership.",
    });
  }
  const channel = await interaction.client.channels.fetch(reviewChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    console.warn(`[Verify] Review channel ${reviewChannelId} not found or not a text channel`);
    return interaction.editReply({
      content: "Your form was received, but the review channel is unavailable. Please contact Training Leadership.",
    });
  }

  const description = [
    `> **Name & Usernames:** ${name}`,
    `> **Invited by:** ${invite}`,
    `> **Requested Rank:** ${rank}`,
    `> **Proof:** ${proof || "Not provided"}`,
    `> **Discord:** <@${userId}>`,
  ].join("\n");

  const leadershipId = config.roles.trainingLeadership();
  await channel.send({
    content: leadershipId ? `<@&${leadershipId}>` : " ",
    embeds: [buildEmbed({ title: "Verification Request", description })],
    components: [buildDecisionRow(userId)],
  });
  console.log(`[Verify] Submission from ${userId} posted to ${reviewChannelId}`);

  await interaction.editReply({
    content: "Form received! You will be notified once our Training Leadership reviews it (**12-24 hours**).",
  });
}

function buildDecisionRow(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${VERIFY_ACCEPT_PREFIX}${userId}`)
      .setLabel("Accept")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${VERIFY_FAIL_PREFIX}${userId}`)
      .setLabel("Fail")
      .setStyle(ButtonStyle.Danger),
  );
}

/** Assign the requested rank role (Trainer or Directory) to a member. */
async function assignRankRole(interaction, userId, requestedRank) {
  const roleKey = requestedRank.includes("directory") ? "directory" : "trainer";
  const roleId = config.roles[roleKey]?.();
  if (!roleId || !interaction.guild) return false;
  try {
    const member = await interaction.guild.members.fetch(userId).catch(() => null);
    if (!member) return false;
    await member.roles.add(roleId);
    return true;
  } catch (e) {
    console.error("[Verify] Failed to assign role:", e);
    return false;
  }
}

/** Accept or fail a verification submission (from the review channel buttons). */
async function handleVerificationDecision(interaction) {
  const accepted = interaction.customId.startsWith(VERIFY_ACCEPT_PREFIX);
  const userId = interaction.customId.split(":")[1];

  await interaction.deferUpdate();

  if (!canLead(interaction)) {
    return interaction.followUp({
      content: "Only Training Leadership can decide verification requests.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const embed = interaction.message.embeds?.[0];
  const description = embed?.description ?? "";
  const rankLine = description.split("\n").find((l) => l.startsWith("> **Requested Rank:** "));
  const requestedRank = rankLine ? rankLine.replace("> **Requested Rank:** ", "").trim() : "";

  let roleAssigned = false;
  if (accepted) {
    roleAssigned = await assignRankRole(interaction, userId, requestedRank);
  }

  if (accepted) {
    const roleName = requestedRank.toLowerCase().includes("directory") ? "Directory" : "Trainer";
    await sendDiscordDm(interaction.client, userId, {
      title: "Verification Accepted",
      description: [
        "> Congratulations! Your verification request has been **accepted**.",
        roleAssigned
          ? `> You have been given the **${roleName}** rank.`
          : `> Your requested rank (**${roleName}**) could not be assigned automatically - please contact a Training Manager.`,
        "> Welcome to the FreshWay Training Division!",
      ].join("\n"),
    });
  } else {
    await sendDiscordDm(interaction.client, userId, {
      title: "Verification Update",
      description: [
        "> Unfortunately, your verification request was **not accepted**.",
        "> If you believe this is a mistake, please contact a Training Manager.",
      ].join("\n"),
    });
  }

  // Patch the embed (color + status) and remove the buttons.
  const patched = embed.toJSON();
  patched.color = accepted ? FW_GREEN : config.colors.red;
  patched.description = `${description}\n\n> **Status:** ${accepted ? "Accepted" : "Declined"} by **${interaction.user.username}**`;
  await interaction.message.edit({ embeds: [patched], components: [] }).catch(() => {});

  pendingUsers.delete(userId);
  console.log(`[Verify] ${accepted ? "Accepted" : "Failed"} verification for ${userId} by ${interaction.user.username}`);

  await interaction.followUp({
    content: accepted ? "Request accepted - the user has been notified." : "Request failed - the user has been notified.",
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = {
  VERIFY_BUTTON_ID,
  VERIFY_ACCEPT_PREFIX,
  VERIFY_FAIL_PREFIX,
  welcomeDescription,
  ensureVerification,
  handleVerifyButton,
  handleVerificationModal,
  handleVerificationDecision,
};
