// Last place a user ran a bot command (for vote pings, etc.)
const last = new Map(); // userId -> { guildId, channelId, at }

function touch(userId, guildId, channelId) {
  if (!userId || !guildId || !channelId) return;
  last.set(String(userId), {
    guildId: String(guildId),
    channelId: String(channelId),
    at: Date.now(),
  });
  if (last.size > 20000) {
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    for (const [k, v] of last) if (v.at < cutoff) last.delete(k);
  }
}

function get(userId) {
  return last.get(String(userId)) || null;
}

module.exports = { touch, get };
