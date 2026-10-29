const antiraid = require('../lib/antiraid');

module.exports = (client) => {
  client.on('guildMemberAdd', async (member) => {
    try {
      await antiraid.handleMemberAdd(member);
    } catch (_) {}
    try {
      await antiraid.sendWelcome(member);
    } catch (_) {}
  });
};
