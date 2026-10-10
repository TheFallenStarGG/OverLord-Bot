const { exportAll, exportStatus } = require('../lib/webexport');

module.exports = {
  name: '!!webexport',
  usage: '!!webexport',
  description: 'Owner only. Sends everything to the website right now instead of waiting for the next automatic update.',
  access: 'owner',

  async run(message, arg, ctx) {
    if (!ctx.isOwner) return;
    try {
      const r = await exportAll(message.client, ctx.commands);
      if (r.skipped) return message.reply(`Skipped: ${r.skipped}.`);
      await exportStatus(message.client).catch(() => {});
      return message.reply(
        `🌐 Updated: ${r.updated.join(', ') || 'nothing'}\n` +
          `Unchanged: ${r.unchanged.join(', ') || 'nothing'}\n` +
          (r.failed.length ? `❌ Failed: ${r.failed.join('; ')}\n` : '') +
          `${r.servers} server(s) listed. It can take up to 5 minutes to show on the site.`
      );
    } catch (err) {
      return message.reply(`❌ Export failed: ${String(err.message).slice(0, 300)}`);
    }
  },
};
