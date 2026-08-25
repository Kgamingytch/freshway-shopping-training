// Training Division verification system.
//
// Flow:
//   1. A welcome embed with a "Verify & Authorization" button lives in the
//      verification channel (auto-posted on startup if missing, or via
//      /verify-setup).
//   2. Clicking the button opens an application modal (name, invited by, rank).
//   3. On submit the user is told to check DMs for proof collection.
//   4. A global messageCreate listener picks up the proof image from DMs.
//   5. The submission is posted to the review channel; Training Leadership is pinged.
//   6. Accept assigns the requested rank role and DMs the user. Fail DMs the user.

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
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

// Pending proof collection: userId -> { proof, timer, onCollected }
const pendingProofs = new Map();

/** The exact welcome copy from Training Leadership. */
function welcomeDescription() {
  return [
    "> <:moderation:1520498323121897634> Welcome dear member! Here in the Training Division there are dedicated people with the number one point of synthesizing and training new staff to reach and show their maximum capabilities. As a trainer here you will have more responsibilities that will be discussed further.",
    "",
    "> <:arrow:1529399913194979458> Therefore, to continue to our verification please click the button below \"Verify & Authorization\" and continue with what is said in the form. If you are and have been invited please add the proof so that the security rate is maximum and to ensure that your request will be accepted.",
    "",
    "> <:arrow:1529399913194979458> If you are a Directory Member please put the rank \"Directory\" if you are or invited and have passed our application/interview or have been handpicked please choose the rank \"Trainer\". Once you have submitted our Training Leadership will be pinged as quickly as possible for this request to be accepted. Thank you once again for choosing FreshWay!",
  ].join("\n");
}

function buildWelcomeEmbed() {
  return buildEmbed({ title: "", description: welcomeDescription() });
}

function buildWelcomeRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(VERIFY_BUTTON_ID)
      .setLabel("Verify & Authorization")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji({ id: "1526129915575930982" }),  // ✅ Object with id
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

async function handleVerifyButton(interaction) {
  await interaction.showModal(buildVerificationModal());
}

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
  );
  return modal;
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
      if (!m.components?.length) continue;
      const desc = m.embeds?.[0]?.description ?? "";
      if (desc.includes(`<@${userId}>`)) return true;
    }
    return false;
  } catch {
    return false;
  }
}
/**
 * Handle a DM message from a user who is waiting to provide proof.
 * Called from the global messageCreate listener in index.js.
 * Returns true if the message was consumed (proof received).
 */
async function handleProofDm(message) {
  if (message.channel.type !== ChannelType.DM) return false;
  if (message.author.bot) return false;

  const userId = message.author.id;
  const pending = pendingProofs.get(userId);
  if (!pending) return false;

  console.log(`[Verify] Received DM from ${userId}: attachments=${message.attachments?.size ?? 0}`);

  let proof = null;

  // Check for attachment first
  if (message.attachments?.size) {
    proof = message.attachments.first().url;
    console.log(`[Verify] Proof attachment URL: ${proof}`);
  } else {
    // Fall back to a link in the message text
    const link = message.content?.match(/https?:\/\/\S+/);
    if (link) {
      proof = link[0];
      console.log(`[Verify] Proof link from text: ${proof}`);
    }
  }

  if (proof) {
    // Clear the timeout and resolve
    clearTimeout(pending.timer);
    pending.proof = proof;
    pending.resolve(proof);
    pendingProofs.delete(userId);

    // Confirm to user
    await message.reply({
      embeds: [
        buildEmbed({
          title: "Proof Received",
          description: "> Your proof has been received. Your request will be reviewed within **12-24 hours**.",
        }),
      ],
    }).catch(() => {});
  } else {
    // No proof in this message — remind them
    await message.reply({
      content: "Please send an **image/screenshot** as proof of your invitation.",
    }).catch(() => {});
  }

  return true;
}

/**
 * Collect proof via DM using a Promise + timeout.
 * Returns the proof URL or null if nothing was sent within 10 minutes.
 */
function collectProofInDm(client, userId) {
  return new Promise(async (resolve) => {
    // Send DM asking for proof
    console.log(`[Verify] Sending DM proof request to ${userId}`);
    try {
      const user = await client.users.fetch(String(userId));
      const dm = await user.createDM();
      await dm.send({
        embeds: [
          buildEmbed({
            title: "Proof of Invitation",
            description: [
              "> Please **send a screenshot** of your invitation here.",
              "> You have **10 minutes** to send it.",
              "> If you do not send proof, your request will still be reviewed.",
            ].join("\n"),
          }),
        ],
      });
      console.log(`[Verify] DM proof request sent to ${userId}`);
    } catch (e) {
      console.error(`[Verify] Failed to send DM to ${userId}:`, e);
      return resolve(null);
    }

    // Set up timeout
    const timer = setTimeout(() => {
      pendingProofs.delete(userId);
      console.log(`[Verify] DM proof collection timed out for ${userId}`);
      resolve(null);
    }, PROOF_DM_TIMEOUT_MS);

    // Store in pending map so global messageCreate can pick it up
    pendingProofs.set(userId, { proof: null, timer, resolve });
  });
}

async function handleVerificationModal(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const name = interaction.fields.getTextInputValue("v_name").trim();
  const invite = interaction.fields.getTextInputValue("v_invite").trim();
  const rank = interaction.fields.getTextInputValue("v_rank").trim();
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

  // Tell the user to check DMs
  await interaction.editReply({
    content: "Form received! **Please check your DMs** to send proof of invitation.",
  });

  // Collect proof via DM (non-blocking, uses global messageCreate listener)
  console.log(`[Verify] Collecting proof from ${userId} via DM...`);
  let proof = await collectProofInDm(interaction.client, userId);
  console.log(`[Verify] Proof result for ${userId}: ${proof || "none"}`);

  const reviewChannelId = config.channels.verificationReviews();
  if (!reviewChannelId) {
    console.warn("[Verify] No review channel configured (FRESHWAY_CHANNEL_VERIFICATION_REVIEWS)");
    return interaction.editReply({
      content: "Your form was received, but the review channel is not configured yet. Please contact Training Leadership.",
    }).catch(() => {});
  }
  const channel = await interaction.client.channels.fetch(reviewChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    console.warn(`[Verify] Review channel ${reviewChannelId} not found or not a text channel`);
    return interaction.editReply({
      content: "Your form was received, but the review channel is unavailable. Please contact Training Leadership.",
    }).catch(() => {});
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
    content: "All done! Your verification request has been submitted. Training Leadership will review it within **12-24 hours**.",
  }).catch(() => {});
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
  const roleKey = requestedRank.toLowerCase().includes("directory") ? "directory" : "trainer";
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
  VERIFY_MODAL_ID,
  welcomeDescription,
  ensureVerification,
  handleVerifyButton,
  handleVerificationModal,
  handleVerificationDecision,
  handleProofDm,
  pendingProofs,
};