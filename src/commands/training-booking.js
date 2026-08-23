const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { getSupabase } = require("../lib/supabase");
const { notifySessionCreated } = require("../lib/notifications");
const { canManage } = require("../lib/guards");

const SESSION_TYPES = ["Training", "Store Shift", "Promotional Shift", "Community Event"];

module.exports = {
  data: new SlashCommandBuilder()
    .setName("training-booking")
    .setDescription("Book a training session or shift (same system as the portal)")
    .addStringOption((o) => o.setName("title").setDescription("Session or shift title").setRequired(true))
    .addStringOption((o) =>
      o
        .setName("type")
        .setDescription("Session type")
        .setRequired(false)
        .addChoices(...SESSION_TYPES.map((t) => ({ name: t, value: t }))),
    )
    .addStringOption((o) =>
      o.setName("when").setDescription("Date and time, e.g. 2026-08-25 18:00 UTC").setRequired(false),
    )
    .addStringOption((o) => o.setName("game-link").setDescription("Roblox game link").setRequired(false))
    .addStringOption((o) => o.setName("description").setDescription("Short description").setRequired(false))
    .addIntegerOption((o) =>
      o.setName("max-participants").setDescription("Max participants").setRequired(false).setMinValue(1),
    )
    .addUserOption((o) => o.setName("host").setDescription("Host (defaults to you)").setRequired(false)),

  async execute(interaction) {
    if (!canManage(interaction)) {
      return interaction.reply({
        content: "You need the Trainer, Staff, or Management role to use this.",
        flags: MessageFlags.Ephemeral,
      });
    }

    // Defer first - Supabase insert + channel post can exceed the 3s window.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const sb = getSupabase();
    if (!sb) {
      return interaction.editReply({
        content: "Supabase is not configured on this bot - cannot create sessions.",
      });
    }

    const title = interaction.options.getString("title", true);
    const type = interaction.options.getString("type") ?? "Training";
    const whenRaw = interaction.options.getString("when");
    const gameLink = interaction.options.getString("game-link");
    const description = interaction.options.getString("description");
    const maxParticipants = interaction.options.getInteger("max-participants");
    const hostUser = interaction.options.getUser("host");

    let scheduledAt = null;
    if (whenRaw) {
      const parsed = new Date(whenRaw);
      if (!Number.isNaN(parsed.getTime())) scheduledAt = parsed.toISOString();
    }

    // Resolve the host's profile (user id) from their Discord id.
    const targetDiscordId = hostUser ? hostUser.id : interaction.user.id;
    const { data: hostProfile } = await sb
      .from("profiles")
      .select("id")
      .eq("discord_id", targetDiscordId)
      .maybeSingle()
      .catch(() => ({ data: null }));
    const hostUserId = hostProfile?.id ?? null;

    const { data: session, error } = await sb
      .from("training_sessions")
      .insert({
        title,
        session_type: type,
        host_user_id: hostUserId,
        description: description ?? null,
        roblox_game_link: gameLink ?? null,
        scheduled_at: scheduledAt,
        max_participants: maxParticipants ?? null,
        status: "scheduled",
      })
      .select("id, title, scheduled_at")
      .single()
      .catch((e) => ({ data: null, error: e }));

    if (error || !session) {
      return interaction.editReply({
        content: `Failed to create the session: ${error?.message ?? "unknown error"}`,
      });
    }

    // Post the announcement to the trainings channel with join buttons
    // (best effort - the same flow the website triggers).
    await notifySessionCreated(interaction.client, session.id);

    await interaction.editReply({
      content: `Session booked - **${session.title}** (${type})${scheduledAt ? ` at ${scheduledAt}` : " (unscheduled)"}. Posted to the trainings channel.`,
    });
  },
};
