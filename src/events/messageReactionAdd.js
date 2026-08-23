const { Events } = require("discord.js");
const { handleVoteReaction } = require("../lib/voting");

module.exports = {
  name: Events.MessageReactionAdd,
  once: false,
  async execute(reaction, user) {
    try {
      if (reaction.partial) {
        await reaction.fetch().catch(() => {});
      }
      await handleVoteReaction(reaction, user);
    } catch (e) {
      console.error("[Voting] Reaction handler failed:", e);
    }
  },
};
