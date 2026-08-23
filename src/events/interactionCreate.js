const { Events, MessageFlags } = require("discord.js");
const { updateTimetableMessage, TIMETABLE_REFRESH_ID } = require("../lib/timetable");
const { handleSessionJoin } = require("../lib/session-join");
const {
  VERIFY_BUTTON_ID,
  VERIFY_ACCEPT_PREFIX,
  VERIFY_FAIL_PREFIX,
  VERIFY_MODAL_ID,
  handleVerifyButton,
  handleVerificationModal,
  handleVerificationDecision,
} = require("../lib/verification");
const {
  VOTE_ACCEPT_PREFIX,
  VOTE_DENY_PREFIX,
  VOTE_MODAL_ID,
  handleVotingModal,
  handleVotingButton,
} = require("../lib/voting");

module.exports = {
  name: Events.InteractionCreate,
  once: false,
  async execute(interaction) {
    // ---- Buttons ----
    if (interaction.isButton()) {
      const id = interaction.customId;
      if (id === TIMETABLE_REFRESH_ID) {
        await interaction.deferUpdate();
        const ok = await updateTimetableMessage(interaction.client, interaction.message);
        if (!ok) {
          await interaction
            .followUp({
              content: "Could not refresh the timetable.",
              flags: MessageFlags.Ephemeral,
            })
            .catch(() => {});
        }
      } else if (id.startsWith("session_join_")) {
        await handleSessionJoin(interaction);
      } else if (id === VERIFY_BUTTON_ID) {
        await handleVerifyButton(interaction);
      } else if (id.startsWith(VERIFY_ACCEPT_PREFIX) || id.startsWith(VERIFY_FAIL_PREFIX)) {
        await handleVerificationDecision(interaction);
      } else if (id.startsWith(VOTE_ACCEPT_PREFIX) || id.startsWith(VOTE_DENY_PREFIX)) {
        await handleVotingButton(interaction);
      }
      return;
    }

    // ---- Modal submits ----
    if (interaction.isModalSubmit()) {
      if (interaction.customId === VERIFY_MODAL_ID) {
        await handleVerificationModal(interaction);
      } else if (interaction.customId === VOTE_MODAL_ID) {
        await handleVotingModal(interaction);
      }
      return;
    }

    // ---- Slash commands ----
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) {
      console.warn(`[CMD] No handler for /${interaction.commandName}`);
      return;
    }

    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(`[CMD] Error in /${interaction.commandName}:`, err);

      const reply = {
        content: "❌ Something went wrong running that command.",
        flags: MessageFlags.Ephemeral,
      };

      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(reply);
        } else {
          await interaction.reply(reply);
        }
      } catch (replyErr) {
        // Interaction already expired (10062) - nothing to reply to.
        console.warn(`[CMD] Could not reply for /${interaction.commandName}:`, replyErr);
      }
    }
  },
};
