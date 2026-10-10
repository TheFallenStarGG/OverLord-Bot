const { exportAll } = require('../lib/webexport');

module.exports = {
  name: '!!webexport',
  usage: '!!webexport',
  description: 'Owner only. Sends the changelog and leaderboards to the website right now instead of waiting for the next automatic update.',
  access: 'owner',

  async run(message, arg, ctx) {
    if (!ctx.isOwner) return;
    try {
      const r = await exportAll(message.client);
      if (r.skipped) return message.reply(`Skipped: ${r.skipped}.`);
      return message.reply(
        `🌐 Changelog: ${r.changelog ? 'updated' : 'unchanged'} · Leaderboards: ${r.leaderboards ? 'updated' : 'unchanged'} · ${r.servers} server(s) listed, ${r.players} player(s). It can take up to 5 minutes to show on the site.`
      );
    } catch (err) {
      return message.reply(`❌ Export failed: ${String(err.message).slice(0, 300)}`);
    }
  },
};
