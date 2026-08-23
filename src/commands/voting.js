const {
  SlashCommandBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require("discord.js");
const { hasRole, isOwner } = require("../lib/guards");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("voting")
    .setDescription("Open a staff case for a Training Leadership vote (TM only)"),

  async execute(interaction) {
    const allowed = isOwner(interaction) || hasRole(interaction, "tm") || hasRole(interaction, "management");
    if (!allowed) {
      return interaction.reply({
        content: "Only Training Managers can open a case.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const modal = new ModalBuilder().setCustomId("voting_modal").setTitle("Open a Staff Case");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("v_report_subject")
          .setLabel("1. Who is the person being reported?")
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("v_report_reason")
          .setLabel("2. What is the reason for the report?")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("v_report_proof")
          .setLabel("3. Do you have proof? Yes or no?")
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
    );

    return interaction.showModal(modal);
  },
};
