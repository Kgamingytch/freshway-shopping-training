// [engineering]
const { Events, MessageFlags } = require("discord.js");
const { updateTimetableMessage, TIMETABLE_REFRESH_ID } = require("../lib/timetable");
const { updateTrainingsBoard, TRAININGS_REFRESH_ID } = require("../lib/boards");
const {
  handleSessionJoin,
  handleSessionManage,
  handleSessionJoinAction,
  MANAGE_PREFIX,
  MANAGE_JOIN_CO_HOST_PREFIX,
  MANAGE_JOIN_HELPER_PREFIX,
  MANAGE_LEAVE_PREFIX,
} = require("../lib/session-join");
const {
  BOOKING_SELECT_ID,
  BOOKING_CANCEL_ID,
  BOOKING_MODAL_ID,
  handleBookingSelect,
  handleBookingCancel,
  handleBookingModal,
} = require("../lib/booking");
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
  VOTE_YES_PREFIX,
  VOTE_NO_PREFIX,
  VOTE_MODAL_ID,
  handleVotingModal,
  handleVotingButton,
  handleVoteButton,
} = require("../lib/voting");
const {
  SUBSCRIBE_ID,
  UNSUBSCRIBE_PREFIX,
  PB_SUB_PREFIX,
  PB_UNSUB_PREFIX,
  PB_MINE_ID,
  PB_UNSUB_ALL_ID,
  handleSessionSubscribe,
  handleSessionUnsubscribe,
  handleMySubscriptions,
  handleUnsubscribeAll,
  handleSubscribeButton,
  handleUnsubscribeButton,
} = require("../lib/public-board");
const E = require("../lib/emojis");
const hostPanel = require("../lib/host-panel");
const { handleConsolePowerButton } = require("../lib/console-panel");

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
      } else if (id === TRAININGS_REFRESH_ID) {
        await interaction.deferUpdate();
        const ok = await updateTrainingsBoard(interaction.client);
        if (!ok.ok) {
          await interaction
            .followUp({
              content: `Could not refresh the trainings board: ${ok.error ?? "unknown error"}`,
              flags: MessageFlags.Ephemeral,
            })
            .catch(() => {});
        }
      } else if (await handleConsolePowerButton(interaction).catch((e) => {
        console.error("[ConsolePanel] power button failed:", e);
        return false;
      })) {
        // handled by the console panel
      } else if (
        await hostPanel.handleHostPanelInteraction(interaction).catch((e) => {
          console.error("[HostPanel] interaction failed:", e);
          return false;
        })
      ) {
        // handled by the host DM control panel
      } else if (id.startsWith(MANAGE_JOIN_CO_HOST_PREFIX) ||
        id.startsWith(MANAGE_JOIN_HELPER_PREFIX) ||
        id.startsWith(MANAGE_LEAVE_PREFIX)
      ) {
        await handleSessionJoinAction(interaction);
      } else if (id.startsWith(MANAGE_PREFIX)) {
        await handleSessionManage(interaction);
      } else if (id.startsWith("session_join_")) {
        await handleSessionJoin(interaction);
      } else if (id === VERIFY_BUTTON_ID) {
        await handleVerifyButton(interaction);
      } else if (id.startsWith(VERIFY_ACCEPT_PREFIX) || id.startsWith(VERIFY_FAIL_PREFIX)) {
        await handleVerificationDecision(interaction);
      } else if (id.startsWith(VOTE_ACCEPT_PREFIX) || id.startsWith(VOTE_DENY_PREFIX)) {
        await handleVotingButton(interaction);
      } else if (id.startsWith(VOTE_YES_PREFIX) || id.startsWith(VOTE_NO_PREFIX)) {
        await handleVoteButton(interaction);
      } else if (id === BOOKING_CANCEL_ID) {
        await handleBookingCancel(interaction);
      } else if (id === SUBSCRIBE_ID) {
        await handleSubscribeButton(interaction);
      } else if (id === UNSUBSCRIBE_PREFIX) {
        await handleUnsubscribeButton(interaction);
      } else if (id.startsWith(PB_SUB_PREFIX)) {
        await handleSessionSubscribe(interaction, id.slice(PB_SUB_PREFIX.length));
      } else if (id.startsWith(PB_UNSUB_PREFIX)) {
        await handleSessionUnsubscribe(interaction, id.slice(PB_UNSUB_PREFIX.length));
      } else if (id === PB_MINE_ID) {
        await handleMySubscriptions(interaction);
      } else if (id === PB_UNSUB_ALL_ID) {
        await handleUnsubscribeAll(interaction);
      }
      return;
    }

    // ---- Select menus ----
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === BOOKING_SELECT_ID) {
        await handleBookingSelect(interaction);
      } else if (
        await hostPanel
          .handleHostPanelInteraction(interaction)
          .catch((e) => {
            console.error("[HostPanel] select failed:", e);
            return false;
          })
      ) {
        // handled by the host DM control panel
      }
      return;
    }

    // ---- Modal submits ----
    if (interaction.isModalSubmit()) {
      if (interaction.customId === VERIFY_MODAL_ID) {
        await handleVerificationModal(interaction);
      } else if (interaction.customId === VOTE_MODAL_ID) {
        await handleVotingModal(interaction);
      } else if (interaction.customId.startsWith(BOOKING_MODAL_ID)) {
        await handleBookingModal(interaction);
      } else if (
        await hostPanel
          .handleHostPanelInteraction(interaction)
          .catch((e) => {
            console.error("[HostPanel] modal failed:", e);
            return false;
          })
      ) {
        // handled by the host DM control panel
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
        content: `${E.cross} Something went wrong running that command.`,
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
