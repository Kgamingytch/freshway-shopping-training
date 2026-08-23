// FreshWay embed builder.
//
// All bot messages follow the FreshWay style:
//   - green color by default (FW_GREEN)
//   - description lines use "> " prefix with **bold** key words
//   - no emojis, no fields
//   - footer is always "FreshWay Training Portal"

const FW_GREEN = 0x1a5632;
const FW_LOG_GRAY = 0x66756a;

/**
 * Build a FreshWay-styled embed object.
 * Title is truncated to 256 chars, description to 4096 (Discord limits).
 */
function buildEmbed({ title, description, color }) {
  return {
    title: String(title ?? "").slice(0, 256),
    description: String(description ?? "").slice(0, 4096),
    color: color ?? FW_GREEN,
    footer: { text: "FreshWay Training Portal" },
    timestamp: new Date().toISOString(),
  };
}

module.exports = { FW_GREEN, FW_LOG_GRAY, buildEmbed };
