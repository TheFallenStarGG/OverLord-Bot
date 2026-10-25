const storage = require('./storage');
const { logging } = require('./logging');

function wipeUserInGuild(guildId, userId) {
  if (!guildId || !userId) throw new Error('Missing guild or user');

  storage.runIn(guildId, () => {
    try {
      require('./economy').deleteUser(userId);
    } catch {}
    try {
      require('./stocks').clearUser(userId);
    } catch {}
    try {
      require('./muscle').clearUser(userId);
    } catch {}
  });

  logging('warn', 'User data wiped', `${userId} in guild ${guildId}`);
  return { ok: true };
}

module.exports = { wipeUserInGuild };
