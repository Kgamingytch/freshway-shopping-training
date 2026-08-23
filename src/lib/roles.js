// Role management - add/remove Discord roles (e.g. Certified Trainer).

/**
 * Add a role to a guild member. Returns true on success.
 */
async function addGuildRole(client, guildId, userId, roleId) {
  try {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return false;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return false;
    await member.roles.add(roleId);
    console.log(`[Role] Added role ${roleId} to user ${userId}`);
    return true;
  } catch (e) {
    console.error(`[Role] Failed to add role ${roleId} to user ${userId}:`, e);
    return false;
  }
}

/**
 * Remove a role from a guild member. Returns true on success.
 */
async function removeGuildRole(client, guildId, userId, roleId) {
  try {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return false;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return false;
    await member.roles.remove(roleId);
    console.log(`[Role] Removed role ${roleId} from user ${userId}`);
    return true;
  } catch (e) {
    console.error(`[Role] Failed to remove role ${roleId} from user ${userId}:`, e);
    return false;
  }
}

module.exports = { addGuildRole, removeGuildRole };
