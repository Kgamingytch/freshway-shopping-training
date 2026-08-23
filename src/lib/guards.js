// Command guards - role checks for slash commands based on configured role
// IDs (FRESHWAY_ROLE_*) and the bot owner.

const config = require("../config");

function hasRole(interaction, key) {
  const roleId = config.roles[key]?.();
  if (!roleId) return false;
  return interaction.member?.roles?.cache?.has(roleId) ?? false;
}

function isOwner(interaction) {
  const ownerId = process.env.OWNER_ID?.trim();
  return !!ownerId && String(interaction.user.id) === ownerId;
}

/** Trainer, staff, management, or the bot owner. */
function canManage(interaction) {
  return (
    isOwner(interaction) ||
    hasRole(interaction, "trainer") ||
    hasRole(interaction, "staff") ||
    hasRole(interaction, "management")
  );
}

module.exports = { canManage, isOwner, hasRole };
