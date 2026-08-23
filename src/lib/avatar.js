// Discord user lookup - returns a user's current username/global name and
// avatar URL. The website uses this to keep staff avatars fresh (Discord has
// no public avatar API, so this is the only way).

/** Deterministic Discord default avatar (same algorithm as the website). */
function defaultAvatarUrl(discordId) {
  const digits = String(discordId).replace(/\D/g, "").slice(0, 15);
  const n = digits ? Number(BigInt(digits) % 5n) : 0;
  return `https://cdn.discordapp.com/embed/avatars/${n}.png`;
}

/**
 * Fetch a user's current profile from Discord.
 * Returns { ok: false } when the user can't be resolved.
 */
async function getUserProfile(client, discordId) {
  try {
    const user = await client.users.fetch(String(discordId)).catch(() => null);
    if (!user) return { ok: false };

    return {
      ok: true,
      username: user.username,
      globalName: user.globalName ?? null,
      avatar: user.avatar ?? null,
      avatarUrl: user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${user.avatar.startsWith("a_") ? "gif" : "png"}?size=256`
        : defaultAvatarUrl(user.id),
    };
  } catch {
    return { ok: false };
  }
}

module.exports = { getUserProfile, defaultAvatarUrl };
