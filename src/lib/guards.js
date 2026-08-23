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

/**
 * Training Leadership (or the management role as a fallback) - used for
 * verification decisions and staff-case buttons.
 */
function canLead(interaction) {
  return (
    isOwner(interaction) ||
    hasRole(interaction, "trainingLeadership") ||
    hasRole(interaction, "management")
  );
}

module.exports = { canManage, canLead, isOwner, hasRole };
